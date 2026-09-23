# Migrate to Ruff 0.16

## Background

Ruff 0.16.4 expands the enabled lint rules for the current configuration and reports 38
diagnostics, including exception-boundary and error-type choices that require review
rather than mechanical formatting. The development constraint is therefore temporarily
`ruff<0.16` (2026-08-27, see `HISTORY.md`).

The validation command set is `docs/runbooks/development.md`.

## Steps

- [x] Review the new diagnostics and decide which rules express this repository's policy
      (2026-09-23; see Status)
- [x] Fix the accepted mechanical diagnostics (29 of 38, 2026-09-23)
- [ ] **Maintainer decision:** BLE001 and TRY004 (below)
- [ ] Apply the decision (inline `noqa` with reasons, config ignore, or code change)
- [ ] Remove the temporary `ruff<0.16` upper bound and refresh the lockfile
- [ ] Run the full Python, extension, isolated Chromium, and release reproducibility gates

## Status

Re-checked on 2026-09-23 against Ruff 0.16.8: still 38 diagnostics. The repository has
no Ruff rule selection, so 0.16's larger default rule set (UP, SIM, RUF, BLE, TRY, I, ...)
is what fires.

Done without a policy decision, compatible with both 0.15 and 0.16:

- `[tool.ruff] src = [".", "packages/mcp/src", "packages/sdk/src"]` in the root
  `pyproject.toml`. Without it, I001 classifies `chrome_bridge_mcp` / `chrome_bridge_sdk`
  as third-party and regroups imports wrongly
- I001 import order (13), UP035 `collections.abc` imports (3), UP037 unquoted annotation
  (1), RUF022 sorted `__all__` (1), SIM117 merged `with` in tests (5), RUF059 unused
  unpacked variable (1)

The 9 remaining diagnostics under 0.16 need the maintainer's decision:

- **BLE001, 5 sites.** `app.py` has four `except Exception` catches in Direct API
  handlers. They feed `_api_error`, which guarantees the
  `{ok:false, error:{...}}` envelope and a 500 `internal_error` for anything
  unrecognised, as `docs/concepts/api.md` requires. Proposal: keep them with an inline
  `# noqa: BLE001` stating that reason. The fifth is `except BaseException` in the SDK's
  `_heartbeat_loop` (`client.py`), which stores any failure and re-raises it as
  `SessionExpiredError(code="session_heartbeat_failed")`. It already lets cancellation
  through, but also swallows `KeyboardInterrupt`/`SystemExit` inside the background
  task. Options: keep with `noqa`, or narrow to `Exception` (slightly changes what SDK
  users see as `session_heartbeat_failed`).
- **TRY004, 4 sites** (`scripts/build_release.py` x2, `scripts/validate_static.py`,
  `packages/mcp/tests/branded_chrome_v03_smoke.py`), none in shipped code. The rule
  wants `TypeError` after an `isinstance` check. The risk is the rule itself: the Direct
  API maps `ValueError` to 400 `invalid_argument` and everything else to 500, so code
  following TRY004 on bad input would silently turn a 400 into a 500. Proposal:
  `[tool.ruff.lint] ignore = ["TRY004"]` with that reasoning as a comment; the narrower
  alternative is per-file ignores for `scripts/*` and the smoke test.

## Handoff

- The decisions here are policy decisions about exception boundaries and error types, not
  formatting. Record the accepted policy where the rule is configured rather than only in
  a commit message.
