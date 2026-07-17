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

The feature is designed but not implemented. Follow
[`docs/video-recording.md`](docs/video-recording.md) as the canonical contract.

- The orientation-aware sizing helper and command-scoped debugger session are complete.
  An isolated artifact recorded 1280×720 and 1920×1080 inactive targets into verified
  WebM files and immediately reused the debugger; production permissions and public APIs
  remain unchanged.
- Portrait 1080×1920 also encoded 15 frames into an approximately 57 KB WebM without
  drops. In the final five-sample cold contention runs, Full HD capture added 18 ms mean
  input queue delay in both orientations, with 27 ms landscape and 30 ms portrait
  maxima; branded Chrome and heavier pages remain unmeasured.
- Recording result metadata and mixed operation/recording failure semantics are fixed in
  the design. Preserve existing values when recording is omitted; implement the recorded
  `{operation, recording}` wrapper and documented retry warnings without absolute paths.
- Implement the production offscreen canvas/MediaRecorder/download pipeline and bounded
  standalone tool with safe `Downloads/chrome-bridge/` output and `uniquify` conflicts.
- Add `video_filename` to non-navigation page actions first. Add upload only after file
  chooser cleanup tests, and navigate/back/forward only after renderer/target lifecycle
  measurements.
- Change `browser_screenshot` from the currently implemented 1024×768 bound to the shared
  Full HD policy in the same milestone as tests and documentation; measure PNG size,
  resize latency, base64/MCP transfer cost, recording CPU/memory, effective frame rate,
  and command duration.
- Update manifest permissions, runtime/release allowlists, privacy and Chrome Web Store
  declarations, protocol schemas, API docs, and isolated/branded-Chrome validation.
