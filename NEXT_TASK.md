# Next task

## P2.1: Operation-recording showcase and README positioning

Make operation-scoped recording a clearly visible product feature by producing a
reproducible, synthetic end-to-end signup demo and presenting it near the top of the
README.

Current implementation progress:

- Added the self-contained fictional Kiteframe LP, signup form, and completion
  screen under `examples/recording-demo`, including one locally generated hero
  image and no runtime network dependencies.
- Added a deterministic MCP client script for the 12-clip journey and an
  `ffprobe`/`ffmpeg` validation and concatenation script. A branded-Chrome run
  produced all clips and a reviewed 25.6-second 1366×818 WebM/MP4 presentation;
  generated media remains ignored from Git.
- Before presenting recording as publication-ready, investigate two issues
  observed during early showcase runs: the in-page `Agent operating` badge
  overlapped a top-right site control and caused strict clickability rejection,
  and one recorded `browser_navigate` timed out with the following standalone
  recording also timing out until the controlled fixture tabs were closed. The
  final showcase avoids both paths; do not silently treat that as resolution.

Remaining showcase work:

- Add a concise recording section near the top of `README.md`, a minimal
  `video_filename` example, and a comparison-table row after rechecking the cited tools'
  current public documentation. Describe the differentiator precisely without claiming
  unsupported exclusivity.
- Create a lightweight poster/thumbnail that communicates “before → operation → after.”
  GitHub README does not provide an inline YouTube player, so link the displayed poster
  image to the final YouTube video.
- Treat YouTube publication as a separate approval boundary: first produce and review
  the final local video, title, description, thumbnail, and proposed visibility. Upload
  only after the destination account and public/unlisted choice are confirmed, then add
  the final URL to the README.
- Acceptance: the README explains the feature before the full tool inventory and its
  linked showcase contains no real user, browser, account, or machine data. A fresh
  checkout serving and recording the controlled demo is already verified locally.

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
