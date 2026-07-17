from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    command_timeout_seconds: float = 15.0

    @classmethod
    def from_env(cls) -> "Settings":
        host = os.environ.get("CHROME_BRIDGE_HOST", "127.0.0.1")
        if host not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("CHROME_BRIDGE_HOST must be a loopback host")

        return cls(
            host=host,
            port=int(os.environ.get("CHROME_BRIDGE_PORT", "8765")),
            command_timeout_seconds=float(
                os.environ.get("CHROME_BRIDGE_COMMAND_TIMEOUT", "15")
            ),
        )
