# Next task

## Review initial CodeQL findings

CodeQL default setup is enabled and its initial scan succeeded. It reported two findings
that need source-context review rather than automatic dismissal:

- High: reflected XSS in the isolated E2E harness
  (`apps/extension/e2e/harness.js`). Confirm whether loopback-only fixture inputs make
  the reported flow unreachable from untrusted input, or escape the rendered value.
- Medium: identity replacement in vendored Playwright code
  (`apps/extension/src/vendor/playwright-v1.51.1/stringUtils.ts`). Compare the vendored
  implementation with upstream and either update it or document a precise dismissal.

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
