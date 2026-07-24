# Next task

## Deferred follow-ups after the v0.3.0 Store update

Server, SDK, and extension 0.3.0 with 23 MCP tools are published. The first real Chrome
Web Store update is also published as Unlisted and passed branded-Chrome background
wait/download smoke with exactly one Store installation connected. The user chose not
to repeat the previously established old-ZIP fallback exercise after this update.

- After the Unlisted update has remained stable, decide whether to change visibility to
  Public. Recheck the listing, privacy declarations, support readiness, publisher
  Non-Trader declaration, and current Store policies before doing so.
- Decide separately whether final Store publication should remain manual or use the
  Chrome Web Store API v2 staged-publication workflow. Do not combine this decision with
  a runtime release or visibility change.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current advisory is moderate and only affects an E2E
  development dependency; do not force a transitive major override solely to silence it.
