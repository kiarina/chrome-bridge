# Keep a tab's refs when the target switches away and back

## Background

Since extension 0.5.0, refs last as long as their element within a document. Switching
the target still clears them: `setTargetTabId` clears the stored ref epoch and the new
target's content ref state (`clearContentSnapshotState`), so a client that works across
tabs (select A, act, select B, act, select A again) must take a new snapshot of A every
time it comes back, although A's document did not change. Asked by kiarina on 2026-10-15.

## Plan

- Keep each tab's ref state in its content runtime across target switches; clear it only
  when the document changes (navigation, also the back/forward cache), as now.
- In the background, remember the ref epoch per tab instead of one `latestSnapshot`
  entry, so a ref is checked against its own tab's epoch.
- Keep refusing refs of another tab: a ref of A used while B is the target is stale.
- Elements that changed while their tab was in the background are caught by the existing
  checks (detached, or role/name changed).

## Done when

- E2E: refs of A work after switching to B and back with no new snapshot of A; refs of A
  are refused while B is the target; refs of A are refused after A navigated.
- SPEC, `docs/concepts/api.md` (Strict refs) and `docs/concepts/architecture.md` say so;
  both servers need no change unless the result shape changes
  (`scripts/check_server_conformance.py` still equal).
- Released with an extension minor version (the ref contract changes).

## Progress (2026-10-15)

- Implemented in the extension (unreleased, `CHANGELOG.md` Unreleased): the background
  keeps one `refEpoch:<tabId>` key per tab in `chrome.storage.session`, target selection
  clears nothing, and a tab's epoch is cleared on its dialog, its navigation (also in the
  background, `webNavigation.onCommitted`) and its close. Servers unchanged.
- E2E `stable-refs.spec.js` covers: refused while another tab is the target, working
  again back on the tab with no new snapshot, stale after a background navigation.
  Full E2E passed with the Python and the Dart server (9/9 each); `validate_static.py` passed.
- SPEC, `docs/concepts/api.md`, `docs/concepts/architecture.md` updated.

## Next

- Release as extension 0.6.0 (the ref contract changes; the servers' version follows the
  release runbook) — waiting for kiarina's go, since it publishes to the Store and PyPI.
- After the release, update the agent repository's index line for chrome-bridge
  ("タブを変えた…で古くなる").
