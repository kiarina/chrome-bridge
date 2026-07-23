# Next task

## P1.12: publish and validate the v0.3.0 runtime update

The source tree prepares server, SDK, and extension 0.3.0 with 23 MCP tools. The new
`browser_wait_for` and strict-ref `browser_download_file` paths pass unit/static and
two-profile isolated Chromium validation, including background operation, exact-target
CDP events, outcome-unknown timeout cleanup, and the maximum 60-second public range.
No tag, GitHub/PyPI publication, or Chrome Web Store upload has been performed yet.

- Run the complete release/reproducibility gates from `docs/release.md` on the final main
  commit, push `v0.3.0`, then verify GitHub/PyPI hashes and a no-cache public-index SDK
  install before any Store upload.
- Validate the same ZIP on branded Chrome 116+ with an immediate and delayed download,
  `timeout=60`, background wait/download, and post-timeout debugger/queue reuse. Stop the
  release if target-scoped Page download events are unavailable; do not add an inferred
  Downloads API fallback.
- Upload that verified ZIP as the first real Unlisted Store update with staged
  publication. Confirm the Store extension ID, browser ID, label, endpoint, server
  settings, background behavior, and verified old-ZIP fallback after the update.
- Keep Public visibility and Store final-publication automation deferred until the first
  real update is stable.
- Track an upstream MCP JavaScript SDK release that can adopt `@hono/node-server>=2.0.5`.
  The current advisory is moderate and only affects an E2E development dependency; do
  not force a transitive major override solely to silence it.
