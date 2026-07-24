# Next task

## Publish and verify v0.4.0

The v0.4.0 release candidate adds browser-native dialog PageState handling, retained
dialog continuation and recovery, and initial-target bootstrap behavior across the
extension, MCP server, and Python SDK. Component changelogs and release documentation
are prepared for 0.4.0.

- Push the version commit to `main`, require CI success, then push tag `v0.4.0`.
- The tag workflow must publish both Python distributions and the GitHub Release before
  using the verified extension ZIP with the Chrome Web Store API v2. The Store job uses
  `DEFAULT_PUBLISH`, fails closed on warnings, and requests automatic 100% publication
  after approval.
- After Store approval, enable only the Store copy in one branded-Chrome profile. Confirm
  the canonical Store extension ID reports 0.4.0, perform one clean navigation to settle
  the pre-marker title migration case, and smoke-test a background dialog response plus
  immediate debugger reuse. Do not enable an unpacked duplicate in the same profile.
- Record the GitHub Actions run, PyPI versions, GitHub Release artifact checksums, Store
  submission/publication state, and branded-Chrome result in `HISTORY.md`. Keep this file
  limited to anything still outstanding afterward.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current moderate advisory affects only an E2E
  development dependency; do not force a transitive major override solely to silence it.
