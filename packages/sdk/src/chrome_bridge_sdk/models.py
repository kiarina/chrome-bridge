from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Generic, Protocol, Self, TypeVar


def _mapping(value: Any) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError("result must be an object")
    return value


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("optional value must be a string")
    return value


@dataclass(frozen=True, slots=True)
class BrowserInstance:
    browser_id: str
    label: str
    protocol_version: int
    extension_version: str
    identity_stable: bool

    @classmethod
    def _from_result(cls, value: Any) -> BrowserInstance:
        item = _mapping(value)
        return cls(
            browser_id=str(item["browserId"]),
            label=str(item["label"]),
            protocol_version=int(item["protocolVersion"]),
            extension_version=str(item["extensionVersion"]),
            identity_stable=bool(item["identityStable"]),
        )


@dataclass(frozen=True, slots=True)
class Tab:
    id: int
    window_id: int
    index: int
    active: bool
    pinned: bool
    incognito: bool
    title: str
    url: str
    targeted: bool
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> Tab:
        item = _mapping(value)
        return cls(
            id=int(item["id"]),
            window_id=int(item["windowId"]),
            index=int(item["index"]),
            active=bool(item["active"]),
            pinned=bool(item["pinned"]),
            incognito=bool(item["incognito"]),
            title=str(item["title"]),
            url=str(item["url"]),
            targeted=bool(item["targeted"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class ClosedTab:
    closed: bool
    tab_id: int
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> ClosedTab:
        item = _mapping(value)
        return cls(
            closed=bool(item["closed"]),
            tab_id=int(item["tabId"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class Snapshot:
    generation: int
    url: str
    title: str
    snapshot: str
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> Snapshot:
        item = _mapping(value)
        return cls(
            generation=int(item["generation"]),
            url=str(item["url"]),
            title=str(item["title"]),
            snapshot=str(item["snapshot"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class Recording:
    requested_filename: str
    filename: str
    mime_type: str
    duration_ms: int
    width: int
    height: int
    frame_count: int
    dropped_frame_count: int
    size_bytes: int
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> Recording:
        item = _mapping(value)
        return cls(
            requested_filename=str(item["requestedFilename"]),
            filename=str(item["filename"]),
            mime_type=str(item["mimeType"]),
            duration_ms=int(item["durationMs"]),
            width=int(item["width"]),
            height=int(item["height"]),
            frame_count=int(item["frameCount"]),
            dropped_frame_count=int(item["droppedFrameCount"]),
            size_bytes=int(item["sizeBytes"]),
            browser_id=_optional_string(item.get("browserId")),
        )


class _ResultModel(Protocol):
    @classmethod
    def _from_result(cls, value: Any) -> Self: ...


OperationT = TypeVar("OperationT", bound=_ResultModel)


@dataclass(frozen=True, slots=True)
class RecordedResult(Generic[OperationT]):
    operation: OperationT
    recording: Recording


@dataclass(frozen=True, slots=True)
class KeyPress:
    pressed: bool
    key: str
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> KeyPress:
        item = _mapping(value)
        return cls(
            pressed=bool(item["pressed"]),
            key=str(item["key"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class WaitResult:
    waited: bool
    time: float
    browser_id: str | None = None

    @classmethod
    def _from_result(cls, value: Any) -> WaitResult:
        item = _mapping(value)
        return cls(
            waited=bool(item["waited"]),
            time=float(item["time"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class Screenshot:
    data: str
    mime_type: str
    width: int
    height: int
    browser_id: str | None = None

    @property
    def image_bytes(self) -> bytes:
        try:
            return base64.b64decode(self.data, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("screenshot data is not valid base64") from error

    @classmethod
    def _from_result(cls, value: Any) -> Screenshot:
        item = _mapping(value)
        return cls(
            data=str(item["data"]),
            mime_type=str(item["mimeType"]),
            width=int(item["width"]),
            height=int(item["height"]),
            browser_id=_optional_string(item.get("browserId")),
        )


@dataclass(frozen=True, slots=True)
class ConsoleEntry:
    type: str
    message: str
    timestamp: float

    @classmethod
    def _from_result(cls, value: Any) -> ConsoleEntry:
        item = _mapping(value)
        return cls(
            type=str(item["type"]),
            message=str(item["message"]),
            timestamp=float(item["timestamp"]),
        )


def _recorded_result(
    value: Any, operation_type: type[OperationT]
) -> RecordedResult[OperationT]:
    item = _mapping(value)
    return RecordedResult(
        operation=operation_type._from_result(item["operation"]),
        recording=Recording._from_result(item["recording"]),
    )
