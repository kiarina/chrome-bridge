# chrome-bridge-sdk

Python SDK for using chrome-bridge directly without an MCP client.

```python
from chrome_bridge_sdk import ChromeBridge

chrome = ChromeBridge()

async with chrome.session() as session:
    tabs = await session.browser_tabs()
```
