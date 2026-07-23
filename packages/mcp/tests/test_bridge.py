from __future__ import annotations

import asyncio
import base64
from pathlib import Path
from typing import Any

import pytest

from chrome_bridge_mcp.bridge import (
    BridgeHub,
    BrowserConnection,
    BrowserController,
    ExtensionCommandError,
    ExtensionUnavailableError,
)
from chrome_bridge_mcp.protocol import ProtocolValidationError


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed: tuple[int, str | None] | None = None

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed = (code, reason)


def v2_hello(
    browser_id: str, label: str = "Test", extension_version: str = "0.1.0"
) -> dict[str, Any]:
    return {
        "type": "hello",
        "protocolVersion": 2,
        "extensionVersion": extension_version,
        "browserId": browser_id,
        "browserLabel": label,
    }


BROWSER_A = "123e4567-e89b-42d3-a456-426614174000"
BROWSER_B = "123e4567-e89b-42d3-a456-426614174001"


async def test_request_round_trip() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await hub.attach(socket)

    task = asyncio.create_task(hub.request("tabs.list", {}))
    await asyncio.sleep(0)
    request = socket.sent[0]
    hub.receive({"id": request["id"], "ok": True, "result": [{"id": 7}]})

    assert await task == [{"id": 7}]


async def test_request_requires_extension() -> None:
    hub = BridgeHub()
    with pytest.raises(ExtensionUnavailableError):
        await hub.request("tabs.list", {})


async def test_extension_error_is_forwarded() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await hub.attach(socket)

    task = asyncio.create_task(hub.request("tabs.close", {"tabId": 4}))
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": False, "error": "No tab"})

    with pytest.raises(ExtensionCommandError, match="No tab"):
        await task


async def test_new_connection_replaces_old_connection() -> None:
    hub = BridgeHub()
    old_socket = FakeSocket()
    new_socket = FakeSocket()
    await hub.attach(old_socket)
    await hub.attach(new_socket)

    assert old_socket.closed == (1012, "Replaced by a newer extension connection")
    assert hub.connected


def test_hello_rejects_unknown_protocol() -> None:
    hub = BridgeHub()
    with pytest.raises(ProtocolValidationError):
        hub.receive(
            {"type": "hello", "protocolVersion": 2, "extensionVersion": "0.1.0"}
        )


async def test_request_rejects_invalid_command_before_sending() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await hub.attach(socket)
    with pytest.raises(ProtocolValidationError):
        await hub.request("tabs.close", {"tabId": "not-an-integer"})
    assert socket.sent == []


def test_response_rejects_unknown_request_id() -> None:
    connection = BrowserConnection(
        FakeSocket(),
        browser_id="123e4567-e89b-42d3-a456-426614174000",
        label="Test",
        protocol_version=2,
        extension_version="0.1.0",
        identity_stable=True,
        timeout_seconds=1,
    )
    with pytest.raises(ProtocolValidationError, match="Unknown response id"):
        connection.receive(
            {
                "id": "123e4567-e89b-42d3-a456-426614174000",
                "ok": True,
                "result": {},
            }
        )


async def test_open_tab_rejects_privileged_url() -> None:
    controller = BrowserController(BridgeHub())
    with pytest.raises(ValueError, match="http"):
        await controller.open_tab("chrome://settings", True)


async def test_select_tab_routes_without_activate_command() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.select_tab(42))
    await asyncio.sleep(0)
    request = socket.sent[0]

    assert request["type"] == "tabs.select"
    assert request["params"] == {"tabId": 42}

    hub.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"id": 42, "active": False, "targeted": True},
        }
    )
    assert await task == {"id": 42, "active": False, "targeted": True}


async def test_select_tab_rejects_invalid_extension_response() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.select_tab(42))
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": []})

    with pytest.raises(ExtensionCommandError, match="tabs.select"):
        await task


async def test_snapshot_routes_to_target_without_tab_id() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.snapshot())
    await asyncio.sleep(0)
    request = socket.sent[0]

    assert request["type"] == "page.snapshot"
    assert request["params"] == {}

    snapshot = {
        "generation": 7,
        "url": "https://example.com/",
        "title": "Example Domain",
        "snapshot": '- heading "Example Domain" [level=1] [ref=s7e4]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


@pytest.mark.parametrize(
    "result",
    [
        None,
        [],
        {"generation": True, "url": "", "title": "", "snapshot": ""},
        {"generation": 1, "url": None, "title": "", "snapshot": ""},
        {"generation": 1, "url": "", "title": None, "snapshot": ""},
        {"generation": 1, "url": "", "title": "", "snapshot": None},
    ],
)
async def test_snapshot_rejects_invalid_extension_response(result: Any) -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.snapshot())
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": result})

    with pytest.raises(ExtensionCommandError, match="page.snapshot"):
        await task


async def test_click_routes_element_and_ref_and_returns_snapshot() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.click("Save button", "s8e12"))
    await asyncio.sleep(0)
    request = socket.sent[0]

    assert request["type"] == "page.click"
    assert request["params"] == {"element": "Save button", "ref": "s8e12"}

    snapshot = {
        "generation": 9,
        "url": "https://example.com/saved",
        "title": "Saved",
        "snapshot": '- status "Saved" [ref=s9e4]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


async def test_click_with_video_returns_operation_wrapper_and_recording() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    task = asyncio.create_task(
        controller.click("Save button", "s8e12", video_filename="click.webm")
    )
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.click"
    assert request["params"] == {
        "element": "Save button",
        "ref": "s8e12",
        "videoFilename": "click.webm",
    }

    snapshot = {
        "generation": 9,
        "url": "https://example.com/saved",
        "title": "Saved",
        "snapshot": '- status "Saved" [ref=s9e4]',
    }
    recording = {
        "requestedFilename": "click.webm",
        "filename": "chrome-bridge/click.webm",
        "mimeType": "video/webm",
        "durationMs": 1250,
        "width": 1920,
        "height": 1080,
        "frameCount": 12,
        "droppedFrameCount": 1,
        "sizeBytes": 4096,
    }
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"operation": snapshot, "recording": recording},
        }
    )
    assert await task == {
        "operation": {**snapshot, "browserId": BROWSER_A},
        "recording": {**recording, "browserId": BROWSER_A},
    }


async def test_click_rejects_unsafe_video_filename_before_sending() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await registry.attach(socket)
    with pytest.raises(ValueError, match="filename"):
        await BrowserController(registry).click(
            "Save", "s1e2", video_filename="../escape.webm"
        )
    assert socket.sent == []


async def test_click_rejects_invalid_recorded_extension_response() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket)
    task = asyncio.create_task(
        BrowserController(registry).click("Save", "s1e2", video_filename="click.webm")
    )
    await asyncio.sleep(0)
    connection.receive(
        {
            "id": socket.sent[0]["id"],
            "ok": True,
            "result": {"operation": {}, "recording": {}},
        }
    )
    with pytest.raises(ExtensionCommandError, match="invalid recorded response"):
        await task


async def test_drag_routes_both_element_refs_and_returns_snapshot() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.drag("Card", "s9e4", "Done column", "s9e8"))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.drag"
    assert request["params"] == {
        "startElement": "Card",
        "startRef": "s9e4",
        "endElement": "Done column",
        "endRef": "s9e8",
    }

    snapshot = {
        "generation": 10,
        "url": "https://example.com/board",
        "title": "Board",
        "snapshot": '- status "Moved Card" [ref=s10e3]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


@pytest.mark.parametrize(
    "arguments",
    [
        ("", "s1e1", "End", "s1e2"),
        ("Start", "", "End", "s1e2"),
        ("Start", "s1e1", "", "s1e2"),
        ("Start", "s1e1", "End", ""),
    ],
)
async def test_drag_rejects_empty_descriptions_and_refs(
    arguments: tuple[str, str, str, str],
) -> None:
    with pytest.raises(ValueError):
        await BrowserController(BridgeHub()).drag(*arguments)


async def test_drag_rejects_invalid_extension_response() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)
    task = asyncio.create_task(controller.drag("Start", "s1e1", "End", "s1e2"))
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": {}})
    with pytest.raises(ExtensionCommandError, match="page.drag"):
        await task


async def test_upload_files_routes_canonical_paths_and_returns_snapshot(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(
        controller.upload_files("Add photos", "s11e4", [str(first), str(second)])
    )
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.uploadFile"
    assert request["params"] == {
        "element": "Add photos",
        "ref": "s11e4",
        "paths": [str(first.resolve()), str(second.resolve())],
    }

    snapshot = {
        "generation": 12,
        "url": "https://example.com/compose",
        "title": "Compose",
        "snapshot": '- status "2 files selected" [ref=s12e3]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


async def test_recorded_upload_files_returns_operation_wrapper(tmp_path: Path) -> None:
    upload = tmp_path / "photo.png"
    upload.write_bytes(b"image")
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await hub.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(hub)
    task = asyncio.create_task(
        controller.upload_files(
            "Add photo",
            "s11e4",
            [str(upload)],
            video_filename="upload.webm",
        )
    )
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.uploadFile"
    assert request["params"] == {
        "element": "Add photo",
        "ref": "s11e4",
        "paths": [str(upload.resolve())],
        "videoFilename": "upload.webm",
    }
    snapshot = {
        "generation": 12,
        "url": "https://example.com/compose",
        "title": "Compose",
        "snapshot": '- status "1 file selected" [ref=s12e3]',
    }
    recording = {
        "requestedFilename": "upload.webm",
        "filename": "chrome-bridge/upload.webm",
        "mimeType": "video/webm",
        "durationMs": 2200,
        "width": 1920,
        "height": 1080,
        "frameCount": 22,
        "droppedFrameCount": 3,
        "sizeBytes": 4096,
    }
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"operation": snapshot, "recording": recording},
        }
    )
    assert await task == {
        "operation": {**snapshot, "browserId": BROWSER_A},
        "recording": {**recording, "browserId": BROWSER_A},
    }


@pytest.mark.parametrize("paths", [[], ["relative.png"], ["/missing.png"]])
async def test_upload_files_rejects_invalid_paths(paths: list[str]) -> None:
    with pytest.raises(ValueError, match="paths|absolute|does not exist"):
        await BrowserController(BridgeHub()).upload_files("Add", "s1e2", paths)


async def test_upload_files_rejects_directories_and_more_than_twenty_paths(
    tmp_path: Path,
) -> None:
    controller = BrowserController(BridgeHub())
    with pytest.raises(ValueError, match="regular file"):
        await controller.upload_files("Add", "s1e2", [str(tmp_path)])
    with pytest.raises(ValueError, match="between 1 and 20"):
        await controller.upload_files("Add", "s1e2", [str(tmp_path)] * 21)


async def test_upload_files_rejects_invalid_extension_response(tmp_path: Path) -> None:
    upload = tmp_path / "upload.png"
    upload.write_bytes(b"image")
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)
    task = asyncio.create_task(
        controller.upload_files("Add photos", "s1e2", [str(upload)])
    )
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": {}})
    with pytest.raises(ExtensionCommandError, match="page.uploadFile"):
        await task


async def test_click_rejects_invalid_extension_response() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.click("Save button", "s8e12"))
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": {}})

    with pytest.raises(ExtensionCommandError, match="page.click"):
        await task


@pytest.mark.parametrize(
    ("element", "ref", "message"),
    [("", "s1e2", "element"), ("Save", "", "ref")],
)
async def test_click_rejects_blank_input(element: str, ref: str, message: str) -> None:
    controller = BrowserController(BridgeHub())
    with pytest.raises(ValueError, match=message):
        await controller.click(element, ref)


@pytest.mark.parametrize(
    ("method_name", "arguments", "command", "params"),
    [
        ("hover", ("Menu", "s10e2"), "page.hover", {"element": "Menu", "ref": "s10e2"}),
        (
            "type_text",
            ("Search", "s10e3", "hello", True),
            "page.type",
            {"element": "Search", "ref": "s10e3", "text": "hello", "submit": True},
        ),
        (
            "select_option",
            ("Colors", "s10e4", ["red", "blue"]),
            "page.selectOption",
            {"element": "Colors", "ref": "s10e4", "values": ["red", "blue"]},
        ),
    ],
)
async def test_element_operation_routes_and_returns_snapshot(
    method_name: str,
    arguments: tuple[Any, ...],
    command: str,
    params: dict[str, Any],
) -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(getattr(controller, method_name)(*arguments))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == command
    assert request["params"] == params

    snapshot = {
        "generation": 11,
        "url": "https://example.com/",
        "title": "Fixture",
        "snapshot": '- status "Updated" [ref=s11e4]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


@pytest.mark.parametrize(
    ("method_name", "arguments", "command", "params"),
    [
        (
            "hover",
            ("Menu", "s10e2"),
            "page.hover",
            {"element": "Menu", "ref": "s10e2"},
        ),
        (
            "type_text",
            ("Search", "s10e3", "hello", True),
            "page.type",
            {"element": "Search", "ref": "s10e3", "text": "hello", "submit": True},
        ),
        (
            "select_option",
            ("Colors", "s10e4", ["red", "blue"]),
            "page.selectOption",
            {"element": "Colors", "ref": "s10e4", "values": ["red", "blue"]},
        ),
        (
            "drag",
            ("Card", "s10e5", "Done", "s10e6"),
            "page.drag",
            {
                "startElement": "Card",
                "startRef": "s10e5",
                "endElement": "Done",
                "endRef": "s10e6",
            },
        ),
        (
            "navigate",
            ("https://example.com/next",),
            "page.navigate",
            {"url": "https://example.com/next"},
        ),
        ("go_back", (), "page.goBack", {}),
        ("go_forward", (), "page.goForward", {}),
    ],
)
async def test_recorded_snapshot_operation_returns_wrapper(
    method_name: str,
    arguments: tuple[Any, ...],
    command: str,
    params: dict[str, Any],
) -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    filename = f"{method_name}.webm"
    task = asyncio.create_task(
        getattr(controller, method_name)(*arguments, video_filename=filename)
    )
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == command
    assert request["params"] == {**params, "videoFilename": filename}

    snapshot = {
        "generation": 11,
        "url": "https://example.com/",
        "title": "Fixture",
        "snapshot": '- status "Updated" [ref=s11e4]',
    }
    recording = {
        "requestedFilename": filename,
        "filename": f"chrome-bridge/{filename}",
        "mimeType": "video/webm",
        "durationMs": 1250,
        "width": 1920,
        "height": 1080,
        "frameCount": 12,
        "droppedFrameCount": 2,
        "sizeBytes": 4096,
    }
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"operation": snapshot, "recording": recording},
        }
    )
    assert await task == {
        "operation": {**snapshot, "browserId": BROWSER_A},
        "recording": {**recording, "browserId": BROWSER_A},
    }


async def test_press_key_routes_and_returns_browser_mcp_message() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.press_key("Control+a"))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.pressKey"
    assert request["params"] == {"key": "Control+a"}

    hub.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"pressed": True, "key": "Control+a"},
        }
    )
    assert await task == "Pressed key Control+a"


async def test_press_key_with_video_returns_operation_wrapper() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    task = asyncio.create_task(controller.press_key("Enter", video_filename="key.webm"))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.pressKey"
    assert request["params"] == {"key": "Enter", "videoFilename": "key.webm"}
    recording = {
        "requestedFilename": "key.webm",
        "filename": "chrome-bridge/key.webm",
        "mimeType": "video/webm",
        "durationMs": 800,
        "width": 1920,
        "height": 1080,
        "frameCount": 8,
        "droppedFrameCount": 1,
        "sizeBytes": 2048,
    }
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {
                "operation": {"pressed": True, "key": "Enter"},
                "recording": recording,
            },
        }
    )
    assert await task == {
        "operation": "Pressed key Enter",
        "recording": {**recording, "browserId": BROWSER_A},
    }


@pytest.mark.parametrize(
    ("operation", "message"),
    [
        (lambda controller: controller.hover("", "s1e2"), "element"),
        (lambda controller: controller.type_text("Search", "", "x", False), "ref"),
        (lambda controller: controller.select_option("Colors", "s1e2", []), "values"),
        (lambda controller: controller.press_key(""), "key"),
    ],
)
async def test_new_page_operations_reject_invalid_input(
    operation: Any, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        await operation(BrowserController(BridgeHub()))


@pytest.mark.parametrize(
    ("method_name", "arguments", "command", "params"),
    [
        (
            "navigate",
            ("https://example.com/next",),
            "page.navigate",
            {"url": "https://example.com/next"},
        ),
        ("go_back", (), "page.goBack", {}),
        ("go_forward", (), "page.goForward", {}),
    ],
)
async def test_navigation_routes_and_returns_snapshot(
    method_name: str,
    arguments: tuple[Any, ...],
    command: str,
    params: dict[str, Any],
) -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(getattr(controller, method_name)(*arguments))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == command
    assert request["params"] == params

    snapshot = {
        "generation": 14,
        "url": "https://example.com/next",
        "title": "Next",
        "snapshot": '- heading "Next" [level=1] [ref=s14e4]',
    }
    hub.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == snapshot


@pytest.mark.parametrize("url", ["about:blank", "chrome://settings", "file:///tmp/a"])
async def test_navigate_rejects_non_http_url(url: str) -> None:
    with pytest.raises(ValueError, match="http"):
        await BrowserController(BridgeHub()).navigate(url)


async def test_wait_routes_and_returns_browser_mcp_message() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.wait(0.25))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.wait"
    assert request["params"] == {"time": 0.25}
    hub.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {"waited": True, "time": 0.25},
        }
    )
    assert await task == "Waited for 0.25 seconds"


async def test_wait_with_video_returns_operation_wrapper_and_recording() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    task = asyncio.create_task(controller.wait(0.25, video_filename="wait.webm"))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.wait"
    assert request["params"] == {
        "time": 0.25,
        "videoFilename": "wait.webm",
    }
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {
                "operation": {"waited": True, "time": 0.25},
                "recording": {
                    "requestedFilename": "wait.webm",
                    "filename": "chrome-bridge/wait.webm",
                    "mimeType": "video/webm",
                    "durationMs": 756,
                    "width": 1920,
                    "height": 1080,
                    "frameCount": 7,
                    "droppedFrameCount": 0,
                    "sizeBytes": 2048,
                },
            },
        }
    )
    assert await task == {
        "operation": "Waited for 0.25 seconds",
        "recording": {
            "requestedFilename": "wait.webm",
            "filename": "chrome-bridge/wait.webm",
            "mimeType": "video/webm",
            "durationMs": 756,
            "width": 1920,
            "height": 1080,
            "frameCount": 7,
            "droppedFrameCount": 0,
            "sizeBytes": 2048,
            "browserId": BROWSER_A,
        },
    }


async def test_wait_for_routes_snapshot_and_requires_extension_03() -> None:
    registry = BridgeHub(timeout_seconds=1)
    old_socket = FakeSocket()
    await registry.attach(old_socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    with pytest.raises(ExtensionCommandError, match="extension 0.3.0 or newer"):
        await controller.wait_for("Ready", browser_id=BROWSER_A)
    assert old_socket.sent == []

    socket = FakeSocket()
    connection = await registry.attach(
        socket, v2_hello(BROWSER_A, extension_version="0.3.0")
    )
    task = asyncio.create_task(controller.wait_for("Ready", "visible", 2, BROWSER_A))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.waitFor"
    assert request["params"] == {
        "text": "Ready",
        "state": "visible",
        "timeout": 2,
    }
    snapshot = {
        "generation": 15,
        "url": "https://example.com/",
        "title": "Ready",
        "snapshot": '- status "Ready" [ref=s15e2]',
    }
    connection.receive({"id": request["id"], "ok": True, "result": snapshot})
    assert await task == {**snapshot, "browserId": BROWSER_A}


async def test_download_file_uses_extended_timeout_and_enriches_nested_results() -> (
    None
):
    registry = BridgeHub(timeout_seconds=0.01)
    socket = FakeSocket()
    connection = await registry.attach(
        socket, v2_hello(BROWSER_A, extension_version="0.3.0")
    )
    controller = BrowserController(registry)
    task = asyncio.create_task(controller.download_file("Export", "s3e4", 1, BROWSER_A))
    await asyncio.sleep(0.02)
    request = socket.sent[0]
    assert request["type"] == "page.downloadFile"
    assert request["params"] == {
        "element": "Export",
        "ref": "s3e4",
        "timeout": 1,
    }
    result = {
        "download": {
            "suggestedFilename": "report.csv",
            "state": "complete",
            "receivedBytes": 42,
            "totalBytes": 42,
        },
        "snapshot": {
            "generation": 4,
            "url": "https://example.com/reports",
            "title": "Reports",
            "snapshot": '- status "Downloaded" [ref=s4e2]',
        },
    }
    connection.receive({"id": request["id"], "ok": True, "result": result})
    assert await task == {
        "download": {**result["download"], "browserId": BROWSER_A},
        "snapshot": {**result["snapshot"], "browserId": BROWSER_A},
    }


@pytest.mark.parametrize("timeout", [0, 60.1, float("nan"), True])
async def test_download_file_rejects_invalid_timeout(timeout: Any) -> None:
    registry = BridgeHub()
    await registry.attach(FakeSocket(), v2_hello(BROWSER_A, extension_version="0.3.0"))
    with pytest.raises(ValueError, match="between 0.1 and 60"):
        await BrowserController(registry).download_file(
            "Export", "s1e2", timeout, BROWSER_A
        )


async def test_wait_rejects_unsafe_video_filename_before_sending() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await registry.attach(socket)
    with pytest.raises(ValueError, match="filename"):
        await BrowserController(registry).wait(0.25, video_filename="../escape.webm")
    assert socket.sent == []


async def test_record_video_routes_and_validates_metadata() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    task = asyncio.create_task(controller.record_video("fixture.webm", 1.5))
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.recordVideo"
    assert request["params"] == {"filename": "fixture.webm", "duration": 1.5}
    connection.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {
                "requestedFilename": "fixture.webm",
                "filename": "chrome-bridge/fixture (1).webm",
                "mimeType": "video/webm",
                "durationMs": 1573,
                "width": 1920,
                "height": 1080,
                "frameCount": 15,
                "droppedFrameCount": 0,
                "sizeBytes": 56920,
            },
        }
    )
    assert await task == {
        "requestedFilename": "fixture.webm",
        "filename": "chrome-bridge/fixture (1).webm",
        "mimeType": "video/webm",
        "durationMs": 1573,
        "width": 1920,
        "height": 1080,
        "frameCount": 15,
        "droppedFrameCount": 0,
        "sizeBytes": 56920,
        "browserId": BROWSER_A,
    }


@pytest.mark.parametrize(
    "filename",
    ["", "video.mp4", "../escape.webm", "folder/video.webm", "bad\n.webm"],
)
async def test_record_video_rejects_unsafe_filename_before_sending(
    filename: str,
) -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await registry.attach(socket)
    with pytest.raises(ValueError, match="filename"):
        await BrowserController(registry).record_video(filename, 1)
    assert socket.sent == []


@pytest.mark.parametrize("duration", [0.49, 10.1, float("inf"), float("nan"), True])
async def test_record_video_rejects_invalid_duration_before_sending(
    duration: Any,
) -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    await registry.attach(socket)
    with pytest.raises(ValueError, match="between 0.5 and 10"):
        await BrowserController(registry).record_video("fixture.webm", duration)
    assert socket.sent == []


async def test_record_video_rejects_invalid_extension_metadata() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    task = asyncio.create_task(
        BrowserController(registry).record_video("fixture.webm", 1)
    )
    await asyncio.sleep(0)
    connection.receive(
        {
            "id": socket.sent[0]["id"],
            "ok": True,
            "result": {
                "requestedFilename": "fixture.webm",
                "filename": "/Users/private/Downloads/fixture.webm",
                "mimeType": "video/webm",
                "durationMs": 1000,
                "width": 800,
                "height": 600,
                "frameCount": 10,
                "droppedFrameCount": 0,
                "sizeBytes": 1000,
            },
        }
    )
    with pytest.raises(ExtensionCommandError, match="recordVideo"):
        await task


@pytest.mark.parametrize("time", [-0.1, 10.1, float("inf"), float("nan"), True])
async def test_wait_rejects_invalid_time(time: Any) -> None:
    with pytest.raises(ValueError, match="between 0 and 10"):
        await BrowserController(BridgeHub()).wait(time)


async def test_screenshot_routes_and_decodes_png() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)

    task = asyncio.create_task(controller.screenshot())
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.screenshot"
    assert request["params"] == {}

    png = b"\x89PNG\r\n\x1a\nfixture"
    hub.receive(
        {
            "id": request["id"],
            "ok": True,
            "result": {
                "data": base64.b64encode(png).decode(),
                "mimeType": "image/png",
                "width": 800,
                "height": 600,
            },
        }
    )
    assert await task == png


@pytest.mark.parametrize(
    "result",
    [
        {},
        {"data": "%%%", "mimeType": "image/png", "width": 1, "height": 1},
        {
            "data": base64.b64encode(b"not png").decode(),
            "mimeType": "image/png",
            "width": 1,
            "height": 1,
        },
    ],
)
async def test_screenshot_rejects_invalid_response(result: Any) -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)
    task = asyncio.create_task(controller.screenshot())
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": result})
    with pytest.raises(ExtensionCommandError, match="screenshot"):
        await task


async def test_console_logs_routes_and_validates_entries() -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)
    task = asyncio.create_task(controller.console_logs())
    await asyncio.sleep(0)
    request = socket.sent[0]
    assert request["type"] == "page.getConsoleLogs"
    assert request["params"] == {}
    entries = [
        {"type": "log", "timestamp": 123.5, "message": "hello 42"},
        {"type": "exception", "timestamp": 124, "message": "Error: boom"},
    ]
    hub.receive({"id": request["id"], "ok": True, "result": entries})
    assert await task == entries


@pytest.mark.parametrize(
    "result",
    [
        {},
        [{"type": "log", "timestamp": True, "message": "bad"}],
        [{"type": "log", "timestamp": float("inf"), "message": "bad"}],
        [{"type": "log", "timestamp": 1, "message": None}],
    ],
)
async def test_console_logs_rejects_invalid_response(result: Any) -> None:
    hub = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    controller = BrowserController(hub)
    await hub.attach(socket)
    task = asyncio.create_task(controller.console_logs())
    await asyncio.sleep(0)
    hub.receive({"id": socket.sent[0]["id"], "ok": True, "result": result})
    with pytest.raises(ExtensionCommandError, match="getConsoleLogs"):
        await task


async def test_two_browser_connections_route_only_by_explicit_id() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket_a = FakeSocket()
    socket_b = FakeSocket()
    connection_a = await registry.attach(socket_a, v2_hello(BROWSER_A, "A"))
    connection_b = await registry.attach(socket_b, v2_hello(BROWSER_B, "B"))

    with pytest.raises(ExtensionUnavailableError, match="Multiple"):
        await registry.request("tabs.list", {})
    task = asyncio.create_task(registry.request("tabs.list", {}, BROWSER_B))
    await asyncio.sleep(0)
    assert socket_a.sent == []
    assert socket_b.sent[0]["type"] == "tabs.list"
    connection_b.receive(
        {"id": socket_b.sent[0]["id"], "ok": True, "result": [{"id": 2}]}
    )
    assert await task == [{"id": 2}]
    assert connection_a.browser_id == BROWSER_A


async def test_same_browser_reconnect_replaces_only_that_connection() -> None:
    registry = BridgeHub(timeout_seconds=1)
    old_socket = FakeSocket()
    other_socket = FakeSocket()
    old = await registry.attach(old_socket, v2_hello(BROWSER_A, "Old"))
    await registry.attach(other_socket, v2_hello(BROWSER_B, "Other"))
    pending = asyncio.create_task(old.request("tabs.list", {}))
    await asyncio.sleep(0)

    new_socket = FakeSocket()
    replacement = await registry.attach(new_socket, v2_hello(BROWSER_A, "New"))
    assert old_socket.closed == (1012, "Replaced by a newer extension connection")
    with pytest.raises(ExtensionUnavailableError, match="replaced"):
        await pending
    await registry.detach(old, old_socket)
    assert registry.resolve(BROWSER_A) is replacement
    assert registry.resolve(BROWSER_B).socket is other_socket


async def test_disconnect_fails_only_its_pending_commands() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket_a = FakeSocket()
    socket_b = FakeSocket()
    connection_a = await registry.attach(socket_a, v2_hello(BROWSER_A))
    connection_b = await registry.attach(socket_b, v2_hello(BROWSER_B))
    task_a = asyncio.create_task(connection_a.request("tabs.list", {}))
    task_b = asyncio.create_task(connection_b.request("tabs.list", {}))
    await asyncio.sleep(0)

    await registry.detach(connection_a, socket_a)
    with pytest.raises(ExtensionUnavailableError, match="disconnected"):
        await task_a
    connection_b.receive(
        {"id": socket_b.sent[0]["id"], "ok": True, "result": [{"id": 8}]}
    )
    assert await task_b == [{"id": 8}]


async def test_response_id_is_never_correlated_across_connections() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket_a = FakeSocket()
    socket_b = FakeSocket()
    connection_a = await registry.attach(socket_a, v2_hello(BROWSER_A))
    connection_b = await registry.attach(socket_b, v2_hello(BROWSER_B))
    task_a = asyncio.create_task(connection_a.request("tabs.list", {}))
    await asyncio.sleep(0)
    with pytest.raises(ProtocolValidationError, match="Unknown response id"):
        connection_b.receive({"id": socket_a.sent[0]["id"], "ok": True, "result": []})
    task_a.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task_a


async def test_legacy_and_v2_connections_coexist_with_distinct_identity() -> None:
    registry = BridgeHub()
    await registry.attach(FakeSocket())
    await registry.attach(FakeSocket(), v2_hello(BROWSER_A, "Work"))
    instances = registry.instances()
    assert len(instances) == 2
    assert {item["identityStable"] for item in instances} == {False, True}
    assert (
        next(item for item in instances if item["identityStable"])["browserId"]
        == BROWSER_A
    )


async def test_v2_structured_result_includes_browser_provenance() -> None:
    registry = BridgeHub(timeout_seconds=1)
    socket = FakeSocket()
    connection = await registry.attach(socket, v2_hello(BROWSER_A))
    controller = BrowserController(registry)
    task = asyncio.create_task(controller.list_tabs())
    await asyncio.sleep(0)
    connection.receive({"id": socket.sent[0]["id"], "ok": True, "result": [{"id": 9}]})
    assert await task == [{"id": 9, "browserId": BROWSER_A}]


async def test_unknown_explicit_browser_id_never_falls_back() -> None:
    registry = BridgeHub()
    socket = FakeSocket()
    await registry.attach(socket, v2_hello(BROWSER_A))
    with pytest.raises(ExtensionUnavailableError, match="browser_instances"):
        await registry.request("tabs.list", {}, BROWSER_B)
    assert socket.sent == []
