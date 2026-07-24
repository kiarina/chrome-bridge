from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any
from urllib.request import Request

import pytest

from scripts.chrome_web_store import (
    ChromeWebStoreClient,
    StoreApiError,
    status_summary,
    submit_release,
)


PUBLISHER_ID = "publisher-123"
ITEM_ID = "ogmocgobegbjbecakclahodnhhfmccad"


class FakeTransport:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = responses
        self.requests: list[Request] = []

    def __call__(self, request: Request, timeout: float) -> dict[str, Any]:
        assert timeout == 30
        self.requests.append(request)
        return self.responses.pop(0)


def extension_zip(tmp_path: Path, version: str = "0.4.0") -> Path:
    archive_path = tmp_path / f"chrome-bridge-extension-{version}.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"version": version}))
    return archive_path


def client(transport: FakeTransport) -> ChromeWebStoreClient:
    return ChromeWebStoreClient(
        publisher_id=PUBLISHER_ID,
        item_id=ITEM_ID,
        access_token="secret-token",
        transport=transport,
    )


def test_submit_release_uploads_exact_zip_and_enables_automatic_publish(
    tmp_path: Path,
) -> None:
    archive_path = extension_zip(tmp_path)
    transport = FakeTransport(
        [
            {
                "itemId": ITEM_ID,
                "publishedItemRevisionStatus": {"state": "PUBLISHED"},
            },
            {
                "itemId": ITEM_ID,
                "uploadState": "SUCCEEDED",
                "crxVersion": "0.4.0",
            },
            {"itemId": ITEM_ID, "state": "PENDING_REVIEW"},
        ]
    )

    result = submit_release(
        client(transport),
        archive_path,
        expected_version="0.4.0",
        publish_type="DEFAULT_PUBLISH",
        deploy_percentage=100,
        poll_interval=0,
        poll_timeout=1,
    )

    assert result == {
        "itemId": ITEM_ID,
        "version": "0.4.0",
        "uploadState": "SUCCEEDED",
        "submissionState": "PENDING_REVIEW",
        "publishType": "DEFAULT_PUBLISH",
        "deployPercentage": 100,
        "skipped": False,
    }
    status_request, upload_request, publish_request = transport.requests
    assert status_request.get_method() == "GET"
    assert status_request.full_url.endswith(
        f"/{PUBLISHER_ID}/items/{ITEM_ID}:fetchStatus"
    )
    assert upload_request.data == archive_path.read_bytes()
    assert upload_request.get_header("Content-type") == "application/zip"
    assert upload_request.get_header("Authorization") == "Bearer secret-token"
    assert json.loads(publish_request.data or b"") == {
        "publishType": "DEFAULT_PUBLISH",
        "deployInfos": [{"deployPercentage": 100}],
        "skipReview": False,
        "blockOnWarnings": True,
    }


def test_submit_release_polls_asynchronous_upload(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            {"itemId": ITEM_ID},
            {"itemId": ITEM_ID, "uploadState": "IN_PROGRESS"},
            {"itemId": ITEM_ID, "lastAsyncUploadState": "SUCCEEDED"},
            {"itemId": ITEM_ID, "state": "PUBLISHED"},
        ]
    )

    result = submit_release(
        client(transport),
        extension_zip(tmp_path),
        expected_version="0.4.0",
        publish_type="DEFAULT_PUBLISH",
        deploy_percentage=100,
        poll_interval=0,
        poll_timeout=1,
    )

    assert result["uploadState"] == "SUCCEEDED"
    assert len(transport.requests) == 4


def test_submit_release_skips_an_already_published_extension(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            {
                "itemId": ITEM_ID,
                "publishedItemRevisionStatus": {
                    "state": "PUBLISHED",
                    "distributionChannels": [{"crxVersion": "0.4.0"}],
                },
            }
        ]
    )

    result = submit_release(
        client(transport),
        extension_zip(tmp_path),
        expected_version="0.4.0",
        publish_type="DEFAULT_PUBLISH",
        deploy_percentage=100,
        poll_interval=0,
        poll_timeout=1,
    )

    assert result == {
        "itemId": ITEM_ID,
        "version": "0.4.0",
        "skipped": True,
        "reason": "extension-version-already-published",
    }
    assert len(transport.requests) == 1


def test_submit_release_rejects_a_version_older_than_store(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            {
                "itemId": ITEM_ID,
                "publishedItemRevisionStatus": {
                    "state": "PUBLISHED",
                    "distributionChannels": [{"crxVersion": "0.4.1"}],
                },
            }
        ]
    )

    with pytest.raises(StoreApiError, match="newer extension version"):
        submit_release(
            client(transport),
            extension_zip(tmp_path, "0.4"),
            expected_version="0.4",
            publish_type="DEFAULT_PUBLISH",
            deploy_percentage=100,
            poll_interval=0,
            poll_timeout=1,
        )

    assert len(transport.requests) == 1


@pytest.mark.parametrize("state", ["PENDING_REVIEW", "STAGED"])
def test_submit_release_rejects_an_existing_submission(
    tmp_path: Path, state: str
) -> None:
    transport = FakeTransport(
        [
            {
                "itemId": ITEM_ID,
                "submittedItemRevisionStatus": {"state": state},
            }
        ]
    )

    with pytest.raises(StoreApiError, match="active submission"):
        submit_release(
            client(transport),
            extension_zip(tmp_path),
            expected_version="0.4.0",
            publish_type="DEFAULT_PUBLISH",
            deploy_percentage=100,
            poll_interval=0,
            poll_timeout=1,
        )

    assert len(transport.requests) == 1


def test_submit_release_rejects_warnings_before_upload(tmp_path: Path) -> None:
    transport = FakeTransport([{"itemId": ITEM_ID, "warned": True}])

    with pytest.raises(StoreApiError, match="policy warning"):
        submit_release(
            client(transport),
            extension_zip(tmp_path),
            expected_version="0.4.0",
            publish_type="DEFAULT_PUBLISH",
            deploy_percentage=100,
            poll_interval=0,
            poll_timeout=1,
        )

    assert len(transport.requests) == 1


def test_submit_release_rejects_version_mismatch_before_api_call(
    tmp_path: Path,
) -> None:
    transport = FakeTransport([])

    with pytest.raises(ValueError, match="does not match"):
        submit_release(
            client(transport),
            extension_zip(tmp_path, "0.4.1"),
            expected_version="0.4.0",
            publish_type="DEFAULT_PUBLISH",
            deploy_percentage=100,
            poll_interval=0,
            poll_timeout=1,
        )

    assert transport.requests == []


def test_status_summary_fails_for_rejection() -> None:
    transport = FakeTransport(
        [
            {
                "itemId": ITEM_ID,
                "publishedItemRevisionStatus": {"state": "PUBLISHED"},
                "submittedItemRevisionStatus": {"state": "REJECTED"},
            }
        ]
    )

    with pytest.raises(StoreApiError, match="requires attention"):
        status_summary(client(transport))
