# Next task

## Enable Dependabot alerts

The repository's Dependabot alerts API returns `403` because alerts are disabled.
`npm audit` currently reports zero vulnerabilities, but GitHub cannot provide continuous
Python and extension alert coverage until the repository security setting is enabled.

- Enable Dependabot alerts in the GitHub repository security settings after explicit
  approval for the settings change.
- Review any alerts created by the initial dependency-graph scan and add a compatible
  version-update configuration if ongoing pull requests are desired.

## Migrate to Ruff 0.16

Ruff 0.16 expands the enabled lint rules for the current configuration and reports
38 diagnostics, including exception-boundary and error-type choices that require
review rather than mechanical formatting. The development constraint is temporarily
`ruff<0.16`.

- Review the new diagnostics and decide which rules express this repository's policy.
- Fix accepted diagnostics, document narrow ignores for intentional boundaries, then
  remove the temporary upper bound.
- Run the full Python, extension, isolated Chromium, and release reproducibility gates.

## Upgrade Playwright beyond 1.61.1

Playwright 1.62.1 with bundled Chromium 151 failed three of seven isolated E2E tests:
two extension connections timed out, and one recorded navigation completed but failed
to reattach its debugger session. The extension remains pinned to 1.61.1.

- Reproduce each failure with retained E2E artifacts and determine whether Chromium 151
  changed extension startup or debugger-session behavior.
- Update the implementation or test lifecycle without weakening the connection,
  recording, or cleanup assertions.
- Upgrade Playwright and run all seven isolated E2E and release reproducibility checks.

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
