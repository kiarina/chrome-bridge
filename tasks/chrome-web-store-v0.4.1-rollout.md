# Confirm the v0.4.1 Chrome Web Store rollout

## Background

Tag `v0.5.0` (release workflow `35854954896`, 2026-09-23) uploaded extension 0.4.1
through Chrome Web Store API v2: `uploadState=SUCCEEDED`,
`submissionState=PENDING_REVIEW`, `publishType=DEFAULT_PUBLISH`, 100% deployment.
Approval publishes it automatically. 0.4.1 carries the bounded frame capture fix for
Chromium 153 (`apps/extension/CHANGELOG.md`).

## Steps

- [x] Wait for review. Approved: the daily `Chrome Web Store status` run of 2026-09-24
      already reported `publishedState=PUBLISHED` with no pending submission, and the
      public listing showed version 0.4.1 on 2026-09-28
- [ ] Confirm the installed Store copy in
      branded Chrome reports 0.4.1 (the SDK's `browser_instances`, as done for 0.4.0)
- [ ] Update the published version, status, and ZIP checksum
      (`dda6ce2f2e214747388dfce87ec0b1a55813cafba8d0ac8b92ea931ecbea594d`) in
      `docs/concepts/chrome-web-store.md`, record the result in `HISTORY.md`, and delete
      this task

## Handoff

- Never re-upload because a call did not return a response. Establish authoritative
  state with the status workflow first.
- The branded-Chrome check needs no extension toggling when the Store copy is already
  the only enabled Chrome Bridge in its profile; the `browserId` can be tied to the Store
  item through that profile's extension storage.
