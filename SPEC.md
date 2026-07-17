# chrome-bridge specification

## 1. Product goal

Provide a local MCP server that lets LLM agents operate every tab by explicit tab ID while preserving the login state of an existing Chrome profile. Use accessibility information and strict element references, and avoid taking over the user's foreground tab.

## 2. Scope

### v0.1 (implemented)

- WebSocket connection from a Manifest V3 extension to the local server
- Streamable HTTP MCP endpoint
- Listing, creating, closing, and selecting any tab
- Loopback-only binding and Host/Origin validation
- Connection status in the extension popup and connection settings in Options
- Non-foreground selection of a single target tab, accessibility snapshots, and element operations through strict refs

### Page operations (implemented)

Page operations run against the single target tab retained by the extension. Change the target with chrome-bridge's `browser_tab_select(tab_id)` tool. This tool does not change Chrome UI's active tab or window focus. The existing `browser_tab_activate(tab_id)` changes the target and explicitly brings it to the foreground only when the user needs to see the page.

The following 12 page-operation tools operate on the persistent target; they do not accept a per-tool `tab_id`.

| Tool | Main arguments | Result |
| --- | --- | --- |
| `browser_navigate` | `url` | Post-operation snapshot |
| `browser_go_back` | None | Post-operation snapshot |
| `browser_go_forward` | None | Post-operation snapshot |
| `browser_wait` | `time`, optional `video_filename` | Completion message, or operation/recording wrapper |
| `browser_press_key` | `key`, optional `video_filename` | Completion message, or operation/recording wrapper |
| `browser_snapshot` | None | URL, title, ARIA snapshot |
| `browser_click` | `element`, `ref`, optional `video_filename` | Snapshot, or operation/recording wrapper |
| `browser_hover` | `element`, `ref`, optional `video_filename` | Snapshot, or operation/recording wrapper |
| `browser_type` | `element`, `ref`, `text`, `submit`, optional `video_filename` | Snapshot, or operation/recording wrapper |
| `browser_select_option` | `element`, `ref`, `values`, optional `video_filename` | Snapshot, or operation/recording wrapper |
| `browser_screenshot` | None | PNG image content |
| `browser_get_console_logs` | None | Console entries |

Add `browser_drag` to operate between two strict refs.

| Tool | Main arguments | Result |
| --- | --- | --- |
| `browser_drag` | `startElement`, `startRef`, `endElement`, `endRef`, optional `video_filename` | Snapshot, or operation/recording wrapper |

As a chrome-bridge-specific extension, assign local files to the file chooser opened by a trusted click on a strict ref, without directly searching for hidden file inputs.

| Tool | Main arguments | Result |
| --- | --- | --- |
| `browser_upload_file` | `element`, `ref`, `paths`, optional `video_filename` | Snapshot, or operation/recording wrapper |

### Out of scope for v0.1

- Use from a remote network
- Operations on Chrome internal pages and `file:`, `data:`, or `javascript:` URLs
- Firefox and Safari
- Cloud relay

### Multiple Chrome profiles (implemented and verified in real Chrome)

For multi-profile routing, store a random UUIDv4 `browserId` and a user-editable, non-unique `browserLabel` in `chrome.storage.local` for each extension installation. Do not derive the ID from the profile path, account, or browsing data.

List connected instances with `browser_instances` and add optional `browser_id` to every tool except instance discovery. For backward compatibility, omission is allowed when exactly one browser is connected. Omission with multiple connections, unknown IDs, and disconnected IDs are errors; never fall back to the latest connection or another browser. Do not keep a server-global browser-selection tool or state because it would conflict across stateless MCP clients.

Use protocol v2 for the identity hello. A new server accepts v1 in one legacy slot for migration, while distinct v2 IDs coexist and only a reconnect with the same ID replaces the old connection with code 1012. [Multiple browser routing](docs/multiple-browser-routing.md) is canonical for the detailed contract and test matrix.

## 3. Architecture

1. The MCP client uses `POST/GET/DELETE /mcp` as Streamable HTTP.
2. The Chrome extension service worker connects to `/extension` over WebSocket.
3. The server assigns a UUID to each tool call and converts it into a WebSocket command.
4. The extension executes Chrome APIs and returns success/error with the same UUID.
5. The server converts the extension response into an MCP structured result.

MCP sessions are stateless. Extension connections and pending commands are process-local state.

## 4. Extension protocol v1 and v2

Server request:

```json
{"id":"uuid","type":"tabs.list","params":{}}
```

Extension response:

```json
{"id":"uuid","ok":true,"result":[{"id":123,"windowId":1,"active":true}]}
```

Error response:

```json
{"id":"uuid","ok":false,"error":"No tab with id: 123"}
```

Connection lifecycle messages are `hello`, `ping`, and `pong`. The current implementation's `hello.protocolVersion` is `1`.
Commands time out after 15 seconds by default. Extension disconnect fails every in-flight command.

`apps/server/src/chrome_bridge_mcp/protocol_v1.schema.json` is canonical for protocol v1 envelopes and command parameters. Request IDs are lowercase UUIDv4 values, and every object rejects unknown fields. A success response contains `result`; an error response contains only a non-empty `error`; the two are never mixed. The server controller continues to validate command-specific result payloads.

Handling of invalid messages at the boundary:

- For an unknown command, invalid parameters, or extra fields with a valid request ID, the extension returns an `ok: false` error response and keeps the connection open.
- The extension closes with WebSocket code 1002 for malformed JSON, a missing request ID, or an ID that cannot be trusted as UUIDv4.
- The server closes with code 1002 for an invalid hello, a duplicate hello at runtime, an invalid response envelope, an unknown response ID, or malformed JSON.
- On a protocol-error disconnect, the server fails every pending command and never implicitly reroutes to another extension.

Protocol v2 adds required `browserId` and `browserLabel` fields to hello. Because the v1 schema rejects unknown fields, this is not treated as an additive v1 extension. Command/response envelopes retain the v1 shape, and the new server distinguishes v1 and v2 hellos.

### implemented commands

- `tabs.list {}`
- `tabs.open {url: string, active: boolean}`
- `tabs.close {tabId: integer}`
- `tabs.select {tabId: integer}`: changes only the target tab and does not foreground Chrome UI.
- `tabs.activate {tabId: integer}`
- `page.snapshot {}`
- `page.click {element: string, ref: string, videoFilename?: string}`
- `page.hover {element: string, ref: string, videoFilename?: string}`
- `page.type {element: string, ref: string, text: string, submit: boolean, videoFilename?: string}`
- `page.selectOption {element: string, ref: string, values: string[], videoFilename?: string}`
- `page.pressKey {key: string, videoFilename?: string}`
- `page.navigate {url: string}`
- `page.goBack {}`
- `page.goForward {}`
- `page.wait {time: number, videoFilename?: string}`
- `page.screenshot {}`
- `page.getConsoleLogs {}`
- `page.recordVideo {filename: string, duration: number}`
- `page.drag {startElement: string, startRef: string, endElement: string, endRef: string, videoFilename?: string}`
- `page.uploadFile {element: string, ref: string, paths: string[], videoFilename?: string}`

Tab result fields are `id`, `windowId`, `index`, `active`, `targeted`, `pinned`, `incognito`, `title`, and `url`.

Each tab result from `tabs.list` includes the additive field `targeted: boolean`. `tabs.open` never changes the target implicitly, regardless of `active`. `tabs.activate` changes the target, then foregrounds the tab and window. If the target tab closes, do not automatically select another tab; the next page command returns a clear target-unavailable error. Preserve the target tab ID after navigation, but invalidate the preceding snapshot. If the content runtime is unavailable, such as after navigation to a restricted page, do not change the target; return a content-unavailable error.

New commands and result fields are backward-compatible protocol v1 extensions and do not change the meaning of existing commands.

`page.screenshot` captures the target's CSS visual viewport as PNG, downsizes the actual image to at most 1024×768 pixels, and returns `{data: base64, mimeType: "image/png", width, height}`. It temporarily attaches the debugger to the page `targetId` without branching on foreground/background and does not alter Chrome UI's active state. MCP returns image content rather than base64 JSON.

`page.getConsoleLogs` enables the target's Runtime domain only for the call and returns up to 100 `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` events replayed by Chrome for the current document. Each entry has `type`, `timestamp`, and `message`, and is strictly filtered by page `targetId`. Entries from other tabs are never mixed in; MCP returns one JSON text entry per line.

## 5. Security

- The server binds to `127.0.0.1:8765` by default and rejects `0.0.0.0`.
- `Host` must be loopback. `Origin` may be absent, loopback, or `chrome-extension://` only.
- `/health` returns only connection status, connection count, and—when one browser is connected—protocol/extension versions. It never returns browser IDs, labels, tab data, or page data.
- Tool URLs are restricted to `http:`, `https:`, and `about:blank`.
- Trust local processes running as the same user. Do not authenticate between local processes.
- If remote binding is added in the future, require authentication together with that transport.
- Upload paths are limited to 1–20 absolute paths to existing regular files on the machine running both the server and Chrome. Resolve them to canonical paths on the server before passing them to the extension, and never return paths in results or health.
- Obtain the upload result after the target input's `change` dispatch and synchronous handlers complete, followed by DOM stabilization. Do not guarantee completion of site-specific asynchronous uploads, thumbnail generation, or media processing; when needed, obtain a new snapshot after `browser_wait`.

## 6. UX requirements

- The extension popup exposes `connected`, `connecting`, `disconnected`, and `error` states.
- The toolbar icon is a faceless silhouette with thick white shape-following padding. It is bright pink when `connected` and gray when `connecting`, `disconnected`, or `error`; the tooltip also displays connection status.
- When the server is not running, reconnect with exponential backoff capped at 30 seconds.
- Send a heartbeat every 20 seconds to keep the service worker alive (Chrome 116+).
- Display a virtual cursor at the operation location during page operations.
- Indicate the target tab with a leading `◉ ` in the title and `Agent target` at the top right of the page. Switch to `● ` and `Agent operating` only while a page command runs. Track dynamic title changes and restore the latest page title when the target is cleared.
- Isolate target/operating indicators and the virtual cursor from page styles with Shadow DOM. Do not render them inside restricted pages; use the popup's Target/Operating display as the fallback.
- The virtual cursor is an arrow whose tip matches the operation coordinates. Synchronize distance-dependent 100–320 ms movement, a click ripple, and drag pressed state with trusted input. Skip animation waits under reduced motion. Keep the cursor at its last position until the target is cleared.
- Screenshots temporarily hide only the status indicator and include the virtual cursor. Restore the status after both success and failure.
- The popup displays the target tab separately from Chrome UI's active tab.
- Manual user tab switching does not change the target.
- Page commands use the same routing whether the target tab is foreground or background and never foreground it automatically.
- The external snapshot/ref format uses YAML and `s<number>e<number>`.
- Snapshot generations are issued extension-wide and never reused across tab changes, navigation, or snapshot updates.
- A ref points to an `Element` in the same content runtime until the next snapshot; generation mismatches are rejected as stale.
- Clear the latest snapshot generation on target selection and top-frame navigation commit, requiring a new snapshot before the next element operation.

## 7. Acceptance criteria

### v0.1

- `uv sync --all-groups` succeeds.
- `uv run pytest` succeeds.
- Non-loopback binds and invalid Host/Origin values are rejected.
- A tool call with no connected extension produces a clear MCP error.
- Round trips for five tools are confirmed in real Chrome.
- `browser_tab_select` leaves Chrome UI's active tab/window focus unchanged and returns `active` and `targeted` separately.
- `browser_snapshot` returns YAML and `s<number>e<number>` refs from a background target tab.
- `browser_click` never falls back to an element other than the ref and returns a post-operation snapshot without foregrounding the background target tab.
- Refs that are malformed, from an old generation, from another target, from before navigation, or refer to detached Elements are clearly rejected.
- Hover, type, select, and key succeed on a background target without changing the active tab/window focus.
- Type accepts only editable refs; select strictly resolves `option.value`.
- Navigate/back/forward return post-operation snapshots on a background target and distinguish no-history from restricted destinations.
- Wait accepts 0–10 seconds and invalidates the latest snapshot when waiting begins.
- Screenshot returns the background target viewport as PNG image content up to 1024×768 without changing the active tab.
- Console logs return at most 100 JSON lines containing only console entries/exceptions from the current target.
- Drag strictly resolves start/end refs from the same latest snapshot and returns a post-operation snapshot without foregrounding the background target.
- Upload intercepts only a file chooser opened by a trusted click on a strict ref, assigns 1–20 validated absolute paths, and returns a snapshot after the input change completes without foregrounding the background target. It rejects refs that open no chooser and multiple files for a single input. Recorded upload borrows the recorder session for interception and takes at most one explicit click milestone frame; every outcome disables interception and releases its change barrier in `finally`.
- Every protocol v1 envelope and all 20 command parameter objects match the canonical JSON Schema, and invalid messages are rejected as specified.
- Fixture tests for role/name/form state, Shadow DOM, slots, and `aria-owns` pass.

### Multiple-profile milestone

- Two distinct v2 IDs connect simultaneously, and explicit tool calls to either are never sent to the other.
- With multiple connections, omitting `browser_id` produces an ambiguous error before command transmission.
- A same-ID reconnect, target disconnect, or protocol error does not affect connections or pending commands for other IDs.
- A v1 legacy connection can coexist with v2 connections, and list results identify the legacy identity as unstable.
- `/health` does not expose IDs, labels, or tab/page metadata from multiple profiles.
- Two real Chrome profiles can be operated independently without automatically foregrounding either target tab.

### Isolated E2E milestone (implemented and verified locally on macOS)

- Two ephemeral profiles in bundled Chromium unified headless connect to the production server simultaneously over protocol v2.
- MCP Streamable HTTP verifies ambiguous-routing rejection, per-ID tabs/snapshots/clicks, isolation of identical ref strings, and same-ID restart.
- The harness never uses default port 8765, a user's Chrome profile, or profile-derived data, and deletes every process and temporary directory after success or failure.
- Only on failure, retain server/worker logs, a bounded MCP transcript, trace, and fixture screenshot; never artifact the full storage/profile.

### v0.1 release artifact milestone (implemented and verified locally)

- Generate a ZIP from the extension runtime allowlist with fixed timestamps, permissions, and order, including third-party notices and the full Apache-2.0 text.
- The Python wheel/sdist contain protocol schemas and the console entry point, and exclude test/cache/profile data.
- Install the wheel in a fresh temporary venv and run isolated E2E with the ZIP extension and installed server.
- Independently built extension ZIP, wheel, and sdist artifacts from the same checkout are byte-identical, and SHA-256 checksums are distributed.
- While the project license and Git remote remain undecided, limit work to local/CI validation and do not publish a release to third parties.

### Page-operation milestone

- Snapshot/click/type/navigation/screenshot succeed when the target tab is in the background.
- Manual user tab switching does not alter target routing.
- Page-operation tools never operate on a tab other than the target.
- Refs from old snapshots, other tabs, or before navigation are rejected as stale.
- Click/hover/type/select return URL, title, and ARIA snapshot afterward.
- The virtual cursor is visible during click, hover, and drag.
- An inactive target's title and in-page indicator transition through Target/Operating while Chrome UI's active tab remains unchanged.
- Target changes, tab close, and operation failure leave no stale status/cursor, and the latest dynamic page title is restored when the target is cleared.
- Screenshots include only the cursor, and the status indicator is restored after capture.
- Screenshots and console logs preserve their MCP content types.

### Target video recording milestone (standalone, wait, and trusted/DOM action recording implemented)

- The bounded `browser_record_video(filename, duration, browser_id)` tool is implemented
  for the current target. `browser_wait`, click, hover, type, select, key, and drag accept
  optional `video_filename`; upload and history/navigation actions remain planned.
- Save silent WebM recordings below `Downloads/chrome-bridge/`, reject unsafe relative
  names, never overwrite an existing file, and do not expose recording through
  tab-management or information-only tools initially.
- Preserve every existing success value exactly when `video_filename` is omitted. When
  it is supplied, return `{operation, recording}` with the actual Downloads-relative
  uniquified filename, elapsed duration, dimensions, frame counts, and encoded size;
  the standalone tool returns recording metadata directly and never exposes an absolute
  path or Chrome download ID.
- Validate recording input before the operation. If the operation succeeds but saving
  fails, return an error that warns against automatic retry. If the operation fails,
  preserve that error as primary and report saved recording or cleanup failure only as
  secondary diagnostic context. If target identity is lost after operation entry, mark
  the outcome unknown, report the diagnostic recording result, and require current page
  state inspection before retry; target loss before entry remains a known not-run error.
- Own the debugger attachment within one page-operation queue entry. Pass that session
  explicitly to input and capture helpers, keep focus emulation limited to trusted input,
  and detach in `finally`; never retain or reference-count an attachment across MCP
  commands.
- Draw the first real target frame before starting the encoder, guarantee that submitted
  initial-state frame plus a 500 ms pre-roll before a recorded operation, then retain the
  500 ms post-roll. Prefer operation latency over cadence for
  ordinary trusted input. Recorded drag may take at most four explicit milestone frames
  through its existing debugger session so intermediate positions remain visible; measure
  and bound that added latency. Never reroute or foreground after failure.
- Update screenshot and video output together to preserve the entire CSS visual viewport
  without crop, stretch, or upscale. Landscape or square output fits within 1920×1080;
  portrait output fits within 1080×1920.
- Use a fixed video canvas selected at recording start. Contain a resized viewport with
  padding only if the viewport changes during recording; never change encoded dimensions
  mid-stream.
- Validate standalone and non-navigation recording first, then upload, then navigation
  and history after debugger/renderer lifecycle measurements. Pass unit tests, isolated
  two-profile Chromium E2E, and branded-Chrome background-target measurements before
  exposing each stage.

[Video recording design](docs/video-recording.md) is canonical for the planned API,
debugger ownership, capture pipeline, dimensions, result/error contract, and
implementation order.

## 8. Versioning

- Manage the extension protocol with integer versions and increment for incompatible changes.
- Keep server and extension package versions equal for now.
- Pin the MCP Python SDK to stable v1 with `>=1.27,<2`; treat migration to v2 as a separate task.
