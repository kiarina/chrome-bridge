# Next task

## P2.1: Operation-recording showcase and README positioning

Make operation-scoped recording a clearly visible product feature by producing a
reproducible, synthetic end-to-end signup demo and presenting it near the top of the
README.

- Add a self-contained demo site to the repository. It should resemble a polished but
  fictional SaaS landing page, include a sufficiently long vertical layout, and lead
  through signup form entry and scrolling to a deterministic completion screen.
- Use only synthetic names, copy, illustrations, and form data. Do not depend on a real
  service, account, analytics endpoint, CDN, or other runtime network resource.
- Keep the demo easy to serve locally and suitable for later publication as the public
  Chrome Web Store reviewer fixture. Make landscape desktop recording the canonical
  showcase while retaining responsive behavior.
- Record the complete journey with chrome-bridge operation tools and ordered filenames,
  covering the landing page, navigation to signup, field entry, scrolling, submission,
  and the completion state. Preserve the individual WebM files as validation artifacts
  outside Git unless a deliberate repository-size decision is made.
- Add a reproducible script or documented command that validates the clips with
  `ffprobe` and concatenates them with `ffmpeg`. Prefer stream-copy when every clip has
  compatible codec, dimensions, and time bases; otherwise produce a single consistently
  encoded presentation file. Keep the native silent WebM output available even if an
  upload-friendly MP4 is also generated.
- Review the joined video for legible text, visible virtual-cursor movement, meaningful
  pre/post-operation context, correct current-scroll-position capture, absence of black
  lead-in frames, and accidental local/private information.
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
- Acceptance: a fresh checkout can serve the demo and reproduce the joined video from
  ordered chrome-bridge recordings; the README explains the feature before the full tool
  inventory; the linked showcase contains no real user, browser, account, or machine
  data.

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
