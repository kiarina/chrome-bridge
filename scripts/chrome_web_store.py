from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any


API_ORIGIN = "https://chromewebstore.googleapis.com"
COMPONENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
ACTIVE_SUBMISSION_STATES = {"PENDING_REVIEW", "STAGED"}
FAILED_SUBMISSION_STATES = {"REJECTED", "CANCELLED"}
UPLOAD_SUCCESS = "SUCCEEDED"
UPLOAD_PENDING = "IN_PROGRESS"
UPLOAD_FAILURES = {"FAILED", "NOT_FOUND", "UPLOAD_STATE_UNSPECIFIED"}
PUBLISH_TYPES = {"DEFAULT_PUBLISH", "STAGED_PUBLISH"}
Transport = Callable[[urllib.request.Request, float], dict[str, Any]]


class StoreApiError(RuntimeError):
    """A safe-to-print Chrome Web Store automation failure."""


def validate_component(label: str, value: str) -> str:
    if not COMPONENT_PATTERN.fullmatch(value):
        raise ValueError(f"{label} contains unsupported characters")
    return value


def extension_version(archive_path: Path) -> str:
    if not archive_path.is_file():
        raise FileNotFoundError(f"extension ZIP does not exist: {archive_path}")
    with zipfile.ZipFile(archive_path) as archive:
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except KeyError as error:
            raise ValueError("extension ZIP has no root manifest.json") from error
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError("extension ZIP manifest has an invalid version")
    return version


def version_tuple(version: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"invalid Chrome extension version: {version!r}")
    parts = tuple(int(part) for part in version.split("."))
    return (*parts, *(0 for _ in range(4 - len(parts))))


def default_transport(
    request: urllib.request.Request, timeout: float
) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read(16_384).decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            message = parsed.get("error", {}).get("message", detail)
        except (json.JSONDecodeError, AttributeError):
            message = detail
        raise StoreApiError(
            f"Chrome Web Store API returned HTTP {error.code}: {message}"
        ) from error
    except urllib.error.URLError as error:
        raise StoreApiError(
            f"Chrome Web Store API request failed: {error.reason}"
        ) from error

    try:
        result = json.loads(payload)
    except json.JSONDecodeError as error:
        raise StoreApiError("Chrome Web Store API returned invalid JSON") from error
    if not isinstance(result, dict):
        raise StoreApiError("Chrome Web Store API returned a non-object response")
    return result


class ChromeWebStoreClient:
    def __init__(
        self,
        *,
        publisher_id: str,
        item_id: str,
        access_token: str,
        timeout: float = 30,
        transport: Transport = default_transport,
    ) -> None:
        self.publisher_id = validate_component("publisher ID", publisher_id)
        self.item_id = validate_component("item ID", item_id)
        if not access_token:
            raise ValueError("access token is required")
        self.access_token = access_token
        self.timeout = timeout
        self.transport = transport

    @property
    def resource_name(self) -> str:
        return f"publishers/{self.publisher_id}/items/{self.item_id}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.access_token}",
        }
        if content_type is not None:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(
            f"{API_ORIGIN}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        return self.transport(request, self.timeout)

    def fetch_status(self) -> dict[str, Any]:
        return self._request("GET", f"/v2/{self.resource_name}:fetchStatus")

    def upload(self, archive_path: Path) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/upload/v2/{self.resource_name}:upload",
            body=archive_path.read_bytes(),
            content_type="application/zip",
        )

    def publish(self, *, publish_type: str, deploy_percentage: int) -> dict[str, Any]:
        if publish_type not in PUBLISH_TYPES:
            raise ValueError(f"unsupported publish type: {publish_type}")
        if not 0 <= deploy_percentage <= 100:
            raise ValueError("deploy percentage must be between 0 and 100")
        payload = json.dumps(
            {
                "publishType": publish_type,
                "deployInfos": [{"deployPercentage": deploy_percentage}],
                "skipReview": False,
                "blockOnWarnings": True,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        return self._request(
            "POST",
            f"/v2/{self.resource_name}:publish",
            body=payload,
            content_type="application/json",
        )


def revision_state(status: dict[str, Any], field: str) -> str | None:
    revision = status.get(field)
    if not isinstance(revision, dict):
        return None
    state = revision.get("state")
    return state if isinstance(state, str) else None


def validate_safe_status(status: dict[str, Any]) -> None:
    if status.get("takenDown") is True:
        raise StoreApiError("Store item is taken down; inspect the Developer Dashboard")
    if status.get("warned") is True:
        raise StoreApiError(
            "Store item has a policy warning; inspect the Developer Dashboard"
        )
    submitted = revision_state(status, "submittedItemRevisionStatus")
    if submitted in ACTIVE_SUBMISSION_STATES:
        raise StoreApiError(f"Store item already has an active submission: {submitted}")
    if submitted in FAILED_SUBMISSION_STATES:
        raise StoreApiError(
            f"previous Store submission ended as {submitted}; inspect the Developer Dashboard"
        )


def published_versions(status: dict[str, Any]) -> set[str]:
    revision = status.get("publishedItemRevisionStatus")
    if not isinstance(revision, dict):
        return set()
    channels = revision.get("distributionChannels")
    if not isinstance(channels, list):
        return set()
    return {
        channel["crxVersion"]
        for channel in channels
        if isinstance(channel, dict) and isinstance(channel.get("crxVersion"), str)
    }


def validate_item_id(response: dict[str, Any], expected: str) -> None:
    if response.get("itemId") != expected:
        raise StoreApiError("Chrome Web Store API response item ID did not match")


def wait_for_upload(
    client: ChromeWebStoreClient,
    upload_response: dict[str, Any],
    *,
    poll_interval: float,
    poll_timeout: float,
) -> str:
    state = upload_response.get("uploadState")
    if state == UPLOAD_SUCCESS:
        return state
    if state != UPLOAD_PENDING:
        raise StoreApiError(f"extension upload did not succeed: {state!r}")

    deadline = time.monotonic() + poll_timeout
    while time.monotonic() < deadline:
        time.sleep(poll_interval)
        status = client.fetch_status()
        state = status.get("lastAsyncUploadState")
        if state == UPLOAD_SUCCESS:
            return state
        if state in UPLOAD_FAILURES:
            raise StoreApiError(f"asynchronous extension upload failed: {state}")
        if state != UPLOAD_PENDING:
            raise StoreApiError(f"asynchronous extension upload returned {state!r}")
    raise StoreApiError("extension upload did not finish before the polling deadline")


def submit_release(
    client: ChromeWebStoreClient,
    archive_path: Path,
    *,
    expected_version: str,
    publish_type: str,
    deploy_percentage: int,
    poll_interval: float,
    poll_timeout: float,
) -> dict[str, Any]:
    if poll_interval < 0 or poll_timeout <= 0:
        raise ValueError("upload polling values must be positive")
    actual_version = extension_version(archive_path)
    if actual_version != expected_version:
        raise ValueError(
            f"extension ZIP version {actual_version!r} does not match {expected_version!r}"
        )

    before = client.fetch_status()
    validate_item_id(before, client.item_id)
    validate_safe_status(before)
    current_versions = published_versions(before)
    if expected_version in current_versions:
        return {
            "itemId": client.item_id,
            "version": expected_version,
            "skipped": True,
            "reason": "extension-version-already-published",
        }
    expected_tuple = version_tuple(expected_version)
    if any(version_tuple(version) > expected_tuple for version in current_versions):
        raise StoreApiError("Store already contains a newer extension version")

    uploaded = client.upload(archive_path)
    validate_item_id(uploaded, client.item_id)
    upload_state = wait_for_upload(
        client,
        uploaded,
        poll_interval=poll_interval,
        poll_timeout=poll_timeout,
    )
    uploaded_version = uploaded.get("crxVersion")
    if uploaded_version is not None and uploaded_version != expected_version:
        raise StoreApiError("uploaded extension version did not match the release")

    published = client.publish(
        publish_type=publish_type,
        deploy_percentage=deploy_percentage,
    )
    validate_item_id(published, client.item_id)
    state = published.get("state")
    expected_states = (
        {"PENDING_REVIEW", "PUBLISHED"}
        if publish_type == "DEFAULT_PUBLISH"
        else {"PENDING_REVIEW", "STAGED", "PUBLISHED"}
    )
    if state not in expected_states:
        raise StoreApiError(f"Store submission returned unexpected state: {state!r}")
    warning_info = published.get("warningInfo")
    warnings = (
        warning_info.get("warnings", []) if isinstance(warning_info, dict) else []
    )
    if warnings:
        raise StoreApiError("Store submission unexpectedly returned warnings")

    return {
        "itemId": client.item_id,
        "version": expected_version,
        "uploadState": upload_state,
        "submissionState": state,
        "publishType": publish_type,
        "deployPercentage": deploy_percentage,
        "skipped": False,
    }


def status_summary(client: ChromeWebStoreClient) -> dict[str, Any]:
    status = client.fetch_status()
    validate_item_id(status, client.item_id)
    if status.get("takenDown") is True or status.get("warned") is True:
        validate_safe_status({**status, "submittedItemRevisionStatus": None})
    submitted = revision_state(status, "submittedItemRevisionStatus")
    if submitted in FAILED_SUBMISSION_STATES:
        raise StoreApiError(f"Store submission requires attention: {submitted}")
    return {
        "itemId": client.item_id,
        "publishedState": revision_state(status, "publishedItemRevisionStatus"),
        "submittedState": submitted,
        "uploadState": status.get("lastAsyncUploadState"),
        "warned": status.get("warned", False),
        "takenDown": status.get("takenDown", False),
    }


def write_summary(result: dict[str, Any]) -> None:
    encoded = json.dumps(result, sort_keys=True, separators=(",", ":"))
    print(encoded)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = ["## Chrome Web Store\n\n"]
        lines.extend(f"- `{key}`: `{value}`\n" for key, value in result.items())
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.writelines(lines)


def require(value: str | None, label: str) -> str:
    if not value:
        raise ValueError(f"{label} is required")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automate Chrome Web Store API v2 release operations"
    )
    parser.add_argument(
        "--publisher-id", default=os.environ.get("CHROME_WEB_STORE_PUBLISHER_ID")
    )
    parser.add_argument("--item-id", default=os.environ.get("CHROME_WEB_STORE_ITEM_ID"))
    parser.add_argument("--request-timeout", type=float, default=30)
    subparsers = parser.add_subparsers(dest="command", required=True)

    submit = subparsers.add_parser("submit")
    submit.add_argument("--extension-zip", type=Path, required=True)
    submit.add_argument("--expected-version")
    submit.add_argument(
        "--publish-type", choices=sorted(PUBLISH_TYPES), default="DEFAULT_PUBLISH"
    )
    submit.add_argument("--deploy-percentage", type=int, default=100)
    submit.add_argument("--poll-interval", type=float, default=5)
    submit.add_argument("--poll-timeout", type=float, default=300)
    subparsers.add_parser("status")

    arguments = parser.parse_args()
    client = ChromeWebStoreClient(
        publisher_id=require(arguments.publisher_id, "publisher ID"),
        item_id=require(arguments.item_id, "item ID"),
        access_token=require(
            os.environ.get("CHROME_WEB_STORE_ACCESS_TOKEN"), "access token"
        ),
        timeout=arguments.request_timeout,
    )
    try:
        if arguments.command == "submit":
            archive_path = arguments.extension_zip.resolve()
            result = submit_release(
                client,
                archive_path,
                expected_version=arguments.expected_version
                or extension_version(archive_path),
                publish_type=arguments.publish_type,
                deploy_percentage=arguments.deploy_percentage,
                poll_interval=arguments.poll_interval,
                poll_timeout=arguments.poll_timeout,
            )
        else:
            result = status_summary(client)
        write_summary(result)
    except (OSError, ValueError, StoreApiError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
