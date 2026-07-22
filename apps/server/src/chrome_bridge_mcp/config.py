from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    command_timeout_seconds: float = 15.0
    operation_wait_timeout_seconds: float = 30.0
    session_idle_ttl_seconds: float = 120.0
    session_max_lifetime_seconds: float = 600.0
    managed: bool = False
    managed_idle_timeout_seconds: float = 300.0

    @classmethod
    def from_env(cls, *, managed: bool = False) -> "Settings":
        host = os.environ.get("CHROME_BRIDGE_HOST", "127.0.0.1")
        if host not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("CHROME_BRIDGE_HOST must be a loopback host")

        return cls(
            host=host,
            port=int(os.environ.get("CHROME_BRIDGE_PORT", "8765")),
            command_timeout_seconds=float(
                os.environ.get("CHROME_BRIDGE_COMMAND_TIMEOUT", "15")
            ),
            operation_wait_timeout_seconds=float(
                os.environ.get("CHROME_BRIDGE_OPERATION_WAIT_TIMEOUT", "30")
            ),
            session_idle_ttl_seconds=float(
                os.environ.get("CHROME_BRIDGE_SESSION_IDLE_TTL", "120")
            ),
            session_max_lifetime_seconds=float(
                os.environ.get("CHROME_BRIDGE_SESSION_MAX_LIFETIME", "600")
            ),
            managed=managed,
            managed_idle_timeout_seconds=float(
                os.environ.get("CHROME_BRIDGE_MANAGED_IDLE_TIMEOUT", "300")
            ),
        )
