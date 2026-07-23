# Operations guide

This document is canonical for operating chrome-bridge with an everyday Chrome profile and the default port. See the [Development guide](development.md) for development builds/tests and [Release artifacts](release.md) for installing, upgrading, and rolling back distribution artifacts.

## Supported boundary

- Supports Chrome 116+ and Python 3.11+. Node.js 20+ is required only to build the extension from a source checkout.
- Run the server, MCP client, and Chrome extension on the same machine. The server cannot bind outside loopback; remote operation is out of scope.
- Page operations target the top frame of HTTP(S) pages. Chrome internal pages, file URLs, and iframe operations are out of scope.
- Automated CI is verified on Ubuntu and manual branded-Chrome smoke tests on macOS. Windows operation is unverified.

## Configuration

### Server environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHROME_BRIDGE_HOST` | `127.0.0.1` | Bind host; only `127.0.0.1`, `::1`, and `localhost` are allowed |
| `CHROME_BRIDGE_PORT` | `8765` | Port shared by HTTP MCP, health, and the extension WebSocket |
| `CHROME_BRIDGE_COMMAND_TIMEOUT` | `15` | Seconds the server waits for an extension command |
| `CHROME_BRIDGE_OPERATION_WAIT_TIMEOUT` | `30` | Seconds a single MCP/Direct call waits for the global lease |
| `CHROME_BRIDGE_SESSION_IDLE_TTL` | `120` | Exclusive Direct session idle TTL in seconds |
| `CHROME_BRIDGE_SESSION_MAX_LIFETIME` | `600` | Maximum exclusive Direct session lifetime in seconds |
| `CHROME_BRIDGE_MANAGED_IDLE_TIMEOUT` | `300` | Idle seconds before an SDK-started managed server exits |

After changing the port, set each Chrome profile's extension Options WebSocket URL to `ws://<host>:<port>/extension` and the MCP client URL to `http://<host>:<port>/mcp`. A command timeout shorter than the default may expire before navigation, the file chooser, or DOM stabilization completes.
The server keeps that normal 15-second command deadline for ordinary operations. A
`browser_download_file` call instead uses its requested 0.1–60 second deadline plus five
seconds of transport cleanup allowance; changing `CHROME_BRIDGE_COMMAND_TIMEOUT` is not
required for a long download.

### Extension Options

Open profile-local settings through “Open settings” in the extension popup.

- `Browser label`: A 1–64-character label used by people to identify the profile in `browser_instances`; it need not be unique.
- `Browser ID`: A read-only UUID per installation. It changes if extension local storage is cleared or the extension is reinstalled.
- `Extension WebSocket URL`: The server's `/extension` endpoint. It accepts `ws://` or `wss://`, though the current server allows only loopback operation.

On save, the service worker closes the current socket and reconnects with the new settings. The target may be cleared after Reload, but Browser ID and label are restored from local storage.

## Start, stop, and restart

From a source checkout, run the following in the foreground:

```bash
uv run chrome-bridge-mcp
```

After installing the wheel with `uv tool install`, use:

```bash
chrome-bridge-mcp
```

The server has no daemonization or OS-service registration. Stop foreground operation with `Ctrl-C`. With a service manager, run exactly one process, retain stdout/stderr, and wait for clean exit after SIGTERM.

Recommended normal startup order:

1. Start the server.
2. Check the HTTP endpoint with `curl http://127.0.0.1:8765/health`.
3. Wait for the toolbar icon to turn bright pink and the extension popup to show `connected`. The extension reconnects automatically with backoff capped at 30 seconds.
4. Check `connectedBrowserCount` and the number of `browser_instances`.
5. Connect the MCP client.

In-flight commands fail during server restart. Because the registry starts empty after restart, wait for connection counts to return before sending new tool calls. Restarting the extension or Chrome itself is normally unnecessary.

## Python SDK lifecycle

Install `chrome-bridge-sdk` in an application and use only its async session context.
The SDK checks `/api/v1/meta`, reuses a compatible server, or starts
`python -m chrome_bridge_mcp --managed`. It does not expose open/close/restart methods and
does not stop a shared process when the application exits. The server releases abandoned
sessions by heartbeat TTL and a managed server exits after the configured idle period.

An explicit SDK session blocks other SDK workflows and MCP tool calls from entering the
browser controller. MCP calls return a retryable busy error after the operation-wait
timeout rather than waiting indefinitely. A lost connection during an operation is never
automatically retried because its browser-side outcome may be unknown.

## MCP client configuration

Field names vary by client, but configure the following Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "chrome-bridge": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

If the client infers the transport from the URL, configure only `url`. MCP Inspector can also check connectivity.

MCP clients commonly impose their own tool-call deadline. When calling
`browser_download_file(timeout=60)`, configure the client timeout to at least 75 seconds
so it does not abandon the request before Chrome reports completion and cleanup finishes.

```bash
npx -y @modelcontextprotocol/inspector
```

## Health and normal state

Health has the following form when no extension is connected:

```json
{
  "status": "ok",
  "extensionConnected": false,
  "connectedBrowserCount": 0,
  "extension": {}
}
```

`status: ok` only means the HTTP server is responding. Normal operation requires `extensionConnected: true` and `connectedBrowserCount` of at least one. Because health is unauthenticated, it never returns browser IDs, labels, tabs, URLs, or titles. Obtain connected IDs and labels through MCP `browser_instances`.

The toolbar icon is a secondary connection-status indicator: bright pink only for `connected`, gray for `connecting`, `disconnected`, and `error`. Its white padding remains visible on any background, and the hover tooltip shows the same state. Use popup details and server health together for the final diagnosis.

With multiple profiles connected, pass `browser_id` explicitly to every tool except `browser_instances`. Never avoid the ambiguous error by falling back to the first or most recent profile.

## Logs and diagnostics

- Server: Inspect stdout/stderr in the startup terminal or retained by the service manager.
- Extension connection: Inspect popup status, details, and Browser ID/label.
- Extension service worker: Open the service worker's Inspect link from Chrome Bridge at `chrome://extensions`.
- MCP: Isolate routing and target issues in order with `browser_instances`, `browser_tabs`, and `browser_snapshot`.

During normal operation, do not inspect Chrome profile directories, cookies, or storage databases directly. Clean up only test tabs and upload files; never close existing user tabs.

## Troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| Server does not start; address already in use | Find the owner with `lsof -nP -iTCP:8765 -sTCP:LISTEN`. Reuse an intended existing process; normally stop only an unneeded process. For another port, change server, extension, and MCP client to the same port. |
| Health responds but `extensionConnected: false` | Check popup details and the Options WebSocket URL. If it does not connect within 30 seconds, Reload the extension and inspect the service-worker console. |
| `connectedBrowserCount` is higher than expected | Check IDs and labels with `browser_instances`. Disable the extension in unneeded profiles or pass explicit `browser_id` to every tool. |
| Ambiguous browser error | Call `browser_instances` and pass the intended `browser_id` to the same tool call. |
| Target unavailable / not selected | Find the tab ID with `browser_tabs` and call `browser_tab_select`. Use `browser_tab_activate` only when foregrounding is necessary. |
| Stale / unknown ref | Capture a new `browser_snapshot` and use only refs from that generation. Never reuse refs after target change, navigation, or another snapshot. |
| Content unavailable | Confirm the target is an HTTP(S) page. Do not perform in-page operations on `chrome://`, `about:blank`, or file URLs; navigate to HTTP(S). |
| Debugger attach or CDP operation fails | Close Chrome DevTools on the target tab and retry. Opening DevTools can detach the extension debugger session. Never foreground and auto-retry after failure. |
| Upload times out waiting for file chooser | Use a visible-element ref from the latest snapshot that actually opens the chooser. Do not pass multiple paths to a single input; specify 1–20 absolute paths to existing regular files. |
| `browser_wait_for` times out | Confirm the literal text and case in a fresh accessibility snapshot. Matching uses normalized top-frame ARIA name/text, not selectors or iframe content. |
| Download requires extension 0.3.0 | Upgrade and Reload the selected profile's extension. The server deliberately does not reroute a new command to another profile. |
| Download outcome is unknown | Do not retry automatically. The trusted click already occurred; inspect the page and Downloads UI, obtain a fresh snapshot, and decide manually. |
| Download exceeds 10 seconds | Raise the tool's `timeout` up to 60 seconds and set the MCP client tool timeout to at least 75 seconds. The deadline covers click through completed CDP progress and is not reset after download starts. |
| Thumbnail or processing display remains incomplete after upload | Synchronous input change processing is reflected in the tool result. For site-specific asynchronous work, capture another `browser_snapshot` after `browser_wait`. |
| Target disappears after extension Reload | Expected. Confirm the Browser ID is unchanged and reselect the target with `browser_tab_select`. |
| Command timeout | Check server/extension connectivity, target load state, and service-worker console. Fix causes such as stalled navigation or a chooser that never opened before increasing the timeout. |

For the relationship between `chrome.debugger` and DevTools, also see [Chrome debugger API `onDetach`](https://developer.chrome.com/docs/extensions/reference/api/debugger#event-onDetach).

## Upgrade and incident recovery

Follow the fixed-directory method in [Release artifacts](release.md) for upgrades and rollbacks. During an incident, limit impact in this order:

1. Stop new page commands.
2. Preserve server logs, health, popup details, and the service-worker console.
3. Stop the server normally.
4. Verify checksums of the rollback wheel and extension backup.
5. Restore and start the server first, then Reload the extension in each profile.
6. Check health, `browser_instances`, and snapshot/click on an inactive fixture before resuming normal operation.
