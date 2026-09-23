from __future__ import annotations

from typing import Any

import pytest

from scripts.validate_static import validate_sdk_server_bound


def pyprojects(
    version: str, dependencies: list[str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    server = {"project": {"name": "chrome-bridge-mcp", "version": version}}
    sdk = {"project": {"name": "chrome-bridge-sdk", "dependencies": dependencies}}
    return server, sdk


def test_sdk_server_bound_admits_released_version() -> None:
    validate_sdk_server_bound(
        *pyprojects("0.4.1", ["chrome-bridge-mcp>=0.4,<0.5", "httpx2>=2"])
    )


def test_sdk_server_bound_rejects_forgotten_minor_bump() -> None:
    with pytest.raises(ValueError, match="must admit the released server version"):
        validate_sdk_server_bound(*pyprojects("0.5.0", ["chrome-bridge-mcp>=0.4,<0.5"]))


def test_sdk_server_bound_rejects_stale_lower_bound() -> None:
    with pytest.raises(ValueError, match="must admit the released server version"):
        validate_sdk_server_bound(*pyprojects("0.4.1", ["chrome-bridge-mcp>=0.5,<0.6"]))


def test_sdk_server_bound_requires_server_dependency() -> None:
    with pytest.raises(ValueError, match="exactly one chrome-bridge-mcp"):
        validate_sdk_server_bound(*pyprojects("0.4.1", ["httpx2>=2"]))
