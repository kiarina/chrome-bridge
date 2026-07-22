from __future__ import annotations

import argparse
import asyncio
import json
import re

from chrome_bridge_sdk import ChromeBridge, Snapshot


BUTTON_REF = re.compile(r'- button "Update this profile" \[ref=(s\d+e\d+)\]')


async def run(fixture_url: str, port: int) -> None:
    chrome = ChromeBridge(port=port, startup_timeout=45)
    temporary_tab_id: int | None = None
    async with chrome.session(wait_timeout=30) as session:
        matches: list[tuple[str, int]] = []
        for instance in await session.browser_instances():
            for tab in await session.browser_tabs(browser_id=instance.browser_id):
                if tab.url == fixture_url:
                    matches.append((instance.browser_id, tab.id))
        if len(matches) != 1:
            raise RuntimeError(
                f"Expected exactly one branded-Chrome fixture tab, found {len(matches)}"
            )

        browser_id, fixture_tab_id = matches[0]
        temporary_tab = await session.browser_tab_open(
            active=True, browser_id=browser_id
        )
        temporary_tab_id = temporary_tab.id
        try:
            selected = await session.browser_tab_select(
                tab_id=fixture_tab_id, browser_id=browser_id
            )
            if selected.active:
                raise RuntimeError("Selecting the fixture unexpectedly activated it")
            tabs = await session.browser_tabs(browser_id=browser_id)
            if not any(tab.id == temporary_tab_id and tab.active for tab in tabs):
                raise RuntimeError("Fixture selection changed the active Chrome tab")

            snapshot = await session.browser_snapshot(browser_id=browser_id)
            match = BUTTON_REF.search(snapshot.snapshot)
            if match is None:
                raise RuntimeError("Fixture button ref was absent from the snapshot")
            clicked = await session.browser_click(
                element="Update this profile button",
                ref=match.group(1),
                browser_id=browser_id,
            )
            if not isinstance(clicked, Snapshot) or "Updated store-sdk-smoke" not in (
                clicked.snapshot
            ):
                raise RuntimeError("Strict-ref click did not update the fixture")

            screenshot = await session.browser_screenshot(browser_id=browser_id)
            if (
                screenshot.mime_type != "image/png"
                or not screenshot.image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
            ):
                raise RuntimeError("SDK screenshot did not return valid PNG data")

            print(
                json.dumps(
                    {
                        "ok": True,
                        "extension": "Chrome Web Store",
                        "selectionStayedBackground": True,
                        "snapshotGeneration": clicked.generation,
                        "screenshot": {
                            "mimeType": screenshot.mime_type,
                            "width": screenshot.width,
                            "height": screenshot.height,
                        },
                    }
                )
            )
        finally:
            await session.browser_tab_close(
                tab_id=temporary_tab_id, browser_id=browser_id
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture-url", required=True)
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.fixture_url, arguments.port))
