# Next task

## P1.8: v0.1 publication destinations and release

MIT licensing and the `chrome-bridge-mcp` Python distribution/CLI name are selected and applied. Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete locally and in CI. Chrome Web Store is selected as the extension distribution channel, starting Unlisted with deferred publishing. Finalize the remaining repository and publication setup.

- Decide the Git remote, repository visibility, authority to create tags/releases, and whether to publish the wheel/sdist to a package index.
- Confirm that the `chrome-bridge-mcp` project name can be registered at the selected package index, then configure trusted publishing if needed.
- After selecting publication destinations, implement upload of CI-verified artifacts and a GitHub Release for tag `v0.1.0`.
- Register and verify the Chrome Web Store developer account, then publish `PRIVACY.md`, the product page, and a monitored support destination at stable HTTPS URLs.
- Produce the required Store screenshot and 440×280 promotional image using only controlled fixture data. Complete listing text, privacy declarations, permission justifications, and reviewer instructions from `docs/chrome-web-store.md`.
- Make the server installable to reviewers through PyPI or a public GitHub Release, upload the same verified extension ZIP as Unlisted, and submit with deferred publishing.
- Confirm matching `SHA256SUMS` between the tag build and a local rebuild, notices/licenses in release assets, a fresh install, and a branded-Chrome manual smoke test.
- After Store approval, disable the unpacked copy before testing the Store installation, then verify connection, inactive-tab operation, stable Store ID across update, and rollback before publishing or considering Public visibility.
- Do not publish artifacts to third parties until the remote, visibility, release authority, package-index destination, Store publisher account, and public privacy/support URLs are explicitly configured.

## P2: target-tab video recording and Full HD media sizing

Standalone, wait, and trusted/DOM action recording are implemented; remaining
operation-scoped recording and Full HD screenshots remain. Follow
[`docs/video-recording.md`](docs/video-recording.md) as the canonical contract.

- The orientation-aware sizing helper and command-scoped debugger session are complete.
  The public standalone tool recorded inactive 1920×1080 for 1.5 seconds and 1080×1920
  for the 10-second maximum, producing 15 and 100 frames without drops, staying within
  the 15-second server timeout, and immediately reusing the debugger.
- In the final pre-production five-sample cold contention runs, Full HD capture added
  18 ms mean input queue delay in both orientations, with 27 ms landscape and 30 ms
  portrait maxima. A later clean-release run under validation load observed a 654 ms
  maximum already-in-flight capture wait; branded Chrome and heavier pages remain
  unmeasured, so operation-scoped recording must retain the one-frame-at-a-time drop
  policy and repeat latency measurements.
- Recording result metadata and mixed operation/recording failure semantics are fixed in
  the design and implemented by recorded wait. It preserves the old string when omitted,
  returns `{operation, recording}` when requested, and emits the documented retry warning
  after external debugger detach without creating a partial download.
- The production offscreen canvas/MediaRecorder/download pipeline and bounded standalone
  tool are implemented with safe `Downloads/chrome-bridge/` output, completed-download
  validation, partial-download cleanup, and `uniquify` conflicts. Branded Chrome still
  needs to confirm the actual returned uniquified name and heavier-page measurements.
- Recorded hover, type, select, key, and drag now reuse the same operation wrapper and,
  for trusted input, the recorder's command-scoped debugger session. Isolated runs
  produced 16–17 frames over 1,649–2,248 ms; trusted input skipped 3–7 capture
  opportunities while select skipped none. Branded Chrome produced 16–17 frames over
  1,665–2,264 ms with the same input-priority behavior, unchanged active tab, and
  immediate screenshot reuse. Manual playback then exposed that the first useful frame
  was already post-operation and drag contained no intermediate position; metadata and
  distinct hashes were insufficient acceptance criteria.
- The corrective implementation guarantees the first submitted frame, adds 500 ms
  pre-roll, records cursor preparation outside the critical interval, and takes at most
  four drag milestone frames. Isolated E2E now produces 21–26 frames over
  2,156–2,844 ms and requires at least 24 drag frames.
- Branded Chrome now confirms actual select/key/drag timelines contain state 1 and state
  2, with multiple intermediate cursor positions during drag. It produced 21–25 frames
  over 2,170–2,867 ms at 1365×817 without changing the active tab.
- The encoder now starts only after the first real target frame is drawn. Isolated
  Chromium and branded Chrome both decoded timestamp 0.000 as the fixture page and
  showed no black lead-in. The branded drag retained 24 submitted frames over 2,766 ms,
  both operation margins, intermediate cursor positions, and the unchanged active tab.
- Then verify mixed failure cleanup, external detach, target change/tab close, immediate
  debugger reuse, and two-profile isolation across the newly recorded actions. Add
  upload only after file chooser cleanup tests, and navigate/back/forward only after
  renderer/target lifecycle measurements.
- Change `browser_screenshot` from the currently implemented 1024×768 bound to the shared
  Full HD policy in the same milestone as tests and documentation; measure PNG size,
  resize latency, base64/MCP transfer cost, recording CPU/memory, effective frame rate,
  and command duration.
- Update manifest permissions, runtime/release allowlists, privacy and Chrome Web Store
  declarations, protocol schemas, API docs, and isolated/branded-Chrome validation.
