# Next task

## Verify the Public rollout and use Store API v2 for the next update

Server, SDK, and extension 0.3.0 with 23 MCP tools are published. The first real Chrome
Web Store update passed branded-Chrome background
wait/download smoke with exactly one Store installation connected. The user chose not
to repeat the previously established old-ZIP fallback exercise after this update. The
separate Public visibility change was approved and manually published on 2026-07-24;
the dashboard reports `公開済み - 一般公開` for version 0.3.0.

- The unauthenticated direct listing resolves with `Add to Chrome`, the canonical item
  ID, and version 0.3.0. The exact item did not yet appear in a Store web-search check
  immediately after publication; recheck discoverability after the search index catches
  up rather than changing or resubmitting the item.
- The local server was not running during the immediate post-publication check. Start it
  and confirm that the installed Store copy still connects under the same Store extension
  ID and reports 0.3.0; the runtime itself already passed its pre-visibility Store smoke.
- Google Cloud project `chrome-bridge`, its keyless service account and repository-bound
  Workload Identity provider, and the unprotected `chrome-web-store` GitHub environment
  are configured. `chrome-web-store@chrome-bridge.iam.gserviceaccount.com` is registered
  as the publisher's API service account in the Chrome Web Store dashboard. Manual status
  run `30068205181` passed through the repository-bound WIF path and returned
  `publishedState=PUBLISHED`, `submittedState=STAGED`, with no warning or takedown.
- The one-time manual-Public prerequisite for API publication is now satisfied. Do not
  create a content-free upload merely to exercise it; let the next changed extension
  release use the fail-closed status preflight and automated path.
- The repository-side API v2 client, fail-closed tests, automatic tag job, and daily
  status workflow are implemented. The tag job uses `DEFAULT_PUBLISH` for fully
  automatic publication after approval and skips Store mutation for Python-only tags.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current advisory is moderate and only affects an E2E
  development dependency; do not force a transitive major override solely to silence it.
