#!/usr/bin/env python3
"""Record the canonical Kiteframe journey through a running chrome-bridge MCP."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mcp-url", default="http://127.0.0.1:8765/mcp")
    parser.add_argument("--site-url", default="http://127.0.0.1:4177/")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("/tmp/kiteframe-recordings.json"),
        help="Write actual downloaded filenames here",
    )
    parser.add_argument(
        "--close-tab",
        action="store_true",
        help="Close the controlled demo tab after recording",
    )
    return parser.parse_args()


def tool_value(result: Any) -> Any:
    if result.isError:
        message = "\n".join(
            item.text
            for item in result.content
            if getattr(item, "type", None) == "text"
        )
        raise RuntimeError(message or "MCP tool call failed")
    structured = result.structuredContent
    if isinstance(structured, dict) and "result" in structured:
        return structured["result"]
    if structured is not None:
        return structured
    text = next(
        (item.text for item in result.content if getattr(item, "type", None) == "text"),
        None,
    )
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def operation_snapshot(value: dict[str, Any]) -> dict[str, Any]:
    operation = value.get("operation", value)
    if not isinstance(operation, dict) or not isinstance(
        operation.get("snapshot"), str
    ):
        raise RuntimeError("Expected a snapshot operation result")
    return operation


def element_ref(snapshot: dict[str, Any], role: str, name: str) -> str:
    pattern = (
        rf'{re.escape(role)} "[^\"]*{re.escape(name)}[^\"]*"[^\n]*'
        rf"\[ref=(s\d+e\d+)\]"
    )
    match = re.search(pattern, snapshot["snapshot"])
    if not match:
        raise RuntimeError(
            f"Could not find {role} named {name!r} in the latest snapshot"
        )
    return match.group(1)


async def call(session: ClientSession, name: str, arguments: dict[str, Any]) -> Any:
    return tool_value(await session.call_tool(name, arguments))


async def record(args: argparse.Namespace) -> None:
    recordings: list[dict[str, Any]] = []
    tab_id: int | None = None
    opened_tab = False
    completed = False

    async with streamablehttp_client(args.mcp_url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            instances = await call(session, "browser_instances", {})
            if len(instances) != 1:
                raise RuntimeError(
                    f"The showcase requires exactly one connected browser; found {len(instances)}"
                )
            browser_id = instances[0]["browserId"]

            try:
                tab = await call(
                    session,
                    "browser_tab_open",
                    {
                        "url": args.site_url,
                        "active": False,
                        "browser_id": browser_id,
                    },
                )
                tab_id = tab["id"]
                opened_tab = True
                await call(
                    session,
                    "browser_tab_select",
                    {"tab_id": tab_id, "browser_id": browser_id},
                )

                landing = await call(
                    session,
                    "browser_record_video",
                    {
                        "filename": "01-landing.webm",
                        "duration": 2,
                        "browser_id": browser_id,
                    },
                )
                recordings.append(landing)

                await call(
                    session,
                    "browser_navigate",
                    {
                        "url": urljoin(args.site_url, "signup.html"),
                        "browser_id": browser_id,
                    },
                )
                signup_arrival = await call(
                    session,
                    "browser_record_video",
                    {
                        "filename": "02-signup-arrival.webm",
                        "duration": 1,
                        "browser_id": browser_id,
                    },
                )
                recordings.append(signup_arrival)
                snapshot = await call(
                    session, "browser_snapshot", {"browser_id": browser_id}
                )

                fields = [
                    ("Full name", "Morgan Rivera", "03-full-name.webm"),
                    ("Work email", "morgan@example.test", "04-email.webm"),
                    ("Create a password", "frame-demo-2026", "05-password.webm"),
                    ("Workspace name", "Northstar Studio", "06-workspace.webm"),
                ]
                for label, text, filename in fields:
                    value = await call(
                        session,
                        "browser_type",
                        {
                            "element": f"{label} field",
                            "ref": element_ref(snapshot, "textbox", label),
                            "text": text,
                            "submit": False,
                            "video_filename": filename,
                            "browser_id": browser_id,
                        },
                    )
                    recordings.append(value["recording"])
                    snapshot = operation_snapshot(value)

                selections = [
                    ("Team size", "11-50", "07-team-size.webm"),
                    ("Your role", "operations", "08-role.webm"),
                ]
                for label, selected, filename in selections:
                    value = await call(
                        session,
                        "browser_select_option",
                        {
                            "element": f"{label} menu",
                            "ref": element_ref(snapshot, "combobox", label),
                            "values": [selected],
                            "video_filename": filename,
                            "browser_id": browser_id,
                        },
                    )
                    recordings.append(value["recording"])
                    snapshot = operation_snapshot(value)

                value = await call(
                    session,
                    "browser_press_key",
                    {
                        "key": "PageDown",
                        "video_filename": "09-scroll.webm",
                        "browser_id": browser_id,
                    },
                )
                recordings.append(value["recording"])
                snapshot = await call(
                    session, "browser_snapshot", {"browser_id": browser_id}
                )

                checkbox_actions = [
                    ("Smoother launches", "10-goal.webm"),
                    (
                        "I understand this is a fictional, local-only demo and no account will actually be created.",
                        "11-acknowledge.webm",
                    ),
                ]
                for label, filename in checkbox_actions:
                    value = await call(
                        session,
                        "browser_click",
                        {
                            "element": label,
                            "ref": element_ref(snapshot, "checkbox", label),
                            "video_filename": filename,
                            "browser_id": browser_id,
                        },
                    )
                    recordings.append(value["recording"])
                    snapshot = operation_snapshot(value)

                value = await call(
                    session,
                    "browser_click",
                    {
                        "element": "Create my workspace button",
                        "ref": element_ref(snapshot, "button", "Create my workspace"),
                        "video_filename": "12-complete.webm",
                        "browser_id": browser_id,
                    },
                )
                recordings.append(value["recording"])
                final_snapshot = operation_snapshot(value)
                if "Your workspace is ready" not in final_snapshot["title"]:
                    raise RuntimeError(
                        f"Unexpected completion page: {final_snapshot['title']}"
                    )
                completed = True
            finally:
                if (
                    (args.close_tab or not completed)
                    and opened_tab
                    and tab_id is not None
                ):
                    await call(
                        session,
                        "browser_tab_close",
                        {"tab_id": tab_id, "browser_id": browser_id},
                    )

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps({"recordings": recordings}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Recorded {len(recordings)} clips. Manifest: {args.manifest}")
    for recording in recordings:
        print(recording["filename"])


def main() -> None:
    asyncio.run(record(parse_args()))


if __name__ == "__main__":
    main()
