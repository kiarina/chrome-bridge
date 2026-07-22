from __future__ import annotations

import json
from typing import Any

import httpx2
import pytest

import chrome_bridge_sdk.client as client_module
from chrome_bridge_sdk import (
    ChromeBridge,
    NestedSessionError,
    OperationOutcomeUnknownError,
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
                    "serverVersion": "0.2.0",
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
            return response(
                request,
                200,
                {"ok": True, "result": {"method": payload["method"]}},
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
        result = await session.browser_tabs()
        assert result == {"method": "browser_tabs"}
        assert await session.tool_definitions() == [{"name": "browser_tabs"}]

    assert direct_api == [{"method": "browser_tabs", "arguments": {"browser_id": None}}]


async def test_nested_session_is_rejected(direct_api: list[dict[str, Any]]) -> None:
    chrome = ChromeBridge()
    async with chrome.session():
        with pytest.raises(NestedSessionError):
            async with chrome.session():
                pass


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
                    "serverVersion": "0.2.0",
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
