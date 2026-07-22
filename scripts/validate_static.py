from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "apps" / "extension"
SERVER_PACKAGE = ROOT / "apps" / "server"
SDK_PACKAGE = ROOT / "packages" / "sdk"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.relative_to(ROOT)} must contain a JSON object")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_png_size(path: Path, expected_size: int) -> None:
    data = path.read_bytes()
    require(data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} must be a PNG")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    require(
        (width, height) == (expected_size, expected_size),
        f"{path.name} must be {expected_size}x{expected_size}, got {width}x{height}",
    )
    require(data[25] in {4, 6}, f"{path.name} must include an alpha channel")


def validate_manifest() -> None:
    manifest = load_json(EXTENSION / "manifest.json")
    package = load_json(EXTENSION / "package.json")
    server = tomllib.loads(
        (SERVER_PACKAGE / "pyproject.toml").read_text(encoding="utf-8")
    )
    sdk = tomllib.loads((SDK_PACKAGE / "pyproject.toml").read_text(encoding="utf-8"))

    require(manifest.get("manifest_version") == 3, "manifest_version must be 3")
    require(
        manifest.get("minimum_chrome_version") == "116",
        "minimum_chrome_version must remain explicit",
    )
    require(
        manifest.get("background")
        == {"service_worker": "background.js", "type": "module"},
        "background must use the module service worker",
    )
    extension_versions = {
        "manifest": manifest.get("version"),
        "extension package": package.get("version"),
    }
    require(
        len(set(extension_versions.values())) == 1,
        f"extension versions must match: {extension_versions}",
    )
    python_versions = {
        "server package": server["project"]["version"],
        "SDK package": sdk["project"]["version"],
    }
    require(
        len(set(python_versions.values())) == 1,
        f"Python package versions must match: {python_versions}",
    )
    require(
        server["project"]["name"] == "chrome-bridge-mcp",
        "Python distribution must be chrome-bridge-mcp",
    )
    require(
        sdk["project"]["name"] == "chrome-bridge-sdk",
        "SDK distribution must be chrome-bridge-sdk",
    )
    require(
        server["project"].get("license") == "MIT" and package.get("license") == "MIT",
        "Python and extension package metadata must use MIT",
    )
    root_license = (ROOT / "LICENSE").read_text(encoding="utf-8")
    server_license = (SERVER_PACKAGE / "LICENSE").read_text(encoding="utf-8")
    sdk_license = (SDK_PACKAGE / "LICENSE").read_text(encoding="utf-8")
    require(root_license == server_license, "server LICENSE must match root LICENSE")
    require(root_license == sdk_license, "SDK LICENSE must match root LICENSE")

    expected_icons = {str(size): f"icons/icon-{size}.png" for size in (16, 32, 48, 128)}
    require(manifest.get("icons") == expected_icons, "manifest icon set drifted")
    require(
        manifest["action"].get("default_icon")
        == {key: expected_icons[key] for key in ("16", "32")},
        "action icon set drifted",
    )
    for size, icon_path in expected_icons.items():
        validate_png_size(EXTENSION / icon_path, int(size))
        validate_png_size(
            EXTENSION / "icons" / "disconnected" / f"icon-{size}.png", int(size)
        )

    icon_files = [
        *manifest.get("icons", {}).values(),
        *manifest.get("action", {}).get("default_icon", {}).values(),
    ]
    referenced_files = [
        manifest["background"]["service_worker"],
        manifest["action"]["default_popup"],
        manifest["options_page"],
        *icon_files,
        *(
            script
            for content_script in manifest.get("content_scripts", [])
            for script in content_script.get("js", [])
        ),
    ]
    missing = [name for name in referenced_files if not (EXTENSION / name).is_file()]
    require(not missing, f"manifest references missing files: {missing}")

    release_files = load_json(EXTENSION / "extension-files.json")
    runtime_files = release_files.get("runtime")
    require(
        isinstance(runtime_files, list)
        and all(isinstance(item, str) for item in runtime_files),
        "extension runtime allowlist must be a string list",
    )
    require(
        runtime_files == sorted(set(runtime_files)),
        "extension runtime allowlist must be sorted and unique",
    )
    require(
        set(referenced_files) <= set(runtime_files),
        "manifest files must be present in the extension runtime allowlist",
    )
    require(
        all((EXTENSION / name).is_file() for name in runtime_files),
        "extension runtime allowlist references missing files",
    )
    notices = release_files.get("notices")
    require(isinstance(notices, list) and notices, "extension notices are required")
    require(
        any(
            notice.get("source") == "../../LICENSE"
            and notice.get("archive") == "LICENSE"
            for notice in notices
            if isinstance(notice, dict)
        ),
        "extension release must include the project LICENSE",
    )
    for notice in notices:
        require(
            isinstance(notice, dict) and set(notice) == {"source", "archive"},
            "extension notices need exact source and archive fields",
        )
        require(
            isinstance(notice["source"], str)
            and (EXTENSION / notice["source"]).is_file(),
            "extension notice source is missing",
        )


def validate_protocol_schemas() -> None:
    schema_dir = SERVER_PACKAGE / "src" / "chrome_bridge_mcp"
    v1 = load_json(schema_dir / "protocol_v1.schema.json")
    v2 = load_json(schema_dir / "protocol_v2.schema.json")
    Draft202012Validator.check_schema(v1)
    Draft202012Validator.check_schema(v2)

    commands = v1["$defs"]["commandRequest"]["properties"]["type"]["enum"]
    require(len(commands) == 20, "protocol v1 must define exactly 20 commands")
    require(
        len(set(commands)) == len(commands), "protocol command names must be unique"
    )
    required_v2_hello = set(v2["$defs"]["hello"]["required"])
    require(
        required_v2_hello
        == {
            "type",
            "protocolVersion",
            "extensionVersion",
            "browserId",
            "browserLabel",
        },
        "protocol v2 hello identity fields drifted",
    )
    require(
        (EXTENSION / "dist" / "protocol.js").is_file(),
        "tracked dist/protocol.js is missing",
    )
    runtime_config = (EXTENSION / "runtime-config.js").read_text(encoding="utf-8")
    require(
        'DEFAULT_SERVER_URL = "ws://127.0.0.1:8765/extension"' in runtime_config,
        "production runtime config must keep the documented loopback default",
    )


def main() -> None:
    validate_manifest()
    validate_protocol_schemas()
    print("Static manifest and protocol validation passed.")


if __name__ == "__main__":
    main()
