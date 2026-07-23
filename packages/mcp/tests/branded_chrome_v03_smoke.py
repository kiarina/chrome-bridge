from __future__ import annotations

import argparse
import asyncio
import json
import re
import socket
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from chrome_bridge_sdk import (
    ChromeBridge,
    DownloadFileResult,
    OperationError,
    OperationOutcomeUnknownError,
    Screenshot,
)


def ref_for(snapshot: str, name: str) -> str:
    match = re.search(rf'- link "{re.escape(name)}" \[ref=(s\d+e\d+)\]', snapshot)
    if match is None:
        raise RuntimeError(f"Fixture ref was absent for {name!r}")
    return match.group(1)


def fixture_handler(run_id: str) -> type[BaseHTTPRequestHandler]:
    filenames = {
        "immediate": f"chrome-bridge-{run_id}-immediate.csv",
        "delayed": f"chrome-bridge-{run_id}-delayed.csv",
        "timeout": f"chrome-bridge-{run_id}-timeout.csv",
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            route = self.path.split("?", 1)[0]
            if route == "/fixture":
                body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Chrome Bridge 0.3 smoke</title></head>
<body><main>
<h1>Chrome Bridge 0.3 branded smoke</h1>
<p role="status">Ready {run_id}</p>
<a href="/download/immediate" download>Download immediate</a>
<a href="/download/delayed" download>Download delayed</a>
<a href="/download/timeout" download>Download timeout</a>
</main><script>
setTimeout(() => {{
  const marker = document.createElement("p");
  marker.id = "async-marker";
  marker.textContent = "Async marker {run_id}";
  document.querySelector("main").append(marker);
}}, 3000);
setTimeout(() => document.querySelector("#async-marker")?.remove(), 6000);
</script></body></html>""".encode()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            match = re.fullmatch(r"/download/(immediate|delayed|timeout)", route)
            if match is None:
                self.send_error(404)
                return
            kind = match.group(1)
            if kind == "delayed":
                time.sleep(1)
            elif kind == "timeout":
                time.sleep(1)
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self.connection.close()
                return
            body = f"kind,value\n{kind},42\n".encode()
            self.send_response(200)
            self.send_header(
                "content-disposition", f'attachment; filename="{filenames[kind]}"'
            )
            self.send_header("content-type", "text/csv; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            return

    Handler.filenames = filenames  # type: ignore[attr-defined]
    return Handler


@contextmanager
def serve_fixture(run_id: str) -> Iterator[tuple[str, dict[str, str]]]:
    handler = fixture_handler(run_id)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        yield f"http://127.0.0.1:{port}/fixture?run={run_id}", handler.filenames
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def delete_created_downloads(
    download_dir: Path, filenames: dict[str, str]
) -> tuple[list[str], list[str]]:
    deleted = []
    missing = []
    for kind in ("immediate", "delayed"):
        candidate = download_dir / filenames[kind]
        if candidate.is_file():
            candidate.unlink()
            deleted.append(candidate.name)
        else:
            missing.append(candidate.name)
    return deleted, missing


async def run(port: int, download_dir: Path) -> None:
    run_id = uuid4().hex
    with serve_fixture(run_id) as (fixture_url, filenames):
        chrome = ChromeBridge(port=port, startup_timeout=45)
        fixture_tab_id: int | None = None
        async with chrome.session(wait_timeout=30) as session:
            instances = await session.browser_instances()
            if len(instances) != 1:
                raise RuntimeError(
                    f"Expected exactly one branded Chrome instance, found {len(instances)}"
                )
            instance = instances[0]
            if instance.extension_version != "0.3.0":
                raise RuntimeError(
                    f"Expected extension 0.3.0, got {instance.extension_version}"
                )
            browser_id = instance.browser_id
            tabs_before = await session.browser_tabs(browser_id=browser_id)
            active_before = next((tab.id for tab in tabs_before if tab.active), None)
            if active_before is None:
                raise RuntimeError("Chrome had no active tab before the smoke")

            fixture_tab = await session.browser_tab_open(
                url=fixture_url, active=False, browser_id=browser_id
            )
            fixture_tab_id = fixture_tab.id
            try:
                selected = await session.browser_tab_select(
                    tab_id=fixture_tab_id, browser_id=browser_id
                )
                if selected.active:
                    raise RuntimeError(
                        "Selecting the fixture unexpectedly activated it"
                    )

                initial = await session.browser_snapshot(browser_id=browser_id)
                stale_ref = ref_for(initial.snapshot, "Download immediate")
                marker = f"Async marker {run_id}"
                visible = await session.browser_wait_for(
                    marker, state="visible", timeout=10, browser_id=browser_id
                )
                if marker not in visible.snapshot:
                    raise RuntimeError("Visible wait result omitted the marker")
                try:
                    await session.browser_download_file(
                        "Download immediate link",
                        stale_ref,
                        browser_id=browser_id,
                    )
                except OperationError as error:
                    if error.outcome_unknown:
                        raise RuntimeError(
                            "Stale ref was incorrectly outcome-unknown"
                        ) from error
                else:
                    raise RuntimeError("A stale pre-wait ref was accepted")

                hidden = await session.browser_wait_for(
                    marker, state="hidden", timeout=10, browser_id=browser_id
                )
                if marker in hidden.snapshot:
                    raise RuntimeError("Hidden wait result retained the marker")

                immediate = await session.browser_download_file(
                    "Download immediate link",
                    ref_for(hidden.snapshot, "Download immediate"),
                    browser_id=browser_id,
                )
                if not isinstance(immediate, DownloadFileResult):
                    raise RuntimeError(
                        "Typed immediate download result was not returned"
                    )
                if immediate.download.suggested_filename != filenames["immediate"]:
                    raise RuntimeError("Immediate download filename did not match")

                delayed_raw = await session.call(
                    "browser_download_file",
                    {
                        "element": "Download delayed link",
                        "ref": ref_for(immediate.snapshot.snapshot, "Download delayed"),
                        "timeout": 60,
                        "browser_id": browser_id,
                    },
                )
                if set(delayed_raw) != {"download", "snapshot"}:
                    raise RuntimeError(
                        "Download result contained unexpected top-level fields"
                    )
                if set(delayed_raw["download"]) != {
                    "suggestedFilename",
                    "state",
                    "receivedBytes",
                    "totalBytes",
                    "browserId",
                }:
                    raise RuntimeError("Download metadata exposed unexpected fields")
                if delayed_raw["download"]["suggestedFilename"] != filenames["delayed"]:
                    raise RuntimeError("Delayed download filename did not match")

                timeout_ref = ref_for(
                    delayed_raw["snapshot"]["snapshot"], "Download timeout"
                )
                try:
                    await session.browser_download_file(
                        "Download timeout link",
                        timeout_ref,
                        timeout=0.1,
                        browser_id=browser_id,
                    )
                except OperationOutcomeUnknownError as error:
                    if error.retryable or not error.outcome_unknown:
                        raise RuntimeError(
                            "Timeout failure contract was incorrect"
                        ) from error
                else:
                    raise RuntimeError(
                        "The intentionally stalled download did not time out"
                    )

                screenshot = await session.browser_screenshot(browser_id=browser_id)
                if not isinstance(screenshot, Screenshot) or not (
                    screenshot.image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
                ):
                    raise RuntimeError(
                        "Debugger was not reusable after download timeout"
                    )

                tabs_after = await session.browser_tabs(browser_id=browser_id)
                if not any(
                    tab.id == active_before and tab.active for tab in tabs_after
                ):
                    raise RuntimeError("Smoke changed the original active Chrome tab")
            finally:
                await session.browser_tab_close(
                    tab_id=fixture_tab_id, browser_id=browser_id
                )

        deleted, missing = delete_created_downloads(download_dir, filenames)
        print(
            json.dumps(
                {
                    "ok": True,
                    "browserId": browser_id,
                    "extensionVersion": instance.extension_version,
                    "selectionStayedBackground": True,
                    "waitFor": ["visible", "hidden"],
                    "downloads": {
                        "immediate": filenames["immediate"],
                        "delayed": filenames["delayed"],
                        "timeoutOutcomeUnknown": True,
                        "timeout60Accepted": True,
                    },
                    "publicDownloadFields": sorted(delayed_raw["download"]),
                    "postTimeoutDebuggerReuse": True,
                    "deletedDownloads": deleted,
                    "cleanupRequired": missing,
                },
                separators=(",", ":"),
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--download-dir", type=Path, default=Path.home() / "Downloads")
    arguments = parser.parse_args()
    asyncio.run(run(arguments.port, arguments.download_dir.resolve()))
