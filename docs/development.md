# Development guide

## Prerequisites

- Python 3.11+
- uv
- Node.js 20+ and npm
- Chrome 116+
- A Chrome profile that can load an unpacked extension

## Setup

```bash
uv sync --all-groups
npm --prefix apps/extension ci
npm --prefix apps/extension run build
uv run chrome-bridge-mcp
```

In Chrome, manually open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `apps/extension`. After changing extension code, click Reload on the same page. See the [Operations guide](operations.md) for routine start/stop procedures, environment variables, Options, MCP client configuration, and incident response.

## Endpoints

| URL | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | None | Server/extension connection status |
| `POST/GET/DELETE /mcp` | Loopback only | MCP Streamable HTTP |
| `WS /extension` | Loopback + Origin validation | Extension protocol |

When `extensionConnected` is `true` in the health response, at least one extension bridge is connected. Check the count with `connectedBrowserCount`. Unauthenticated health never returns browser IDs or labels.

## Validation

```bash
uv run pytest
uv run ruff check apps/server
uv run ruff format --check apps/server
uv run python -m compileall -q apps/server/src
npm --prefix apps/extension test
npm --prefix apps/extension run lint
npm --prefix apps/extension audit --audit-level=high
uv run python scripts/validate_static.py
git diff --check
```

The isolated extension E2E implements the contract in [Isolated Chrome E2E](isolated-chrome-e2e.md). Install bundled Chromium once, then run it explicitly and separately from ordinary unit/DOM tests.

```bash
npm --prefix apps/extension exec playwright install --no-shell chromium
npm --prefix apps/extension run test:e2e
```

`test:e2e` has one worker own a production server on a pre-bound random port, a loopback fixture, a temporary extension artifact containing a random URL, and two ephemeral persistent contexts. It never connects to default port 8765 or an everyday Chrome profile and cleans up processes and temporary directories after success or failure. It retains traces, fixture screenshots, server/worker logs, and a bounded MCP transcript only on failure.

The temporary artifact also exposes test-only recording probes. The navigation lifecycle
probe holds one debugger target while sampling screenshots through same-document,
cross-document, back, and forward transitions; it never ships in the production
extension artifact.

The fixture renders its `/a` or `/b` route and also owns deterministic delayed
(`/slow-a`) and connection-reset (`/fail`) routes. The visible route makes playback
transitions testable; recorded-navigation E2E uses the controlled failures to inject
target change, tab close, and external detach without external networks or variable
remote servers.

The production manifest includes `offscreen`/`downloads`, and E2E calls the public
`browser_record_video` tool against controlled inactive landscape and portrait fixtures.
It also records wait, click, hover, type, select, key, drag, upload, navigate, back, and
forward; verifies conditional
result wrappers, visible operation outcomes, guaranteed initial frame/pre-roll,
input-priority frame dropping, bounded drag milestone capture, and post-roll WebM output;
and forces an external debugger detach to verify the mixed-failure warning,
absent partial download, and immediate screenshot reuse. Each successful test download
is removed exactly. A small test-only input-contention probe remains injected.
Because Playwright stores accepted downloads under UUID filenames, the
ephemeral artifact substitutes only the returned relative filename conversion; the
production conversion has cross-platform unit coverage and remains unchanged.

`scripts/validate_static.py` checks manifest references, matching extension/server versions, protocol v1/v2 JSON Schemas, and the command catalog. The GitHub Actions [CI workflow](../.github/workflows/ci.yml) runs the same commands on Python 3.11/3.12 and Node 20, and rejects drift between canonical schemas and the tracked bundle with `git diff --exit-code -- apps/extension/dist/protocol.js` after the extension build. After earlier gates pass, the isolated E2E job installs full bundled Chromium and runs the same `test:e2e`. It then builds release artifacts, clean-installs the wheel into a temporary venv, runs E2E with the ZIP extension, and checks matching SHA-256 values across two independent builds. [Release artifacts](release.md) is canonical for artifact contents and installation.

Edit `protocol_v1.schema.json` when changing protocol commands/runtime and `protocol_v2.schema.json` when changing the identity hello, then regenerate `dist/protocol.js` with `npm --prefix apps/extension run build`. Python and extension protocol tests check every command, unknown/extra fields, omissions, type mismatches, lifecycle, and success/error exclusivity against the same canonical schemas. Because the background imports `dist/protocol.js`, Reload the unpacked extension after schema or validator changes.

For multi-profile validation, Load unpacked from the same `apps/extension` directory in two Chrome profiles and assign different labels in Options.

1. Confirm `/health` has `connectedBrowserCount: 2` and contains no IDs or labels.
2. Confirm `browser_instances` returns two distinct stable IDs.
3. Confirm `browser_tabs` without `browser_id` returns an ambiguous error and sends a command to neither browser.
4. Confirm `browser_tabs` with each ID returns only that profile's tabs and a matching result `browserId`.
5. Select a different target in each profile and alternate snapshots, confirming refs and target state never mix.
6. Reload one profile and confirm it reconnects with the same ID while the other connection and target remain intact.
7. Confirm active tab/window focus in both profiles remains unchanged throughout.

Reloading an extension may initialize that profile's own `chrome.storage.session`, so clearing its target is acceptable. Reconnect validation requires that stable `browserId` be restored from `chrome.storage.local` and that the non-reloaded profile's connection, target, and pending state remain unaffected. Serve `apps/server/tests/fixtures/multiple-profile.html` over loopback as the reproducible page.

To use MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector
```

Set the URL to `http://127.0.0.1:8765/mcp`. For real-Chrome validation, check five tools in this order:

1. Record existing tab IDs with `browser_tabs`.
2. Create `https://example.com` as inactive with `browser_tab_open`.
3. Target the new tab with `browser_tab_select` and confirm the original active tab is unchanged.
4. Explicitly foreground the new tab with `browser_tab_activate`.
5. Close only the new tab with `browser_tab_close`.

Never close existing user tabs during validation.

For real-Chrome `browser_snapshot` validation, create an inactive HTTP(S) test tab, select it, and capture a snapshot. Confirm the original active tab ID is unchanged and the result contains a URL, title, YAML, and refs matching `^s\d+e\d+$`. Expect content-unavailable for `about:blank` or `chrome://` targets. Prefer loopback HTTP fixtures for reproducible E2E because external sites can become Chrome error pages in some environments.

For `browser_click`, place two same-named buttons in a loopback fixture, target the background tab, and verify:

1. Choose the second button's ref from the snapshot and confirm only it updates the status and post-operation snapshot.
2. Chrome UI's active tab ID remains unchanged before and after the click.
3. The old post-operation ref, a ref from before target change, and a pre-navigation ref are rejected as stale.
4. A ref to an Element removed from the DOM after the snapshot is rejected as unknown/detached.
5. A link-click navigation returns the new URL and new document snapshot.
6. Finally, `chrome.debugger.getTargets()` shows no debugger attached to the test tab.

After adding `debugger` permission, Reload the unpacked extension. The implementation attaches to page `targetId` and enables renderer focus emulation only during input. Do not use `{tabId}` attachment because it foregrounds background tabs in some environments, and do not test foreground-and-restore as a failure fallback.

For real-Chrome hover/type/select/key validation, place a hover event, editable input, multiple select, and keydown event in the same loopback fixture. After each operation confirm:

- Hover fires `mouseenter` and updates the virtual cursor and post-operation snapshot.
- Type changes only the specified input and `submit=true` fires the Enter handler.
- A new snapshot after the press-key completion message shows the keydown-driven DOM update.
- Chords such as `Meta+a` directly confirm the modifier-flag/key combination in the fixture's keydown handler.
- Select marks only the specified `option.value` values selected and fires `input` and `change` handlers.
- Each operation yields a new generation, rejects old refs as stale, leaves the active tab unchanged, attaches/detaches the debugger cleanly across consecutive calls, and cleans up the test tab.

For real-Chrome navigate/back/forward/wait validation, provide two history pages and a delayed-update page on loopback.

1. Click a link on the background target from `/one` to `/two`, then obtain `/one` after back and `/two` after forward.
2. Navigating to the current URL reloads and produces a new generation.
3. Expect `Cannot go forward` with no forward history.
4. Navigate to the delayed-update page, record an old ref, then confirm after wait that the old ref is stale and a new snapshot contains the update.
5. A link click to `about:blank` returns content-unavailable; back recovers the HTTP page without changing the target.
6. The active tab ID remains unchanged throughout, and only the test tab is closed at the end.

For real-Chrome screenshot/console validation, create two inactive loopback tabs with distinct console output.

1. Target landscape and portrait tabs and call `browser_screenshot`. Confirm both are
   `image/png`, have a PNG signature, and fit the shared Full HD policy: landscape/square
   within 1920×1080 and portrait within 1080×1920. Confirm the image is not cropped,
   stretched, or upscaled. Consecutive success also demonstrates debugger detach.
   On high-DPI Chrome, record `devicePixelRatio` and CSS viewport dimensions in the
   controlled fixture and confirm the decoded PNG follows the CSS sizing contract rather
   than returning an unbounded physical-pixel image.
2. Use `browser_get_console_logs` to confirm normal logs, warnings, delayed errors, and uncaught exceptions. Wait at least one second for delayed entries because background-tab timers are throttled.
3. Confirm the target result lacks the other tab's identifying log and, after switching targets, no data leaks in the opposite direction.
4. The original active tab ID remains unchanged across select, screenshot, console, and target changes.
5. Close only test tabs and clean up even after intermediate errors.

After changing the target indicator or virtual cursor, also verify on the same inactive fixture:

1. Immediately after select, the tab title starts with `◉ ` and the top right shows `Agent target`; the original active tab is unchanged.
2. Only while `browser_wait(time=1)` runs, the title uses `● ` and the indicator reads `Agent operating`; completion or error returns to target state.
3. Repeated `document.title` changes never duplicate the prefix, and selecting another target restores the latest original title.
4. The click/type/select arrow tip matches the operation point and shows a ripple. During drag, pressed state follows interpolated points and clears at the end.
5. Target change removes status and cursor from the old tab and shows status only on the new target. Navigation restores only status; the cursor remains hidden until the next coordinate operation.
6. A screenshot includes the cursor but not top-right status, and the page shows status again afterward.
7. `prefers-reduced-motion: reduce` skips cursor movement waits and pulse/ripple animation.
8. Repeat with two profiles and confirm their target/operating states never mix.

Console logs use the buffer Chrome replays for the current document after `Runtime.enable` at call time. The same entry may appear on the next call, but the extension keeps no independent persistent history across calls. When an object preview is unavailable, the message falls back to a description such as `Object`.

For real-Chrome drag validation, place a `draggable=true` source and a drop zone with `dragover.preventDefault()` in the same viewport.

1. Obtain source and drop-zone refs from a snapshot and call `browser_drag` on the background target.
2. Confirm `dragstart`, `dragenter`, `dragover`, `drop`, `dragend`, and the drop result in the post-operation snapshot.
3. Confirm pre-operation start/end refs become stale and the active tab ID is unchanged.
4. Immediately succeed with another debugger-based tool, confirming detach after drag.
5. Add synthetic `Input.dispatchDragEvent` only if ordinary mouse events cannot produce the HTML5 event sequence.

For real-Chrome upload validation, use a loopback fixture whose visible button click handler calls `click()` on a hidden `<input type="file" multiple>` and whose change handler writes only `File.name` values to status.

1. Create two small test files with different contents in a temporary directory outside the repository.
2. Obtain the visible button's ref from a snapshot and call `browser_upload_file(element, ref, paths, video_filename=...)` on the background target; omit the filename when recording is not under test.
3. Confirm both basenames and synchronous change-handler output in the post-operation snapshot, with unchanged active tab/window focus. Asynchronous media-processing status may remain pending in the direct result; separately confirm a new snapshot after `browser_wait` changes to complete.
4. Confirm the server rejects relative paths, nonexistent paths, directories, zero files, and 21 files before sending a command.
5. A button ref that opens no chooser returns a timeout error, and multiple paths for a single-file input are rejected before assignment.
6. After failure, no file-chooser interception, focus emulation, or debugger attachment remains, and the next screenshot/click succeeds.
7. Clean up only test files and tabs, and leave no absolute paths in results, logs, or failure artifacts.

The upload-result boundary fixture synchronously writes basenames and `Processing: pending` inside the `change` handler, then transitions to `Processing: complete` after five seconds. The delay intentionally exceeds the one-second DOM-stability interval plus measured large-file assignment time in branded Chrome. The direct result contains basenames and pending without waiting for site-specific delayed work. Confirm complete afterward with `browser_wait(time=6)` + `browser_snapshot`.

Chrome throttles background-tab timers, so a fixture's 200 ms timer may still not fire after 300 ms. Judge wait correctness by elapsed time and message; allow at least one second of margin in E2E that waits for DOM updates. Because `chrome.tabs.update` can replace the current history entry of a directly created tab, create successful-history fixtures through link clicks.

## Page-operation implementation order

Add page operations as separately validated vertical slices in this order:

1. `browser_tab_select` and target state
2. Playwright-derived content runtime and `browser_snapshot`
3. Ref resolution, `browser_click`, and post-operation snapshot
4. Hover, type, select, and key
5. Navigate, back, forward, and wait
6. Virtual cursor, screenshot, and console logs
7. drag

When adding Playwright-derived source, preserve the source commit, Apache-2.0 header, and local modifications. When introducing an extension build, provide a lockfile and commands reproducible from a fresh clone, and add validation that required generated files exist in the Load-unpacked directory.

## Target tab validation

Target selection must not take over Chrome UI. In real Chrome, never close existing user tabs; verify in this order:

1. Record the current `active` tab ID with `browser_tabs`.
2. Create a test HTTP(S) tab with `browser_tab_open(active=false)`.
3. Target it with `browser_tab_select`.
4. Use `browser_tabs` to confirm the original tab still has `active: true` and only the test tab has `targeted: true`.
5. Manually foreground another tab and confirm `targeted` does not change.
6. Run snapshot, click, type, navigate, and screenshot on the background target.
7. Close the target tab and confirm the next page command returns target-unavailable.

Never call `browser_tab_activate` automatically after a background operation fails. Return an error that identifies a focus dependency and leave activation/retry to the MCP client.

## Snapshot/ref validation

At minimum, verify the following with automated tests or fixed fixtures:

- Implicit/explicit roles and accessible names
- Checked, disabled, expanded, level, pressed, and selected states
- Input/textarea values and link URLs
- Text normalization, `aria-owns`, slots, open shadow roots, and pseudo content
- YAML and refs matching `^s\d+e\d+$`
- Stale-ref rejection after regenerating a snapshot
- Stale-ref rejection after target change and navigation
- No selector guessing or operation on an Element other than the ref
- Clear errors for restricted pages and missing content runtime
- Rejection of non-editable type refs, non-select refs, and nonexistent option values
- Modifier ordering in key chords and invalidation of the latest snapshot after operation
- Snapshot invalidation before navigation, same-URL reload, no-history errors, and recovery from restricted history destinations
- Wait's 0–10 second bounds, target changes, and background-timer throttling
- Same-generation drag start/end, end visibility, old-ref rejection, and mouse-release/debugger cleanup

## Adding a tool

1. Update the protocol command and MCP schema in `SPEC.md`.
2. Add a method with response validation to `BrowserController`.
3. Call the controller from the FastMCP tool in `app.py`.
4. Add the Chrome API implementation to extension `executeCommand`.
5. Test success, extension error, disconnect, and timeout.
6. Put durable procedures in this guide, completed-work records in `HISTORY.md`, and only remaining work in `NEXT_TASK.md`.
