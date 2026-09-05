# Migrate to Ruff 0.16

## Background

Ruff 0.16.4 expands the enabled lint rules for the current configuration and reports 38
diagnostics, including exception-boundary and error-type choices that require review
rather than mechanical formatting. The development constraint is therefore temporarily
`ruff<0.16` (2026-08-27, see `HISTORY.md`).

The validation command set is `docs/runbooks/development.md`.

## Steps

- [ ] Review the new diagnostics and decide which rules express this repository's policy
- [ ] Fix the accepted diagnostics
- [ ] Document narrow ignores for intentional boundaries
- [ ] Remove the temporary `ruff<0.16` upper bound and refresh the lockfile
- [ ] Run the full Python, extension, isolated Chromium, and release reproducibility gates

## Status

Not started. The pin keeps CI green, so this is not blocking a release.

Re-checked on 2026-09-05 against Ruff 0.16.6: still exactly 38 diagnostics, 24 of them
auto-fixable and one more behind `--unsafe-fixes`. The rule set has not drifted since
0.16.4, so the review below is still the whole job.

## Handoff

- The decisions here are policy decisions about exception boundaries and error types, not
  formatting. Record the accepted policy where the rule is configured rather than only in
  a commit message.
