from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator


class ProtocolValidationError(ValueError):
    """Raised when an extension protocol message does not match version 1."""


def _load_schema(name: str) -> dict[str, Any]:
    resource = files(__package__).joinpath(name)
    return json.loads(resource.read_text(encoding="utf-8"))


PROTOCOL_SCHEMA = _load_schema("protocol_v1.schema.json")
PROTOCOL_V2_SCHEMA = _load_schema("protocol_v2.schema.json")
for _schema in (PROTOCOL_SCHEMA, PROTOCOL_V2_SCHEMA):
    Draft202012Validator.check_schema(_schema)


def _validator(definition: str) -> Draft202012Validator:
    schema = dict(PROTOCOL_SCHEMA)
    schema["$ref"] = f"#/$defs/{definition}"
    return Draft202012Validator(schema)


def _v2_validator(definition: str) -> Draft202012Validator:
    schema = dict(PROTOCOL_V2_SCHEMA)
    schema["$ref"] = f"#/$defs/{definition}"
    return Draft202012Validator(schema)


_SERVER_MESSAGE = _validator("serverMessage")
_EXTENSION_MESSAGE = _validator("extensionMessage")
_EXTENSION_INITIAL_MESSAGE = _validator("extensionInitialMessage")
_EXTENSION_V2_INITIAL_MESSAGE = _v2_validator("extensionInitialMessage")
_EXTENSION_RUNTIME_MESSAGE = _validator("extensionRuntimeMessage")


def _validate(validator: Draft202012Validator, message: Any, label: str) -> None:
    errors = sorted(validator.iter_errors(message), key=lambda error: list(error.path))
    if not errors:
        return
    error = errors[0]
    path = ".".join(str(part) for part in error.absolute_path)
    location = f" at {path}" if path else ""
    raise ProtocolValidationError(f"Invalid {label}{location}: {error.message}")


def validate_server_message(message: Any) -> None:
    _validate(_SERVER_MESSAGE, message, "server message")


def validate_extension_message(message: Any) -> None:
    _validate(_EXTENSION_MESSAGE, message, "extension message")


def validate_extension_initial_message(message: Any) -> None:
    validator = (
        _EXTENSION_V2_INITIAL_MESSAGE
        if isinstance(message, dict) and message.get("protocolVersion") == 2
        else _EXTENSION_INITIAL_MESSAGE
    )
    _validate(validator, message, "extension hello")


def validate_extension_runtime_message(message: Any) -> None:
    _validate(_EXTENSION_RUNTIME_MESSAGE, message, "extension runtime message")
