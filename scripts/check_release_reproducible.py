from __future__ import annotations

import tempfile
from pathlib import Path

from build_release import build, sha256


def checksums(directory: Path) -> dict[str, str]:
    return {
        path.name: sha256(path)
        for path in sorted(directory.iterdir())
        if path.name != "SHA256SUMS"
    }


def main() -> None:
    with (
        tempfile.TemporaryDirectory(
            prefix="chrome-bridge-reproducible-a-"
        ) as first_temp,
        tempfile.TemporaryDirectory(
            prefix="chrome-bridge-reproducible-b-"
        ) as second_temp,
    ):
        first = Path(first_temp)
        second = Path(second_temp)
        build(first)
        build(second)
        first_checksums = checksums(first)
        second_checksums = checksums(second)
        if first_checksums != second_checksums:
            raise ValueError(
                f"release build is not reproducible: {first_checksums} != {second_checksums}"
            )
        for name, digest in first_checksums.items():
            print(f"{digest}  {name}")
    print("Two independent release builds are byte-identical.")


if __name__ == "__main__":
    main()
