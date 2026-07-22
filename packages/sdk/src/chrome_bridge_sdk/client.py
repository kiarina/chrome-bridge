from __future__ import annotations

import asyncio
import contextvars
import os
import subprocess
import sys
import threading
import time
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Any

import httpx2

from .errors import (
    ExtensionUnavailableError,
    IncompatibleServerError,
    NestedSessionError,
    OperationError,
    OperationOutcomeUnknownError,
    ServerUnavailableError,
    SessionAcquireTimeoutError,
    SessionExpiredError,
)


_active_bridges: contextvars.ContextVar[frozenset[int]] = contextvars.ContextVar(
    "chrome_bridge_active_sessions", default=frozenset()
)


class ChromeBridge:
    """Configuration and lazy session factory for a shared Chrome Bridge server."""

    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 8765,
        startup_timeout: float = 45,
        session_idle_ttl: float = 120,
        session_max_lifetime: float = 600,
    ) -> None:
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("ChromeBridge host must be loopback")
        self.host = host
        self.port = port
        self.startup_timeout = startup_timeout
        self.session_idle_ttl = session_idle_ttl
        self.session_max_lifetime = session_max_lifetime

    @property
    def base_url(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"http://{host}:{self.port}"

    @asynccontextmanager
    async def session(
        self, *, wait_timeout: float | None = None
    ) -> AsyncIterator[ChromeBridgeSession]:
        marker = id(self)
        active = _active_bridges.get()
        if marker in active:
            raise NestedSessionError("ChromeBridge sessions cannot be nested")
        context_token = _active_bridges.set(active | {marker})
        client = httpx2.AsyncClient(base_url=self.base_url, timeout=70)
        session: ChromeBridgeSession | None = None
        try:
            await self._ensure_server(client)
            await self._wait_for_extension(client)
            body: dict[str, Any] = {
                "idleTtlSeconds": self.session_idle_ttl,
                "maxLifetimeSeconds": self.session_max_lifetime,
            }
            if wait_timeout is not None:
                body["waitTimeoutSeconds"] = wait_timeout
            try:
                response = await client.post(
                    "/api/v1/sessions",
                    json=body,
                    timeout=None if wait_timeout is None else wait_timeout + 5,
                )
            except httpx2.HTTPError as error:
                raise ServerUnavailableError(
                    "Chrome Bridge disappeared while acquiring a session"
                ) from error
            result = _result_or_raise(response)
            session = ChromeBridgeSession(
                client,
                session_id=result["sessionId"],
                token=result["token"],
                idle_ttl=float(result["idleTtlSeconds"]),
            )
            await session._start()
            yield session
        finally:
            if session is not None:
                await session._release()
            await client.aclose()
            _active_bridges.reset(context_token)

    async def _ensure_server(self, client: httpx2.AsyncClient) -> None:
        meta = await self._probe_meta(client)
        if meta is not None:
            _validate_meta(meta)
            return
        self._spawn_managed_server()
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(0.1)
            meta = await self._probe_meta(client)
            if meta is not None:
                _validate_meta(meta)
                return
        raise ServerUnavailableError(
            f"Chrome Bridge did not start on {self.base_url} within "
            f"{self.startup_timeout:g} seconds"
        )

    async def _probe_meta(self, client: httpx2.AsyncClient) -> dict[str, Any] | None:
        try:
            response = await client.get("/api/v1/meta", timeout=0.5)
        except httpx2.ConnectError:
            return None
        except httpx2.HTTPError as error:
            raise ServerUnavailableError(
                f"Cannot inspect the service on {self.base_url}"
            ) from error
        if response.status_code != 200:
            raise IncompatibleServerError(
                f"Port {self.port} is occupied by a service without Direct API v1"
            )
        try:
            body = response.json()
        except ValueError as error:
            raise IncompatibleServerError(
                f"Port {self.port} is occupied by a foreign service"
            ) from error
        if not isinstance(body, dict):
            raise IncompatibleServerError("Direct API metadata is invalid")
        return body

    async def _wait_for_extension(self, client: httpx2.AsyncClient) -> None:
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            meta = await self._probe_meta(client)
            if meta is None:
                raise ServerUnavailableError(
                    "Chrome Bridge stopped before the extension connected"
                )
            _validate_meta(meta)
            if meta.get("extensionConnected") is True:
                return
            await asyncio.sleep(0.25)
        raise ExtensionUnavailableError(
            "Chrome Bridge is running, but no Chrome extension connected. "
            f"Expected ws://{self.host}:{self.port}/extension"
        )

    def _spawn_managed_server(self) -> None:
        environment = {
            **os.environ,
            "CHROME_BRIDGE_HOST": self.host,
            "CHROME_BRIDGE_PORT": str(self.port),
        }
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "chrome_bridge_mcp", "--managed"],
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                start_new_session=True,
            )
        except OSError as error:
            raise ServerUnavailableError("Failed to start chrome-bridge-mcp") from error
        threading.Thread(target=process.wait, daemon=True).start()


class ChromeBridgeSession:
    """An exclusive, server-managed browser-operation lease."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        session_id: str,
        token: str,
        idle_ttl: float,
    ) -> None:
        self._client = client
        self._session_id = session_id
        self._token = token
        self._idle_ttl = idle_ttl
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._heartbeat_error: BaseException | None = None

    async def _start(self) -> None:
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _release(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            await asyncio.gather(self._heartbeat_task, return_exceptions=True)
            self._heartbeat_task = None
        try:
            await asyncio.shield(
                self._client.delete(
                    f"/api/v1/sessions/{self._session_id}",
                    headers=self._headers,
                    timeout=5,
                )
            )
        except (httpx2.HTTPError, asyncio.CancelledError):
            pass

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "X-Chrome-Bridge-Session": self._session_id,
        }

    async def _heartbeat_loop(self) -> None:
        interval = max(1.0, min(30.0, self._idle_ttl / 3))
        try:
            while True:
                await asyncio.sleep(interval)
                response = await self._client.post(
                    f"/api/v1/sessions/{self._session_id}/heartbeat",
                    headers=self._headers,
                    timeout=10,
                )
                _result_or_raise(response)
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            self._heartbeat_error = error

    async def tool_definitions(self) -> list[dict[str, Any]]:
        self._raise_heartbeat_error()
        try:
            response = await self._client.get("/api/v1/tools")
            response.raise_for_status()
            body = response.json()
            return body["tools"]
        except (httpx2.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ServerUnavailableError(
                "Cannot retrieve Chrome Bridge tools"
            ) from error

    async def call(
        self, method: str, arguments: Mapping[str, Any] | None = None
    ) -> Any:
        self._raise_heartbeat_error()
        try:
            response = await self._client.post(
                "/api/v1/call",
                headers=self._headers,
                json={"method": method, "arguments": dict(arguments or {})},
            )
        except httpx2.HTTPError as error:
            raise OperationOutcomeUnknownError(
                f"Connection failed while running {method}; operation outcome is unknown"
            ) from error
        return _result_or_raise(response)

    def _raise_heartbeat_error(self) -> None:
        if self._heartbeat_error is not None:
            raise SessionExpiredError(
                "Chrome Bridge session heartbeat failed"
            ) from self._heartbeat_error

    async def browser_instances(self) -> list[dict[str, Any]]:
        return await self.call("browser_instances")

    async def browser_tabs(self, browser_id: str | None = None) -> list[dict[str, Any]]:
        return await self.call("browser_tabs", {"browser_id": browser_id})

    async def browser_tab_open(
        self,
        url: str = "about:blank",
        active: bool = True,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_tab_open",
            {"url": url, "active": active, "browser_id": browser_id},
        )

    async def browser_tab_close(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        return await self.call(
            "browser_tab_close", {"tab_id": tab_id, "browser_id": browser_id}
        )

    async def browser_tab_select(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        return await self.call(
            "browser_tab_select", {"tab_id": tab_id, "browser_id": browser_id}
        )

    async def browser_tab_activate(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        return await self.call(
            "browser_tab_activate", {"tab_id": tab_id, "browser_id": browser_id}
        )

    async def browser_snapshot(self, browser_id: str | None = None) -> dict[str, Any]:
        return await self.call("browser_snapshot", {"browser_id": browser_id})

    async def browser_click(
        self,
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_click",
            _element_arguments(element, ref, video_filename, browser_id),
        )

    async def browser_hover(
        self,
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_hover",
            _element_arguments(element, ref, video_filename, browser_id),
        )

    async def browser_drag(
        self,
        startElement: str,
        startRef: str,
        endElement: str,
        endRef: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_drag",
            {
                "startElement": startElement,
                "startRef": startRef,
                "endElement": endElement,
                "endRef": endRef,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
        )

    async def browser_upload_file(
        self,
        element: str,
        ref: str,
        paths: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments["paths"] = paths
        return await self.call("browser_upload_file", arguments)

    async def browser_type(
        self,
        element: str,
        ref: str,
        text: str,
        submit: bool,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments.update({"text": text, "submit": submit})
        return await self.call("browser_type", arguments)

    async def browser_select_option(
        self,
        element: str,
        ref: str,
        values: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments["values"] = values
        return await self.call("browser_select_option", arguments)

    async def browser_press_key(
        self,
        key: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_press_key",
            {
                "key": key,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
        )

    async def browser_navigate(
        self,
        url: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_navigate",
            {
                "url": url,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
        )

    async def browser_go_back(
        self,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_go_back",
            {"video_filename": video_filename, "browser_id": browser_id},
        )

    async def browser_go_forward(
        self,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_go_forward",
            {"video_filename": video_filename, "browser_id": browser_id},
        )

    async def browser_wait(
        self,
        time: float,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        return await self.call(
            "browser_wait",
            {
                "time": time,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
        )

    async def browser_record_video(
        self, filename: str, duration: float, browser_id: str | None = None
    ) -> dict[str, Any]:
        return await self.call(
            "browser_record_video",
            {"filename": filename, "duration": duration, "browser_id": browser_id},
        )

    async def browser_screenshot(self, browser_id: str | None = None) -> dict[str, Any]:
        return await self.call("browser_screenshot", {"browser_id": browser_id})

    async def browser_get_console_logs(
        self, browser_id: str | None = None
    ) -> list[dict[str, Any]]:
        return await self.call("browser_get_console_logs", {"browser_id": browser_id})


def _element_arguments(
    element: str,
    ref: str,
    video_filename: str | None,
    browser_id: str | None,
) -> dict[str, Any]:
    return {
        "element": element,
        "ref": ref,
        "video_filename": video_filename,
        "browser_id": browser_id,
    }


def _validate_meta(meta: Mapping[str, Any]) -> None:
    if (
        meta.get("service") != "chrome-bridge"
        or meta.get("apiVersion") != 1
        or not str(meta.get("serverVersion", "")).startswith("0.2.")
    ):
        raise IncompatibleServerError(
            "The running Chrome Bridge server is not compatible with SDK 0.2"
        )


def _result_or_raise(response: httpx2.Response) -> Any:
    try:
        body = response.json()
    except ValueError as error:
        raise ServerUnavailableError("Chrome Bridge returned invalid JSON") from error
    if not isinstance(body, dict):
        raise ServerUnavailableError("Chrome Bridge returned an invalid response")
    if response.status_code < 400 and body.get("ok") is True:
        if "result" not in body:
            raise ServerUnavailableError("Chrome Bridge response omitted its result")
        return body["result"]
    error = body.get("error", {})
    if not isinstance(error, dict):
        raise ServerUnavailableError("Chrome Bridge returned an invalid error")
    code = error.get("code", "unknown_error")
    message = error.get("message", f"Chrome Bridge request failed with {code}")
    if error.get("outcomeUnknown"):
        raise OperationOutcomeUnknownError(message)
    if code == "session_expired" or code == "invalid_session_token":
        raise SessionExpiredError(message)
    if code == "busy":
        raise SessionAcquireTimeoutError(message)
    if code == "extension_unavailable":
        raise ExtensionUnavailableError(message)
    raise OperationError(message)
