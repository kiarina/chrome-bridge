# Next task

## P1.12: publish and validate the approved v0.3.0 Store update

Server, SDK, and extension 0.3.0 with 23 MCP tools are tagged and published. GitHub
Release and both PyPI projects passed the tag workflow, release checksum verification,
PyPI/GitHub hash comparison, and a no-cache public-index SDK install. The same extension
ZIP passed isolated Chromium and branded-Chrome wait/download smoke. Chrome Web Store
item `ogmocgobegbjbecakclahodnhhfmccad` now has version 0.3.0 pending review as Unlisted,
with automatic publication disabled.

- Monitor the dashboard and publisher email. Do not resubmit while the authoritative
  item status is `審査待ち`, even though the initial submission returned a transient
  error toast after the item had already entered that state.
- After approval, manually publish the staged Unlisted update. Confirm the Store
  extension ID, browser ID, label, endpoint, server settings, background behavior,
  wait/download smoke, and verified old-ZIP fallback after the update.
- Keep Public visibility and Store final-publication automation deferred until the first
  real update is stable.
- Track an upstream MCP JavaScript SDK release that can adopt `@hono/node-server>=2.0.5`.
  The current advisory is moderate and only affects an E2E development dependency; do
  not force a transitive major override solely to silence it.
