# Next task

## P1.10: shared managed-server release validation and publication

Direct API v1, process-wide exclusive sessions, managed idle shutdown, and the
`chrome-bridge-sdk` 0.2.0 package are implemented. The extension protocol and Store
runtime remain 0.1.0; do not create a content-free Store update for this Python-only
release.

- Confirm GitHub Actions passes the SDK suite and artifact-based isolated Chromium SDK
  probe on Python 3.11/3.12, then perform a branded-Chrome SDK smoke using the Store
  extension. Local validation already covers two independent SDK processes, MCP/SDK
  contention, managed idle exit, two real isolated Chromium profiles, clean install, and
  reproducible five-artifact builds on Python 3.12.
- PyPI pending trusted publishing for `chrome-bridge-sdk` is configured for repository
  `kiarina/chrome-bridge`, workflow `release-pypi.yml`, and GitHub environment `pypi`.
  After review and CI, publish server/SDK 0.2.0 together by tagging the version commit.
- After the first Python-only release is stable, resume the separately tracked first real
  Chrome Web Store update and Public visibility decision from the v0.1 handoff.
