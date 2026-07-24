# Browser dialog PageState design and probe

## Status

Browser-native JavaScript dialogs are implemented in the public MCP, Direct API, SDK,
and production extension. The isolated Chromium technical probe completed on
2026-07-24 established the debugger lifecycle constraints; production E2E now covers
alert, confirm, prompt, beforeunload navigation, stale refs, blocked ordinary actions,
and chained dialogs.

This document is canonical for `alert`, `confirm`, `prompt`, and `beforeunload` state,
CDP attachment ownership and synthetic dialog snapshots. Debugger attachment is an
internal implementation detail: no public monitor start/end actions are exposed. DOM `<dialog>` elements remain ordinary document content
and are outside this design.

## Product model

Treat a browser dialog as a dominant page state rather than as an operation error:

```text
PageState = DocumentSnapshot | BrowserDialogSnapshot
```

Opening a browser dialog invalidates the latest document snapshot and every element
ref. While the dialog is open, `browser_snapshot` returns only a synthetic dialog state;
it does not expose the blocked document tree or stale element refs. A dialog response
requires a generation-scoped dialog ref and returns the next fresh `PageState`, which
may be a document, navigation, or another dialog.

Dialog state:

```yaml
pageState: browser-dialog
url: https://example.test/form
title: Edit profile
dialog:
  type: confirm
  message: Save these changes?
  ref: s13d1
  actions:
    - accept
    - dismiss
```

Response action:

```text
browser_dialog_respond(
    dialog_ref="s13d1",
    action="accept",
    prompt_text=null,
    browser_id=null,
)
```

`prompt_text` is valid only when accepting a prompt. For `beforeunload`, the public
state must explain that accept means leave and dismiss means stay; localized Chrome
button labels must not be invented from CDP's generic actions.

## Isolated Chromium evidence

The test-only probe uses the production manifest permissions and a temporary extension
artifact on a random non-8765 port. It never loads or modifies an everyday Chrome
profile. The probe registers `Page.javascriptDialogOpening` and
`Page.javascriptDialogClosed` before triggering a dialog and responds with
`Page.handleJavaScriptDialog`.

Measured results with Playwright 1.61.1 bundled Chromium:

| Scenario | Result |
| --- | --- |
| Trusted CDP click opens `alert` while attached and Page-enabled | Opening event contained type, message, URL, frame ID, default prompt, and browser-handler flag. `Input.dispatchMouseEvent` remained pending. |
| A later worker call accepts the held alert through the same debugger session | Closing event reported `result=true`; the original input command then completed without error. |
| Reload opens `beforeunload` while attached | Opening event reported `type=beforeunload`. The `chrome.tabs.reload` promise itself had already settled, but navigation remained blocked. Dismiss produced `result=false` and retained the current document. |
| Detach while alert and input are pending | No closing event was observed. The original input command failed with `Detached while handling command.` |
| Reattach while that dialog remains open | `chrome.debugger.attach` completed, but `Page.enable` remained pending and no opening event was replayed. |
| Dialog opens while chrome.debugger is detached | Reattach completed, `Page.enable` remained pending, no opening event appeared, and an immediately queued `Page.handleJavaScriptDialog` failed with `No dialog is showing`. |
| Explicit monitor attaches and Page-enables before an asynchronous alert | The monitor survived across worker calls, observed opening/closing, and accepted the dialog from a later call. |
| Monitor remains open for a 35-second idle window before the dialog | Monitor state and listener survived with no detach. This agrees with Chrome 118+'s active-debugger service-worker keepalive contract. |
| Trusted clicks open confirm and prompt inside the same monitor | Both input commands remained pending until a later response. Dismiss returned `confirm=false`; accepting the prompt with `LLM response` returned that exact string to the page. |
| Content-script ping while the dialog is open | Still pending after 500 ms; the same ping completed immediately after dialog response. |
| `Accessibility.getFullAXTree` while the dialog is open | Still pending after 500 ms. It cannot be used as a fallback dialog snapshot path. |
| Background target monitoring | The original active tab remained active through monitor start, three dialogs, responses, and monitor end. |

The probe therefore rejects a detach-and-reattach recovery model. Attaching again is not
enough: the Page domain cannot be enabled while the already-open dialog blocks it, and
CDP offers no independent `getCurrentDialog` query.

## Transparent operation-promoted ownership

For dialogs caused by a chrome-bridge action, attach and enable Page before trusted
input or navigation. If an opening event wins the race with the operation command,
promote that command-scoped debugger session into a dialog-scoped session:

```text
command session
  -> opening event
  -> return synthetic BrowserDialogSnapshot while retaining attachment/pending command
  -> browser_dialog_respond in a later call
  -> closing event and pending command completion
  -> fresh PageState
  -> detach
```

Do not detach between snapshot and response. The measured detach path loses the event
state and fails the pending command.

The LLM never starts or ends debugger monitoring. Every chrome-bridge operation capable
of opening a browser dialog establishes observation before performing trusted input or
navigation. The attachment closes normally when no dialog opens and is promoted
transparently when one does. `browser_snapshot` and `browser_dialog_respond` remain the
only public state/response actions.

Dialogs opened by page timers or user activity wholly between chrome-bridge calls are
not guaranteed in the initial scope. The probe shows that covering them would require a
continuously attached monitor, but exposing its lifecycle would leak transport state
into LMM planning and create avoidable start/end failure modes. Revisit continuous
internal observation only if real usage establishes that between-call dialogs matter.

## Snapshot and routing contract

- The extension stores the observed dialog metadata; it does not ask the blocked
  content runtime for a document snapshot.
- A dialog opening consumes a new extension-wide snapshot generation and invalidates
  all document refs immediately.
- The dialog ref includes browser identity, target tab identity, generation, and a
  per-generation dialog ID. A stale ref can never act on a later dialog.
- While dialog state is current, ordinary page actions fail fast and direct the caller
  to `browser_snapshot` and `browser_dialog_respond`. Tab discovery, explicit activation,
  and close remain separate recovery operations.
- A response waits for the closing event, the suspended input/navigation continuation,
  DOM or navigation completion, and then returns a fresh `PageState`.
- A strict-ref download click uses the same promotion path. After an accepted dialog,
  the original bounded observer finishes and its sanitized metadata is attached to the
  returned document PageState.
- A second dialog opened by the resumed JavaScript becomes the next dialog snapshot; it
  is never accepted using the preceding ref or action.
- Dialog messages are page data. They may appear in explicit tool results but never in
  unauthenticated health, connection listings, or routine logs.

## Disconnect and interruption policy

Client or server disconnect does not answer or detach a live dialog. The extension owns
the retained session and accepts the exact response after reconnection. There is no
elapsed-time lease: expiry by detach would lose dialog metadata and strand a destructive
`beforeunload` or confirm without a safe default action.

The extension mirrors the retained tab ID and synthetic dialog state into a minimal
`chrome.storage.local` recovery marker. Session storage is insufficient because an
extensions-page Reload clears it while the native dialog remains open. If external
detach, worker replacement, or Reload loses the in-memory session,
`browser_dialog_respond` fails explicitly and the marker prevents ordinary page actions
from hanging. `browser_snapshot` probes the content runtime for at most 500 ms. While
the native dialog remains it instructs the user to answer manually or close the target.
After manual response, the extension reinjects an invalidated content runtime when
needed, clears the marker, restores the marked target, and returns a fresh document
snapshot. The recovery attempt remains bounded while the dialog blocks injection.
Browser startup clears any marker because a native dialog cannot survive complete
browser shutdown. Cleanup never silently accepts or dismisses a dialog.

## Branded-Chrome results and remaining failure validation

A developer-mode unpacked build in branded stable Chrome passed alert, confirm dismiss,
prompt text, chained confirm→prompt, accepted beforeunload navigation, repeated dominant
snapshots, blocked ordinary actions, manual confirm cancellation with automatic pending-
click continuation, immediate debugger reuse, and target-close/new-target recovery. Test
tabs were removed after the run. Playwright could not load the unpacked extension in an
automated branded-Chrome process, so this matrix used the normal user-loaded extension.

- Measure manual accept in addition to the verified manual dismiss path.
- Verify accept for `beforeunload`, cross-process navigation, target ID stability, and
  debugger detach ordering.
- Branded Chrome passed DevTools opened during retention and chrome-bridge attachment
  while DevTools was already open; both clients remained usable and no replacement or
  warning occurred. It also passed extensions-page Reload: the dialog remained, a
  snapshot failed fast, and manual accept was followed by content-runtime reinjection,
  marker cleanup, target restoration, and a fresh document snapshot. Browser shutdown
  also cleared the marker and returned to ordinary target-not-selected state after
  restart. With `Continue where you left off` enabled, Chrome restored the fixture under
  a new tab ID but did not restore the native dialog; selecting that tab produced a
  normal generation-1 snapshot with unchanged page state. Isolated production E2E
  covers client loss, complete server restart, external detach, orphaned-session fail-
  fast/manual recovery, and target close.
- An isolated `chrome.runtime.reload()` experiment disconnected the extension but did
  not create a replacement worker even after the native dialog was answered manually.
  Treat this as an automation limitation, not as the result of extensions-page Reload;
  validate the real Reload path in the user-loaded branded-Chrome profile.
- Verify two-profile isolation and that one profile's retained session never blocks the other.
- Verify recorded dialog operations in branded Chrome. The retained recording finalizes
  after response and its metadata is attached to the returned document PageState; no
  screenshot is attempted while dialog state is dominant.

## Reproduction

Run only the isolated technical probe:

```bash
npm --prefix apps/extension run test:e2e -- --grep dialog
```

Implementation files:

- `apps/extension/e2e/dialog-probe/dialog-probe.js`
- `apps/extension/e2e/dialog-probe.spec.js`
- `apps/extension/e2e/harness.js`

The probe is copied only into the temporary E2E artifact. It is not present in
`extension-files.json` and does not ship in the production extension ZIP.
