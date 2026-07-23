from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

ASGIApp = Callable[
    [dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]],
    Awaitable[None],
]


class LoopbackSecurityMiddleware:
    """Protect the local MCP and extension endpoints from DNS rebinding."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Awaitable[Any]],
        send: Callable[..., Awaitable[Any]],
    ) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        if not _host_is_loopback(headers.get("host", "")) or not _origin_is_allowed(
            headers.get("origin")
        ):
            await self._reject(scope, receive, send, 403, "Forbidden origin")
            return

        await self.app(scope, receive, send)

    async def _reject(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Awaitable[Any]],
        send: Callable[..., Awaitable[Any]],
        status: int,
        detail: str,
    ) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": detail})
            return
        response = JSONResponse({"detail": detail}, status_code=status)
        await response(scope, receive, send)


def _host_is_loopback(host_header: str) -> bool:
    host = host_header.rsplit(":", 1)[0].strip("[]").lower()
    return host in {"127.0.0.1", "localhost", "::1", "testserver"}


def _origin_is_allowed(origin: str | None) -> bool:
    if origin is None:
        return True
    parsed = urlsplit(origin)
    if parsed.scheme == "chrome-extension":
        return bool(parsed.hostname)
    return parsed.scheme == "http" and parsed.hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
