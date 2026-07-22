from __future__ import annotations

import asyncio
import json
import os
import socket
import sys

import websockets


CHILD = """
import asyncio
import os
import sys
from chrome_bridge_sdk import ChromeBridge

async def main():
    chrome = ChromeBridge(port=int(os.environ["SDK_TEST_PORT"]), startup_timeout=10)
    async with chrome.session():
        print("acquired", flush=True)
        await asyncio.to_thread(sys.stdin.readline)

asyncio.run(main())
"""


def unused_port() -> int:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    listener.close()
    return port


async def fake_extension(port: int) -> None:
    url = f"ws://127.0.0.1:{port}/extension"
    while True:
        try:
            async with websockets.connect(url) as websocket:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "hello",
                            "protocolVersion": 2,
                            "extensionVersion": "0.1.0",
                            "browserId": "123e4567-e89b-42d3-a456-426614174000",
                            "browserLabel": "SDK integration",
                        }
                    )
                )
                await websocket.wait_closed()
        except asyncio.CancelledError:
            raise
        except (OSError, websockets.WebSocketException):
            await asyncio.sleep(0.05)


async def start_child(environment: dict[str, str]) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        CHILD,
        env=environment,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


async def acquired(child: asyncio.subprocess.Process) -> None:
    assert child.stdout is not None
    line = await asyncio.wait_for(child.stdout.readline(), 15)
    if line != b"acquired\n":
        stderr = await child.stderr.read() if child.stderr is not None else b""
        raise AssertionError(f"SDK child failed: stdout={line!r}, stderr={stderr!r}")


async def release(child: asyncio.subprocess.Process) -> None:
    assert child.stdin is not None
    child.stdin.write(b"release\n")
    await child.stdin.drain()
    assert await asyncio.wait_for(child.wait(), 10) == 0


async def test_two_processes_share_managed_server_and_fifo_session() -> None:
    port = unused_port()
    environment = {
        **os.environ,
        "SDK_TEST_PORT": str(port),
        "CHROME_BRIDGE_MANAGED_IDLE_TIMEOUT": "0.5",
    }
    extension = asyncio.create_task(fake_extension(port))
    first = await start_child(environment)
    second: asyncio.subprocess.Process | None = None
    try:
        await acquired(first)
        second = await start_child(environment)
        assert second.stdout is not None
        try:
            await asyncio.wait_for(second.stdout.readline(), 0.25)
        except TimeoutError:
            pass
        else:
            raise AssertionError("second SDK process acquired a concurrent session")
        await release(first)
        await acquired(second)
        await release(second)
    finally:
        for child in (first, second):
            if child is not None and child.returncode is None:
                child.kill()
                await child.wait()
        extension.cancel()
        await asyncio.gather(extension, return_exceptions=True)

    deadline = asyncio.get_running_loop().time() + 5
    while asyncio.get_running_loop().time() < deadline:
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
        except OSError:
            return
        writer.close()
        await writer.wait_closed()
        await asyncio.sleep(0.1)
    raise AssertionError("managed Chrome Bridge did not exit after becoming idle")
