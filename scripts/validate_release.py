from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "apps" / "extension"
DEFAULT_RELEASE = ROOT / "release"
FORBIDDEN_PARTS = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    "e2e",
    "node_modules",
    "test-results",
    "tests",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_clean_names(names: list[str]) -> None:
    for name in names:
        parts = PurePosixPath(name).parts
        if any(
            part in FORBIDDEN_PARTS or part.endswith((".pyc", ".pyo")) for part in parts
        ):
            raise ValueError(f"forbidden release entry: {name}")


def expected_extension_names() -> set[str]:
    config: dict[str, Any] = json.loads(
        (EXTENSION / "extension-files.json").read_text(encoding="utf-8")
    )
    return set(config["runtime"]) | {item["archive"] for item in config["notices"]}


def validate_checksums(release_dir: Path, artifacts: list[Path]) -> None:
    checksum_path = release_dir / "SHA256SUMS"
    recorded = {}
    for line in checksum_path.read_text(encoding="ascii").splitlines():
        digest, name = line.split("  ", 1)
        recorded[name] = digest
    expected = {artifact.name: sha256(artifact) for artifact in artifacts}
    if recorded != expected:
        raise ValueError(f"checksum mismatch: recorded={recorded}, expected={expected}")


def validate_extension(extension_zip: Path) -> None:
    with zipfile.ZipFile(extension_zip) as archive:
        names = archive.namelist()
        if set(names) != expected_extension_names() or len(names) != len(set(names)):
            raise ValueError(f"extension archive entries drifted: {names}")
        assert_clean_names(names)
        manifest = json.loads(archive.read("manifest.json"))
        referenced = {
            manifest["background"]["service_worker"],
            manifest["action"]["default_popup"],
            manifest["options_page"],
            *(
                script
                for content_script in manifest.get("content_scripts", [])
                for script in content_script.get("js", [])
            ),
        }
        missing = referenced - set(names)
        if missing:
            raise ValueError(
                f"extension manifest files missing from archive: {sorted(missing)}"
            )
        if archive.read("LICENSE") != (ROOT / "LICENSE").read_bytes():
            raise ValueError("extension LICENSE does not match the project LICENSE")


def validate_python_archives(wheel: Path, sdist: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        wheel_names = archive.namelist()
        assert_clean_names(wheel_names)
        required_suffixes = {
            "chrome_bridge_mcp/__main__.py",
            "chrome_bridge_mcp/protocol_v1.schema.json",
            "chrome_bridge_mcp/protocol_v2.schema.json",
        }
        for suffix in required_suffixes:
            if not any(name.endswith(suffix) for name in wheel_names):
                raise ValueError(f"wheel is missing {suffix}")
        entry_points = [
            name for name in wheel_names if name.endswith(".dist-info/entry_points.txt")
        ]
        if len(entry_points) != 1:
            raise ValueError("wheel is missing console entry point metadata")
        if "chrome-bridge-mcp = chrome_bridge_mcp.__main__:main" not in archive.read(
            entry_points[0]
        ).decode("utf-8"):
            raise ValueError("wheel has an unexpected console entry point")
        licenses = [
            name for name in wheel_names if name.endswith(".dist-info/licenses/LICENSE")
        ]
        if len(licenses) != 1:
            raise ValueError("wheel is missing the MIT license")
        if archive.read(licenses[0]) != (ROOT / "LICENSE").read_bytes():
            raise ValueError("wheel LICENSE does not match the project LICENSE")
    with tarfile.open(sdist, "r:gz") as archive:
        names = archive.getnames()
        assert_clean_names(names)
        if not any(name.endswith("/pyproject.toml") for name in names):
            raise ValueError("sdist is missing pyproject.toml")
        required_suffixes = {
            "/LICENSE",
            "/src/chrome_bridge_mcp/__main__.py",
            "/src/chrome_bridge_mcp/protocol_v1.schema.json",
            "/src/chrome_bridge_mcp/protocol_v2.schema.json",
        }
        for suffix in required_suffixes:
            if not any(name.endswith(suffix) for name in names):
                raise ValueError(f"sdist is missing {suffix.removeprefix('/')}")
        licenses = [
            member
            for member in archive.getmembers()
            if member.name.endswith("/LICENSE")
        ]
        if len(licenses) != 1:
            raise ValueError("sdist must contain exactly one project LICENSE")
        license_stream = archive.extractfile(licenses[0])
        if (
            license_stream is None
            or license_stream.read() != (ROOT / "LICENSE").read_bytes()
        ):
            raise ValueError("sdist LICENSE does not match the project LICENSE")


def venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def validate_clean_install(wheel: Path, extension_zip: Path, *, run_e2e: bool) -> None:
    with tempfile.TemporaryDirectory(
        prefix="chrome-bridge-release-smoke-"
    ) as temporary:
        root = Path(temporary)
        venv = root / "venv"
        subprocess.run(
            ["uv", "venv", "--python", sys.executable, str(venv)],
            cwd=root,
            check=True,
        )
        python = venv_python(venv)
        subprocess.run(
            ["uv", "pip", "install", "--python", str(python), str(wheel)],
            cwd=root,
            check=True,
        )
        imported = subprocess.run(
            [
                str(python),
                "-c",
                (
                    "from importlib.resources import files; import chrome_bridge_mcp as p; "
                    "assert files(p).joinpath('protocol_v1.schema.json').is_file(); "
                    "print(p.__file__)"
                ),
            ],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONNOUSERSITE": "1"},
        )
        if str(ROOT) in imported.stdout:
            raise ValueError(
                f"clean install imported the source tree: {imported.stdout.strip()}"
            )

        extracted = root / "extension"
        with zipfile.ZipFile(extension_zip) as archive:
            archive.extractall(extracted)
        if run_e2e:
            subprocess.run(
                ["npm", "run", "test:e2e:release"],
                cwd=EXTENSION,
                check=True,
                env={
                    **os.environ,
                    "CHROME_BRIDGE_E2E_EXTENSION_DIR": str(extracted),
                    "CHROME_BRIDGE_E2E_PYTHON": str(python),
                    "PYTHONNOUSERSITE": "1",
                },
            )


def validate(release_dir: Path, *, run_e2e: bool) -> None:
    extension_archives = list(release_dir.glob("chrome-bridge-extension-*.zip"))
    wheels = list(release_dir.glob("chrome_bridge_mcp-*.whl"))
    sdists = list(release_dir.glob("chrome_bridge_mcp-*.tar.gz"))
    if len(extension_archives) != 1 or len(wheels) != 1 or len(sdists) != 1:
        raise ValueError(
            "release directory must contain exactly one extension ZIP, wheel, and sdist"
        )
    artifacts = [extension_archives[0], wheels[0], sdists[0]]
    validate_checksums(release_dir, artifacts)
    validate_extension(extension_archives[0])
    validate_python_archives(wheels[0], sdists[0])
    validate_clean_install(wheels[0], extension_archives[0], run_e2e=run_e2e)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate chrome-bridge release artifacts"
    )
    parser.add_argument("--release-dir", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--skip-e2e", action="store_true")
    args = parser.parse_args()
    validate(args.release_dir.resolve(), run_e2e=not args.skip_e2e)
    print("Release artifacts and clean install validated.")


if __name__ == "__main__":
    main()
