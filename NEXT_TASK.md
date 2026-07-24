# Next task

## Publish the approved Public visibility and automate later Store updates

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
- After the first manual Public publication, implement Chrome Web Store API v2 upload,
  submission, and status polling for later verified release ZIPs. Start with
  `STAGED_PUBLISH` and a protected manual approval for the final publication action;
  consider `DEFAULT_PUBLISH` only after multiple automated updates are stable.
- Track an upstream MCP JavaScript SDK release that can adopt
  `@hono/node-server>=2.0.5`. The current advisory is moderate and only affects an E2E
  development dependency; do not force a transitive major override solely to silence it.
