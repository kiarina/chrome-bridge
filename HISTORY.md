# History

## 2026-07-17

### Kiteframe operation-recording showcase foundation

- Added a self-contained fictional SaaS journey under `examples/recording-demo`: a
  polished long-form LP, vertically scrolling signup form, and deterministic completion
  page. All names, claims, testimonials, and form values are synthetic, and the fixture
  makes no runtime network requests.
- Added a reusable MCP client that opens an inactive controlled tab and records twelve
  ordered clips covering the LP, signup arrival, typing, select controls, PageDown,
  checkbox clicks, and completion. Failed runs close only the tab they created; successful
  runs leave the completed fixture available for review and write actual uniquified
  download names to a temporary manifest.
- Added `ffprobe` validation and `ffmpeg` concatenation with compatible-stream copy or a
  normalized VP9 fallback, plus optional H.264 MP4 generation. Odd 1365×817 source frames
  are reduced by at most one pixel and padded to an encoder-safe 1366×818 canvas without
  stretching or cropping.
- A branded-Chrome run produced and visually reviewed all twelve clips and a 25.6-second
  combined showcase. The virtual cursor, synthetic input, current scrolled viewport,
  intended goal/acknowledgement selections, and final completion screen were present;
  raw and joined media remain ignored from Git.
- Python tests (127), static validation, JavaScript syntax, extension lint, and formatting
  for the new scripts passed. Two early-run observations remain explicitly open in
  `NEXT_TASK.md`: the operating badge can cover a top-right control, and one recorded
  navigation timeout affected the following recording until controlled tabs were closed.

### Fix document-top capture on scrolled pages

- A user report exposed that recording a vertically scrolled page repeatedly jumped to
  the document top and back, while the WebM kept showing top-of-page content instead of
  the viewport containing the virtual cursor.
- Root cause was the shared CDP screenshot request: every frame set
  `captureBeyondViewport: true` with a document-origin `(0, 0)` clip. CDP defines `clip`
  as a specific region and `captureBeyondViewport` as viewport-external capture, so the
  request explicitly selected the document top rather than the current viewport.
- Added one shared current-viewport parameter helper for recording frames, drag
  milestones, screenshot, and the test-only contention probe. It strips any clip and
  forces `captureBeyondViewport: false` while retaining surface capture and format/quality.
- A new isolated regression scrolled to 2800 px, monitored every animation frame and
  scroll event, called normal screenshot, then recorded wait. `min`, `max`, and final
  `scrollY` all remained 2800 with zero events; the PNG center pixel matched the lower
  blue/green fixture rather than the white document top. The WebM contained 16 frames
  over about 1.58 seconds without drops.
- All 44 extension tests and lint passed, and the complete two-profile E2E passed in
  1.2 minutes.
- After extension reload, branded Chrome recorded a click from a controlled page initially
  scrolled to 2800 px. Normal screenshot and all 21 WebM frames showed only the lower
  blue/green viewport; the red document top never appeared. The first frame retained
  `State: before`, the last retained the virtual cursor and `State: after`, and the
  2,371 ms timeline kept both operation margins.
- Click produced one intentional element-centering scroll from 2800 to 2534 px. The page
  observed no oscillation and never approached zero. The original active tab was
  unchanged, immediate screenshot reuse succeeded, and only the controlled tab was
  closed. This completes the branded regression gate.

### Shared Full HD screenshot sizing

- Replaced the screenshot-only 1024×768 constants with the same orientation-aware sizing
  helper used by recording. Landscape/square viewports fit within 1920×1080 and portrait
  viewports within 1080×1920, preserving the full viewport without crop, stretch, or
  upscale; the content canvas still enforces the actual PNG pixel bound for high-DPI
  captures.
- Added E2E PNG signature and IHDR decoding rather than trusting extension metadata. The
  isolated landscape path returned 1920×1080 at 92,259 bytes / 123,012 base64 characters
  in 108 ms, while portrait returned 1080×1920 at 87,221 bytes / 116,296 characters in
  125 ms. The complete two-profile E2E passed in 1.2 minutes.
- All 43 extension tests and lint passed. No public argument, PNG response type,
  permission, runtime file, release allowlist, or retained-data disclosure changed.
- After extension reload, branded Chrome at DPR 2 returned the 1365×817 CSS viewport as
  an exact 1365×817 PNG rather than a 2× physical-pixel image, confirming the canvas
  enforces the no-upscale contract on high-DPI output. A controlled high-entropy page
  produced identical 1,097,472-byte PNGs across five calls in 1,952–2,137 ms, preserved
  the complete frame and bottom-right marker, kept the active tab unchanged, and released
  each debugger session for immediate reuse.
- During three more heavy-page calls, coarse process sampling observed aggregate Chrome
  RSS rise from 1,948,960 to 2,083,760 KiB and server RSS from 110,560 to 114,368 KiB.
  These totals include all existing Chrome processes and are a conservative observation,
  not per-command retained-memory attribution.
- A temporary Chrome-control viewport provided a controlled 1080×1920 portrait tab
  without resizing the user's normal window. chrome-bridge discovered that inactive tab
  and returned three exact 1080×1920 PNGs in 1,329–1,402 ms at about 1.31 MB / 1.74 M
  base64 characters. Visual inspection confirmed the complete frame and bottom-right
  marker, the original active tab remained unchanged, and consecutive calls reused the
  debugger cleanly. The viewport override was reset and the temporary tab was closed.
- Landscape, high-DPI/no-upscale, portrait, full framing, transfer size/duration,
  repeated debugger reuse, and coarse resource observations are now complete. The P2
  recording and shared media-sizing milestone is closed; remaining work is release and
  publication setup.

### Branded upload and navigation timeline acceptance

- Reloaded the unpacked extension and restarted the local server so branded Chrome used
  the current upload/navigation tool signatures. A controlled inactive fixture tab
  recorded upload, navigate, back, and forward without changing the active tab.
- The 1365×817 WebMs produced 23, 12, 11, and 11 frames over 2,570, 1,184, 1,073, and
  1,104 ms. Upload intentionally dropped four scheduled captures while its critical
  input work had priority; all navigation captures completed without drops.
- First/last-frame and full contact-sheet inspection found no black lead-in and confirmed
  `Files: none → README.md`, `/a → /b`, `/b → /a`, and `/a → /b`, including the
  initial-state and final-state margins. The fixture now renders its route so document
  transitions are visually distinguishable.
- The immediate post-recording screenshot succeeded, the original active tab was
  preserved, and the disposable target tab was closed after validation.

### Recorded-navigation lifecycle failure matrix

- Added controlled `/slow-a` and connection-reset `/fail` fixture routes, then injected
  load failure, target change, external debugger detach, and tab close through the actual
  recorded navigation path after first-frame startup and pre-roll.
- `net::ERR_EMPTY_RESPONSE` preserves the navigation error. Depending on whether Chrome
  keeps the error document capturable through finalization, it saves one valid diagnostic
  WebM or reports the secondary capture failure; neither path leaves a partial download.
- Target change during the delayed load returned an unknown outcome plus one valid
  diagnostic WebM, did not reroute, and immediately reused the replacement target.
- External detach let navigation and its destination snapshot complete, returned the
  operation-completed/recording-failed retry warning, created no download, and immediately
  reattached for screenshot.
- Tab close returned an unknown outcome, finalized or discarded only its own diagnostic,
  cleared the dead target, preserved the other profile, and immediately reused the
  original background fixture. The complete two-profile E2E passed in 1.2 minutes.

### First recorded navigation and history operations

- Added optional `video_filename` to navigate, back, and forward across MCP schemas,
  server response validation, extension protocol/handlers, tests, and documentation.
- The operations retain their existing webNavigation commit/history/fragment monitoring
  and post-load snapshot boundary while the common recorded-operation wrapper owns one
  debugger session; navigation itself does not open a second debugger.
- Added a controlled history link to the isolated fixture. Recorded cross-document
  navigate, back, and forward each returned the expected destination snapshot as 13-frame
  recordings over 1,231–1,239 ms with zero dropped captures.
- The original active tab remained unchanged and all later recorded input/upload and
  lifecycle tests continued successfully. All 127 Python and 43 extension tests, static
  validation, and the full 1.0-minute two-profile E2E passed.
- Load failure, target change, tab close, and external detach remain to be injected through
  the actual navigation recording path before branded-Chrome playback acceptance.

### Navigation recording lifecycle measurement

- Added a test-only isolated probe that keeps one command-scoped debugger session open
  while performing same-document `pushState`, cross-document `/a` to `/b`, back, forward,
  and reset navigation on an inactive target.
- Page target ID and top-frame ID remained identical across every transition; same-
  document navigation retained its loader ID, while each cross-document/back/forward
  renderer load produced a new loader ID.
- No debugger detach event occurred. Continuous `Page.captureScreenshot` sampling
  succeeded for every sample with no transient errors: maxima were 38 ms same-document,
  56 ms cross-document, 53 ms back, and 52 ms forward.
- The original active tab remained unchanged, the session closed normally, and the full
  two-profile E2E passed in 56.7 seconds. These measurements support reusing the recorder
  session for navigate/back/forward; load failure and lifecycle injection remain required
  with the actual public recording path.

### Recorded-upload lifecycle cleanup matrix

- Extended isolated E2E to hold file-chooser interception open on a strict non-chooser
  button, then inject target change, tab close, and external debugger detach after the
  first frame and pre-roll.
- Target change produced an unknown outcome plus one valid diagnostic WebM, did not
  reroute the upload, and immediately reused the replacement target for screenshot.
- Tab close produced the unknown-outcome contract, cleared the dead target, finalized or
  discarded only the command's diagnostic, preserved the other profile, and immediately
  attached on a newly selected tab.
- External detach failed immediately on the next CDP cleanup call, reported both the
  primary debugger loss and secondary recording failure, created no partial download,
  and immediately reattached for screenshot.
- Chrome's detach cleared interception automatically; all extension-owned chooser
  listeners, change barriers, Runtime objects, and best-effort interception disable paths
  completed. Lint and the full two-profile E2E passed in 56.6 seconds.

### First recorded file uploads

- Added optional `video_filename` to `browser_upload_file` / `page.uploadFile` across the
  MCP schema, server validation, protocol, extension, tests, and API documentation.
- Recorded upload borrows the command-scoped debugger session for file-chooser
  interception instead of attaching twice. Cursor preparation runs before the critical
  interval, and one bounded click milestone frame is captured through the owned session.
- The existing chooser listener, change barrier, interception disable, Runtime object
  release, and debugger cleanup remain in their original `finally` paths.
- Isolated two-profile E2E recorded a successful upload as 22 frames over 2,372 ms with
  three skipped scheduled captures, then verified a single-file rejection saved one valid
  diagnostic WebM and left subsequent upload/screenshot operations working.
- All 124 Python and 43 extension tests passed; the complete E2E passed in 52.8 seconds.
  Upload-specific target-change, tab-close, and external-detach injection remain next.

### Recorded-operation tab-close outcome contract

- Added an isolated E2E case that closes the target after a recorded wait's first frame
  and pre-roll, while the operation is running.
- The first run exposed that lifecycle loss was reported as an ordinary target-change
  failure even though a general operation could already have side effects.
- Added an explicit internal unknown-outcome marker. A target change before operation
  entry remains a known not-run failure; target replacement or tab loss after entry now
  returns `Operation outcome unknown`, reports whether the diagnostic WebM was saved or
  recording also failed, and requires page-state inspection before retry.
- The tab-close E2E saved one valid diagnostic WebM, cleared the closed target, preserved
  the other Chrome profile, and immediately reused a newly selected tab for screenshot.
  All 43 extension tests, lint, and the 50.5-second two-profile E2E passed.

### Recorded-action target-change isolation

- Added an isolated E2E case that starts a recorded `Escape` key operation and switches
  only that Chrome profile's target during the 500 ms pre-roll.
- The operation failed before dispatching the key, retained `Key: Enter` on the original
  tab, did not reroute input to the replacement target, and saved one valid diagnostic
  WebM under the documented operation-error contract.
- The other Chrome profile retained its own target. An immediate screenshot on the new
  target succeeded, proving command-scoped debugger cleanup, and reselecting the original
  required a fresh snapshot as expected.
- The full isolated two-profile E2E passed in 48.1 seconds. Tab-close interruption remains
  the next lifecycle case.

### Remove the recording black lead-in

- Identified that the offscreen canvas was filled black and its `MediaRecorder` started
  before the first captured Chrome frame was decoded and drawn.
- Deferred creation of the canvas stream and encoder until after the first real target
  frame is drawn. The first encoder-visible canvas state is therefore a page frame while
  the existing initial-state pre-roll remains unchanged.
- All 42 extension tests and static validation passed. The complete isolated two-profile
  E2E also passed in 47.1 seconds, including its operation/standalone recording paths and
  cleanup/failure checks.
- A retained isolated 1365×817 probe decoded its frame at timestamp 0.000 seconds as the
  fixture's initial page state, and its full contact sheet contained no black lead-in.
- After extension reload, branded Chrome recorded a 1365×817 drag as 24 submitted frames
  over 2,766 ms. Its decoded timestamp 0.000 was the initial fixture page, the full
  contact sheet had no black lead-in, and the pre-roll, intermediate cursor positions,
  final state, post-roll, and unchanged active tab all remained visible.

### Correct operation-video temporal semantics

- Manual playback revealed that the initial branded acceptance was inadequate: videos
  contained multiple hashes and correct final state, but the first non-black frame was
  already post-operation and drag showed no intermediate position. The old drag timeline
  jumped from 0 to 783 ms while seven scheduled captures were skipped during input.
- Changed recorder startup to wait for the first submitted frame and added a fixed 500 ms
  operation pre-roll. Recorded cursor preparation now runs outside the critical debugger
  interval so normal scheduled capture can observe its movement.
- Added at most four explicit drag milestone captures through the already-owned debugger
  session. This intentionally adds bounded capture time to drag without reordering input,
  opening another debugger, or weakening cleanup.
- All 123 Python and 42 extension tests passed. Isolated two-profile E2E produced
  21–26 frames over 2,156–2,844 ms, required at least 24 drag frames, and still passed
  mixed-failure, download cleanup, active-tab, immediate screenshot, and reconnect checks.
- After extension reload, branded Chrome produced select/key/drag recordings with
  22/21/25 frames over 2,170/2,371/2,867 ms at 1365×817. Full-frame contact sheets
  visually confirmed the pre-operation state, the final state, and multiple intermediate
  cursor positions during drag; the original active tab remained unchanged.
- The initially observed short black lead-in was addressed in the following encoder-start
  milestone without reducing the captured initial-state interval.

### Recorded hover, type, select, key, and drag actions

- Added optional `video_filename` to hover, type, select, key, and drag across MCP,
  protocol, server validation, and the production extension. Omission preserves each
  original Snapshot or completion string; presence returns `{operation, recording}`.
- Shared one recorded-target wrapper that rechecks target identity after recorder startup.
  Hover, type, key, and drag borrow the recorder's command-scoped debugger session;
  select runs beside capture without claiming critical debugger time.
- Isolated 1920×1080 E2E recorded all five visible fixture outcomes as 16–17 frames,
  about 64–66 KB, and 1,649–2,248 ms timelines. Trusted-input actions skipped 3–7
  capture opportunities while select skipped none, preserving operation priority.
- Each recording validated its completed WebM and removed only that test download. The
  flow then passed upload, screenshot, active-tab preservation, two-profile isolation,
  and extension reconnect checks.
- Branded Chrome recorded the same five actions at 1365×817 as 16–17 frames,
  50,863–53,056 bytes, and 1,665–2,264 ms timelines. Trusted input skipped 3–6 capture
  opportunities while select skipped none; all WebMs had valid EBML headers and 15–16
  distinct frame hashes. Visible outcomes, active-tab preservation, and immediate
  screenshot reuse all passed.

### First recorded trusted-input action: browser_click

- Added optional `video_filename` to `browser_click` and `page.click`. Omission preserves
  the existing Snapshot response and avoids recording setup; presence returns the exact
  post-click Snapshot under `operation` plus completed recording metadata.
- Made click borrow the recorder's command-scoped debugger session, preventing a second
  attach while retaining focus emulation only around trusted input and prioritizing input
  over frame capture.
- Added protocol, MCP schema, filename, response-wrapper, and provenance validation.
  Unsafe filenames are rejected before a command is sent.
- Isolated two-profile E2E recorded an inactive 1920×1080 click as 17 frames and about
  57 KB over 1,829 ms. Two capture opportunities were skipped during input as designed;
  the DOM update, active-tab preservation, download validation, and immediate
  type/drag/upload/screenshot continuation all passed.
- Branded Chrome then recorded an inactive 1365×817 click as 16 frames and 44,451 bytes
  over 1,873 ms, skipping three capture opportunities. The VP9 stream had 15 distinct
  decoded frame hashes, the fixture update appeared in the returned snapshot, the active
  tab remained unchanged, and an immediate screenshot succeeded.

### First operation-scoped recording: browser_wait

- Added optional `video_filename` to `browser_wait`. Omission preserves its exact text
  result and adds no recording work; presence returns `{operation, recording}` with
  stable browser provenance after the WebM download completes.
- Refactored standalone capture into a command-scoped recorder that runs frames alongside
  an operation, shares one debugger session, stops without waiting for the next frame
  interval, and adds a fixed 500 ms post-roll before encoding.
- Implemented the mixed outcome matrix so operation success plus recording failure warns
  against automatic retry, while operation failure always remains primary and reports a
  saved diagnostic recording or secondary recording failure.
- Isolated E2E recorded the ten-second maximum wait plus post-roll as 106 Full HD frames
  and about 110 KB on a 10,550 ms timeline without drops or timeout. External debugger
  detach returned the retry warning, produced no partial download, and allowed immediate
  screenshot reattachment to the same target.

### Production standalone target recording

- Added public `browser_record_video(filename, duration, browser_id)` and
  `page.recordVideo`, with 0.5–10 second bounds, strict `.webm` basename validation, and
  stable multiple-browser provenance.
- Moved offscreen canvas/MediaRecorder encoding and Downloads output into the production
  extension. Each command owns one debugger session and offscreen document, waits for
  completion, revokes its Blob URL, closes the encoder, and removes only its own known
  partial download after failure.
- Return only validated Downloads-relative metadata: requested and actual uniquified
  names, fixed dimensions, elapsed recording time, submitted/dropped frame counts, and
  encoded byte size. Absolute paths and Chrome download IDs remain internal.
- Added production `downloads` and `offscreen` permissions, release allowlist entries,
  privacy/Store disclosures, protocol/MCP schema validation, and filename/result tests.
- Isolated public-tool E2E recorded inactive 1920×1080 for 1.5 seconds as 15 frames and
  about 58 KB, then exercised the 10-second maximum at 1080×1920 as 100 frames and about
  117 KB. Both had no drops, preserved both active tabs, rejected traversal before
  download, remained within the server timeout, and immediately reused the debugger.
- A clean-release run under build/validation load still completed both recordings but
  observed a 654 ms maximum wait behind an already-started Full HD capture. Standalone
  recording serializes other page operations, while future operation-scoped recording
  remains gated on branded/heavy-page latency measurements and capture dropping.

### Video recording result and failure contract

- Fixed the planned recorded-operation success shape as `{operation, recording}` while
  preserving every existing return value and content type when recording is omitted;
  the bounded standalone tool returns recording metadata directly.
- Defined metadata for the requested and actual Downloads-relative uniquified names,
  WebM type, elapsed duration, fixed canvas size, submitted/dropped frames, encoded byte
  size, and stable browser identity when available. Absolute paths and Chrome download
  IDs remain private.
- Fixed the mixed-failure matrix: validate before acting, warn against retry after an
  operation succeeds but saving fails, keep the original operation error primary, and
  report a saved diagnostic recording or cleanup failure only as secondary context.
- Restricted the initial public filename to a validated `.webm` basename below
  `Downloads/chrome-bridge/`; existing files are still protected by Chrome `uniquify`.

### Portrait Full HD and input-contention recording measurements

- Added a portrait 1080×1920 isolated profile and encoded 15 frames into approximately
  57 KB WebM files without drops, matching the landscape Full HD pipeline and preserving
  the profile's original active tab.
- Added a five-sample contention probe per orientation that begins a real Full HD
  `Page.captureScreenshot`, immediately requests `Input.dispatchMouseEvent` on the same
  command-scoped session, and separates capture time, queue delay, and input-command
  duration.
- In the final cold-path run, landscape input queue delay was 18 ms mean and 27 ms
  maximum; portrait was 18 ms mean and 30 ms maximum. The mouse-move command itself took
  at most 7 ms. Two preceding warm runs had at most 32 ms queue delay.
- Kept the probe non-clicking and disabled focus emulation so the measurement isolates
  recording-added serialization delay from the existing 250 ms focus-emulation settle.
  The controlled evidence supports the lease design; branded Chrome and heavier pages
  remain validation boundaries.

### Background target recording technical probe

- Extracted debugger ownership into a command-scoped session used by all existing
  debugger operations. It preserves attach/focus/detach ordering, serializes critical
  work, skips opportunistic capture under contention, observes external detach, and
  never retains an attachment across commands.
- Added a shared orientation-aware Full HD sizing helper with landscape, portrait,
  square, unusual-aspect, small, and invalid-input tests. The public screenshot limit is
  intentionally still 1024×768 until the production media milestone.
- Injected `offscreen`/`downloads` permissions and an internal recorder only into the
  isolated E2E artifact; the production manifest, release artifact, protocol, and MCP
  tools remain unchanged.
- The first cold inactive 1280×720 probe produced 15 frames and a 42,639-byte WebM in
  1,581 ms, with 43 ms mean and 289 ms maximum capture time; a warm repeat measured
  13 ms mean and 31 ms maximum. The final 1920×1080 run produced 15 frames and a
  56,920-byte WebM in 1,570 ms, with 21 ms mean and 63 ms maximum. No frames were skipped.
- Verified each EBML header, deleted only the test download, preserved the active tab,
  immediately reused the debugger for a screenshot, and passed the remaining
  click/type/drag/upload/two-profile/restart E2E flow.

### Target video recording and Full HD media design

- Selected optional `video_filename` on page-action tools plus a bounded standalone
  `browser_record_video` tool, producing silent WebM files below
  `Downloads/chrome-bridge/` without overwriting existing files.
- Chose a command-scoped debugger session explicitly shared by capture and trusted-input
  helpers, not a global or cross-command reference-counted lease. Input has priority and
  recording drops frames under debugger contention.
- Unified the planned screenshot and video size policy: preserve the complete viewport,
  do not crop/stretch/upscale, fit landscape or square content within 1920×1080, and fit
  portrait content within 1080×1920.
- Kept the feature explicitly unimplemented and recorded the staged prototype, lifecycle,
  performance, two-profile isolation, and branded-Chrome validation work in
  `docs/video-recording.md` and `NEXT_TASK.md`.

### Chrome Web Store publication handoff

- Selected Chrome Web Store as the extension distribution channel, with an Unlisted first release and deferred publishing. The Store submission reuses the reproducible release ZIP instead of introducing a separate build.
- Added a Store submission runbook covering developer-account setup, listing copy and image sizes, privacy declarations, permission reasons, reviewer instructions, Store/unpacked migration, review, rollout, rollback, and later API v2 automation.
- Added a public-ready privacy policy describing page data, interactions, screenshots, console messages, upload behavior, local identity/config storage, the user-configured WebSocket endpoint, retention boundaries, and the absence of a developer-operated cloud relay, analytics, advertising, or data sale.

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
