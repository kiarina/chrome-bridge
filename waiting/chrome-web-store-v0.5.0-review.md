# Wait for the Chrome Web Store review of 0.5.0

## Waiting for

The Chrome Web Store review of extension 0.5.0 (refs kept within a document; ref input
never lands on another element). Submitted on 2026-10-15 by release workflow
`38654165075` (tag `v0.5.1`) with `DEFAULT_PUBLISH` at 100%
(`submissionState=PENDING_REVIEW`). Approval publishes it automatically.

## How to check

- Read the latest run of the daily `Chrome Web Store status` workflow:
  `gh run list --workflow chrome-web-store-status.yml`, then
  `gh run view <id> --log | grep -E "publishedState|crxVersion|submissionState"`.
  For a fresh reading: `gh workflow run chrome-web-store-status.yml`
- Listing: https://chromewebstore.google.com/detail/chrome-bridge/ogmocgobegbjbecakclahodnhhfmccad

## Check around

2026-10-18

## When it is met

- Set "Published version" in `docs/concepts/chrome-web-store.md` to 0.5.0 and record the
  approval and publication
- Confirm the branded Chrome's Store copy reports 0.5.0 (`extensionVersion` from
  `browser_instances`), record it in `HISTORY.md`, and delete this file
- If rejected, read the reason in the dashboard and open a new task. Never re-upload only
  because a call did not return a response
