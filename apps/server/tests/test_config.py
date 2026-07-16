from __future__ import annotations

import pytest

from chrome_bridge_server.config import Settings


def test_settings_rejects_non_loopback_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHROME_BRIDGE_HOST", "0.0.0.0")
    with pytest.raises(ValueError, match="loopback"):
        Settings.from_env()
