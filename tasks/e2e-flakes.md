# Reduce flakes in the isolated Chromium E2E

## Seen on 2026-10-15

- `e2e/multiple-profiles.spec.js`: recorded navigate/go_back sometimes fail with
  `Not attached to an active page` or `Unable to capture screenshot`. Pre-existing: 2 of
  3 runs on the code before the stable-refs change
- The same spec's target-changed upload check (expects "Operation outcome unknown")
  relies on a 750 ms race. After the point check before ref input was added, the target
  change once arrived before the click ("waiting to run", nothing sent)
- `e2e/stable-refs.spec.js`, second test: twice, on the first run right after a build,
  `Chrome extension timed out while running page.click` (15 s). Six consecutive runs then
  passed. Which click is unknown; a failing run now prints the last calls with durations
  (`last calls`)

- The externally detached upload check (`multiple-profiles`, around "Debugger is not
  attached to the target") is the same kind of 750 ms race: once the extension reported
  "Detached while handling command." instead (seen with the Dart server; the message
  comes from the extension, not the server)

## Next

- From `last calls` and the server/worker logs of a failing run, find the timed-out click
  and its cause
- Check whether recording fails when the debugger target is replaced during navigation;
  then either wait in the recorder or expect "operation completed, recording failed"
- Drive the target-change check from a "click sent" signal instead of a fixed delay

## Done when

`npm --prefix apps/extension run test:e2e` passes five runs in a row.
