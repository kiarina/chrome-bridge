from __future__ import annotations

import pytest

from chrome_bridge_mcp.protocol import (
    PROTOCOL_SCHEMA,
    PROTOCOL_V2_SCHEMA,
    ProtocolValidationError,
    validate_extension_initial_message,
    validate_extension_runtime_message,
    validate_server_message,
)


ID = "123e4567-e89b-42d3-a456-426614174000"


def test_schema_lists_all_protocol_commands() -> None:
    command_types = PROTOCOL_SCHEMA["$defs"]["commandRequest"]["properties"]["type"][
        "enum"
    ]
    assert len(command_types) == 20
    assert len(set(command_types)) == 20
    assert "page.drag" in command_types
    assert "page.uploadFile" in command_types
    assert "page.recordVideo" in command_types


def test_protocol_v2_requires_stable_browser_identity() -> None:
    assert PROTOCOL_V2_SCHEMA["$defs"]["hello"]["additionalProperties"] is False
    validate_extension_initial_message(
        {
            "type": "hello",
            "protocolVersion": 2,
            "extensionVersion": "0.1.0",
            "browserId": ID,
            "browserLabel": "Work",
        }
    )
    with pytest.raises(ProtocolValidationError):
        validate_extension_initial_message(
            {
                "type": "hello",
                "protocolVersion": 2,
                "extensionVersion": "0.1.0",
                "browserId": ID,
            }
        )
    with pytest.raises(ProtocolValidationError):
        validate_extension_initial_message(
            {
                "type": "hello",
                "protocolVersion": 2,
                "extensionVersion": "0.1.0",
                "browserId": ID,
                "browserLabel": "   ",
            }
        )


@pytest.mark.parametrize(
    "message",
    [
        {"id": ID, "type": "tabs.list", "params": {}},
        {
            "id": ID,
            "type": "page.drag",
            "params": {
                "startElement": "Card",
                "startRef": "s1e2",
                "endElement": "Done",
                "endRef": "s1e3",
            },
        },
        {
            "id": ID,
            "type": "page.uploadFile",
            "params": {
                "element": "Add photos",
                "ref": "s1e4",
                "paths": ["/tmp/one.png", "/tmp/two.png"],
            },
        },
        {
            "id": ID,
            "type": "page.recordVideo",
            "params": {"filename": "fixture.webm", "duration": 1.5},
        },
        {
            "id": ID,
            "type": "page.wait",
            "params": {"time": 1, "videoFilename": "wait.webm"},
        },
        {"type": "pong"},
    ],
)
def test_server_message_validation_accepts_valid_messages(message: object) -> None:
    validate_server_message(message)


@pytest.mark.parametrize(
    "message",
    [
        {"id": ID, "type": "tabs.list", "params": {"extra": True}},
        {"id": ID, "type": "tabs.close", "params": {"tabId": "1"}},
        {"id": ID, "type": "page.wait", "params": {"time": 11}},
        {
            "id": ID,
            "type": "page.recordVideo",
            "params": {"filename": "fixture.webm", "duration": 10.1},
        },
        {
            "id": ID,
            "type": "page.uploadFile",
            "params": {"element": "Add", "ref": "s1e2", "paths": []},
        },
        {"id": ID, "type": "page.unknown", "params": {}},
        {"type": "pong", "extra": True},
    ],
)
def test_server_message_validation_rejects_invalid_messages(message: object) -> None:
    with pytest.raises(ProtocolValidationError):
        validate_server_message(message)


def test_extension_lifecycle_messages_are_disjoint() -> None:
    hello = {
        "type": "hello",
        "protocolVersion": 1,
        "extensionVersion": "0.1.0",
    }
    validate_extension_initial_message(hello)
    validate_extension_runtime_message({"type": "ping"})
    with pytest.raises(ProtocolValidationError):
        validate_extension_runtime_message(hello)


@pytest.mark.parametrize(
    "message",
    [
        {"id": ID, "ok": True, "result": {}},
        {"id": ID, "ok": False, "error": "No tab"},
    ],
)
def test_extension_response_envelopes_accept_valid_messages(message: object) -> None:
    validate_extension_runtime_message(message)


@pytest.mark.parametrize(
    "message",
    [
        {"id": ID, "ok": True},
        {"id": ID, "ok": False, "error": ""},
        {"id": ID, "ok": True, "result": {}, "error": "mixed"},
        {"id": "not-a-uuid", "ok": True, "result": {}},
    ],
)
def test_extension_response_envelopes_reject_invalid_messages(message: object) -> None:
    with pytest.raises(ProtocolValidationError):
        validate_extension_runtime_message(message)
