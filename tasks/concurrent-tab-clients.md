# Let several clients work in different tabs of one Chrome at once

## Background

Chrome Bridge serves one client at a time per server: page operations act on one
target tab per browser (no `tab_id`), snapshot generations are extension-wide, and the
server runs every operation through one process-wide FIFO, with exclusive sessions for
multi-step work (`docs/concepts/architecture.md` "Shared operation coordination": global
"because target selection and snapshot generations are shared extension state"). This is
a design choice, not a CDP limit: `chrome.debugger` can attach to several tabs at once,
and Claude in Chrome and Codex's Chrome extension give each agent its own tabs and run
them concurrently. Asked by kiarina on 2026-10-15.

Refs became per document in extension 0.5.0, and `tasks/refs-across-target-switches.md`
makes them per tab, which removes one of the shared states.

## Directions to weigh

- A target per client session (each session selects its own tab; operations of different
  sessions run in parallel when their tabs differ), or a `tab_id` on page operations
- The coordinator per tab instead of global; operations that are global by nature
  (downloads, recordings, tab open/close bookkeeping) keep a global lane
- The extension's page-operation queue per tab; focus emulation and input are per
  debugger target already, but the agent UI ("operating" indicator, virtual cursor) and
  the stored `targetTabId`/`operatingTabId` assume one tab
- Compatibility: MCP clients that rely on the shared target today

## Done when

A design agreed with kiarina; then two clients act in two tabs at the same time with E2E
coverage, in both servers (`scripts/check_server_conformance.py`), with SPEC and docs
updated. Only worth it when a real use needs it (for example Spirits Garden's brain and
workers sharing one Chrome through Chrome Bridge).

## State

Waiting for kiarina's decision on whether and when.
