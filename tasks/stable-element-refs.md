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
3. **"Not clickable"**: find out why the button and the radio above were rejected
   (covered, off screen in a background tab, or the hit test). Reproduce it on that page
   or a fixture.

## Done when

- SPEC, `docs/concepts/architecture.md` and `docs/concepts/api.md` describe the new ref
  lifetime, and the e2e tests cover: refs surviving clicks and typing on a static form;
  stale on navigation and target change; stale when a node is detached or reused for
  other content (role or name changed); no reuse on ambiguous matches (if step 2 is done).
- The diagnosis form can be answered with refs from one snapshot.
- The "not clickable" cause is fixed, or recorded with why it is correct.

## Handoff

- This changes the public ref contract (SPEC "strict refs"). Agree on the design with
  kiarina before implementing, and record the version and changelog impact.
- The SDK and the MCP tool descriptions say "obtain a new snapshot after any element
  operation". Update them with the contract.
