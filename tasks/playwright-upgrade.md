# Upgrade Playwright beyond 1.61.1

## Background

Playwright 1.62.1 with bundled Chromium 151 failed three of seven isolated E2E tests
(2026-08-27, see `HISTORY.md`): two extension connections timed out, and one recorded
navigation completed but failed to reattach its debugger session. The extension remains
pinned to 1.61.1, which passes all seven tests.

Re-measured on 2026-09-05 with Playwright 1.63.0, which bundles Chromium 153 rather than
151: six of the seven tests pass and only
`e2e/multiple-profiles.spec.js:260 routes two isolated Chrome profiles and preserves
identity across restart` fails, on the 180-second test timeout. The two extension
connection timeouts and the recorded-navigation debugger reattach failure seen under
Chromium 151 no longer reproduce. The run reached the recording metrics for initial
target navigate, recorded wait-for, recorded wait, and scrolled recorded wait before
timing out, so the failure is in the later restart-and-reidentify phase rather than in
connection or recording startup.

The harness contract is `docs/concepts/isolated-chrome-e2e.md`; the commands and retained
failure artifacts are described in `docs/runbooks/development.md`.

## Steps

- [ ] Reproduce the restart-identity failure with retained E2E artifacts
- [ ] Determine whether the profile restart, the reconnect backoff, or the stable
      `browserId` restore from `chrome.storage.local` is what exceeds the timeout
- [ ] Update the implementation or the test lifecycle without weakening the connection,
      recording, or cleanup assertions
- [ ] Upgrade Playwright and run all seven isolated E2E and release reproducibility checks

## Status

Still pinned at the verified 1.61.1. Narrowed on 2026-09-05 from three failures under
1.62.1 to one under 1.63.0; the remaining failure is the only thing blocking the upgrade.

## Handoff

- Do not relax the assertions to make the upgrade pass. If Chromium 153 genuinely changed
  extension startup or debugger ownership, that belongs in
  `docs/concepts/isolated-chrome-e2e.md` or `docs/concepts/browser-dialogs.md` as a
  changed platform constraint.
- Reproduce with 1.63.0 rather than 1.62.1; the Chromium 151 failures are gone and
  re-investigating them wastes the time.
- A plain test-timeout extension is not a fix. The test asserts that a reloaded profile
  reconnects with the same `browserId` while the other profile is unaffected, so confirm
  what the restart actually does before touching any timeout.
