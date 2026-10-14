# Keep element refs stable within a document

## Background

Every page action returns a new snapshot with a new generation, and every ref from an
earlier generation is rejected as stale (SPEC "strict refs"; `docs/concepts/architecture.md`
"SnapshotState"). A model therefore has to use the refs of the page the last action
returned, one action at a time.

Observed on 2026-10-15 with an orchestrator that drives the Direct API from its own tools
(one exclusive session, refs passed through as they are). The task was the "ぎふりょく診断"
form on https://gifuquest.blazeworks.jp/diagnosis: a name field, 10 radio questions and a
"診断する" button, and selecting answers does not rebuild the form.

- gpt-5.6-luna (Codex) finished it: 88 tool calls and 7.58M input tokens (7.38M cached)
  at first. It re-read the page after every click although the click had returned it, and
  each snapshot is about 3k tokens. Tool descriptions saying "one action at a time, with a
  ref from the page the last action returned" brought it to 50 calls and 3.49M tokens
- Claude Haiku 4.5 never reached the result in two runs, the second with those
  descriptions too. It clicked several answers at once with refs from one snapshot. The
  first click made the rest stale, so it advanced one question per round
- Both sometimes got `Element for aria-ref is not clickable` for the "診断する" button
  (`button`, at the bottom of the form, background target tab) and for one radio. They
  worked around it with Tab, Space and PageDown
- Stronger models were not slowed down by it: gpt-6.1-sol and Claude Opus 5.5 each
  finished in 23 tool calls without an error (1.07M input tokens, about 2 minutes),
  reading the page once and then using the refs each click returned. Opus reported that
  a first click sometimes landed on the option of the question below, and re-clicked

The content runtime already holds the `Element` objects (`elements: Map<integer, Element>`,
`ids: Map<Element, integer>`). It can tell "the same element" exactly, without guessing
from paths or values, as long as the node survives.

## Plan

1. **Same node, same ref** (do this first)
   - Keep the `Element` → id map for the life of the document instead of rebuilding it
     per snapshot. Only new elements get new ids.
   - Issue a new generation only on target change and top-frame navigation (and
     whatever else replaces the document), not on every snapshot or action.
   - Before an operation, reject the ref as stale when its element is detached
     (`!isConnected`), or when its role or accessible name differs from the ones recorded
     when the id was assigned. This catches a framework reusing a node for other content.
   - Decide what an action returns once refs survive it: the whole snapshot as now, or
     only what changed (smaller results, fewer tokens).
2. **Replaced nodes keep their ref** (decide after 1 is in use)
   - When a framework replaces a node, match the new one to an old id by a fingerprint:
     role, accessible name, the role/name chain up to the root, and index among siblings.
     Leave out values and checked state: they change while the element stays the same.
   - Reuse an id only when exactly one candidate matches. Otherwise assign a new id and
     never guess. Clicking a different element than intended is the failure to avoid.
3. **"Not clickable" and clicks landing below**: find out why the button and the radio
   above were rejected (covered, off screen in a background tab, or the hit test), and
   whether a click on a radio can land on the element below it (a scroll or layout shift
   between taking the point and dispatching the click). A click on another element than
   the ref is the worst failure here. Reproduce both on that page or a fixture.

## Done when

- SPEC, `docs/concepts/architecture.md` and `docs/concepts/api.md` describe the new ref
  lifetime, and the e2e tests cover: refs surviving clicks and typing on a static form;
  stale on navigation and target change; stale when a node is detached or reused for
  other content (role or name changed); no reuse on ambiguous matches (if step 2 is done).
- The diagnosis form can be answered with refs from one snapshot.
- The "not clickable" cause is fixed, or recorded with why it is correct; a click never
  lands on another element than its ref.

## Progress (2026-10-15)

- Step 3 done (`1c674bb`). Cause: the page has `html { scroll-behavior: smooth }`, and
  `scrollIntoView({behavior: "auto"})` follows it, so the point was taken mid-scroll;
  the click then hit whatever had moved there (the option below), or the element was
  still off screen ("not clickable"). Scrolling is now instant, and the point is checked
  to hit the ref right before input is sent (measured once more, otherwise refused with
  nothing sent). The `/form` fixture and `e2e/stable-refs.spec.js` reproduce it: before
  the fix, 10 clicks with fresh refs gave `1,2,-,4,-,-,3,4,-,-` instead of
  `1,2,3,4,1,2,3,4,1,2`, all reported as successful.
- Step 1 done (`aba16d4`): ref epoch per document, ids kept per `Element`, stale when
  detached or role/name changed; refs survive clicks, typing, keys, waits; a new epoch on
  target change, navigation (also back/forward cache) and dialogs. SPEC, api.md,
  architecture.md, the MCP instructions and both changelogs updated. Unit tests 57 pass;
  E2E `stable-refs` 2 pass, `browser-dialogs` and the probes pass.
- Live check on the real diagnosis page in an isolated Chromium: refs from one snapshot
  answered all 10 questions and submitted (16 calls, no error).
- Orchestrator runs (the Spirits Garden prototype pointed at a server with this build):

  | model | before | after |
  | --- | --- | --- |
  | gpt-5.6-luna | 50 calls, 3.49M input, 236,000 | 19 calls, 0.67M input, 236,000, ~90 s |
  | Claude Haiku 4.5 | no result (stale refs from parallel clicks) | 17 calls, 9 requests, ~0.36M input, 186,005, ~65 s |

## Remaining

- Decide with kiarina: step 2 (replaced nodes keep their ref), and whether actions
  return only what changed instead of the whole snapshot.
- Release: the extension changes the public ref contract (minor bump of the extension;
  the server only changed its instructions text). Follow `docs/runbooks/release.md`.
- `e2e/multiple-profiles.spec.js` has pre-existing flakes: recorded navigate/go_back
  sometimes fail with `Not attached to an active page` / `Unable to capture screenshot`
  (2 of 3 runs on the code before this task), and the target-changed upload check
  (around "Operation outcome unknown") depends on a 750 ms race; with the extra point
  check it once saw the target change before the click instead ("waiting to run",
  nothing sent).

## Handoff

- This changes the public ref contract (SPEC "strict refs"). Agree on the design with
  kiarina before implementing, and record the version and changelog impact.
- The SDK and the MCP tool descriptions say "obtain a new snapshot after any element
  operation". Update them with the contract.
