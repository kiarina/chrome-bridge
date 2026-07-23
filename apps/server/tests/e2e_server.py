from __future__ import annotations

import asyncio
import json
import os
import socket

import uvicorn

from chrome_bridge_mcp import Settings, create_app


async def run() -> None:
    requested_port = int(os.environ.get("CHROME_BRIDGE_E2E_PORT", "0"))
    if requested_port < 0 or requested_port > 65535:
        raise ValueError("CHROME_BRIDGE_E2E_PORT must be between 0 and 65535")
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", requested_port))
    listener.listen()
    listener.setblocking(False)
    port = listener.getsockname()[1]
    settings = Settings(port=port)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings),
            host=settings.host,
            port=port,
            log_level="info",
        )
    )
    task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        while not server.started:
            if task.done():
                await task
                raise RuntimeError("E2E server stopped before startup")
            await asyncio.sleep(0.01)
        print(
            json.dumps(
                {
                    "event": "ready",
                    "httpUrl": f"http://127.0.0.1:{port}",
                    "mcpUrl": f"http://127.0.0.1:{port}/mcp",
                    "extensionUrl": f"ws://127.0.0.1:{port}/extension",
                }
            ),
            flush=True,
        )
        await task
    finally:
        listener.close()


if __name__ == "__main__":
    asyncio.run(run())
