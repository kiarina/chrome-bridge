# Verify the v0.4.0 Chrome Web Store rollout

## Background

GitHub Release v0.4.0 and both Python distributions are published. Release workflow
`30121554355` uploaded the exact verified extension ZIP through Chrome Web Store API v2
and returned `uploadState=SUCCEEDED`, `submissionState=PENDING_REVIEW`,
`publishType=DEFAULT_PUBLISH`, and a 100% deployment target.

The Store ledger, automation contract, and published-version record are
`docs/concepts/chrome-web-store.md`.

## Steps

- [x] Do not resubmit while review is pending. The configured `DEFAULT_PUBLISH` path
      published automatically after approval, as designed
- [ ] After Store approval, enable only the Store copy in one branded-Chrome profile, and
      confirm the canonical Store extension ID reports 0.4.0
- [ ] Perform one clean navigation to settle the pre-marker title migration case
- [ ] Smoke-test a background dialog response plus immediate debugger reuse
- [ ] Record the final Store publication state and branded-Chrome result in `HISTORY.md`
- [ ] Update the published version, status, and checksum in
      `docs/concepts/chrome-web-store.md`
- [ ] Update the README's Public-version statement

## Status

**Approved and published; the review blocker is gone.** The daily Store status workflow
reported `publishedState=PUBLISHED` with `submittedState=null`, `warned=false`, and
`takenDown=false` (run `33936466830`, 2026-09-05). The release workflow for `v0.4.1`
independently confirmed it: the Store job skipped with
`reason=extension-version-already-published` for version 0.4.0, which the API only
returns when 0.4.0 is on a published distribution channel.

The remaining steps above are the branded-Chrome verification and the record updates.
They need the user's Chrome and have not been done.

## Handoff

- Do not enable an unpacked duplicate in the same profile as the Store copy; both would
  connect as separate browser IDs and make routing ambiguous.
- Never re-upload because a call did not return a response. Establish authoritative state
  with the status workflow first.
