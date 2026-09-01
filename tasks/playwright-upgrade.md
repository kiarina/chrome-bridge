# Upgrade Playwright beyond 1.61.1

## Background

Playwright 1.62.1 with bundled Chromium 151 failed three of seven isolated E2E tests
(2026-08-27, see `HISTORY.md`): two extension connections timed out, and one recorded
navigation completed but failed to reattach its debugger session. The extension remains
pinned to 1.61.1, which passes all seven tests.

The harness contract is `docs/concepts/isolated-chrome-e2e.md`; the commands and retained
failure artifacts are described in `docs/runbooks/development.md`.

## Steps

- [ ] Reproduce each failure with retained E2E artifacts
- [ ] Determine whether Chromium 151 changed extension startup or debugger-session behavior
- [ ] Update the implementation or the test lifecycle without weakening the connection,
      recording, or cleanup assertions
- [ ] Upgrade Playwright and run all seven isolated E2E and release reproducibility checks

## Status

Not started. Pinned at the verified 1.61.1.

## Handoff

- Do not relax the assertions to make the upgrade pass. If Chromium 151 genuinely changed
  extension startup or debugger ownership, that belongs in
  `docs/concepts/isolated-chrome-e2e.md` or `docs/concepts/browser-dialogs.md` as a
  changed platform constraint.
