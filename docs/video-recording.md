# Video recording design

## Status and goal

This document is the canonical design and rollout record for target-tab video recording.
The production offscreen/download pipeline and bounded standalone tool are implemented.
Operation-scoped wait, click, hover, type, select, key, and drag recording are also
implemented; upload/history/navigation options and Full HD screenshot output remain
planned. The current 21-tool API includes these recording modes, while screenshot remains
limited to 1024×768 until its production tests and documentation land together.

The goal is to record the target tab while chrome-bridge performs an operation without
foregrounding that tab, then save a WebM file below the Chrome profile's default
Downloads directory. Recording must not weaken the existing guarantees around target
routing, strict refs, debugger cleanup, or operation ordering.

## Public API and planned operation options

`browser_wait`, `browser_click`, `browser_hover`, `browser_type`,
`browser_select_option`, `browser_press_key`, `browser_drag`, and
`browser_upload_file`, `browser_navigate`, `browser_go_back`, and
`browser_go_forward` now accept optional `video_filename: string | null = null`.

Omitting the argument preserves the current behavior and must not add a persistent
debugger attachment or recording overhead. When it is present, recording begins before
the operation, waits until an initial-state frame is submitted, retains it for a 500 ms
pre-roll, continues through operation/post-processing, and includes a 500 ms post-roll
before finalization and download.

Do not initially add the argument to discovery, inspection, screenshot, console, or
tab-management tools. The source and completion boundary are ambiguous for open,
close, select, and activate, and closing a tab can destroy the recording source before
finalization.

The implemented standalone tool has this shape:

```text
browser_record_video(
    filename: string,
    duration: number,
    browser_id: string | null = null,
)
```

It records the current target without performing another page action. Initially limit
`duration` to a range that completes within the server's 15-second command timeout;
0.5–10 seconds is the design target. A separate start/stop pair that spans multiple MCP
calls is deferred because it introduces persistent recording ownership and recovery
state.

Save recordings as WebM under `Downloads/chrome-bridge/`. Treat the public filename as
a safe relative filename: reject absolute paths and parent traversal, and use Chrome's
`uniquify` conflict behavior instead of overwriting an existing file. Audio is out of
scope for the first implementation.

### Success result contract

Omitting `video_filename` preserves each tool's current return value and content type
exactly. Supplying it changes only that invocation's success value to this wrapper:

```json
{
  "operation": "the tool's existing success value",
  "recording": {
    "requestedFilename": "checkout.webm",
    "filename": "chrome-bridge/checkout (1).webm",
    "mimeType": "video/webm",
    "durationMs": 1573,
    "width": 1920,
    "height": 1080,
    "frameCount": 15,
    "droppedFrameCount": 0,
    "sizeBytes": 56920
  }
}
```

`operation` is the exact value that the same invocation would have returned without
recording: currently a snapshot object for most page actions and a completion string for
key and wait. The standalone tool returns the `recording` object directly because it has
no second operation result. When the routed connection has a stable identity, recording
metadata also contains `browserId`, matching the existing multiple-browser convention.

`requestedFilename` is the validated caller input. `filename` is the actual path relative
to the profile's Downloads directory after Chrome applies `uniquify`; it never contains
an absolute local path. `durationMs` is the elapsed recording timeline from capture start
through post-roll, and dimensions are the fixed encoder canvas. `frameCount` counts
submitted frames, `droppedFrameCount` counts scheduled capture opportunities skipped or
failed after recording started, and `sizeBytes` is the encoded Blob size verified before
download. Do not expose Chrome's profile-local download ID.

For the first implementation, `filename` is a basename rather than a nested relative
path. Require a `.webm` suffix, reject empty names, `.`/`..`, `/` and `\\`, control
characters, and names longer than 200 UTF-8 bytes. Do not trim, rewrite, or silently add
an extension. Prefix the validated name with `chrome-bridge/` only after validation.

### Mixed failure contract

Filename, duration, browser, and target validation happen before recording starts and
before the page operation runs. Once recording starts, always attempt finalization and
debugger detach, but preserve operation outcome as the primary fact:

| Outcome | Tool result and recovery |
| --- | --- |
| Recording cannot start | Return `Recording did not start: <detail>. The operation was not run.` as an MCP error; no download was created. |
| Operation and recording succeed | Return the success wrapper above only after Chrome reports the download complete. |
| Operation succeeds, recording finalization or download fails | Return an MCP error beginning `Operation completed, but recording failed:` and ending `Do not retry the operation automatically.` The operation may have side effects; inspect current page state before deciding what to do. |
| Operation fails, recording succeeds | Return the original operation error first, followed by `Recording saved: <relative filename>`. The recording is a diagnostic artifact, never a substitute success. |
| Operation and recording both fail | Return the original operation error first, followed by `Recording also failed: <detail>`. Cleanup failure never replaces the operation error. |
| Target change, tab close, disconnect, timeout, or cancellation after operation entry leaves the outcome unknown | Return `Operation outcome unknown: <detail>`, followed by either `Recording saved: <relative filename>` or `Recording also failed: <detail>`, and end with `Inspect current page state before retrying.` Finalize or discard any partial recording and detach best-effort; never reroute to a replacement target. Target loss before operation entry remains a known not-run failure. |

Errors remain MCP error results with human-readable messages; this milestone does not
introduce stable numeric error codes or a new protocol error envelope. Error details must
not contain absolute download paths. If Chrome creates an interrupted or partial download,
remove only the download created by this command when its identity is known. Never delete
or overwrite a pre-existing file. Standalone recording has no mixed operation outcome:
its failures begin `Recording failed:` and are normally safe to retry after checking the
target.

## Command-scoped debugger session

Do not implement a process-wide debugger lease map or share an attachment across MCP
commands. A recording command owns one command-scoped debugger session:

```text
page-operation queue entry
  attach to the exact target
  start recording
  run the operation with the same debugger session
  finish post-operation processing and post-roll
  finalize the recording
  detach in finally
```

Pass the session explicitly through the page-operation context. Existing helpers may
borrow that session when present and retain their current attach/use/detach behavior
when it is absent. Focus emulation remains scoped to actual trusted input and must not
stay enabled for the duration of a recording.

The existing page-operation queue remains the concurrency boundary. Within one session,
ordinary trusted input has priority over scheduled frame capture. Do not issue overlapping
screenshot captures; if critical debugger work owns the session, skip that scheduled
frame. Recorded drag is the bounded exception: after moving to a milestone, capture at
most four explicit frames through the already-owned debugger session so intermediate
positions appear in the artifact. These captures may extend drag duration and must be
measured; they never reorder input or attach another debugger. Any detach, tab close,
target change, protocol failure, or cancellation must stop capture and execute best-effort
final cleanup without attaching to a different tab or target.

Navigation, back/forward, and file upload are later implementation stages. Navigation
can replace renderer state, while upload combines debugger use with file-chooser
interception. Do not enable recording for them until branded-Chrome and isolated tests
demonstrate that detach, interception, and target identity remain correct.

## Capture and encoding

The initial implementation should prefer repeated `Page.captureScreenshot` calls over
the experimental `Page.startScreencast` path. The existing screenshot implementation
has already demonstrated background-target capture. Send frames to a single MV3
offscreen document, draw them to a canvas, encode video with `MediaRecorder`, and pass
the resulting Blob to `chrome.downloads` from the service worker.

Target approximately 10 frames per second. Preserve ordinary operation latency by dropping
scheduled frames under debugger backpressure, while retaining the bounded drag milestones
defined above. Measure CPU, memory, encoded size, capture latency, and MCP command duration
before fixing the production frame-rate contract.

## Shared screenshot and video dimensions

When the recording feature is implemented, update `browser_screenshot` to the same
orientation-aware Full HD bounds. Both still images and video use the target tab's CSS
visual viewport, preserve its aspect ratio, include the complete viewport, and never
crop, stretch, or upscale it.

- Landscape or square source: fit within 1920×1080.
- Portrait source: fit within 1080×1920.

Equivalent sizing logic is:

```text
landscape_or_square = source_width >= source_height
max_width  = 1920 if landscape_or_square else 1080
max_height = 1080 if landscape_or_square else 1920
scale = min(1, max_width / source_width, max_height / source_height)
output = round(source * scale)
```

Examples:

| Source | Output |
| --- | --- |
| 1920×1080 | 1920×1080 |
| 2560×1440 | 1920×1080 |
| 3440×1440 | 1920×804 |
| 1080×1920 | 1080×1920 |
| 1440×2560 | 1080×1920 |
| 1200×1600 | 1080×1440 |
| 1200×1200 | 1080×1080 |
| 800×600 | 800×600 |

Use one sizing helper for screenshots and video so their contracts cannot drift. A video
encoder uses a fixed canvas selected at recording start. If the viewport changes during
recording, contain the new viewport within that canvas with aspect ratio preserved and
add padding only as needed; do not change encoded dimensions mid-stream.

Full HD PNG responses can be several megabytes and base64 transport adds overhead.
Retain PNG for the screenshot contract, then measure image size, resize time, and MCP
transfer time with complex pages and high-DPI displays before declaring the new limit
implemented.

## Technical probe evidence

On 2026-07-17, an initial isolated two-profile Chromium probe injected test-only
permissions and an internal recorder. The subsequent production implementation added
the public tool, protocol, permissions, encoder, Downloads completion checks, and
strict result validation. Together, the probe and public-tool E2E:

- recorded inactive 1280×720 and 1920×1080 targets for 1.5 seconds without changing
  the active tab;
- captured and encoded 15 JPEG frames per run; the Full HD WebM was 56,920 bytes and
  completed in 1,570 ms;
- measured 21 ms mean and 63 ms maximum Full HD screenshot capture time;
- recorded portrait 1080×1920 as 15 frames and approximately 57 KB with no drops;
- requested real CDP `Input.dispatchMouseEvent` immediately after a Full HD capture
  started; five cold-path samples per orientation waited 18 ms on average, with 27 ms
  landscape and 30 ms portrait maxima, while the input command itself took at most 7 ms;
- dropped no frames in the standalone, uncontended case;
- downloaded the Blob, verified its EBML/WebM header, and deleted only that test file;
- immediately reused the target for a debugger-backed screenshot and continued through
  click, type, drag, upload, screenshot, profile isolation, and restart E2E checks.
- called the public tool for a 1.5-second 1920×1080 target, producing 15 frames and a
  58,204-byte WebM on a 1,503 ms timeline, and for the maximum 10-second 1080×1920
  target, producing 100 frames and a 116,801-byte WebM on a 10,008 ms timeline; neither
  dropped frames nor exceeded the server command timeout;
- rejected an unsafe filename before creating any download and returned stable browser
  provenance without an absolute path or Chrome download ID.

The first cold 1280×720 run had a 289 ms maximum capture; later warm and deliberately
cold contention runs stayed at or below 32 ms queue delay, and Full HD recording runs
stayed at or below 63 ms capture time. Input priority prevents a new capture from
starting after critical work is pending, but a capture already in flight cannot be
cancelled. A later clean-release E2E run under build/validation load observed a 654 ms
maximum already-in-flight capture wait and 144 ms maximum input command, while still
passing the one-second guard and completing both recordings. This does not affect the
standalone tool, whose page-operation queue admits no concurrent input, but it is a gate
for operation-scoped recording. The controlled Chromium evidence supports the
command-scoped design; branded Chrome and heavier pages still require measurement before
the frame-rate contract is fixed. The input probe uses a non-clicking mouse-move command
without focus emulation so that it isolates added queue delay from the existing 250 ms
focus-emulation settle.

## Implementation and validation order

The first three steps are complete: the shared sizing helper has landscape, portrait,
square, unusual-aspect, small, and invalid-input coverage; the debugger session preserves
existing attach/focus/detach semantics, serializes critical work, skips capture under
contention, and avoids a second detach after an external detach; the standalone recorder
succeeds on inactive targets; and the same path is now in the production extension and
public MCP tool.

The first operation-scoped slices are also complete. A maximum ten-second recorded wait
plus 500 ms post-roll produced 106 frames, approximately 110 KB, and a 10,550 ms timeline
without drops or exceeding the server timeout. Omitting the option retained the exact
completion string. An external debugger detach during the wait returned the operation-
completed/recording-failed retry warning, created no download, and allowed an immediate
screenshot reattach.

A recorded click borrows the recorder's command-scoped debugger session instead of
attaching a second debugger. Isolated 1920×1080 E2E captured the cursor movement, trusted
click, updated DOM, post-operation snapshot, and 500 ms post-roll as 17 frames over
1,829 ms. It skipped two capture opportunities while trusted input owned the session,
preserved the inactive target, and continued immediately through type, drag, upload, and
screenshot operations.

After reloading the unpacked extension, branded Chrome recorded the same inactive click
at 1365×817 as 16 frames and 44,451 bytes over 1,873 ms. Three capture opportunities
were skipped during trusted input, the encoded VP9 stream contained 15 distinct decoded
frame hashes, the post-click snapshot contained the fixture update, the original active
tab remained unchanged, and an immediate screenshot successfully reattached.

The same session-borrowing path now covers hover, type, key, and drag; select records
alongside its content-runtime DOM operation without claiming critical debugger time. In
isolated 1920×1080 E2E, hover, type, select, key, and drag produced 16–17 frames over
1,649–2,248 ms and approximately 64–66 KB each. Trusted-input operations deliberately
skipped 3–7 capture opportunities, while select dropped none. Every operation updated
its visible fixture state, preserved the inactive target, removed only its test download,
and continued through upload, screenshot, profile isolation, and reconnect checks.

After extension reload, branded Chrome recorded the five operations at 1365×817 as
16–17 frames, 50,863–53,056 bytes, and 1,665–2,264 ms timelines. Hover, type, key, and
drag skipped 3, 5, 3, and 6 capture opportunities respectively; select again skipped
none. Each VP9/WebM had a valid EBML header and 15–16 distinct decoded frame hashes.
All visible outcomes, the original active tab, and immediate screenshot reuse passed.

That initial branded check validated metadata, final DOM state, and distinct frame hashes,
but not temporal content. Manual playback subsequently showed that the first encoded
non-black frame already contained the final state and that drag had no intermediate
positions; its first two frame timestamps were 0 and 783 ms. Treat the preceding branded
result as a discovered acceptance gap, not evidence of useful operation video.

The corrective implementation waits for the first submitted frame, adds a 500 ms pre-roll,
moves recorded cursor preparation outside the critical debugger interval, and captures at
most four drag milestones. Isolated E2E now produces 21–26 frames over 2,156–2,844 ms;
drag produces at least 24 frames while preserving active-tab, cleanup, mixed-failure, and
immediate reuse checks.

After extension reload, branded Chrome recorded select, key, and drag at 1365×817 as
22, 21, and 25 frames over 2,170, 2,371, and 2,867 ms. Contact sheets built from the
decoded timelines visually confirmed the initial and final fixture states. Drag also
showed the virtual cursor at multiple intermediate positions before `Drop: completed A`;
the original active tab remained unchanged. This closes the temporal-content acceptance
gap.

The short black lead-in came from starting `MediaRecorder` on the black-initialized
offscreen canvas before the first JPEG was decoded and drawn. The encoder is now created
and started only after that first real target frame has been painted. This changes neither
capture scheduling nor the 500 ms pre-roll. The complete isolated E2E remained green, and
a retained 1365×817 probe decoded timestamp 0.000 as the fixture page with no black cells
in its full contact sheet. After extension reload, branded Chrome confirmed the same with
a 1365×817 drag: timestamp 0.000 was the initial page, all 24 submitted frames over
2,766 ms were free of the former lead-in, and the pre-roll, intermediate cursor positions,
final state, post-roll, and unchanged active tab remained visible.

Continue in this order:

1. Complete navigate/back/forward lifecycle failure injection.
   Upload success, rejection, target change, tab close, and external detach now preserve
   chooser cleanup, download isolation, profile routing, and immediate debugger reuse.
   The isolated navigation probe found a stable page target/frame ID, new loader IDs only
   for document loads, no detach events, and successful capture samples with 38–56 ms
   maxima across same-document, cross-document, back, and forward. The actual recorded
   paths now produce correct destination snapshots with 13 frames, 1,231–1,239 ms, and
   zero drops; inject load failure, target change, tab close, and external detach next.
2. Change screenshot dimensions, remaining public tool schemas, Store disclosures,
   release allowlists, and all user-facing documentation in the same implementation
   milestone.

Acceptance requires unit tests, isolated two-profile Chromium E2E, and branded-Chrome
manual measurements on background targets. Recording must never foreground the target,
reroute to another browser or tab, leave a debugger attached, delay trusted input to
maintain frame rate, or overwrite an existing download.
