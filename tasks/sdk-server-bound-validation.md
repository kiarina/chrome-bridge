# Validate that the SDK's server bound admits the released server version

## Background

`chrome-bridge-mcp` and `chrome-bridge-sdk` are released together with identical
versions, and the SDK pins the server to the same minor line:
`chrome-bridge-mcp>=0.4,<0.5` in `packages/sdk/pyproject.toml`.

`scripts/validate_static.py` only checks that the two versions are **equal**. It does not
check that the server version actually satisfies the SDK's own requirement. If a minor
bump sets both packages to 0.5.0 but forgets the bound, every gate still passes (the
workspace resolves the local server), and the published `chrome-bridge-sdk==0.5.0` then
either resolves to an old 0.4.x server or fails to install.

v0.4.1 avoided this only because it was a patch bump (recorded in the agent repository's
`HISTORY.md` for the 2026-09-05 sweep).

## Steps

- [ ] Add a check to `scripts/validate_static.py` that the server `project.version` is
      contained in the SDK's `chrome-bridge-mcp` specifier
- [ ] Unit-test both the passing case and the forgotten-bound case
- [ ] Mention the bound in the version bump section of `docs/runbooks/release.md` and in
      the lockstep entry of `AGENTS.md`
- [ ] Run the validation set in `docs/runbooks/development.md`

## Status

Not started.
