from __future__ import annotations

import argparse
import asyncio
import json

from chrome_bridge_sdk import ChromeBridge


async def run(port: int) -> None:
    chrome = ChromeBridge(port=port, startup_timeout=15)
    async with chrome.session(wait_timeout=15) as session:
        instances = await session.browser_instances()
        print(
            json.dumps(
                [
                    {
                        "browserId": item.browser_id,
                        "label": item.label,
                        "protocolVersion": item.protocol_version,
                        "extensionVersion": item.extension_version,
                        "identityStable": item.identity_stable,
                    }
                    for item in instances
                ]
            ),
            flush=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.port))
