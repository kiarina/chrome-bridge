from __future__ import annotations

import asyncio
import base64
import binascii
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from .protocol import (
    ProtocolValidationError,
    validate_extension_runtime_message,
    validate_server_message,
)


class ExtensionSocket(Protocol):
    async def send_json(self, data: Any) -> None: ...

    async def close(self, code: int = 1000, reason: str | None = None) -> None: ...


class ExtensionUnavailableError(RuntimeError):
    """Raised when no Chrome extension is connected."""


class ExtensionCommandError(RuntimeError):
    """Raised when the extension rejects a command."""


class BrowserConnection:
    def __init__(
        self,
        socket: ExtensionSocket,
        *,
        browser_id: str,
        label: str,
        protocol_version: int,
        extension_version: str,
        identity_stable: bool,
        timeout_seconds: float,
    ) -> None:
        self.socket = socket
        self.browser_id = browser_id
        self.label = label
        self.protocol_version = protocol_version
        self.extension_version = extension_version
        self.identity_stable = identity_stable
        self._timeout_seconds = timeout_seconds
        self._pending: dict[str, asyncio.Future[Any]] = {}
        self._send_lock = asyncio.Lock()

    def as_dict(self) -> dict[str, Any]:
        return {
            "browserId": self.browser_id,
            "label": self.label,
            "protocolVersion": self.protocol_version,
            "extensionVersion": self.extension_version,
            "identityStable": self.identity_stable,
        }

    async def disconnect(
        self, error: ExtensionUnavailableError, *, close: bool = False
    ) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(error)
        self._pending.clear()
        if close:
            await self.socket.close(
                code=1012, reason="Replaced by a newer extension connection"
            )

    async def request(self, command: str, params: Mapping[str, Any]) -> Any:
        request_id = str(uuid4())
        message = {"id": request_id, "type": command, "params": dict(params)}
        validate_server_message(message)
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            async with self._send_lock:
                await self.socket.send_json(message)
            return await asyncio.wait_for(future, timeout=self._timeout_seconds)
        except TimeoutError as error:
            raise ExtensionCommandError(
                f"Chrome extension timed out while running {command}"
            ) from error
        finally:
            self._pending.pop(request_id, None)

    def receive(self, message: Mapping[str, Any]) -> dict[str, Any] | None:
        validate_extension_runtime_message(message)
        message_type = message.get("type")
        if message_type == "ping":
            return {"type": "pong"}

        request_id = message.get("id")
        if not isinstance(request_id, str):
            return None
        future = self._pending.get(request_id)
        if future is None or future.done():
            raise ProtocolValidationError(f"Unknown response id: {request_id}")
        if message.get("ok") is True:
            future.set_result(message.get("result"))
        else:
            future.set_exception(
                ExtensionCommandError(
                    str(message.get("error", "Extension command failed"))
                )
            )
        return None


class BrowserRegistry:
    def __init__(self, timeout_seconds: float = 15.0) -> None:
        self._timeout_seconds = timeout_seconds
        self._connections: dict[str, BrowserConnection] = {}
        self._legacy_browser_id: str | None = None

    @property
    def connected(self) -> bool:
        return bool(self._connections)

    @property
    def connected_count(self) -> int:
        return len(self._connections)

    @property
    def extension_info(self) -> dict[str, Any]:
        if len(self._connections) != 1:
            return {}
        connection = next(iter(self._connections.values()))
        return {
            "protocolVersion": connection.protocol_version,
            "extensionVersion": connection.extension_version,
        }

    def instances(self) -> list[dict[str, Any]]:
        return [
            connection.as_dict()
            for connection in sorted(
                self._connections.values(), key=lambda item: item.browser_id
            )
        ]

    async def attach(
        self, socket: ExtensionSocket, hello: Mapping[str, Any] | None = None
    ) -> BrowserConnection:
        if hello is None:
            hello = {
                "type": "hello",
                "protocolVersion": 1,
                "extensionVersion": "test",
            }
        protocol_version = int(hello["protocolVersion"])
        identity_stable = protocol_version == 2
        browser_id = str(hello["browserId"]) if identity_stable else str(uuid4())
        label = str(hello["browserLabel"]) if identity_stable else "Legacy browser"
        connection = BrowserConnection(
            socket,
            browser_id=browser_id,
            label=label,
            protocol_version=protocol_version,
            extension_version=str(hello["extensionVersion"]),
            identity_stable=identity_stable,
            timeout_seconds=self._timeout_seconds,
        )
        replaced_id = browser_id if identity_stable else self._legacy_browser_id
        previous = self._connections.get(replaced_id) if replaced_id else None
        if previous is not None:
            self._connections.pop(previous.browser_id, None)
        self._connections[browser_id] = connection
        if not identity_stable:
            self._legacy_browser_id = browser_id
        if previous is not None:
            await previous.disconnect(
                ExtensionUnavailableError("Chrome extension connection was replaced"),
                close=True,
            )
        return connection

    async def detach(
        self,
        connection: BrowserConnection | ExtensionSocket,
        socket: ExtensionSocket | None = None,
    ) -> None:
        if socket is None:
            socket = connection  # compatibility with the former singleton API
            matches = [
                item for item in self._connections.values() if item.socket is socket
            ]
            if not matches:
                return
            connection = matches[0]
        assert isinstance(connection, BrowserConnection)
        if connection.socket is not socket:
            return
        if self._connections.get(connection.browser_id) is not connection:
            return
        self._connections.pop(connection.browser_id, None)
        if self._legacy_browser_id == connection.browser_id:
            self._legacy_browser_id = None
        await connection.disconnect(
            ExtensionUnavailableError("Chrome extension disconnected")
        )

    async def request(
        self, command: str, params: Mapping[str, Any], browser_id: str | None = None
    ) -> Any:
        return await self.resolve(browser_id).request(command, params)

    def receive(
        self, message: Mapping[str, Any], browser_id: str | None = None
    ) -> dict[str, Any] | None:
        if message.get("type") == "hello":
            raise ProtocolValidationError("Duplicate extension hello")
        return self.resolve(browser_id).receive(message)

    def resolve(self, browser_id: str | None = None) -> BrowserConnection:
        if browser_id is not None:
            connection = self._connections.get(browser_id)
            if connection is None:
                raise ExtensionUnavailableError(
                    f"No connected Chrome browser has browser_id {browser_id!r}. "
                    "Call browser_instances to list connected browsers."
                )
            return connection
        if not self._connections:
            raise ExtensionUnavailableError(
                "No Chrome extension is connected. Open the extension and check its settings."
            )
        if len(self._connections) > 1:
            raise ExtensionUnavailableError(
                "Multiple Chrome browsers are connected. Call browser_instances and pass browser_id explicitly."
            )
        return next(iter(self._connections.values()))


# Kept as a source-compatible name for callers while the implementation is a registry.
BridgeHub = BrowserRegistry


class BrowserController:
    def __init__(self, hub: BrowserRegistry) -> None:
        self._hub = hub

    def instances(self) -> list[dict[str, Any]]:
        return self._hub.instances()

    def _connection(self, browser_id: str | None) -> BrowserConnection:
        return self._hub.resolve(browser_id)

    @staticmethod
    def _with_browser_id(
        result: dict[str, Any], connection: BrowserConnection
    ) -> dict[str, Any]:
        if not connection.identity_stable:
            return result
        return {**result, "browserId": connection.browser_id}

    async def _snapshot_operation(
        self,
        command: str,
        params: dict[str, Any],
        connection: BrowserConnection,
        video_filename: str | None,
    ) -> dict[str, Any]:
        if video_filename is not None:
            _validate_recording_filename(video_filename)
            params["videoFilename"] = video_filename
        result = await connection.request(command, params)
        if video_filename is not None:
            if not (
                isinstance(result, dict)
                and set(result) == {"operation", "recording"}
                and _is_snapshot_result(result["operation"])
                and _is_recording_result(
                    result["recording"], requested_filename=video_filename
                )
            ):
                raise ExtensionCommandError(
                    f"{command} returned an invalid recorded response"
                )
            return {
                "operation": self._with_browser_id(result["operation"], connection),
                "recording": self._with_browser_id(result["recording"], connection),
            }
        if not _is_snapshot_result(result):
            raise ExtensionCommandError(f"{command} returned an invalid response")
        return self._with_browser_id(result, connection)

    async def list_tabs(self, browser_id: str | None = None) -> list[dict[str, Any]]:
        connection = self._connection(browser_id)
        result = await connection.request("tabs.list", {})
        if not isinstance(result, list):
            raise ExtensionCommandError("tabs.list returned an invalid response")
        return [self._with_browser_id(tab, connection) for tab in result]

    async def open_tab(
        self, url: str, active: bool, browser_id: str | None = None
    ) -> dict[str, Any]:
        if not _is_allowed_url(url):
            raise ValueError("url must use http://, https://, or be about:blank")
        connection = self._connection(browser_id)
        result = await connection.request("tabs.open", {"url": url, "active": active})
        if not isinstance(result, dict):
            raise ExtensionCommandError("tabs.open returned an invalid response")
        return self._with_browser_id(result, connection)

    async def close_tab(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("tabs.close", {"tabId": tab_id})
        if not isinstance(result, dict):
            raise ExtensionCommandError("tabs.close returned an invalid response")
        return self._with_browser_id(result, connection)

    async def select_tab(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("tabs.select", {"tabId": tab_id})
        if not isinstance(result, dict):
            raise ExtensionCommandError("tabs.select returned an invalid response")
        return self._with_browser_id(result, connection)

    async def activate_tab(
        self, tab_id: int, browser_id: str | None = None
    ) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("tabs.activate", {"tabId": tab_id})
        if not isinstance(result, dict):
            raise ExtensionCommandError("tabs.activate returned an invalid response")
        return self._with_browser_id(result, connection)

    async def snapshot(self, browser_id: str | None = None) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("page.snapshot", {})
        if not _is_snapshot_result(result):
            raise ExtensionCommandError("page.snapshot returned an invalid response")
        return self._with_browser_id(result, connection)

    async def click(
        self,
        element: str,
        ref: str,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> dict[str, Any]:
        if not element.strip():
            raise ValueError("element must be a non-empty description")
        if not ref.strip():
            raise ValueError("ref must be returned by browser_snapshot")
        connection = self._connection(browser_id)
        return await self._snapshot_operation(
            "page.click",
            {"element": element, "ref": ref},
            connection,
            video_filename,
        )

    async def hover(
        self,
        element: str,
        ref: str,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> dict[str, Any]:
        _validate_element_ref(element, ref)
        connection = self._connection(browser_id)
        return await self._snapshot_operation(
            "page.hover",
            {"element": element, "ref": ref},
            connection,
            video_filename,
        )

    async def drag(
        self,
        start_element: str,
        start_ref: str,
        end_element: str,
        end_ref: str,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> dict[str, Any]:
        _validate_element_ref(start_element, start_ref)
        _validate_element_ref(end_element, end_ref)
        connection = self._connection(browser_id)
        return await self._snapshot_operation(
            "page.drag",
            {
                "startElement": start_element,
                "startRef": start_ref,
                "endElement": end_element,
                "endRef": end_ref,
            },
            connection,
            video_filename,
        )

    async def upload_files(
        self,
        element: str,
        ref: str,
        paths: list[str],
        browser_id: str | None = None,
    ) -> dict[str, Any]:
        _validate_element_ref(element, ref)
        resolved_paths = _validate_upload_paths(paths)
        connection = self._connection(browser_id)
        result = await connection.request(
            "page.uploadFile",
            {"element": element, "ref": ref, "paths": resolved_paths},
        )
        if not _is_snapshot_result(result):
            raise ExtensionCommandError("page.uploadFile returned an invalid response")
        return self._with_browser_id(result, connection)

    async def type_text(
        self,
        element: str,
        ref: str,
        text: str,
        submit: bool,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> dict[str, Any]:
        _validate_element_ref(element, ref)
        connection = self._connection(browser_id)
        return await self._snapshot_operation(
            "page.type",
            {"element": element, "ref": ref, "text": text, "submit": submit},
            connection,
            video_filename,
        )

    async def select_option(
        self,
        element: str,
        ref: str,
        values: list[str],
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> dict[str, Any]:
        _validate_element_ref(element, ref)
        if not values:
            raise ValueError("values must contain at least one option value")
        connection = self._connection(browser_id)
        return await self._snapshot_operation(
            "page.selectOption",
            {"element": element, "ref": ref, "values": values},
            connection,
            video_filename,
        )

    async def press_key(
        self,
        key: str,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> str | dict[str, Any]:
        if not key.strip():
            raise ValueError("key must be a non-empty key name or character")
        if video_filename is not None:
            _validate_recording_filename(video_filename)
        connection = self._connection(browser_id)
        params = {"key": key}
        if video_filename is not None:
            params["videoFilename"] = video_filename
        result = await connection.request("page.pressKey", params)
        completion = f"Pressed key {key}"
        if video_filename is not None:
            if not (
                isinstance(result, dict)
                and set(result) == {"operation", "recording"}
                and isinstance(result["operation"], dict)
                and result["operation"].get("pressed") is True
                and result["operation"].get("key") == key
                and _is_recording_result(
                    result["recording"], requested_filename=video_filename
                )
            ):
                raise ExtensionCommandError(
                    "page.pressKey returned an invalid recorded response"
                )
            return {
                "operation": completion,
                "recording": self._with_browser_id(result["recording"], connection),
            }
        if not (
            isinstance(result, dict)
            and result.get("pressed") is True
            and result.get("key") == key
        ):
            raise ExtensionCommandError("page.pressKey returned an invalid response")
        return completion

    async def navigate(self, url: str, browser_id: str | None = None) -> dict[str, Any]:
        if not _is_http_url(url):
            raise ValueError("url must use http:// or https://")
        connection = self._connection(browser_id)
        result = await connection.request("page.navigate", {"url": url})
        if not _is_snapshot_result(result):
            raise ExtensionCommandError("page.navigate returned an invalid response")
        return self._with_browser_id(result, connection)

    async def go_back(self, browser_id: str | None = None) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("page.goBack", {})
        if not _is_snapshot_result(result):
            raise ExtensionCommandError("page.goBack returned an invalid response")
        return self._with_browser_id(result, connection)

    async def go_forward(self, browser_id: str | None = None) -> dict[str, Any]:
        connection = self._connection(browser_id)
        result = await connection.request("page.goForward", {})
        if not _is_snapshot_result(result):
            raise ExtensionCommandError("page.goForward returned an invalid response")
        return self._with_browser_id(result, connection)

    async def wait(
        self,
        time: float,
        browser_id: str | None = None,
        video_filename: str | None = None,
    ) -> str | dict[str, Any]:
        if (
            isinstance(time, bool)
            or not isinstance(time, (int, float))
            or not math.isfinite(time)
            or time < 0
            or time > 10
        ):
            raise ValueError("time must be between 0 and 10 seconds")
        if video_filename is not None:
            _validate_recording_filename(video_filename)
        connection = self._connection(browser_id)
        params: dict[str, Any] = {"time": time}
        if video_filename is not None:
            params["videoFilename"] = video_filename
        result = await connection.request("page.wait", params)
        completion = f"Waited for {time:g} seconds"
        if video_filename is not None:
            if not (
                isinstance(result, dict)
                and set(result) == {"operation", "recording"}
                and isinstance(result["operation"], dict)
                and result["operation"].get("waited") is True
                and result["operation"].get("time") == time
                and _is_recording_result(
                    result["recording"], requested_filename=video_filename
                )
            ):
                raise ExtensionCommandError(
                    "page.wait returned an invalid recorded response"
                )
            return {
                "operation": completion,
                "recording": self._with_browser_id(result["recording"], connection),
            }
        if not (
            isinstance(result, dict)
            and result.get("waited") is True
            and result.get("time") == time
        ):
            raise ExtensionCommandError("page.wait returned an invalid response")
        return completion

    async def record_video(
        self, filename: str, duration: float, browser_id: str | None = None
    ) -> dict[str, Any]:
        _validate_recording_filename(filename)
        if (
            isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or not math.isfinite(duration)
            or duration < 0.5
            or duration > 10
        ):
            raise ValueError("duration must be between 0.5 and 10 seconds")
        connection = self._connection(browser_id)
        result = await connection.request(
            "page.recordVideo", {"filename": filename, "duration": duration}
        )
        if not _is_recording_result(result, requested_filename=filename):
            raise ExtensionCommandError("page.recordVideo returned an invalid response")
        return self._with_browser_id(result, connection)

    async def screenshot(self, browser_id: str | None = None) -> bytes:
        connection = self._connection(browser_id)
        result = await connection.request("page.screenshot", {})
        if not (
            isinstance(result, dict)
            and result.get("mimeType") == "image/png"
            and isinstance(result.get("data"), str)
            and isinstance(result.get("width"), int)
            and not isinstance(result.get("width"), bool)
            and result["width"] > 0
            and isinstance(result.get("height"), int)
            and not isinstance(result.get("height"), bool)
            and result["height"] > 0
        ):
            raise ExtensionCommandError("page.screenshot returned an invalid response")
        try:
            image = base64.b64decode(result["data"], validate=True)
        except (binascii.Error, ValueError) as error:
            raise ExtensionCommandError(
                "page.screenshot returned invalid base64 data"
            ) from error
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ExtensionCommandError("page.screenshot did not return a PNG image")
        return image

    async def console_logs(self, browser_id: str | None = None) -> list[dict[str, Any]]:
        connection = self._connection(browser_id)
        result = await connection.request("page.getConsoleLogs", {})
        if not isinstance(result, list) or len(result) > 100:
            raise ExtensionCommandError(
                "page.getConsoleLogs returned an invalid response"
            )
        for entry in result:
            if not (
                isinstance(entry, dict)
                and isinstance(entry.get("type"), str)
                and isinstance(entry.get("message"), str)
                and isinstance(entry.get("timestamp"), (int, float))
                and not isinstance(entry.get("timestamp"), bool)
                and math.isfinite(entry["timestamp"])
            ):
                raise ExtensionCommandError(
                    "page.getConsoleLogs returned an invalid response"
                )
        return result


def _is_allowed_url(url: str) -> bool:
    return url == "about:blank" or url.startswith(("http://", "https://"))


def _is_http_url(url: str) -> bool:
    return url.startswith(("http://", "https://"))


def _validate_element_ref(element: str, ref: str) -> None:
    if not element.strip():
        raise ValueError("element must be a non-empty description")
    if not ref.strip():
        raise ValueError("ref must be returned by browser_snapshot")


def _validate_recording_filename(filename: str) -> None:
    if not isinstance(filename, str) or not filename:
        raise ValueError("filename must be a non-empty .webm basename")
    if (
        filename in {".", ".."}
        or "/" in filename
        or "\\" in filename
        or any(ord(character) <= 31 or ord(character) == 127 for character in filename)
        or not filename.endswith(".webm")
    ):
        raise ValueError(
            "filename must be a .webm basename without path separators or control characters"
        )
    if len(filename.encode("utf-8")) > 200:
        raise ValueError("filename must be at most 200 UTF-8 bytes")


def _is_recording_result(result: Any, *, requested_filename: str) -> bool:
    if not isinstance(result, dict):
        return False
    expected = {
        "requestedFilename",
        "filename",
        "mimeType",
        "durationMs",
        "width",
        "height",
        "frameCount",
        "droppedFrameCount",
        "sizeBytes",
    }
    if set(result) != expected:
        return False
    positive_integers = ("durationMs", "width", "height", "frameCount", "sizeBytes")
    if any(
        not isinstance(result[name], int)
        or isinstance(result[name], bool)
        or result[name] <= 0
        for name in positive_integers
    ):
        return False
    dropped = result["droppedFrameCount"]
    return (
        result["requestedFilename"] == requested_filename
        and isinstance(result["filename"], str)
        and result["filename"].startswith("chrome-bridge/")
        and "/" not in result["filename"].removeprefix("chrome-bridge/")
        and "\\" not in result["filename"]
        and result["filename"].endswith(".webm")
        and result["mimeType"] == "video/webm"
        and isinstance(dropped, int)
        and not isinstance(dropped, bool)
        and dropped >= 0
    )


def _validate_upload_paths(paths: list[str]) -> list[str]:
    if not isinstance(paths, list) or not paths or len(paths) > 20:
        raise ValueError("paths must contain between 1 and 20 file paths")
    resolved_paths: list[str] = []
    for index, value in enumerate(paths):
        if not isinstance(value, str) or not value:
            raise ValueError("paths must contain only non-empty strings")
        path = Path(value)
        if not path.is_absolute():
            raise ValueError(f"upload path at index {index} must be absolute")
        try:
            resolved = path.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ValueError(f"upload file at index {index} does not exist") from error
        if not resolved.is_file():
            raise ValueError(f"upload path at index {index} is not a regular file")
        resolved_paths.append(str(resolved))
    return resolved_paths


def _is_snapshot_result(result: Any) -> bool:
    return (
        isinstance(result, dict)
        and isinstance(result.get("generation"), int)
        and not isinstance(result.get("generation"), bool)
        and isinstance(result.get("url"), str)
        and isinstance(result.get("title"), str)
        and isinstance(result.get("snapshot"), str)
    )
