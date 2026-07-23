from __future__ import annotations

import asyncio
import inspect
import logging
import os
import subprocess
import sys
import threading
import time
import weakref
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from enum import Enum
from typing import Any, Awaitable, Callable, TypeVar

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
from .models import (
    BrowserInstance,
    ClosedTab,
    ConsoleEntry,
    DownloadFileResult,
    KeyPress,
    RecordedResult,
    Recording,
    Screenshot,
    Snapshot,
    Tab,
    WaitResult,
    _recorded_result,
)


logger = logging.getLogger(__name__)
_active_session_tasks: weakref.WeakSet[asyncio.Task[Any]] = weakref.WeakSet()
_active_session_tasks_lock = threading.Lock()
ResultT = TypeVar("ResultT")


class SessionStatus(str, Enum):
    CHECKING_SERVER = "checking_server"
    STARTING_SERVER = "starting_server"
    WAITING_FOR_SERVER = "waiting_for_server"
    SERVER_READY = "server_ready"
    CHECKING_EXTENSION = "checking_extension"
    WAITING_FOR_EXTENSION = "waiting_for_extension"
    WAITING_FOR_SESSION = "waiting_for_session"
    SESSION_ACQUIRED = "session_acquired"
    RELEASING_SESSION = "releasing_session"
    SESSION_RELEASED = "session_released"


StatusCallback = Callable[[SessionStatus], None | Awaitable[None]]


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
        status_callback: StatusCallback | None = None,
    ) -> None:
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("ChromeBridge host must be loopback")
        self.host = host
        self.port = port
        self.startup_timeout = startup_timeout
        self.session_idle_ttl = session_idle_ttl
        self.session_max_lifetime = session_max_lifetime
        self.status_callback = status_callback

    @property
    def base_url(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"http://{host}:{self.port}"

    @asynccontextmanager
    async def session(
        self, *, wait_timeout: float | None = None
    ) -> AsyncIterator[ChromeBridgeSession]:
        task = _claim_session_task()
        client: httpx2.AsyncClient | None = None
        session: ChromeBridgeSession | None = None
        try:
            client = httpx2.AsyncClient(base_url=self.base_url, timeout=90)
            await self._ensure_server(client)
            await self._wait_for_extension(client)
            body: dict[str, Any] = {
                "idleTtlSeconds": self.session_idle_ttl,
                "maxLifetimeSeconds": self.session_max_lifetime,
            }
            if wait_timeout is not None:
                body["waitTimeoutSeconds"] = wait_timeout
            await self._emit_status(SessionStatus.WAITING_FOR_SESSION)
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
            await self._emit_status(SessionStatus.SESSION_ACQUIRED)
            yield session
        finally:
            try:
                if session is not None:
                    await self._emit_status(SessionStatus.RELEASING_SESSION)
                    await session._release()
                    await self._emit_status(SessionStatus.SESSION_RELEASED)
            finally:
                try:
                    if client is not None:
                        await client.aclose()
                finally:
                    _release_session_task(task)

    async def _ensure_server(self, client: httpx2.AsyncClient) -> None:
        await self._emit_status(SessionStatus.CHECKING_SERVER)
        meta = await self._probe_meta(client)
        if meta is not None:
            _validate_meta(meta)
            await self._emit_status(SessionStatus.SERVER_READY)
            return
        await self._emit_status(SessionStatus.STARTING_SERVER)
        self._spawn_managed_server()
        await self._emit_status(SessionStatus.WAITING_FOR_SERVER)
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(0.1)
            meta = await self._probe_meta(client)
            if meta is not None:
                _validate_meta(meta)
                await self._emit_status(SessionStatus.SERVER_READY)
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
        await self._emit_status(SessionStatus.CHECKING_EXTENSION)
        deadline = time.monotonic() + self.startup_timeout
        waiting_emitted = False
        while time.monotonic() < deadline:
            meta = await self._probe_meta(client)
            if meta is None:
                raise ServerUnavailableError(
                    "Chrome Bridge stopped before the extension connected"
                )
            _validate_meta(meta)
            if meta.get("extensionConnected") is True:
                return
            if not waiting_emitted:
                await self._emit_status(SessionStatus.WAITING_FOR_EXTENSION)
                waiting_emitted = True
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

    async def _emit_status(self, status: SessionStatus) -> None:
        logger.debug("Chrome Bridge session status: %s", status.value)
        if self.status_callback is None:
            return
        try:
            pending = self.status_callback(status)
            if inspect.isawaitable(pending):
                await pending
        except Exception:
            logger.warning("Chrome Bridge status callback failed", exc_info=True)


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
                f"Connection failed while running {method}; operation outcome is unknown",
                code="server_unavailable",
            ) from error
        return _result_or_raise(response)

    def _raise_heartbeat_error(self) -> None:
        if self._heartbeat_error is not None:
            raise SessionExpiredError(
                "Chrome Bridge session heartbeat failed",
                code="session_heartbeat_failed",
                retryable=True,
            ) from self._heartbeat_error

    async def _typed_call(
        self,
        method: str,
        arguments: Mapping[str, Any] | None,
        parser: Callable[[Any], ResultT],
    ) -> ResultT:
        value = await self.call(method, arguments)
        try:
            return parser(value)
        except (KeyError, TypeError, ValueError) as error:
            raise ServerUnavailableError(
                f"Chrome Bridge returned an invalid {method} result",
                code="invalid_server_response",
            ) from error

    async def browser_instances(self) -> list[BrowserInstance]:
        return await self._typed_call(
            "browser_instances",
            None,
            lambda value: [BrowserInstance._from_result(item) for item in _list(value)],
        )

    async def browser_tabs(self, browser_id: str | None = None) -> list[Tab]:
        return await self._typed_call(
            "browser_tabs",
            {"browser_id": browser_id},
            lambda value: [Tab._from_result(item) for item in _list(value)],
        )

    async def browser_tab_open(
        self,
        url: str = "about:blank",
        active: bool = True,
        browser_id: str | None = None,
    ) -> Tab:
        return await self._typed_call(
            "browser_tab_open",
            {"url": url, "active": active, "browser_id": browser_id},
            Tab._from_result,
        )

    async def browser_tab_close(
        self, tab_id: int, browser_id: str | None = None
    ) -> ClosedTab:
        return await self._typed_call(
            "browser_tab_close",
            {"tab_id": tab_id, "browser_id": browser_id},
            ClosedTab._from_result,
        )

    async def browser_tab_select(
        self, tab_id: int, browser_id: str | None = None
    ) -> Tab:
        return await self._typed_call(
            "browser_tab_select",
            {"tab_id": tab_id, "browser_id": browser_id},
            Tab._from_result,
        )

    async def browser_tab_activate(
        self, tab_id: int, browser_id: str | None = None
    ) -> Tab:
        return await self._typed_call(
            "browser_tab_activate",
            {"tab_id": tab_id, "browser_id": browser_id},
            Tab._from_result,
        )

    async def browser_snapshot(self, browser_id: str | None = None) -> Snapshot:
        return await self._typed_call(
            "browser_snapshot", {"browser_id": browser_id}, Snapshot._from_result
        )

    async def browser_click(
        self,
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_click",
            _element_arguments(element, ref, video_filename, browser_id),
            recorded=video_filename is not None,
        )

    async def browser_hover(
        self,
        element: str,
        ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_hover",
            _element_arguments(element, ref, video_filename, browser_id),
            recorded=video_filename is not None,
        )

    async def browser_drag(
        self,
        start_element: str,
        start_ref: str,
        end_element: str,
        end_ref: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_drag",
            {
                "startElement": start_element,
                "startRef": start_ref,
                "endElement": end_element,
                "endRef": end_ref,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
            recorded=video_filename is not None,
        )

    async def browser_upload_file(
        self,
        element: str,
        ref: str,
        paths: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments["paths"] = paths
        return await self._snapshot_call(
            "browser_upload_file", arguments, recorded=video_filename is not None
        )

    async def browser_type(
        self,
        element: str,
        ref: str,
        text: str,
        submit: bool = False,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments.update({"text": text, "submit": submit})
        return await self._snapshot_call(
            "browser_type", arguments, recorded=video_filename is not None
        )

    async def browser_select_option(
        self,
        element: str,
        ref: str,
        values: list[str],
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        arguments = _element_arguments(element, ref, video_filename, browser_id)
        arguments["values"] = values
        return await self._snapshot_call(
            "browser_select_option", arguments, recorded=video_filename is not None
        )

    async def browser_press_key(
        self,
        key: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> KeyPress | RecordedResult[KeyPress]:
        return await self._typed_call(
            "browser_press_key",
            {
                "key": key,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
            lambda value: (
                _recorded_result(value, KeyPress)
                if video_filename is not None
                else KeyPress._from_result(value)
            ),
        )

    async def browser_navigate(
        self,
        url: str,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_navigate",
            {
                "url": url,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
            recorded=video_filename is not None,
        )

    async def browser_go_back(
        self,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_go_back",
            {"video_filename": video_filename, "browser_id": browser_id},
            recorded=video_filename is not None,
        )

    async def browser_go_forward(
        self,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_go_forward",
            {"video_filename": video_filename, "browser_id": browser_id},
            recorded=video_filename is not None,
        )

    async def browser_wait(
        self,
        time: float,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> WaitResult | RecordedResult[WaitResult]:
        return await self._typed_call(
            "browser_wait",
            {
                "time": time,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
            lambda value: (
                _recorded_result(value, WaitResult)
                if video_filename is not None
                else WaitResult._from_result(value)
            ),
        )

    async def browser_wait_for(
        self,
        text: str,
        state: str = "visible",
        timeout: float = 10,
        video_filename: str | None = None,
        browser_id: str | None = None,
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._snapshot_call(
            "browser_wait_for",
            {
                "text": text,
                "state": state,
                "timeout": timeout,
                "video_filename": video_filename,
                "browser_id": browser_id,
            },
            recorded=video_filename is not None,
        )

    async def browser_download_file(
        self,
        element: str,
        ref: str,
        timeout: float = 10,
        browser_id: str | None = None,
    ) -> DownloadFileResult:
        return await self._typed_call(
            "browser_download_file",
            {
                "element": element,
                "ref": ref,
                "timeout": timeout,
                "browser_id": browser_id,
            },
            DownloadFileResult._from_result,
        )

    async def browser_record_video(
        self, filename: str, duration: float, browser_id: str | None = None
    ) -> Recording:
        return await self._typed_call(
            "browser_record_video",
            {"filename": filename, "duration": duration, "browser_id": browser_id},
            Recording._from_result,
        )

    async def browser_screenshot(self, browser_id: str | None = None) -> Screenshot:
        return await self._typed_call(
            "browser_screenshot", {"browser_id": browser_id}, Screenshot._from_result
        )

    async def browser_get_console_logs(
        self, browser_id: str | None = None
    ) -> list[ConsoleEntry]:
        return await self._typed_call(
            "browser_get_console_logs",
            {"browser_id": browser_id},
            lambda value: [ConsoleEntry._from_result(item) for item in _list(value)],
        )

    async def _snapshot_call(
        self, method: str, arguments: Mapping[str, Any], *, recorded: bool
    ) -> Snapshot | RecordedResult[Snapshot]:
        return await self._typed_call(
            method,
            arguments,
            lambda value: (
                _recorded_result(value, Snapshot)
                if recorded
                else Snapshot._from_result(value)
            ),
        )


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


def _list(value: Any) -> list[Any]:
    if not isinstance(value, list):
        raise TypeError("result must be an array")
    return value


def _claim_session_task() -> asyncio.Task[Any]:
    task = asyncio.current_task()
    if task is None:
        raise RuntimeError("ChromeBridge.session() requires an asyncio task")
    with _active_session_tasks_lock:
        if task in _active_session_tasks:
            raise NestedSessionError(
                "ChromeBridge sessions cannot be nested in the same asyncio task",
                code="nested_session",
            )
        _active_session_tasks.add(task)
    return task


def _release_session_task(task: asyncio.Task[Any]) -> None:
    with _active_session_tasks_lock:
        _active_session_tasks.discard(task)


def _validate_meta(meta: Mapping[str, Any]) -> None:
    if (
        meta.get("service") != "chrome-bridge"
        or meta.get("apiVersion") != 1
        or not str(meta.get("serverVersion", "")).startswith("0.3.")
    ):
        raise IncompatibleServerError(
            "The running Chrome Bridge server is not compatible with SDK 0.3"
        )


def _result_or_raise(response: httpx2.Response) -> Any:
    try:
        body = response.json()
    except ValueError as error:
        raise ServerUnavailableError(
            "Chrome Bridge returned invalid JSON", code="invalid_server_response"
        ) from error
    if not isinstance(body, dict):
        raise ServerUnavailableError(
            "Chrome Bridge returned an invalid response",
            code="invalid_server_response",
        )
    if response.status_code < 400 and body.get("ok") is True:
        if "result" not in body:
            raise ServerUnavailableError(
                "Chrome Bridge response omitted its result",
                code="invalid_server_response",
            )
        return body["result"]
    error = body.get("error", {})
    if not isinstance(error, dict):
        raise ServerUnavailableError(
            "Chrome Bridge returned an invalid error", code="invalid_server_response"
        )
    code = error.get("code", "unknown_error")
    message = str(error.get("message", f"Chrome Bridge request failed with {code}"))
    retryable = error.get("retryable") is True
    outcome_unknown = error.get("outcomeUnknown") is True
    if error.get("outcomeUnknown"):
        raise OperationOutcomeUnknownError(
            message,
            code=str(code),
            retryable=retryable,
            outcome_unknown=outcome_unknown,
        )
    if code == "session_expired" or code == "invalid_session_token":
        raise SessionExpiredError(message, code=str(code), retryable=retryable)
    if code == "busy":
        raise SessionAcquireTimeoutError(message, code=str(code), retryable=retryable)
    if code == "extension_unavailable":
        raise ExtensionUnavailableError(message, code=str(code), retryable=retryable)
    raise OperationError(
        message,
        code=str(code),
        retryable=retryable,
        outcome_unknown=outcome_unknown,
    )
