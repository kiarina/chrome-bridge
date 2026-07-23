from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import httpx2
import pytest

import chrome_bridge_sdk.client as client_module
from chrome_bridge_sdk import (
    BrowserInstance,
    ChromeBridge,
    ClosedTab,
    ConsoleEntry,
    Download,
    DownloadFileResult,
    KeyPress,
    NestedSessionError,
    OperationError,
    OperationOutcomeUnknownError,
    RecordedResult,
    Recording,
    Screenshot,
    SessionStatus,
    Snapshot,
    Tab,
    WaitResult,
)


def response(
    request: httpx2.Request, status: int, body: dict[str, Any]
) -> httpx2.Response:
    return httpx2.Response(
        status,
        content=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        request=request,
    )


@pytest.fixture
def direct_api(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/api/v1/meta":
            return response(
                request,
                200,
                {
                    "service": "chrome-bridge",
                    "apiVersion": 1,
                    "serverVersion": "0.3.0",
                    "extensionConnected": True,
                },
            )
        if request.url.path == "/api/v1/sessions" and request.method == "POST":
            return response(
                request,
                200,
                {
                    "ok": True,
                    "result": {
                        "sessionId": "session-1",
                        "token": "secret",
                        "idleTtlSeconds": 120,
                    },
                },
            )
        if request.url.path.endswith("/heartbeat"):
            return response(request, 200, {"ok": True, "result": {}})
        if request.url.path == "/api/v1/sessions/session-1":
            return response(request, 200, {"ok": True, "result": {"released": True}})
        if request.url.path == "/api/v1/tools":
            return response(request, 200, {"tools": [{"name": "browser_tabs"}]})
        if request.url.path == "/api/v1/call":
            payload = json.loads(request.content)
            calls.append(payload)
            method = payload["method"]
            arguments = payload["arguments"]
            result: Any
            tab = {
                "id": 7,
                "windowId": 2,
                "index": 0,
                "active": True,
                "pinned": False,
                "incognito": False,
                "title": "Fixture",
                "url": "https://example.com/",
                "targeted": True,
                "browserId": "browser-1",
            }
            recording = {
                "requestedFilename": arguments.get("video_filename", "hold.webm"),
                "filename": "chrome-bridge/save.webm",
                "mimeType": "video/webm",
                "durationMs": 1200,
                "width": 1920,
                "height": 1080,
                "frameCount": 12,
                "droppedFrameCount": 0,
                "sizeBytes": 4096,
                "browserId": "browser-1",
            }
            if method == "browser_instances":
                result = [
                    {
                        "browserId": "browser-1",
                        "label": "Primary",
                        "protocolVersion": 2,
                        "extensionVersion": "0.1.0",
                        "identityStable": True,
                    }
                ]
            elif method == "browser_tabs":
                result = [tab]
            elif method in {
                "browser_tab_open",
                "browser_tab_select",
                "browser_tab_activate",
            }:
                result = tab
            elif method == "browser_tab_close":
                result = {
                    "closed": True,
                    "tabId": arguments["tab_id"],
                    "browserId": "browser-1",
                }
            elif method in {
                "browser_drag",
                "browser_type",
                "browser_snapshot",
                "browser_hover",
                "browser_upload_file",
                "browser_select_option",
                "browser_navigate",
                "browser_go_back",
                "browser_go_forward",
            }:
                result = {
                    "generation": 3,
                    "url": "https://example.com/",
                    "title": "Fixture",
                    "snapshot": '- button "Save" [ref=s3e1]',
                    "browserId": "browser-1",
                }
            elif method == "browser_wait_for":
                snapshot = {
                    "generation": 3,
                    "url": "https://example.com/",
                    "title": "Fixture",
                    "snapshot": '- status "Ready" [ref=s3e1]',
                    "browserId": "browser-1",
                }
                if arguments["video_filename"] is None:
                    result = snapshot
                else:
                    result = {
                        "operation": snapshot,
                        "recording": {
                            **recording,
                            "requestedFilename": arguments["video_filename"],
                        },
                    }
            elif method == "browser_click":
                snapshot = {
                    "generation": 4,
                    "url": "https://example.com/saved",
                    "title": "Saved",
                    "snapshot": '- status "Saved" [ref=s4e1]',
                    "browserId": "browser-1",
                }
                result = {
                    "operation": snapshot,
                    "recording": {
                        **recording,
                        "requestedFilename": arguments["video_filename"],
                    },
                }
            elif method == "browser_press_key":
                result = {
                    "pressed": True,
                    "key": arguments["key"],
                    "browserId": "browser-1",
                }
            elif method == "browser_wait":
                result = {
                    "waited": True,
                    "time": arguments["time"],
                    "browserId": "browser-1",
                }
            elif method == "browser_download_file":
                result = {
                    "download": {
                        "suggestedFilename": "report.csv",
                        "state": "complete",
                        "receivedBytes": 42,
                        "totalBytes": 42,
                        "browserId": "browser-1",
                    },
                    "snapshot": {
                        "generation": 5,
                        "url": "https://example.com/reports",
                        "title": "Reports",
                        "snapshot": '- status "Downloaded" [ref=s5e1]',
                        "browserId": "browser-1",
                    },
                }
            elif method == "browser_record_video":
                result = {
                    **recording,
                    "requestedFilename": arguments["filename"],
                }
            elif method == "browser_screenshot":
                result = {
                    "data": base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode(),
                    "mimeType": "image/png",
                    "width": 1920,
                    "height": 1080,
                    "browserId": "browser-1",
                }
            elif method == "browser_get_console_logs":
                result = [{"type": "log", "message": "ready", "timestamp": 123.5}]
            else:
                result = {"method": method}
            return response(
                request,
                200,
                {"ok": True, "result": result},
            )
        raise AssertionError(request.url)

    transport = httpx2.MockTransport(handler)
    async_client = httpx2.AsyncClient
    monkeypatch.setattr(
        client_module.httpx2,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )
    return calls


async def test_session_hides_lifecycle_and_calls_direct_api(
    direct_api: list[dict[str, Any]],
) -> None:
    chrome = ChromeBridge()
    assert not hasattr(chrome, "open")
    assert not hasattr(chrome, "close")
    assert not hasattr(chrome, "restart")
    assert not hasattr(chrome, "finish")

    async with chrome.session() as session:
        tabs = await session.browser_tabs()
        assert tabs == [
            Tab(
                id=7,
                window_id=2,
                index=0,
                active=True,
                pinned=False,
                incognito=False,
                title="Fixture",
                url="https://example.com/",
                targeted=True,
                browser_id="browser-1",
            )
        ]
        assert tabs[0].id == 7
        assert await session.call("custom") == {"method": "custom"}
        assert await session.tool_definitions() == [{"name": "browser_tabs"}]

    assert direct_api == [
        {"method": "browser_tabs", "arguments": {"browser_id": None}},
        {"method": "custom", "arguments": {}},
    ]


async def test_nested_session_is_rejected(direct_api: list[dict[str, Any]]) -> None:
    chrome = ChromeBridge()
    another = ChromeBridge()
    async with chrome.session():
        with pytest.raises(NestedSessionError):
            async with another.session():
                pass

        async def acquire_in_another_task() -> None:
            async with chrome.session():
                pass

        await asyncio.create_task(acquire_in_another_task())


async def test_typed_results_python_arguments_and_status(
    direct_api: list[dict[str, Any]],
) -> None:
    statuses: list[SessionStatus] = []
    chrome = ChromeBridge(status_callback=statuses.append)

    async with chrome.session() as session:
        snapshot = await session.browser_drag(
            start_element="Card",
            start_ref="s3e1",
            end_element="Column",
            end_ref="s3e2",
        )
        assert isinstance(snapshot, Snapshot)
        await session.browser_type("Name", "s3e3", "Ada")
        recorded = await session.browser_click(
            "Save button", "s3e4", video_filename="save.webm"
        )
        assert isinstance(recorded, RecordedResult)
        assert recorded.operation.title == "Saved"
        assert recorded.recording.filename == "chrome-bridge/save.webm"
        screenshot = await session.browser_screenshot()
        assert isinstance(screenshot, Screenshot)
        assert screenshot.image_bytes.startswith(b"\x89PNG")
        logs = await session.browser_get_console_logs()
        assert logs == [ConsoleEntry(type="log", message="ready", timestamp=123.5)]

    assert direct_api[0] == {
        "method": "browser_drag",
        "arguments": {
            "startElement": "Card",
            "startRef": "s3e1",
            "endElement": "Column",
            "endRef": "s3e2",
            "video_filename": None,
            "browser_id": None,
        },
    }
    assert direct_api[1]["arguments"]["submit"] is False
    assert statuses == [
        SessionStatus.CHECKING_SERVER,
        SessionStatus.SERVER_READY,
        SessionStatus.CHECKING_EXTENSION,
        SessionStatus.WAITING_FOR_SESSION,
        SessionStatus.SESSION_ACQUIRED,
        SessionStatus.RELEASING_SESSION,
        SessionStatus.SESSION_RELEASED,
    ]


async def test_remaining_typed_result_models(
    direct_api: list[dict[str, Any]],
) -> None:
    async with ChromeBridge().session() as session:
        assert await session.browser_instances() == [
            BrowserInstance(
                browser_id="browser-1",
                label="Primary",
                protocol_version=2,
                extension_version="0.1.0",
                identity_stable=True,
            )
        ]
        assert isinstance(await session.browser_tab_open(), Tab)
        closed = await session.browser_tab_close(7)
        assert closed == ClosedTab(closed=True, tab_id=7, browser_id="browser-1")
        pressed = await session.browser_press_key("Enter")
        assert pressed == KeyPress(pressed=True, key="Enter", browser_id="browser-1")
        waited = await session.browser_wait(0.5)
        assert waited == WaitResult(waited=True, time=0.5, browser_id="browser-1")
        assert isinstance(await session.browser_wait_for("Ready"), Snapshot)
        recorded_wait = await session.browser_wait_for(
            "Ready", video_filename="wait-for.webm"
        )
        assert isinstance(recorded_wait, RecordedResult)
        assert recorded_wait.recording.requested_filename == "wait-for.webm"
        downloaded = await session.browser_download_file("Export", "s3e1", 60)
        assert downloaded == DownloadFileResult(
            download=Download(
                suggested_filename="report.csv",
                state="complete",
                received_bytes=42,
                total_bytes=42,
                browser_id="browser-1",
            ),
            snapshot=Snapshot(
                generation=5,
                url="https://example.com/reports",
                title="Reports",
                snapshot='- status "Downloaded" [ref=s5e1]',
                browser_id="browser-1",
            ),
        )
        recording = await session.browser_record_video("hold.webm", 1)
        assert isinstance(recording, Recording)
        assert recording.requested_filename == "hold.webm"


async def test_structured_operation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/api/v1/meta":
            return response(
                request,
                200,
                {
                    "service": "chrome-bridge",
                    "apiVersion": 1,
                    "serverVersion": "0.3.0",
                    "extensionConnected": True,
                },
            )
        if request.url.path == "/api/v1/sessions":
            return response(
                request,
                200,
                {
                    "ok": True,
                    "result": {
                        "sessionId": "session-1",
                        "token": "secret",
                        "idleTtlSeconds": 120,
                    },
                },
            )
        if request.url.path == "/api/v1/call":
            return response(
                request,
                400,
                {
                    "ok": False,
                    "error": {
                        "code": "invalid_arguments",
                        "message": "bad ref",
                        "retryable": True,
                        "outcomeUnknown": False,
                    },
                },
            )
        if request.method == "DELETE":
            return response(request, 200, {"ok": True, "result": {}})
        raise AssertionError(request.url)

    transport = httpx2.MockTransport(handler)
    async_client = httpx2.AsyncClient
    monkeypatch.setattr(
        client_module.httpx2,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )

    async with ChromeBridge().session() as session:
        with pytest.raises(OperationError) as caught:
            await session.call("browser_snapshot")
    assert caught.value.code == "invalid_arguments"
    assert caught.value.retryable is True
    assert caught.value.outcome_unknown is False


async def test_call_transport_failure_is_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    call_count = 0

    def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal call_count
        if request.url.path == "/api/v1/meta":
            return response(
                request,
                200,
                {
                    "service": "chrome-bridge",
                    "apiVersion": 1,
                    "serverVersion": "0.3.0",
                    "extensionConnected": True,
                },
            )
        if request.url.path == "/api/v1/sessions":
            return response(
                request,
                200,
                {
                    "ok": True,
                    "result": {
                        "sessionId": "session-1",
                        "token": "secret",
                        "idleTtlSeconds": 120,
                    },
                },
            )
        if request.url.path == "/api/v1/call":
            call_count += 1
            raise httpx2.ConnectError("lost", request=request)
        if request.method == "DELETE":
            return response(request, 200, {"ok": True, "result": {}})
        raise AssertionError(request.url)

    transport = httpx2.MockTransport(handler)
    async_client = httpx2.AsyncClient
    monkeypatch.setattr(
        client_module.httpx2,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )
    chrome = ChromeBridge()
    async with chrome.session() as session:
        with pytest.raises(OperationOutcomeUnknownError):
            await session.browser_instances()
    assert call_count == 1
