# Next task

## P1.10: shared managed-server release validation and publication

Direct API v1, process-wide exclusive sessions, managed idle shutdown, and the
`chrome-bridge-sdk` 0.2.0 package are implemented. The extension protocol and Store
runtime remain 0.1.0; do not create a content-free Store update for this Python-only
release.

- Review and merge draft PR #2 after its green CI. The PR run passed Python 3.11/3.12,
  extension tests/audit, source and artifact-installed isolated Chromium SDK E2E, and
  reproducible five-artifact builds. The Store-extension branded-Chrome SDK smoke also
  passed locally without foregrounding the background fixture or closing existing tabs.
- PyPI pending trusted publishing for `chrome-bridge-sdk` is configured for repository
  `kiarina/chrome-bridge`, workflow `release-pypi.yml`, and GitHub environment `pypi`.
  After PR merge and green `main` CI, publish server/SDK 0.2.0 together by tagging the
  version commit, then verify both PyPI projects and GitHub Release checksums.
- Track an upstream MCP JavaScript SDK release that can adopt `@hono/node-server>=2.0.5`.
  The current advisory is moderate and only affects an E2E development dependency; do
  not force a transitive major override solely to silence it.
- After the first Python-only release is stable, resume the separately tracked first real
  Chrome Web Store update and Public visibility decision from the v0.1 handoff.
