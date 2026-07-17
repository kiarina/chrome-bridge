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

- Add one shared orientation-aware sizing helper and cover landscape, portrait, square,
  small, unusual-aspect, and high-DPI inputs. The future screenshot/video bounds are
  1920×1080 for landscape or square and 1080×1920 for portrait, preserving the complete
  viewport without crop, stretch, or upscale.
- Prototype a command-scoped debugger session on the existing page-operation queue. Pass
  it explicitly, retain the current attach/detach path when recording is absent, scope
  focus emulation to input, skip frames under contention, and prove cleanup/reuse after
  every failure path.
- Implement standalone bounded silent-WebM recording on an inactive target, offscreen
  canvas/MediaRecorder encoding, and safe `Downloads/chrome-bridge/` output with
  `uniquify` conflicts.
- Fix recording result metadata and the operation-success/recording-failure error
  contract before changing public schemas.
- Add `video_filename` to non-navigation page actions first. Add upload only after file
  chooser cleanup tests, and navigate/back/forward only after renderer/target lifecycle
  measurements.
- Change `browser_screenshot` from the currently implemented 1024×768 bound to the shared
  Full HD policy in the same milestone as tests and documentation; measure PNG size,
  resize latency, base64/MCP transfer cost, recording CPU/memory, effective frame rate,
  and command duration.
- Update manifest permissions, runtime/release allowlists, privacy and Chrome Web Store
  declarations, protocol schemas, API docs, and isolated/branded-Chrome validation.
