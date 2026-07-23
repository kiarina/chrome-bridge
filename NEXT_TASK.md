# Next task

## P1.12: stage and validate the v0.3.0 Chrome Web Store update

Server, SDK, and extension 0.3.0 with 23 MCP tools are tagged and published. GitHub
Release and both PyPI projects passed the tag workflow, release checksum verification,
PyPI/GitHub hash comparison, and a no-cache public-index SDK install. The same extension
ZIP passed isolated Chromium and branded-Chrome wait/download smoke. No Chrome Web Store
0.3.0 upload has been performed yet.

- Upload the verified GitHub Release asset `chrome-bridge-extension-0.3.0.zip` (SHA-256
  `32d79d0d93be55ac5dbb9c50fbcc79e7e5f680347304486e7ecd0ee8da2b0d04`) as the first
  real Unlisted Store update with staged
  publication. Confirm the Store extension ID, browser ID, label, endpoint, server
  settings, background behavior, and verified old-ZIP fallback after the update.
- Keep Public visibility and Store final-publication automation deferred until the first
  real update is stable.
- Track an upstream MCP JavaScript SDK release that can adopt `@hono/node-server>=2.0.5`.
  The current advisory is moderate and only affects an E2E development dependency; do
  not force a transitive major override solely to silence it.
