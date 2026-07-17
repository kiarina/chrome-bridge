# MCP tool API reference

This document is the user-facing reference for the 21 tools exposed by the chrome-bridge MCP server. MCP clients connect to the Streamable HTTP endpoint at `http://127.0.0.1:8765/mcp`.

[`apps/server/src/chrome_bridge_mcp/app.py`](../apps/server/src/chrome_bridge_mcp/app.py) is the runtime source of truth for tool names, input JSON Schemas, and tool descriptions; they are available through MCP `tools/list`. The [Specification](../SPEC.md) is canonical for detailed page-operation semantics and security boundaries, and [Multiple browser routing](multiple-browser-routing.md) is canonical for multi-browser routing rules.

## Common conventions

### Browser routing

Every tool except `browser_instances` accepts `browser_id: string | null` as its final optional argument.

- When one browser is connected, `browser_id` may be omitted.
- When two or more are connected, explicitly pass a `browserId` from `browser_instances` as `browser_id`.
- An unknown or disconnected ID never falls back to another browser.
- Tab IDs, targets, and snapshot refs are independent per browser. Never infer a browser from an ID or ref.

The MCP tool schema uses snake-case `browser_id` for the argument, while result provenance uses camel-case `browserId`. Structured tab/snapshot results from a protocol v2 browser include `browserId`; results from a legacy protocol v1 browser do not.

### Target tab

Page-operation tools do not accept `tab_id` directly. They operate on the single target tab retained for each browser.

1. Obtain a tab ID with `browser_tabs`.
2. Select the target with `browser_tab_select`.
3. Call `browser_snapshot` or another page-operation tool.

`browser_tab_select` does not change Chrome UI's active tab or window focus. Use `browser_tab_activate` only when the user needs to see the target. `browser_tab_open` does not change the target, regardless of `active`.

Closing the target tab clears the target. Switching the active tab in Chrome UI does not change it. The target belongs to the extension connection, not an MCP session, so clients operating the same browser share it.

### Snapshot and strict refs

A snapshot result has the following form:

```json
{
  "generation": 12,
  "url": "https://example.test/form",
  "title": "Example form",
  "snapshot": "- textbox \"Name\" [ref=s12e4]\n- button \"Save\" [ref=s12e7]",
  "browserId": "b9d746c1-e245-4f2d-9e5d-65fddf63c587"
}
```

`snapshot` is a YAML accessibility tree. Operable elements have refs in the form `s<generation>e<element-id>`. For element operations, pass the human-readable description shown in the snapshot as `element` and its ref as `ref`. Only the ref identifies the element; `element` is never used as a selector or fallback search.

A ref is scoped to its source browser, target tab, document, and latest snapshot generation. After obtaining a new snapshot, performing an element operation, changing the target, navigating, calling `browser_wait`, or calling `browser_press_key`, do not reuse old refs; obtain a new snapshot.

### Common result types

#### BrowserInstance

```json
{
  "browserId": "b9d746c1-e245-4f2d-9e5d-65fddf63c587",
  "label": "Work",
  "protocolVersion": 2,
  "extensionVersion": "0.1.0",
  "identityStable": true
}
```

`label` is for display and may not be unique. Use only `browserId` for routing. `identityStable: false` identifies a legacy protocol v1 connection that does not retain the same ID after reconnecting to the server.

#### Tab

```json
{
  "id": 123,
  "windowId": 7,
  "index": 2,
  "active": false,
  "targeted": true,
  "pinned": false,
  "incognito": false,
  "title": "Example",
  "url": "https://example.test/",
  "browserId": "b9d746c1-e245-4f2d-9e5d-65fddf63c587"
}
```

`active` indicates whether Chrome UI is displaying the tab; `targeted` indicates whether it is the page-operation target. They are independent.

#### Snapshot

| Field | Type | Description |
| --- | --- | --- |
| `generation` | integer | Extension-wide monotonically increasing snapshot generation |
| `url` | string | Current URL of the target document |
| `title` | string | Document title without the agent-display prefix |
| `snapshot` | string | Accessibility YAML with refs |
| `browserId` | string | Routing provenance attached to structured protocol v2 results |

## Browser discovery and tab tools

### `browser_instances`

Lists connected Chrome browser instances.

**Arguments:** None.

**Returns:** `BrowserInstance[]`, sorted by `browserId`; an empty array when none are connected.

### `browser_tabs`

Lists every tab in every window of the specified browser.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `browser_id` | string | no | Browser to route to |

**Returns:** `Tab[]`.

### `browser_tab_open`

Opens a new tab without changing the target.

| Argument | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | no | `about:blank` | `http://`, `https://`, or `about:blank` |
| `active` | boolean | no | `true` | Whether to make the new tab active in Chrome UI |
| `browser_id` | string | no | — | Browser to route to |

**Returns:** The created `Tab`.

### `browser_tab_close`

Closes a tab by an ID obtained from `browser_tabs`. If it is the target, the target is also cleared.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `tab_id` | integer | yes | Tab ID to close |
| `browser_id` | string | no | Browser to route to |

**Returns:**

```json
{
  "closed": true,
  "tabId": 123,
  "browserId": "b9d746c1-e245-4f2d-9e5d-65fddf63c587"
}
```

### `browser_tab_select`

Selects the page-operation target without changing Chrome UI's active tab or window focus.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `tab_id` | integer | yes | Tab ID obtained from `browser_tabs` |
| `browser_id` | string | no | Browser to route to |

**Returns:** The selected `Tab`, with `targeted: true`.

### `browser_tab_activate`

Selects the page-operation target, makes the tab active, and brings its window to the foreground.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `tab_id` | integer | yes | Tab ID obtained from `browser_tabs` |
| `browser_id` | string | no | Browser to route to |

**Returns:** The selected `Tab`, with `active: true` and `targeted: true`.

## Snapshot and element tools

Before using the following tools, select an HTTP(S) target with `browser_tab_select` or `browser_tab_activate`. Element operations return a new `Snapshot`, invalidating the ref used for the operation.

### `browser_snapshot`

Captures an accessibility snapshot of the target page.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `browser_id` | string | no | Browser to route to |

**Returns:** `Snapshot`.

### `browser_click`

Clicks the element identified by a snapshot ref using trusted mouse input, without foregrounding the target.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `element` | string | yes | Non-empty human-readable element description |
| `ref` | string | yes | Ref from the latest snapshot |
| `browser_id` | string | no | Browser to route to |

**Returns:** A post-operation `Snapshot`.

### `browser_hover`

Moves the pointer to the element identified by a snapshot ref.

Arguments are the same as `browser_click`. **Returns:** A post-operation `Snapshot`.

### `browser_type`

Clicks and focuses the editable element identified by a snapshot ref, then types text.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `element` | string | yes | Non-empty human-readable element description |
| `ref` | string | yes | Editable-element ref from the latest snapshot |
| `text` | string | yes | Text to enter; may be empty |
| `submit` | boolean | yes | Whether to send Enter after typing |
| `browser_id` | string | no | Browser to route to |

**Returns:** A post-operation `Snapshot`.

### `browser_select_option`

Selects the specified `option.value` values in the `<select>` identified by a snapshot ref.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `element` | string | yes | Non-empty human-readable element description |
| `ref` | string | yes | `<select>` ref from the latest snapshot |
| `values` | string[] | yes | One or more exact `option.value` values |
| `browser_id` | string | no | Browser to route to |

Every value is validated before any change. **Returns:** A `Snapshot` after dispatching `input` and `change`.

### `browser_drag`

Drags between two refs in the same latest snapshot.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `startElement` | string | yes | Non-empty human-readable source description |
| `startRef` | string | yes | Source ref |
| `endElement` | string | yes | Non-empty human-readable destination description |
| `endRef` | string | yes | Destination ref |
| `browser_id` | string | no | Browser to route to |

The four drag-specific arguments use camel case in the public schema. The source must be clickable and the destination visible within the viewport. **Returns:** A post-operation `Snapshot`.

### `browser_upload_file`

Trusted-clicks a snapshot ref and assigns local files to the chooser opened by that click. It does not search for hidden file inputs with selectors.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `element` | string | yes | Human-readable description of the element that opens the chooser |
| `ref` | string | yes | Ref from the latest snapshot |
| `paths` | string[] | yes | File paths on the machine running the server and Chrome |
| `browser_id` | string | no | Browser to route to |

`paths` is limited to 1–20 absolute paths to existing regular files and is resolved to canonical paths by the server. Multiple paths cannot be assigned to a single-file input. Successful results and health responses never include paths.

**Returns:** A `Snapshot` after the file input's `change` event and synchronous handlers complete, followed by DOM stabilization. Completion of site-specific asynchronous uploads, thumbnail generation, or media processing is not guaranteed. If needed, call `browser_snapshot` after `browser_wait`.

## Keyboard, navigation, and timing tools

### `browser_press_key`

Sends a single key or `+`-delimited key chord to the target page.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | string | yes | Key name, single character, or key chord |
| `browser_id` | string | no | Browser to route to |

Named keys include `Alt`, arrow keys, `Backspace`, `Control`, `Delete`, `End`, `Enter`, `Escape`, `Home`, `Meta`, `PageDown`, `PageUp`, `Shift`, `Space`, and `Tab`. Single characters and chords such as `Control+a`, `Meta+a`, and `Shift+ArrowDown` are also accepted.

**Returns:** Text content `Pressed key <key>`. The latest refs are cleared, so call `browser_snapshot` before the next element operation.

### `browser_navigate`

Navigates the target tab to a URL and captures a snapshot after load completes. The same URL triggers a reload.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | `http://` or `https://` URL |
| `browser_id` | string | no | Browser to route to |

**Returns:** A post-navigation `Snapshot`.

### `browser_go_back`

Goes back one entry in the target tab's history. Has no arguments other than `browser_id`.

**Returns:** A post-navigation `Snapshot`. Returns an error when there is no back history.

### `browser_go_forward`

Goes forward one entry in the target tab's history. Has no arguments other than `browser_id`.

**Returns:** A post-navigation `Snapshot`. Returns an error when there is no forward history.

### `browser_wait`

Waits for a specified duration while retaining the target. This is a real-time sleep, not a wait for a DOM condition.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `time` | number | yes | Finite number of seconds from 0 through 10 |
| `video_filename` | string | no | Record the wait and 500 ms post-roll to this validated `.webm` basename |
| `browser_id` | string | no | Browser to route to |

**Returns:** Without `video_filename`, text content `Waited for <time> seconds` exactly as
before. With it, returns `{ "operation": "Waited for <time> seconds", "recording":
<metadata> }` after the download completes. The latest refs are cleared in both cases;
call `browser_snapshot` to read the DOM afterward.

## Diagnostic and media tools

### `browser_screenshot`

Captures the target's CSS visual viewport without foregrounding it.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `browser_id` | string | no | Browser to route to |

**Returns:** MCP image content in PNG format. The actual image is downscaled to at most 1024×768 pixels while preserving its aspect ratio. The agent's virtual cursor is included; the top-right target/operating status is hidden only during capture.

The implemented limit remains 1024×768. A planned recording milestone will change
screenshots and video to shared orientation-aware Full HD bounds: landscape or square
content fits within 1920×1080, portrait content fits within 1080×1920, with no cropping,
stretching, or upscaling. See [Video recording design](video-recording.md); that planned
screenshot contract is not exposed by the current tool yet.

### `browser_get_console_logs`

Retrieves console calls and uncaught exceptions retained by Chrome Runtime for the target's current document.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `browser_id` | string | no | Browser to route to |

**Returns:** Text content of up to 100 lines. Each line is an independent JSON object.

```json
{"type":"log","timestamp":1750000000000,"message":"ready"}
{"type":"exception","timestamp":1750000000123,"message":"Error: failed"}
```

Each entry contains `type: string`, `timestamp: number`, and `message: string`. This is not an extension-maintained persistent log; it is the buffer Chrome replays for the current document when `Runtime.enable` is called. The same entry may be returned again on a later call.

### `browser_record_video`

Records the current target without performing another page action. The target is not
foregrounded. The command returns only after Chrome reports that the silent WebM download
completed.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `filename` | string | yes | `.webm` basename, at most 200 UTF-8 bytes; paths, control characters, and implicit extension changes are rejected |
| `duration` | number | yes | Recording duration from 0.5 through 10 seconds |
| `browser_id` | string | no | Browser to route to |

Chrome saves below the selected profile's `Downloads/chrome-bridge/` directory and uses
`uniquify`, never overwrite. The result reports the requested name and the actual
Downloads-relative name without exposing an absolute path or Chrome download ID:

```json
{
  "requestedFilename": "checkout.webm",
  "filename": "chrome-bridge/checkout (1).webm",
  "mimeType": "video/webm",
  "durationMs": 1570,
  "width": 1920,
  "height": 1080,
  "frameCount": 15,
  "droppedFrameCount": 0,
  "sizeBytes": 58136,
  "browserId": "b9d746c1-e245-4f2d-9e5d-65fddf63c587"
}
```

Landscape or square recordings fit inside 1920×1080 and portrait recordings inside
1080×1920 without crop, stretch, or upscale. The encoder canvas stays fixed during one
recording. If encoding or download fails, the command returns an MCP error beginning
`Recording failed:` and removes only its own partial download when known.

## Planned operation-scoped recording API

`browser_wait` implements the first optional `video_filename` slice. Adding it to the
remaining page-action tools remains planned. Tab-management and information tools do not
receive the option. The authoritative ownership constraints, rollout order, and mixed
operation/recording result and error contract are in
[Video recording design](video-recording.md).

The planned recorded-operation success value is `{ "operation": <existing success
value>, "recording": <metadata> }`; omitting `video_filename` preserves the current
success value and content type exactly. Metadata reports the requested name, actual
Downloads-relative uniquified name, WebM type, elapsed duration, fixed dimensions,
submitted and dropped frame counts, encoded byte size, and stable `browserId` when
available. If the page operation succeeds but saving fails, the tool returns an error
that explicitly warns against automatic retry. If the operation fails, its original
error remains primary even if recording cleanup also fails.

## Errors

Tool errors are returned to the client as MCP error results. There is no published stable set of error codes; humans and agents interpret the message. Common causes follow.

| Category | Typical condition | Recovery |
| --- | --- | --- |
| browser unavailable | No extension connection, or specified ID is unknown/disconnected | Check extension settings and `browser_instances` |
| ambiguous browser | `browser_id` omitted with two or more connections | Pass a `browserId` from `browser_instances` explicitly |
| target unavailable | No target selected or target tab closed | Call `browser_tab_select` after `browser_tabs` |
| content unavailable | Restricted page such as `chrome://` or `about:blank` | Target an HTTP(S) tab or recover with navigate/back |
| stale/invalid ref | Old generation, another target, pre-navigation, or malformed ref | Capture a new `browser_snapshot` |
| element mismatch | Detached, covered, non-editable, non-select, or missing option | Choose an appropriate ref/value from the latest snapshot |
| navigation failure | No history, load failure, or restricted destination | Check the URL/history and navigate to HTTP(S) if needed |
| upload failure | Invalid path, no chooser, or multiple files for a single input | Correct the paths/ref; interception is cleaned up after failure |
| timeout/disconnect | Command did not finish within the default 15 seconds, or disconnected during processing | Check connectivity, obtain current state, then retry |

On error, chrome-bridge never implicitly reroutes to another browser/tab or falls back to a similar element.

## Typical workflows

### Single browser: background tab click

```text
browser_tabs()
browser_tab_select(tab_id=123)
browser_snapshot()
browser_click(element="Save button", ref="s12e7")
```

### Multiple browsers

```text
browser_instances()
browser_tabs(browser_id="b9d746c1-e245-4f2d-9e5d-65fddf63c587")
browser_tab_select(tab_id=123, browser_id="b9d746c1-e245-4f2d-9e5d-65fddf63c587")
browser_snapshot(browser_id="b9d746c1-e245-4f2d-9e5d-65fddf63c587")
```

### Upload with asynchronous processing

```text
browser_snapshot()
browser_upload_file(
  element="Attach images button",
  ref="s20e9",
  paths=["/absolute/path/image.png"]
)
# Direct result includes synchronous change-handler state.
browser_wait(time=1)
browser_snapshot()
# Observe site-specific asynchronous completion here.
```
