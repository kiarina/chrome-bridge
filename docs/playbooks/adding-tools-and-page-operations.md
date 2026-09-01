# Adding tools and page operations

This playbook covers extending the browser surface: the order in which a new page
operation is built, what its target-tab and snapshot/ref behavior must be validated
against, and the steps that add a tool end to end. Judgment is required at each step, so
read it before designing the change rather than only while implementing it.

The [Development guide](../runbooks/development.md) is canonical for setup and the
validation commands themselves, and [`SPEC.md`](../../SPEC.md) is canonical for the
protocol commands and MCP schemas these steps modify.

## Page-operation implementation order

Add page operations as separately validated vertical slices in this order:

1. `browser_tab_select` and target state
2. Playwright-derived content runtime and `browser_snapshot`
3. Ref resolution, `browser_click`, and post-operation snapshot
4. Hover, type, select, and key
5. Navigate, back, forward, and wait
6. Virtual cursor, screenshot, and console logs
7. drag

When adding Playwright-derived source, preserve the source commit, Apache-2.0 header, and local modifications. When introducing an extension build, provide a lockfile and commands reproducible from a fresh clone, and add validation that required generated files exist in the Load-unpacked directory.

## Target tab validation

Target selection must not take over Chrome UI. In real Chrome, never close existing user tabs; verify in this order:

1. Record the current `active` tab ID with `browser_tabs`.
2. Create a test HTTP(S) tab with `browser_tab_open(active=false)`.
3. With no prior target, confirm the created tab has `targeted: true`. With a prior target, confirm the new tab has `targeted: false` until selected explicitly.
4. Use `browser_tabs` to confirm the original tab still has `active: true` and only the test tab has `targeted: true`.
5. Manually foreground another tab and confirm `targeted` does not change.
6. Run snapshot, click, type, navigate, and screenshot on the background target.
7. Close the target tab and confirm `browser_snapshot` returns target-unavailable.
8. With no target, call `browser_navigate` and confirm it creates and targets a new inactive tab without changing the original active tab.

Never call `browser_tab_activate` automatically after a background operation fails. Return an error that identifies a focus dependency and leave activation/retry to the MCP client.

## Snapshot/ref validation

At minimum, verify the following with automated tests or fixed fixtures:

- Implicit/explicit roles and accessible names
- Checked, disabled, expanded, level, pressed, and selected states
- Input/textarea values and link URLs
- Text normalization, `aria-owns`, slots, open shadow roots, and pseudo content
- YAML and refs matching `^s\d+e\d+$`
- Stale-ref rejection after regenerating a snapshot
- Stale-ref rejection after target change and navigation
- No selector guessing or operation on an Element other than the ref
- Clear errors for restricted pages and missing content runtime
- Rejection of non-editable type refs, non-select refs, and nonexistent option values
- Modifier ordering in key chords and invalidation of the latest snapshot after operation
- Snapshot invalidation before navigation, same-URL reload, no-history errors, and recovery from restricted history destinations
- Wait's 0–10 second bounds, target changes, and background-timer throttling
- Wait-for accessible-text normalization, case sensitivity, observer/poll cleanup, fresh snapshot, and recorded wrapper
- Strict-ref download target filtering, one total 0.1–60 second deadline, outcome-unknown failures, and debugger cleanup
- Same-generation drag start/end, end visibility, old-ref rejection, and mouse-release/debugger cleanup

## Adding a tool

1. Update the protocol command and MCP schema in `SPEC.md`.
2. Add a method with response validation to `BrowserController`.
3. Call the controller from the FastMCP tool in `app.py`.
4. Add the Chrome API implementation to extension `executeCommand`.
5. Test success, extension error, disconnect, timeout, extension-version gating, and any operation-specific response contract.
6. Put the decision pattern in this playbook, fixed procedures in the
   [Development guide](../runbooks/development.md), completed-work records in
   `HISTORY.md`, and only remaining work in `tasks/`.
