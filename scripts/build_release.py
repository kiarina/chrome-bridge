from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "apps" / "extension"
DEFAULT_OUTPUT = ROOT / "release"
SOURCE_DATE_EPOCH = 315532800  # 1980-01-01, the earliest ZIP timestamp.


def load_extension_files() -> tuple[list[str], list[tuple[str, str]]]:
    config: dict[str, Any] = json.loads(
        (EXTENSION / "extension-files.json").read_text(encoding="utf-8")
    )
    runtime = config.get("runtime")
    notices = config.get("notices")
    if not isinstance(runtime, list) or not all(
        isinstance(item, str) for item in runtime
    ):
        raise ValueError("extension-files.json runtime must be a string list")
    if not isinstance(notices, list):
        raise ValueError("extension-files.json notices must be a list")
    notice_files: list[tuple[str, str]] = []
    for item in notices:
        if not isinstance(item, dict) or set(item) != {"source", "archive"}:
            raise ValueError("each extension notice needs source and archive")
        source, archive = item["source"], item["archive"]
        if not isinstance(source, str) or not isinstance(archive, str):
            raise ValueError("extension notice paths must be strings")
        notice_files.append((source, archive))
    return runtime, notice_files


def validate_relative_path(value: str) -> None:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"unsafe release path: {value!r}")


def extension_entries() -> list[tuple[Path, str]]:
    runtime, notices = load_extension_files()
    entries = [(EXTENSION / relative, relative) for relative in runtime]
    entries.extend((EXTENSION / source, archive) for source, archive in notices)
    archive_paths = [archive for _, archive in entries]
    for archive in archive_paths:
        validate_relative_path(archive)
    if len(archive_paths) != len(set(archive_paths)):
        raise ValueError("extension release paths must be unique")
    missing = [
        str(source.relative_to(ROOT)) for source, _ in entries if not source.is_file()
    ]
    if missing:
        raise FileNotFoundError(f"extension release files are missing: {missing}")
    return sorted(entries, key=lambda item: item[1])


def build_extension_zip(destination: Path) -> None:
    timestamp = time.gmtime(SOURCE_DATE_EPOCH)[:6]
    with zipfile.ZipFile(
        destination,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for source, name in extension_entries():
            info = zipfile.ZipInfo(name, date_time=timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            archive.writestr(info, source.read_bytes(), compresslevel=9)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(output_dir: Path) -> list[Path]:
    output_dir = output_dir.resolve()
    if output_dir == ROOT or output_dir == Path(output_dir.anchor):
        raise ValueError(f"refusing to replace unsafe output directory: {output_dir}")
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    env = {**os.environ, "SOURCE_DATE_EPOCH": str(SOURCE_DATE_EPOCH)}

    subprocess.run(
        ["npm", "--prefix", str(EXTENSION), "run", "build"],
        cwd=ROOT,
        check=True,
        env=env,
    )
    with tempfile.TemporaryDirectory(
        prefix="chrome-bridge-release-build-"
    ) as temporary:
        staging = Path(temporary)
        python_dir = staging / "python"
        python_dir.mkdir()
        for package in ("chrome-bridge-mcp", "chrome-bridge-sdk"):
            subprocess.run(
                [
                    "uv",
                    "build",
                    "--package",
                    package,
                    "--out-dir",
                    str(python_dir),
                ],
                cwd=ROOT,
                check=True,
                env=env,
            )
        extension_zip = staging / f"chrome-bridge-extension-{version}.zip"
        build_extension_zip(extension_zip)

        artifacts = [
            extension_zip,
            *sorted(python_dir.glob("*.whl")),
            *sorted(python_dir.glob("*.tar.gz")),
        ]
        if len(artifacts) != 5:
            raise RuntimeError(
                f"expected extension ZIP and two Python wheel/sdist pairs; got {artifacts}"
            )

        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True)
        copied = [
            Path(shutil.copy2(artifact, output_dir / artifact.name))
            for artifact in artifacts
        ]
        checksum_lines = [
            f"{sha256(artifact)}  {artifact.name}\n" for artifact in copied
        ]
        (output_dir / "SHA256SUMS").write_text(
            "".join(checksum_lines), encoding="ascii"
        )
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build reproducible chrome-bridge release artifacts"
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    artifacts = build(output_dir)
    for artifact in artifacts:
        print(f"{sha256(artifact)}  {artifact}")
    print(f"Checksums: {output_dir / 'SHA256SUMS'}")


if __name__ == "__main__":
    main()
