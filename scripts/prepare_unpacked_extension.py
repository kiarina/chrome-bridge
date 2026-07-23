from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "apps" / "extension"
RELEASE = ROOT / "release"
DESTINATION = ROOT / "unpacked-extension"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_extension_names() -> set[str]:
    config: dict[str, Any] = json.loads(
        (EXTENSION / "extension-files.json").read_text(encoding="utf-8")
    )
    return set(config["runtime"]) | {item["archive"] for item in config["notices"]}


def expected_checksum(archive: Path) -> str:
    checksum_path = RELEASE / "SHA256SUMS"
    if not checksum_path.is_file():
        raise FileNotFoundError(
            "release/SHA256SUMS is missing; run scripts/build_release.py first"
        )
    matches = []
    for line in checksum_path.read_text(encoding="ascii").splitlines():
        digest, separator, name = line.partition("  ")
        if separator and name == archive.name:
            matches.append(digest)
    if len(matches) != 1:
        raise ValueError(
            f"SHA256SUMS must contain exactly one entry for {archive.name}"
        )
    return matches[0]


def validate_archive(archive: Path, source_version: str) -> str:
    if not archive.is_file():
        raise FileNotFoundError(
            f"{archive.relative_to(ROOT)} is missing; run scripts/build_release.py first"
        )
    digest = sha256(archive)
    recorded_digest = expected_checksum(archive)
    if digest != recorded_digest:
        raise ValueError(
            f"SHA-256 mismatch for {archive.name}: expected {recorded_digest}, got {digest}"
        )

    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        expected_names = expected_extension_names()
        if set(names) != expected_names or len(names) != len(set(names)):
            raise ValueError("extension ZIP entries do not match extension-files.json")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or not path.parts:
                raise ValueError(f"unsafe extension ZIP path: {name!r}")
        manifest = json.loads(bundle.read("manifest.json"))
        if manifest.get("version") != source_version:
            raise ValueError(
                "extension ZIP version does not match apps/extension/manifest.json"
            )
    return digest


def replace_destination(archive: Path) -> None:
    if DESTINATION.parent != ROOT or DESTINATION.name != "unpacked-extension":
        raise RuntimeError(f"refusing unsafe destination: {DESTINATION}")
    if DESTINATION.is_symlink():
        raise RuntimeError(f"refusing to replace symlink destination: {DESTINATION}")
    if DESTINATION.exists() and not DESTINATION.is_dir():
        raise RuntimeError(f"destination is not a directory: {DESTINATION}")

    temporary = Path(tempfile.mkdtemp(prefix=".unpacked-extension-", dir=ROOT))
    staged = temporary / "staged"
    previous = temporary / "previous"
    staged.mkdir()
    try:
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                destination = staged.joinpath(*PurePosixPath(member.filename).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bundle.read(member))

        if DESTINATION.exists():
            DESTINATION.rename(previous)
        try:
            staged.rename(DESTINATION)
        except BaseException:
            if previous.exists() and not DESTINATION.exists():
                previous.rename(DESTINATION)
            raise
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def main() -> None:
    source_manifest = json.loads(
        (EXTENSION / "manifest.json").read_text(encoding="utf-8")
    )
    version = source_manifest["version"]
    archive = RELEASE / f"chrome-bridge-extension-{version}.zip"
    digest = validate_archive(archive, version)
    replace_destination(archive)
    print(f"Prepared Chrome extension {version}: {DESTINATION}")
    print(f"Source ZIP: {archive}")
    print(f"SHA-256: {digest}")
    print("Reload this fixed directory at chrome://extensions after each update.")


if __name__ == "__main__":
    main()
