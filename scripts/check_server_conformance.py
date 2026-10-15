"""Check that the Python and the Dart server answer the same.

Starts each server on a free loopback port, connects a fake extension over the
extension WebSocket (it answers commands from a fixed table), and runs one scenario
through MCP, the Direct API, sessions, the security checks and the protocol checks.
The two transcripts must be equal after removing what is per instance (instance IDs,
session IDs and tokens, the implementation name). Messages produced by each language's
argument validation are compared by their error code only.

    uv run python scripts/check_server_conformance.py            # both, compared
    uv run python scripts/check_server_conformance.py --server dart --show
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx2
import websockets

ROOT = Path(__file__).resolve().parents[1]
BROWSER_ID = "8b1f0c52-6f0e-4b5a-9a7e-2f1c3d4e5a6b"
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 20).decode()
SNAPSHOT = {
    "generation": 3,
    "url": "https://example.test/",
    "title": "Example",
    "snapshot": '- button "Save" [ref=s3e1]',
}
TAB = {
    "id": 2,
    "windowId": 1,
    "index": 1,
    "active": False,
    "targeted": True,
    "pinned": False,
    "incognito": False,
    "title": "Example",
    "url": "https://example.test/",
}
DIALOG = {
    "pageState": "browser-dialog",
    "generation": 7,
    "url": "https://example.test/",
    "title": "Example",
    "dialog": {
        "type": "confirm",
        "message": "Sure?",
        "defaultPrompt": "",
        "ref": "s7d1",
        "actions": ["accept", "dismiss"],
    },
}
# What the fake extension answers to each command: a result, ("error", message), or
# ("bad", result) for a malformed result the server must reject.
ANSWERS: dict[str, Any] = {
    "tabs.list": [TAB],
    "tabs.open": TAB,
    "tabs.close": {"closed": True, "tabId": 2},
    "tabs.select": TAB,
    "tabs.activate": {**TAB, "active": True},
    "page.snapshot": SNAPSHOT,
    "page.click": DIALOG,
    "page.hover": SNAPSHOT,
    "page.type": ("bad", {"generation": "3"}),
    "page.selectOption": ("error", "Unable to find option for value: x"),
    "page.pressKey": {"pressed": True, "key": "Enter"},
    "page.navigate": SNAPSHOT,
    "page.goBack": SNAPSHOT,
    "page.goForward": SNAPSHOT,
    "page.wait": {"waited": True, "time": 0.5},
    "page.waitFor": SNAPSHOT,
    "page.screenshot": {"mimeType": "image/png", "data": PNG, "width": 2, "height": 2},
    "page.getConsoleLogs": [{"type": "log", "message": "ready", "timestamp": 1.5}],
    "page.dialogRespond": SNAPSHOT,
    "page.downloadFile": {
        "download": {
            "suggestedFilename": "a.csv",
            "state": "complete",
            "receivedBytes": 3,
            "totalBytes": 3,
        },
        "snapshot": SNAPSHOT,
    },
}
HEADERS = {
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
}


def server_command(name: str) -> list[str]:
    if name == "python":
        return ["uv", "run", "python", "-u", "packages/mcp/tests/e2e_server.py"]
    return ["dart", "run", "packages/mcp-dart/bin/chrome_bridge_mcp.dart"]


async def start(name: str) -> tuple[asyncio.subprocess.Process, str]:
    env = {
        **os.environ,
        "CHROME_BRIDGE_E2E_PORT": "0",
        "CHROME_BRIDGE_OPERATION_WAIT_TIMEOUT": "1",
        "CHROME_BRIDGE_COMMAND_TIMEOUT": "2",
    }
    command = server_command(name)
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=ROOT,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    assert process.stdout is not None
    while True:
        line = await process.stdout.readline()
        if not line:
            raise RuntimeError(f"{name} server stopped before it was ready")
        try:
            ready = json.loads(line)
        except ValueError:
            continue
        if ready.get("event") == "ready":
            return process, ready["httpUrl"]


async def fake_extension(url: str, connected: asyncio.Event) -> None:
    async with websockets.connect(
        url.replace("http://", "ws://") + "/extension",
        origin="chrome-extension://abcdefghijklmnop",
    ) as socket:
        await socket.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.5.0",
                    "browserId": BROWSER_ID,
                    "browserLabel": "Work",
                }
            )
        )
        connected.set()
        async for raw in socket:
            message = json.loads(raw)
            answer = ANSWERS.get(
                message["type"], ("error", f"unknown {message['type']}")
            )
            if message["type"] == "page.wait" and message["params"].get("time") == 2:
                await asyncio.sleep(3)  # longer than the command timeout
            if isinstance(answer, tuple) and answer[0] == "error":
                reply = {"id": message["id"], "ok": False, "error": answer[1]}
            else:
                result = answer[1] if isinstance(answer, tuple) else answer
                reply = {"id": message["id"], "ok": True, "result": result}
            await socket.send(json.dumps(reply))


async def scenario(url: str) -> list[Any]:
    out: list[Any] = []
    async with httpx2.AsyncClient(base_url=url, timeout=10) as http:

        async def get(path: str, **kw: Any) -> None:
            r = await http.get(path, **kw)
            out.append(["GET", path, r.status_code, _body(r)])

        async def mcp(method: str, params: dict[str, Any] | None = None) -> None:
            body: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
            if params is not None:
                body["params"] = params
            r = await http.post("/mcp", headers=HEADERS, json=body)
            out.append(["MCP", method, params, r.status_code, _body(r)])

        async def tool(name: str, arguments: dict[str, Any]) -> None:
            await mcp("tools/call", {"name": name, "arguments": arguments})

        async def call(
            method: str, arguments: Any, headers: dict[str, str] | None = None
        ) -> Any:
            r = await http.post(
                "/api/v1/call",
                json={"method": method, "arguments": arguments},
                headers=headers or {},
            )
            out.append(["CALL", method, arguments, r.status_code, _body(r)])
            return r

        await get("/health")
        await get("/api/v1/meta")
        await tool("browser_tabs", {})
        connected = asyncio.Event()
        extension = asyncio.create_task(fake_extension(url, connected))
        await connected.wait()
        await asyncio.sleep(0.2)
        await get("/health")
        await get("/api/v1/meta")
        await get("/api/v1/tools")
        await get("/health", headers={"origin": "https://evil.example"})
        await get("/health", headers={"host": "evil.example"})
        await get("/api/v1/meta", headers={"origin": "chrome-extension://abc"})
        await get("/nowhere")

        await mcp(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "c", "version": "1"},
            },
        )
        await mcp(
            "initialize",
            {
                "protocolVersion": "2099-01-01",
                "capabilities": {},
                "clientInfo": {"name": "c", "version": "1"},
            },
        )
        await mcp("ping", {})
        await mcp("tools/list", {})
        await mcp("resources/list", {})
        await mcp("prompts/list", {})
        r = await http.post(
            "/mcp",
            headers=HEADERS,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        out.append(["MCP", "notification", r.status_code, r.text])
        r = await http.delete("/mcp")
        out.append(["MCP", "DELETE", r.status_code])

        for name, arguments in [
            ("browser_instances", {}),
            ("browser_tabs", {}),
            ("browser_tab_open", {"url": "https://example.test/", "active": False}),
            ("browser_tab_open", {"url": "file:///etc/passwd"}),
            ("browser_tab_close", {"tab_id": 2}),
            ("browser_tab_select", {"tab_id": 2}),
            ("browser_tab_activate", {"tab_id": 2}),
            ("browser_snapshot", {}),
            ("browser_click", {"element": "Save", "ref": "s3e1"}),
            ("browser_click", {"element": " ", "ref": "s3e1"}),
            ("browser_hover", {"element": "Save", "ref": "s3e1"}),
            (
                "browser_type",
                {"element": "Name", "ref": "s3e1", "text": "x", "submit": False},
            ),
            (
                "browser_select_option",
                {"element": "Color", "ref": "s3e1", "values": ["x"]},
            ),
            (
                "browser_select_option",
                {"element": "Color", "ref": "s3e1", "values": []},
            ),
            ("browser_press_key", {"key": "Enter"}),
            ("browser_navigate", {"url": "https://example.test/next"}),
            ("browser_navigate", {"url": "about:blank"}),
            ("browser_go_back", {}),
            ("browser_go_forward", {}),
            ("browser_wait", {"time": 0.5}),
            ("browser_wait", {"time": 11}),
            ("browser_wait_for", {"text": "Saved"}),
            ("browser_wait_for", {"text": "Saved", "state": "gone"}),
            ("browser_screenshot", {}),
            ("browser_get_console_logs", {}),
            ("browser_dialog_respond", {"dialog_ref": "s7d1", "action": "accept"}),
            ("browser_dialog_respond", {"dialog_ref": "nope", "action": "accept"}),
            ("browser_download_file", {"element": "Export", "ref": "s3e1"}),
            ("browser_record_video", {"filename": "../x.webm", "duration": 1}),
            ("browser_tabs", {"browser_id": "00000000-0000-4000-8000-000000000000"}),
            ("browser_nope", {}),
        ]:
            await tool(name, arguments)
        out.append(["NOTE", "argument validation"])
        for name, arguments in [
            ("browser_tab_close", {}),
            ("browser_wait", {"time": "soon"}),
        ]:
            await tool(name, arguments)

        await call("browser_tabs", {})
        await call("browser_press_key", {"key": "Enter"})
        await call("browser_wait", {"time": 0.5})
        await call("browser_screenshot", {})
        await call("browser_get_console_logs", {})
        await call(
            "browser_type",
            {"element": "Name", "ref": "s3e1", "text": "x", "submit": False},
        )
        await call("browser_tab_open", {"url": "file:///etc/passwd"})
        await call("browser_nope", {})
        await call("browser_tab_close", {})
        r = await http.post("/api/v1/call", content=b"{bad")
        out.append(["CALL", "bad json", r.status_code, _body(r)])
        r = await http.post("/api/v1/call", json={"method": "browser_tabs"})
        out.append(["CALL", "no arguments", r.status_code, _body(r)])
        await call("browser_tabs", {}, headers={"x-chrome-bridge-session": "x"})

        r = await http.post("/api/v1/sessions", json={"idleTtlSeconds": 10})
        out.append(["SESSION", "too short", r.status_code, _body(r)])
        r = await http.post(
            "/api/v1/sessions", json={"idleTtlSeconds": 30, "maxLifetimeSeconds": 60}
        )
        out.append(["SESSION", "create", r.status_code, _body(r)])
        lease = r.json()["result"]
        auth = {
            "authorization": f"Bearer {lease['token']}",
            "x-chrome-bridge-session": lease["sessionId"],
        }
        await call("browser_tabs", {}, headers=auth)
        await call("browser_tabs", {})  # busy: another client while the session holds
        await tool("browser_tabs", {})
        await call(
            "browser_tabs", {}, headers={**auth, "authorization": "Bearer wrong"}
        )
        r = await http.post(
            f"/api/v1/sessions/{lease['sessionId']}/heartbeat", headers=auth
        )
        out.append(["SESSION", "heartbeat", r.status_code, _body(r)])
        r = await http.post("/api/v1/sessions", json={"waitTimeoutSeconds": 0.5})
        out.append(["SESSION", "second", r.status_code, _body(r)])
        r = await http.delete(f"/api/v1/sessions/{lease['sessionId']}", headers=auth)
        out.append(["SESSION", "release", r.status_code, _body(r)])
        r = await http.delete(f"/api/v1/sessions/{lease['sessionId']}", headers=auth)
        out.append(["SESSION", "release again", r.status_code, _body(r)])
        await call("browser_tabs", {}, headers=auth)
        await call("browser_tabs", {})

        # A second browser: calls without browser_id become ambiguous.
        second = await websockets.connect(
            url.replace("http://", "ws://") + "/extension",
            origin="chrome-extension://other",
        )
        await second.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.2.0",
                    "browserId": "11111111-2222-4333-8444-555555555555",
                    "browserLabel": "Home",
                }
            )
        )
        await asyncio.sleep(0.2)
        await tool("browser_instances", {})
        await tool("browser_tabs", {})
        await tool(
            "browser_wait_for",
            {"text": "x", "browser_id": "11111111-2222-4333-8444-555555555555"},
        )
        await tool(
            "browser_dialog_respond",
            {
                "dialog_ref": "s7d1",
                "action": "accept",
                "browser_id": "11111111-2222-4333-8444-555555555555",
            },
        )
        await second.close()

        # Protocol checks: a bad hello and a bad runtime message close the socket.
        for label, first, then in [
            ("bad hello", {"type": "hello", "protocolVersion": 3}, None),
            ("not json", "nope", None),
            (
                "unknown response",
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.5.0",
                    "browserId": "22222222-2222-4333-8444-555555555555",
                    "browserLabel": "X",
                },
                {"id": "33333333-2222-4333-8444-555555555555", "ok": True, "result": 1},
            ),
            (
                "ping",
                {
                    "type": "hello",
                    "protocolVersion": 2,
                    "extensionVersion": "0.5.0",
                    "browserId": "44444444-2222-4333-8444-555555555555",
                    "browserLabel": "X",
                },
                {"type": "ping"},
            ),
        ]:
            socket = await websockets.connect(
                url.replace("http://", "ws://") + "/extension",
                origin="chrome-extension://p",
            )
            await socket.send(first if isinstance(first, str) else json.dumps(first))
            if then is not None:
                await socket.send(json.dumps(then))
            try:
                reply = await asyncio.wait_for(socket.recv(), 2)
                out.append(["WS", label, "message", json.loads(reply)])
                await socket.close()
            except websockets.ConnectionClosed as closed:
                out.append(
                    [
                        "WS",
                        label,
                        "closed",
                        closed.rcvd.code if closed.rcvd else None,
                        closed.rcvd.reason if closed.rcvd else None,
                    ]
                )
            except TimeoutError:
                out.append(["WS", label, "no answer"])
                await socket.close()
        try:
            async with websockets.connect(
                url.replace("http://", "ws://") + "/extension",
                origin="https://evil.example",
            ) as socket:
                out.append(["WS", "foreign origin", "accepted"])
        except websockets.InvalidStatus as rejected:
            out.append(
                ["WS", "foreign origin", "rejected", rejected.response.status_code]
            )

        # The extension answers after the command timed out: the server drops
        # the connection (an unknown response id is a protocol error).
        await call("browser_wait", {"time": 2})
        await asyncio.sleep(1.5)
        await get("/health")
        extension.cancel()
    return out


def _body(response: httpx2.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


_PER_INSTANCE = {"instanceId", "sessionId", "token", "implementation", "serverVersion"}


def normalize(transcript: list[Any]) -> list[Any]:
    def walk(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                k: ("<per-instance>" if k in _PER_INSTANCE else walk(v))
                for k, v in value.items()
            }
        if isinstance(value, list):
            return [walk(v) for v in value]
        return value

    result = walk(transcript)
    validating = False
    for entry in result:
        if entry[:2] == ["NOTE", "argument validation"]:
            validating = True
            continue
        if validating and entry[0] == "MCP":
            entry[-1]["result"]["content"][0]["text"] = "<argument validation message>"
        if entry[0] == "CALL" and isinstance(entry[-1], dict):
            error = entry[-1].get("error")
            if (
                isinstance(error, dict)
                and error.get("code") == "invalid_argument"
                and entry[2] in ({},)
            ):
                error["message"] = "<argument validation message>"
        if entry[0] == "MCP" and entry[1] == "initialize":
            entry[-1]["result"]["serverInfo"] = "<per-implementation>"
        if entry[:2] == ["CALL", "bad json"] or entry[:2] == ["WS", "not json"]:
            pass
        if (
            entry[0] == "WS"
            and entry[2] == "closed"
            and isinstance(entry[4], str)
            and entry[4].startswith("Invalid extension hello")
        ):
            entry[4] = entry[4].split(":")[0]
    return result


async def run(name: str) -> list[Any]:
    process, url = await start(name)
    try:
        return await scenario(url)
    finally:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 5)
        except TimeoutError:
            process.kill()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--server", choices=["python", "dart"])
    parser.add_argument("--show", action="store_true", help="print the transcript")
    args = parser.parse_args()
    if args.server:
        transcript = normalize(asyncio.run(run(args.server)))
        if args.show:
            print(json.dumps(transcript, ensure_ascii=False, indent=1))
        return
    python = normalize(asyncio.run(run("python")))
    dart = normalize(asyncio.run(run("dart")))
    differences = [(i, p, d) for i, (p, d) in enumerate(zip(python, dart)) if p != d]
    if len(python) != len(dart):
        differences.append((-1, f"{len(python)} entries", f"{len(dart)} entries"))
    for index, p, d in differences:
        print(f"--- entry {index}")
        print("python:", json.dumps(p, ensure_ascii=False)[:1500])
        print("dart:  ", json.dumps(d, ensure_ascii=False)[:1500])
    if differences:
        sys.exit(
            f"{len(differences)} differences between the Python and the Dart server"
        )
    print(f"The Python and the Dart server answered the same ({len(python)} steps).")


if __name__ == "__main__":
    main()
