# Next task

## Verify the v0.4.0 Chrome Web Store rollout

GitHub Release v0.4.0 and both Python distributions are published. Release workflow
`30121554355` uploaded the exact verified extension ZIP through Chrome Web Store API v2
and returned `uploadState=SUCCEEDED`, `submissionState=PENDING_REVIEW`,
`publishType=DEFAULT_PUBLISH`, and a 100% deployment target.

- Do not resubmit while review is pending. The configured `DEFAULT_PUBLISH` path should
  publish automatically after approval. Use the daily/manual Store status workflow to
  detect warnings, rejection, takedown, or completion.
- After Store approval, enable only the Store copy in one branded-Chrome profile. Confirm
  the canonical Store extension ID reports 0.4.0, perform one clean navigation to settle
  the pre-marker title migration case, and smoke-test a background dialog response plus
  immediate debugger reuse. Do not enable an unpacked duplicate in the same profile.
- Record the final Store publication state and branded-Chrome result in `HISTORY.md`,
  update the published version/status/checksum in `docs/chrome-web-store.md`, and update
  the README's Public-version statement. Keep this file limited to anything still
  outstanding afterward.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current moderate advisory affects only an E2E
  development dependency; do not force a transitive major override solely to silence it.
