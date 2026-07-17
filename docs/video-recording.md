# Video recording design

## Status and goal

This document is the canonical design for planned target-tab video recording. The
public feature and API described here are not implemented yet. A command-scoped
debugger-session abstraction, orientation-aware sizing helper, and isolated recording
probe are implemented as groundwork. The existing 20-tool API and the current 1024×768
screenshot limit remain in effect until the production implementation, protocol, tests,
permissions, and user documentation land together.

The goal is to record the target tab while chrome-bridge performs an operation without
foregrounding that tab, then save a WebM file below the Chrome profile's default
Downloads directory. Recording must not weaken the existing guarantees around target
routing, strict refs, debugger cleanup, or operation ordering.

## Planned public API

Add optional `video_filename: string | null = null` to these page-operation tools:

- `browser_click`
- `browser_hover`
- `browser_type`
- `browser_upload_file`
- `browser_select_option`
- `browser_press_key`
- `browser_navigate`
- `browser_go_back`
- `browser_go_forward`
- `browser_wait`
- `browser_drag`

Omitting the argument preserves the current behavior and must not add a persistent
debugger attachment or recording overhead. When it is present, recording begins before
the operation, continues through its post-operation processing, and includes a short
post-roll before finalization and download.

Do not initially add the argument to discovery, inspection, screenshot, console, or
tab-management tools. The source and completion boundary are ambiguous for open,
close, select, and activate, and closing a tab can destroy the recording source before
finalization.

Add a standalone tool with the following planned shape:

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

The exact recording metadata added to tool results and the error contract for “page
operation succeeded but encoding or download failed” must be fixed before the public
schema is implemented. Do not silently report full success when the requested recording
was not saved, and do not lose the original page-operation error during recording
cleanup.

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
trusted input has priority over frame capture. Do not issue overlapping screenshot
captures; if input or another critical debugger command owns the session, skip that
video frame instead of delaying the operation. The encoder may hold the last frame to
fill timing gaps. Any detach, tab close, target change, protocol failure, or cancellation
must stop capture and execute best-effort final cleanup without attaching to a different
tab or target.

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

Target approximately 10 frames per second, but preserve operation latency by dropping
capture frames under debugger backpressure. Measure CPU, memory, encoded size, capture
latency, and MCP command duration before fixing the production frame-rate contract.

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

On 2026-07-17, the isolated two-profile Chromium E2E artifact injected test-only
`offscreen` and `downloads` permissions plus an internal recorder. The production
manifest and public protocol remained unchanged. The probe:

- recorded inactive 1280×720 and 1920×1080 targets for 1.5 seconds without changing
  the active tab;
- captured and encoded 15 JPEG frames per run; the Full HD WebM was 56,920 bytes and
  completed in 1,570 ms;
- measured 21 ms mean and 63 ms maximum Full HD screenshot capture time;
- dropped no frames in the standalone, uncontended case;
- downloaded the Blob, verified its EBML/WebM header, and deleted only that test file;
- immediately reused the target for a debugger-backed screenshot and continued through
  click, type, drag, upload, screenshot, profile isolation, and restart E2E checks.

The first cold 1280×720 run had a 289 ms maximum capture; a repeated warm run measured
13 ms mean and 31 ms maximum, while the Full HD run measured 21 ms mean and 63 ms
maximum. Input priority prevents a new capture from starting after critical work is
pending, but a capture that is already in flight cannot be cancelled. Measure the delay
seen by real input and portrait Full HD before fixing frame rate and pre-roll behavior.

## Implementation and validation order

The first two steps are complete: the shared sizing helper has landscape, portrait,
square, unusual-aspect, small, and invalid-input coverage; the debugger session preserves
existing attach/focus/detach semantics, serializes critical work, skips capture under
contention, and avoids a second detach after an external detach; and the isolated
standalone recorder probe succeeds on an inactive target.

Continue in this order:

1. Measure portrait Full HD capture and actual input-delay behavior.
2. Fix public result metadata and mixed operation/recording failure semantics.
3. Add the production offscreen/download pipeline and bounded standalone tool.
4. Add non-navigation operations such as click, hover, type, select, key, drag, and wait.
5. Verify failure cleanup, frame backpressure, extension reload, tab close, target
   change, two-profile isolation, and immediate debugger reuse.
6. Add upload recording after file-chooser cleanup is proven unchanged.
7. Add navigate/back/forward only after renderer and target lifecycle measurements.
8. Change screenshot dimensions, public tool schemas, permissions, Store disclosures,
   release allowlists, and all user-facing documentation in the same implementation
   milestone.

Acceptance requires unit tests, isolated two-profile Chromium E2E, and branded-Chrome
manual measurements on background targets. Recording must never foreground the target,
reroute to another browser or tab, leave a debugger attached, delay trusted input to
maintain frame rate, or overwrite an existing download.
