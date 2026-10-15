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

## Decided (2026-10-15, kiarina)

- Solve it first where the model sees results: the Spirits Garden brain shows page
  results as diffs (Dart) or keeps only the latest page (Python, `unique_key`). The
  contract here stays: actions return the whole page.
- Here, later and only if MCP clients that cannot control presentation need it: an
  optional argument on page actions (for example `result: "full" | "changes"`), default
  `full` so nothing changes for existing clients. The content runtime is the accurate
  place to compute it (it knows element identity); both servers would pass it through.

## State

Not now. Revisit when an MCP client user needs smaller results.
