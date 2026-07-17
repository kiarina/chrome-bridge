#!/usr/bin/env python3
"""Validate and concatenate ordered chrome-bridge demo recordings."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input_dir", type=Path, help="Directory containing NN-*.webm clips"
    )
    parser.add_argument("output_webm", type=Path, help="Joined WebM output path")
    parser.add_argument("--mp4", type=Path, help="Optional H.264 MP4 output path")
    return parser.parse_args()


def require_program(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Required program not found: {name}")


def video_signature(path: Path) -> dict[str, object]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,pix_fmt,r_frame_rate,time_base",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    streams = json.loads(result.stdout).get("streams", [])
    if len(streams) != 1:
        raise SystemExit(f"Expected exactly one video stream: {path}")
    return streams[0]


def concat_line(path: Path) -> str:
    escaped = str(path.resolve()).replace("'", "'\\''")
    return f"file '{escaped}'\n"


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def main() -> None:
    args = parse_args()
    require_program("ffmpeg")
    require_program("ffprobe")

    clips = sorted(args.input_dir.glob("[0-9][0-9]-*.webm"))
    if not clips:
        raise SystemExit(f"No NN-*.webm clips found below {args.input_dir}")
    if args.output_webm.exists():
        raise SystemExit(f"Refusing to overwrite existing output: {args.output_webm}")
    if args.mp4 and args.mp4.exists():
        raise SystemExit(f"Refusing to overwrite existing output: {args.mp4}")

    signatures = [video_signature(clip) for clip in clips]
    first = signatures[0]
    compatible = all(signature == first for signature in signatures[1:])
    args.output_webm.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="chrome-bridge-demo-") as temporary:
        concat_file = Path(temporary) / "clips.txt"
        concat_file.write_text(
            "".join(concat_line(clip) for clip in clips), encoding="utf-8"
        )
        base = [
            "ffmpeg",
            "-v",
            "warning",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-map",
            "0:v:0",
            "-an",
        ]

        if compatible:
            try:
                run([*base, "-c:v", "copy", str(args.output_webm)])
            except subprocess.CalledProcessError:
                args.output_webm.unlink(missing_ok=True)
                compatible = False

        if not compatible:
            width = max(int(signature["width"]) for signature in signatures)
            height = max(int(signature["height"]) for signature in signatures)
            width += width % 2
            height += height % 2
            video_filter = (
                "scale='trunc(iw/2)*2':'trunc(ih/2)*2',"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x17213f,"
                "setsar=1"
            )
            try:
                run(
                    [
                        *base,
                        "-vf",
                        video_filter,
                        "-c:v",
                        "libvpx-vp9",
                        "-crf",
                        "31",
                        "-b:v",
                        "0",
                        "-deadline",
                        "good",
                        str(args.output_webm),
                    ]
                )
            except subprocess.CalledProcessError:
                args.output_webm.unlink(missing_ok=True)
                raise

    if args.mp4:
        args.mp4.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                "ffmpeg",
                "-v",
                "warning",
                "-i",
                str(args.output_webm),
                "-an",
                "-c:v",
                "libx264",
                "-crf",
                "20",
                "-preset",
                "medium",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(args.mp4),
            ]
        )

    mode = "stream copy" if compatible else "normalized VP9 encode"
    print(f"Joined {len(clips)} clips using {mode}: {args.output_webm}")
    if args.mp4:
        print(f"Created upload copy: {args.mp4}")


if __name__ == "__main__":
    main()
