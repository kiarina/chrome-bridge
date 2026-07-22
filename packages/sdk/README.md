# chrome-bridge-sdk

Python SDK for using chrome-bridge directly without an MCP client.

```python
from chrome_bridge_sdk import ChromeBridge, SessionStatus

chrome = ChromeBridge(status_callback=lambda status: print(status.value))

async with chrome.session() as session:
    tabs = await session.browser_tabs()
    await session.browser_tab_select(tab_id=tabs[0].id)
    snapshot = await session.browser_snapshot()
    print(snapshot.title, snapshot.snapshot)
```

`ChromeBridge` stores configuration only. Entering `session()` discovers or starts the
shared managed server, waits for the extension and FIFO lease, maintains its heartbeat,
and releases it on every context exit. `SessionStatus` callbacks can drive application
logs or startup UI.

The 21 high-level methods return frozen typed models such as `Tab`, `Snapshot`,
`Screenshot`, `ConsoleEntry`, and `Recording`. Python parameters use snake_case, including
`browser_drag(start_element=..., start_ref=..., end_element=..., end_ref=...)`;
`browser_type(..., submit=False)` does not require the common default explicitly.
`Screenshot.image_bytes` decodes its Direct API base64 data.

For LLM adapters, `session.tool_definitions()` returns JSON Schema dictionaries and
`session.call(method, arguments)` returns the raw Direct API JSON result. SDK exceptions
expose `code`, `retryable`, and `outcome_unknown` attributes. Calls with an unknown
outcome are never automatically retried.
