# Next task

## Complete the Public migration and activate Store API v2 automation

Server, SDK, and extension 0.3.0 with 23 MCP tools are published. The first real Chrome
Web Store update is also published as Unlisted and passed branded-Chrome background
wait/download smoke with exactly one Store installation connected. The user chose not
to repeat the previously established old-ZIP fallback exercise after this update. A
Public visibility change is now pending review with automatic publication disabled; no
new ZIP or runtime change was submitted.

- Monitor the dashboard and publisher email without resubmitting while version 0.3.0 is
  `審査待ち`. After approval, manually publish the staged Public visibility and confirm
  that the direct listing is publicly discoverable while the installed Store copy still
  connects and reports 0.3.0.
- Google Cloud project `chrome-bridge`, its keyless service account and repository-bound
  Workload Identity provider, and the unprotected `chrome-web-store` GitHub environment
  are configured. `chrome-web-store@chrome-bridge.iam.gserviceaccount.com` is registered
  as the publisher's API service account in the Chrome Web Store dashboard. Manual status
  run `30068205181` passed through the repository-bound WIF path and returned
  `publishedState=PUBLISHED`, `submittedState=STAGED`, with no warning or takedown.
- No API upload may run until Public is manually published once.
- The repository-side API v2 client, fail-closed tests, automatic tag job, and daily
  status workflow are implemented. The tag job uses `DEFAULT_PUBLISH` for fully
  automatic publication after approval and skips Store mutation for Python-only tags.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current advisory is moderate and only affects an E2E
  development dependency; do not force a transitive major override solely to silence it.
