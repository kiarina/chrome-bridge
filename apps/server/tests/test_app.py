from __future__ import annotations

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from chrome_bridge_mcp import Settings, create_app


def test_health() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["extensionConnected"] is False


def test_extension_hello_updates_health() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/extension") as websocket:
            websocket.send_json(
                {
                    "type": "hello",
                    "protocolVersion": 1,
                    "extensionVersion": "0.1.0",
                }
            )
            websocket.send_json({"type": "ping"})
            assert websocket.receive_json() == {"type": "pong"}
            health = client.get("/health").json()
            assert health["extensionConnected"] is True
            assert health["extension"]["extensionVersion"] == "0.1.0"


def test_health_redacts_multiple_browser_identity() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/extension") as first:
            first.send_json(
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.1.0",
                    "browserId": "123e4567-e89b-42d3-a456-426614174000",
                    "browserLabel": "Private work profile",
                }
            )
            with client.websocket_connect("/extension") as second:
                second.send_json(
                    {
                        "type": "hello",
                        "protocolVersion": 2,
                        "extensionVersion": "0.1.0",
                        "browserId": "123e4567-e89b-42d3-a456-426614174001",
                        "browserLabel": "Private personal profile",
                    }
                )
                second.send_json({"type": "ping"})
                assert second.receive_json() == {"type": "pong"}
                health = client.get("/health").json()
                assert health == {
                    "status": "ok",
                    "extensionConnected": True,
                    "connectedBrowserCount": 2,
                    "extension": {},
                }


def test_extension_rejects_malformed_json_with_protocol_close() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/extension") as websocket:
            websocket.send_text("{")
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 1002


def test_extension_rejects_invalid_hello_with_protocol_close() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/extension") as websocket:
            websocket.send_json(
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.1.0",
                }
            )
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 1002


@pytest.mark.parametrize(
    "message",
    [
        {"type": "ping", "extra": True},
        {
            "id": "123e4567-e89b-42d3-a456-426614174000",
            "ok": True,
            "result": {},
        },
    ],
)
def test_extension_rejects_invalid_runtime_lifecycle(message: object) -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        with client.websocket_connect("/extension") as websocket:
            websocket.send_json(
                {
                    "type": "hello",
                    "protocolVersion": 1,
                    "extensionVersion": "0.1.0",
                }
            )
            websocket.send_json(message)
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 1002


def test_health_rejects_dns_rebinding_origin() -> None:
    app = create_app(Settings())
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": "http://localhost.evil"})
        assert response.status_code == 403


def test_tools_include_non_focusing_tab_select() -> None:
    app = create_app(Settings())
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
            headers={"Accept": "application/json, text/event-stream"},
        )
        assert response.status_code == 200
        tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}
        assert len(tools) == 21
        assert tools["browser_instances"]["inputSchema"]["properties"] == {}
        assert "browser_tab_select" in tools
        assert "without focusing" in tools["browser_tab_select"]["description"]
        assert "browser_snapshot" in tools
        assert set(tools["browser_snapshot"]["inputSchema"]["properties"]) == {
            "browser_id"
        }
        assert "browser_click" in tools
        click_schema = tools["browser_click"]["inputSchema"]
        assert set(click_schema["required"]) == {"element", "ref"}
        assert set(click_schema["properties"]) == {
            "element",
            "ref",
            "video_filename",
            "browser_id",
        }
        assert set(tools["browser_drag"]["inputSchema"]["required"]) == {
            "startElement",
            "startRef",
            "endElement",
            "endRef",
        }
        assert "video_filename" in tools["browser_drag"]["inputSchema"]["properties"]
        assert set(tools["browser_upload_file"]["inputSchema"]["required"]) == {
            "element",
            "ref",
            "paths",
        }
        assert "video_filename" in tools["browser_upload_file"]["inputSchema"][
            "properties"
        ]
        assert set(tools["browser_hover"]["inputSchema"]["required"]) == {
            "element",
            "ref",
        }
        assert "video_filename" in tools["browser_hover"]["inputSchema"]["properties"]
        assert set(tools["browser_type"]["inputSchema"]["required"]) == {
            "element",
            "ref",
            "text",
            "submit",
        }
        assert "video_filename" in tools["browser_type"]["inputSchema"]["properties"]
        assert set(tools["browser_select_option"]["inputSchema"]["required"]) == {
            "element",
            "ref",
            "values",
        }
        assert (
            "video_filename"
            in tools["browser_select_option"]["inputSchema"]["properties"]
        )
        assert set(tools["browser_press_key"]["inputSchema"]["required"]) == {"key"}
        assert (
            "video_filename" in tools["browser_press_key"]["inputSchema"]["properties"]
        )
        assert set(tools["browser_navigate"]["inputSchema"]["required"]) == {"url"}
        assert set(tools["browser_go_back"]["inputSchema"]["properties"]) == {
            "browser_id"
        }
        assert set(tools["browser_go_forward"]["inputSchema"]["properties"]) == {
            "browser_id"
        }
        assert set(tools["browser_wait"]["inputSchema"]["required"]) == {"time"}
        assert set(tools["browser_wait"]["inputSchema"]["properties"]) == {
            "time",
            "video_filename",
            "browser_id",
        }
        assert set(tools["browser_record_video"]["inputSchema"]["required"]) == {
            "filename",
            "duration",
        }
        assert set(tools["browser_screenshot"]["inputSchema"]["properties"]) == {
            "browser_id"
        }
        assert set(tools["browser_get_console_logs"]["inputSchema"]["properties"]) == {
            "browser_id"
        }
        for name, tool in tools.items():
            if name != "browser_instances":
                assert "browser_id" in tool["inputSchema"]["properties"]
                assert "browser_id" not in tool["inputSchema"].get("required", [])
