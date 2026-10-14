# Decide whether page actions return only what changed

## Background

Click, type and the other page actions return the whole page (the accessibility tree)
after the action. Since 2026-10-15 refs last within a document (`HISTORY.md`), so the
result is rarely needed to pick up new refs, but the whole page still comes back every
time: about 3k tokens per action on the "ぎふりょく診断" form, most of an orchestrator's
input (gpt-5.6-luna: 19 calls, about 0.67M tokens).

## Options and impact

- Keep the whole page / return only the added, removed and changed elements / let the
  caller choose (for example `result: "full" | "changes" | "none"`)
- Returning changes alters the result shape for MCP, the Direct API and the SDK types,
  and for callers that map it (for example the Spirits Garden prototype's `browser/*`)
- With changes only, a model can lose the overall picture (after a dialog or a
  navigation): those would still return the whole page

## State

Waiting for kiarina's decision. Once decided, write the design and tests here.
