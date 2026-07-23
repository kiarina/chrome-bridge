# Next task

## P1.11: v0.2 release follow-up and next extension update

Direct API v1, process-wide exclusive sessions, managed idle shutdown, and the
`chrome-bridge-sdk` 0.2.0 package are published. The extension protocol and Store runtime
remain 0.1.0; no content-free Store update was created for this Python-only release.

- `v0.2.0` is published on GitHub and PyPI. All GitHub assets passed `SHA256SUMS`, both
  PyPI projects matched the GitHub wheel/sdist hashes, and a no-cache public-index SDK
  install pulled server/SDK 0.2.0 successfully.
- Track an upstream MCP JavaScript SDK release that can adopt `@hono/node-server>=2.0.5`.
  The current advisory is moderate and only affects an E2E development dependency; do
  not force a transitive major override solely to silence it.
- After the Python-only release remains stable, resume the separately tracked first real
  Chrome Web Store runtime update and Public visibility decision from the v0.1 handoff.
