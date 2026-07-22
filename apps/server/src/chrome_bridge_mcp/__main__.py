from __future__ import annotations

import argparse
import asyncio

import uvicorn

from .app import create_app
from .config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Chrome Bridge server")
    parser.add_argument(
        "--managed",
        action="store_true",
        help="exit automatically after the managed idle timeout",
    )
    args = parser.parse_args()
    settings = Settings.from_env(managed=args.managed)
    asyncio.run(_serve(settings))


async def _serve(settings: Settings) -> None:
    server: uvicorn.Server | None = None

    def request_shutdown() -> None:
        if server is not None:
            server.should_exit = True

    app = create_app(settings, request_shutdown=request_shutdown)
    server = uvicorn.Server(
        uvicorn.Config(app, host=settings.host, port=settings.port, log_level="info")
    )
    await server.serve()


if __name__ == "__main__":
    main()
