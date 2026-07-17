# History

## 2026-07-17

### MIT licensing and Python package naming

- Selected MIT for the original chrome-bridge code and added matching license text to the repository, Python distribution, and extension ZIP. Playwright-derived code remains under Apache-2.0 with its existing third-party notice and full license text.
- Renamed the unpublished Python distribution, import package, and CLI from `chrome-bridge-server` / `chrome_bridge_server` to `chrome-bridge-mcp` / `chrome_bridge_mcp`, while retaining `chrome-bridge` as the repository, product, and MCP client configuration name.
- Extended static and release validation to reject missing or inconsistent MIT license files and stale package/archive names.
- All 98 Python tests, 23 extension tests, lint/static gates, clean-wheel import, and two-profile artifact E2E passed. Two independent builds were byte-identical with SHA-256 prefixes `19b063e3...` for the extension ZIP, `e2a0c3da...` for the wheel, and `d7656637...` for the sdist.

### Branded Chrome upload change-barrier smoke

- Reloaded the unpacked extension in two branded Chrome profiles and connected both simultaneously to the production loopback server.
- Assigned a 5000×5000, 678,796-byte PNG to the hidden multiple file input on an inactive fixture tab. The final direct result completed in 2.252 seconds and contained the basename plus `Processing: pending`; a snapshot after `browser_wait(time=6)` contained `Processing: complete`.
- Increased the fixture's site-specific completion delay from 1.5 to 5 seconds because the former could expire during large-file assignment plus the required one-second DOM-stability wait in branded Chrome. The isolated E2E now waits six seconds before checking completion.
- Disabled file-chooser interception immediately after assigning files, required the change barrier to report that it observed the event, and retained best-effort cleanup for every earlier failure path.
- Profile B remained `Ready` with `Processing: idle` and no uploaded basename. Both profiles retained their original active tabs throughout.
- A ref that opened no chooser returned the expected error, and an immediate screenshot succeeded afterward, confirming debugger/interception cleanup. Closed only the two fixture tabs and removed the temporary image.

## 2026-07-16

### MCP tool API reference

- Added `docs/api.md`, consolidating the arguments and return values of all 20 tools, browser routing, the target/ref lifecycle, major errors, and common workflows into a single user-facing reference aligned with the implementation.
- Added links to the API reference from the README and the AGENTS documentation guide.

### Character icon and pink UI palette

- Created a silhouette icon with a round head, folded ears, and no facial features, using the supplied character sheet as the shape and color reference. Reduced the transparent margin to about half of the initial version and roughly doubled the shape-following white padding so the outline remains visible on any background. Kept 16/32/48/128 px PNGs and an editable master.
- Set the manifest default and `connected` state to bright pink `#f21b86`, and `connecting`, `disconnected`, and `error` to gray `#9aa0a6`. Synchronized `chrome.action.setIcon` and the tooltip with connection-status updates. Consolidated concurrent initial-install `connect()` calls into one Promise.
- Unified the virtual cursor, click ripple, target/operating indicator, and popup/options accents around a derived palette of bright pink `#f21b86`, deep pink `#b80f62`, and dark pink `#72083d`.
- Added static checks for the manifest icon set, PNG dimensions, alpha channels, and the release allowlist. All 23 extension tests, lint, the isolated two-profile Chromium E2E, release archive validation, and byte-for-byte comparison of two independent builds passed.

### Operations and release handoff

- Added `docs/operations.md`, consolidating the support boundary, server environment variables, extension Options, MCP client configuration, start/stop/restart procedures, health interpretation, multi-profile operation, logs, and recovery from common errors into one runbook.
- Added version-bump targets, server stop/start steps, per-profile Reload steps, and rollback criteria for failed smoke tests to the release documentation.
- Updated the isolated E2E documentation's runtime-config explanation to match the current implementation, and linked the runbook from the README, AGENTS, development, and release documentation.

### Documentation scope cleanup

- Consolidated names and feature comparisons for similar tools into the README comparison table, removing product-specific dependencies from the specification, design, history, development instructions, code, and test names.
- Removed the comparison-only research document and rewrote decisions required by the implementation—snapshot, strict refs, target routing, and CDP input—in product-neutral terms.
- Based the README comparison on public setup guides, changelogs, READMEs, and tool references as of 2026-07-16. Features not documented publicly are described as “not mentioned in public documentation,” rather than asserted to be unsupported.

### File input change barrier

- Resolved `Page.fileChooserOpened.backendNodeId` with `DOM.resolveNode` and installed a temporary `change` barrier on the target input before `DOM.setFileInputFiles`. DOM stabilization and snapshot capture now begin only after event dispatch and synchronous handlers complete.
- Separated site-specific asynchronous uploads and thumbnail generation from this contract instead of waiting indefinitely; they are observed in a fresh snapshot after `browser_wait`. The E2E fixture confirmed files/pending in the direct result and processing complete in the subsequent snapshot.

### Strict-ref local file upload

- Added `browser_upload_file(element, ref, paths, browser_id)` and `page.uploadFile`. The server limits input to 1–20 absolute paths to existing regular files and canonicalizes them. Paths are not returned in results.
- Before trusted-clicking the strict ref, the extension intercepts the file chooser and calls `DOM.setFileInputFiles` on the `backendNodeId` returned by `Page.fileChooserOpened`. It does not guess a selector for a hidden input or bring Chrome UI to the foreground.
- Rejects chooser timeouts, missing backend nodes, and multiple files for a single-file chooser before setting any files. Interception and debugger state are cleaned up in `finally` on both success and failure.
- All 98 Python tests and 21 extension DOM/protocol tests passed. In the isolated two-profile Chromium E2E, two temporary files were assigned to a hidden multiple input from a visible button on a background target; the post-operation snapshot contained both basenames, the active tab remained unchanged, and an immediate screenshot succeeded.
- After reloading the unpacked extension, branded Chrome also assigned two images to a hidden multiple input on a background target. Multiple files for a single input and a ref that opened no chooser failed as expected; screenshots immediately after both errors succeeded, interception was cleaned up, and the active tab remained unchanged.
- Using only this project's MCP, created a two-post image thread on X, verified each post's text, image, and thread relationship in the profile, then deleted the reply and root post. The test X tab was also closed; existing tabs and posts were not modified.

### Agent target indicator and virtual cursor refinement

- Kept the target tab separate from Chrome UI's active tab while visualizing it through `◉ `/`● ` title prefixes, Shadow DOM `Agent target`/`Agent operating` indicators, and popup state. Dynamic title changes are tracked and restored when the target is cleared.
- Added a session-persisted tab ID and UUID token to the page-operation queue, marking it operating only from operation start through `finally`. Implemented cleanup that leaves no stale indicator after target changes, tab close, failure, or service-worker restart.
- Replaced the circular cursor with a white-outlined purple arrow and added distance-dependent 100–320 ms movement, reduced-motion behavior, a click ripple, drag pressed state, and 180–500 ms interpolated CDP movement. Click/type/select input begins after the cursor arrives.
- Screenshots hide only the top-right status for two animation frames, include the cursor, and restore the status in `finally`.
- Increased DOM tests to 21, covering the arrow tip, Shadow DOM, movement bounds, reduced motion, dynamic titles, and capture visibility. A single retry-free isolated two-profile Chromium E2E test passed for Target/Operating transitions on an inactive target, click/type/drag/screenshot, cleanup on target change, recovery from errors, profile isolation, and unchanged active tab.
- After reloading the unpacked extension, branded Chrome with two profiles also passed Target/Operating title, click/type/drag/screenshot, cursor-only capture, profile isolation, and unchanged-active-tab checks. Only test tabs were cleaned up.

### Reproducible v0.1 release artifacts

- Made `extension-files.json` the canonical runtime/notice allowlist shared by the E2E harness, static validation, and release ZIP build.
- Generated the extension ZIP with a fixed entry order, 1980-01-01 timestamps, 0644 permissions, and deflate level 9. Included the third-party notice and full Apache-2.0 text for Playwright-derived code; excluded source, tests, `node_modules`, and profile data.
- Release validation detected that Hatch's default sdist file selection included `tests/e2e_server.py`, so `/tests` was explicitly excluded from the sdist target. Validation checks that the wheel contains the console entry point and protocol v1/v2 schemas.
- Installed the wheel into a fresh temporary venv, verified imports outside the source tree and the packaged schemas, then ran retry-free isolated E2E with two profiles using the ZIP extension and installed server; it passed in 7.2 seconds.
- All artifacts from two independent builds were byte-identical, with matching SHA-256 values for the extension ZIP `3a34c1d1...`, wheel `bb440d2c...`, and sdist `cf3c75ac...`. Because source changes alter these values, generated `SHA256SUMS` is canonical at release time.
- Publication was deferred because the project `LICENSE` and Git remote are unset. License selection by the rights holder and release-process decisions remain as the next task.

### Isolated Chrome E2E harness implementation

- Extracted the production default WebSocket URL into `runtime-config.js`; only the test artifact replaces it with a pre-bound random port, ensuring the harness never connects to the default port 8765 while running.
- Implemented a harness in which one Playwright worker owns production `create_app`, a Uvicorn helper with JSON readiness, a loopback fixture, an MCP SDK client, a runtime-allowlist artifact, and two bundled-Chromium persistent contexts.
- Automated checks for empty health, two protocol v2 stable IDs, ambiguous-routing rejection, inactive selection, profile isolation for the same `s1e6` ref, click, stale-ref rejection, preservation of A's ID and B's `Updated B` target across an A restart, ID-specific close, and a final empty registry.
- One retry-free test passed in 6.8 seconds with Chromium 149.0.7827.55 on local macOS. Because the headless restart did not restore A's tab session itself, tab IDs/restoration are not part of the identity contract; routing is checked by explicitly opening and closing a new A tab after reconnection.
- Added a separate `npm run test:e2e`, diagnostics that retain trace/screenshot/log/transcript only on failure, and a ten-minute GitHub Actions job that installs full Chromium after earlier gates pass.

### Isolated Chrome E2E harness design

- Confirmed from official Playwright/Chrome documentation that extensions require a persistent context and that bundled Chromium's `chromium` channel supports unified headless mode. Automated branded-Chrome launch is not the primary path because its sideload flag was removed.
- Launched Playwright 1.61.1's bundled Chromium 149.0.7827.55 headlessly with an ephemeral profile and measured the MV3 service worker, protocol v2, snapshot and strict ref on an inactive target, `chrome.debugger` click, and unchanged active `about:blank`.
- Confirmed that the registry returned to the existing two connections and the temporary profile was deleted after the probe.
- Designed ownership for the random-port production server, fixture, test-only runtime-config artifact, two-profile restart, and reverse-order cleanup.
- Recorded the minimum E2E contract, service-worker suspension/debugger policy, failure-artifact minimization, and the boundary between Ubuntu CI and macOS manual smoke testing.

### Continuous integration gates

- Added GitHub Actions Python/Extension jobs with read-only permissions, per-branch concurrency cancellation, and timeouts.
- On Python 3.11/3.12, run locked sync, 90 tests, Ruff check/format, compileall, and static manifest/protocol validation.
- On Node 20, run locked npm install, ESLint 10.4.0, extension build and 17 Playwright tests, and a high-severity audit.
- A shared script validates manifest-referenced files, matching server/extension versions, Draft 2020-12 protocol v1/v2 schemas, and the 18-command catalog.
- After the extension build, CI checks the Git diff of tracked `dist/protocol.js` and fails on drift from the canonical schema/validator.
- CI-equivalent commands passed in isolated Python 3.11.15 and 3.12.10 environments, each with 90 tests and all static gates. The extension also passed from locked `npm ci` through ESLint, build, 17 tests, an audit with zero vulnerabilities, and no generated-bundle drift.

### Multiple Chrome profile routing implementation

- Added stable UUIDv4 `browserId` and 1–64-character `browserLabel` fields to the protocol v2 hello, generating, normalizing, and saving them in `chrome.storage.local` per extension installation. The label is editable in Options and the local identity is visible in the popup.
- Changed the server to per-ID `BrowserRegistry`/`BrowserConnection` objects, isolating sockets, pending requests, and send locks. Only reconnects with the same v2 ID and the single v1 legacy slot replace an old connection with code 1012; stale detach or protocol errors do not propagate to other IDs.
- Added `browser_instances`, bringing the total to 19 tools, and added optional `browser_id` to the existing 18. It may be omitted only with one connection; zero/multiple/unknown/disconnected IDs are rejected before sending without fallback. Structured v2 tab/snapshot results include `browserId`.
- Added `connectedBrowserCount` to health and made singular `extension` `{}` when multiple browsers are connected. IDs, labels, tab data, and page data are not returned.
- The 90 Python and 17 extension tests covered v1/v2 schemas, identity storage, schemas for all 19 tools, concurrent two-connection routing, same-ID replacement, stale detach, target disconnect, cross-connection response IDs, legacy coexistence, and health redaction.
- Connected two real Chrome profiles simultaneously with stable IDs `7bd4492b-...` and `e0151dd1-...`; verified ambiguous error when omitting the ID, profile-specific tabs, isolation of identical `s1e6` refs, B remaining `Ready` after a click in A, and unchanged active tabs in both profiles.
- Reloading only Profile A restored the same ID while preserving Profile B's target and generation-4 `Updated B` snapshot. Only the reloaded profile's session target was cleared. Closed only the two test tabs, specifying their IDs.

### Multiple Chrome profile routing design

- Fixed the design around a random UUIDv4 stored in `chrome.storage.local` per extension installation, separate from the non-unique user label.
- Because the v1 hello rejects unknown fields, identity was introduced as protocol v2, with a new server accepting one v1 legacy slot for migration.
- Split the singleton into per-ID `BrowserRegistry`/`BrowserConnection` objects, isolating pending requests and send locks per connection.
- Added optional `browser_id` to the existing 18 tools, omissible only for a single connection. Rejected global selection state because it conflicts across stateless MCP clients.
- Recorded a state machine and test matrix that never falls back for unknown/disconnected/ambiguous IDs and replaces only reconnects with the same ID using code 1012.
- Fixed the unauthenticated health boundary: expose only connection presence, count, and—when singular—version; omit IDs, labels, tabs, and page data.

### Extension protocol v1 schema validation

- Made the server package's `protocol_v1.schema.json` the Draft 2020-12 canonical source, defining hello, ping/pong, request, success/error responses, and all 18 command parameter objects with unknown fields forbidden.
- The Python server loads the same package resource with `jsonschema` and validates outgoing requests/pongs and incoming hello/runtime messages. The extension embeds canonical JSON into `dist/protocol.js` with esbuild and validates both directions against the same command catalog.
- Fixed the policy that an invalid command with a valid UUIDv4 ID becomes an extension error response, while malformed JSON, invalid IDs, invalid hello/runtime messages, mixed success/error fields, and unknown response IDs close the WebSocket with code 1002.
- When a protocol error makes the server detach a connection, all pending commands fail and are never implicitly rerouted to another extension.
- The 81 Python and 14 extension tests covered every command, type, missing and extra fields, lifecycle, and response exclusivity.
- After reloading the unpacked extension, connected to the real server with a protocol v1 hello and verified schemas for 18 tools and a `browser_tabs` round trip over the three existing tabs. `extensionConnected: true` remained set after the 20-second heartbeat interval.

### Strict ref drag on background target tabs

- Added `browser_drag` with a `startElement`, `startRef`, `endElement`, `endRef` schema and exposed it as an MCP tool.
- The content runtime strictly resolves start/end Elements from the same latest snapshot, scrolls and hit-tests the start for clickability, and converts the end to viewport coordinates. It moves the virtual cursor from start to end, waits for DOM stabilization, and returns a new snapshot.
- Temporarily attaches to the page `targetId` with focus emulation and sends mouse move/press, five movement steps, and release. It attempts release even if movement fails, then disables focus emulation and detaches in `runWithDebugger`'s `finally`.
- Did not add `Input.dispatchDragEvent`, because ordinary mouse events alone produced `dragstart,dragenter,dragover,drop,dragend` in a real-Chrome HTML5 fixture.
- On background tab `1976814743`, dragged generation-3 source `s3e6` to target `s3e7` and verified generation-4 status `Moved card` and the full event sequence. The old ref became stale, and an immediate 1024×613 PNG capture succeeded.
- Active tab `1976814175` remained unchanged throughout; only the test tab was closed, preserving existing tabs.

### Screenshot and console implementation

- Added `browser_screenshot`, `browser_get_console_logs`, and their protocol/controllers, returning FastMCP PNG image content and one JSON-text entry per line respectively.
- Implemented background-tab `Page.getLayoutMetrics` / `Page.captureScreenshot`, content-side canvas downscaling to at most 1024×768, Runtime console/exception collection, and a 100-entry limit.
- chrome-bridge temporarily attaches to the page `targetId` for both foreground and background tabs and does not enable focus emulation for screenshots. Measurements showed that `clip.scale` alone does not reduce actual PNG pixels on high-DPI displays, so a canvas performs the real-image downscale.
- The Runtime domain is enabled only during a console call, collecting for 100 ms the entries Chrome replays for the current document. Event sources are strictly filtered by page `targetId`; console values, unserializable values, preview/description, and exceptions are stringified.
- Captured the background loopback-fixture target tab `1976814716` twice; both PNGs were 1024×613, 23,515 bytes, and `image/png`. Consecutive success also confirmed debugger detach after each operation.
- Retrieved the target's log/warning/delayed error/exception without including `decoy-secret` from decoy tab `1976814719`. Switching the target to the decoy likewise excluded the former target's logs.
- Active tab `1976814175` remained unchanged throughout; only the two test tabs were closed.

### Navigate, history, and wait implementation

- Added `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_wait`, and corresponding protocol/controllers.
- The same URL reloads, a different URL uses `chrome.tabs.update`, and history traversal uses the Chrome tabs API.
- Began monitoring top-frame commits, History API changes, fragments, navigation errors, and tab close before starting navigation; clear the latest snapshot before navigation and return a new one after load completes.
- Navigate permits only HTTP(S). Wait is limited to 0–10 seconds to fit within the server timeout; it also clears the latest snapshot when it begins and returns only a completion message.
- On background loopback-fixture tab `1976814642`, verified generations 20–26 across link-history back/forward, same-URL reload, navigation to `/delayed`, a DOM update after a 1.2-second wait, and stale rejection of the old ref.
- Forward with no history returned `Cannot go forward`. Clicking to `about:blank` produced content-unavailable; going back from background tab `1976814646` restored an HTTP snapshot at generation 28.
- Because `chrome.tabs.update` could replace the current history entry of a directly created tab in this Chrome version, successful back/forward E2E uses history created by a link click.
- Active tab `1976814175` remained unchanged throughout; only each test tab was closed.

### Hover, type, select, and key implementation

- Added `browser_hover`, `browser_type`, `browser_select_option`, `browser_press_key`, and corresponding protocol/controllers.
- Implemented hover mouse movement, typing with optional Enter, selection by `option.value`, `+`-delimited key chords, and post-operation DOM stabilization.
- Hover/type share hit-tested coordinates and the virtual cursor from a strict ref; type accepts only editable Elements, focuses them with a trusted click, then sends CDP `Input.insertText`.
- Select operates directly on the saved `HTMLSelectElement`, validates the existence of every value before changing anything, then fires `input` and `change`.
- Key converts primary navigation/edit keys, modifier chords, and single characters into CDP keyDown/keyUp events.
- On background loopback-fixture tab `1976814579`, verified hover, `alpha` plus Enter, ArrowLeft, multi-select `red`/`blue`, and debugger reattachment across generations 11–16. The old ref was rejected as stale.
- On another background tab, `1976814595`, a generation-26 snapshot confirmed that the `Meta+a` keydown carried `metaKey`.
- Active tab `1976814175` remained unchanged during validation; only the test tab was closed, preserving four existing tabs.

### Strict ref click on background target tabs

- Added `page.click` / `BrowserController.click()` / `browser_click()` as one vertical slice from `element`, `ref` through the post-operation snapshot.
- Strictly resolves the saved Element in the content runtime without re-querying a CSS selector or falling back to a similar Element, and produces hit-tested viewport coordinates plus a virtual cursor.
- Rejects malformed refs, stale generations, target changes, navigation, and detached/covered Elements. After the operation, waits up to three seconds for one second without mutations before returning a new snapshot.
- Measurements showed that `chrome.debugger.attach({tabId}, "1.3")` foregrounds an arbitrary background tab, so the implementation attaches directly to the page `targetId` returned by `chrome.debugger.getTargets()`.
- Enables `Emulation.setFocusEmulationEnabled` only while sending CDP mouse input through a `targetId` attachment, then always disables it and detaches. There is no foreground-and-restore behavior or fallback to `tabId` attachment.
- On background loopback-fixture tab `1976814528`, clicked only the second of two same-named buttons and confirmed generation 3→4 and status `second`. Click navigation returned generation 5 and the `/done` snapshot `Arrived`.
- Active tab `1976814175` remained unchanged during validation. Real Chrome confirmed stale-ref, target-change, and detached-ref rejection, debugger detach, and cleanup of only the test tab.

### Accessibility snapshot foundation

- Vendored the ARIA tree, role/name/state, and YAML processing derived from Playwright v1.51.1 commit `0ad26b38902449d9347536c97a34cc5dedbec729`, including Apache-2.0 source headers and notice.
- Added `[ref=s<generation>e<element-id>]` and link `/url`, retaining strict generation and Element maps.
- Added a non-minified IIFE bundle for Chrome 116 built with esbuild, a package lock, and Playwright fixture tests.
- The test runner uses 1.61.1 to avoid a known advisory in older Playwright, while only the snapshot source remains pinned to 1.51.1.
- Implemented a manifest-declared top-frame content script, on-demand injection for existing pages, and serialized generation issuance.
- Clear the latest snapshot on target selection, target close, and top-frame navigation, and explicitly reject restricted pages.
- Added `page.snapshot` / `BrowserController.snapshot()` / `browser_snapshot()`.
- On inactive loopback-fixture tab `1976814466`, obtained generations 1 and 2; on another target `1976814469`, generation 3; and after reselecting the first target, generation 4. Real Chrome confirmed active tab `1976814175` never changed.
- Confirmed a content-unavailable error on `about:blank` and cleanup of test tabs. Because external `example.com` became a Chrome error page, E2E was switched to a loopback fixture with no external-network dependency.

## 2026-07-15

### Non-focusing target tab

- Separated the page-operation target from Chrome UI's active tab and stored it as `targetTabId` in `chrome.storage.session`.
- Added `tabs.select` / `browser_tab_select`, allowing only the target to change without foregrounding a tab or window.
- Added `targeted` to `browser_tabs`; aligned `browser_tab_activate` to set the target first and then explicitly foreground it.
- Clear the target when its tab closes and never select another tab implicitly.
- Displayed the target tab in the popup independently of the active tab and clear stale stored values.
- Fixed server command routing, response validation, and tool schemas with automated tests.
- Real Chrome confirmed that inactive tab `1976814296` could be targeted while active tab `1976814175` remained active.
- Foregrounding another test tab `1976814297` left the target at `1976814296`; active and target matched only after explicit activation.
- Closing the target left zero tabs with `targeted: true`; only the two test tabs were removed and the two existing tabs remained.

### Initial architecture and v0.1 vertical slice

- Finalized the Streamable HTTP MCP + loopback WebSocket + Manifest V3 extension architecture.
- Implemented `browser_tabs`, `browser_tab_open`, `browser_tab_close`, and `browser_tab_activate`.
- Implemented a shared token, loopback binding, Host/Origin validation, reconnection, and heartbeat.
- Connected a real Streamable HTTP client and a simulated WebSocket extension, confirming a `browser_tabs` round trip.
- Established the SPEC, architecture, development guide, and remaining-task tracking.

### Remove local shared token

- Documented a threat model that trusts local processes running as the same user.
- Removed the shared token because it was not an effective boundary against compromise by a local process and added configuration burden.
- Retained loopback binding and Host/Origin checks to prevent web pages from attacking localhost.

### Real Chrome v0.1 E2E validation

- The user loaded unpacked extension 0.1.0 and reloaded it after token removal.
- After server startup, the extension reconnected automatically and `/health` reported `extensionConnected: true`.
- Ran `browser_tabs` against the three existing tabs in real Chrome.
- Created `https://example.com` as inactive tab `1976814209`, activated it, and closed only that tab.
- All three existing tabs remained at the end; real E2E for `browser_tabs`, open, activate, and close succeeded.
