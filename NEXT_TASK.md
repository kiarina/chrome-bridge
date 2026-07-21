# Next task

## P1.9: first Chrome Web Store update and visibility decision

Chrome Web Store item `ogmocgobegbjbecakclahodnhhfmccad`, version `0.1.0`, was
approved and manually published as Unlisted on 2026-07-21. The Store installation
connected as the only protocol v2 browser, passed inactive snapshot/click smoke tests,
retained its browser ID across disable/re-enable, and successfully switched to and from
the verified unpacked fallback. Keep v0.1.0 Unlisted while preparing the first real
update; do not submit a content-free version solely to test update mechanics.

- When a real extension change is ready, bump the manifest/server/package version above
  `0.1.0`, run the full release and reproducibility gates, and upload the exact verified
  ZIP as a staged Store update.
- Confirm the Store extension ID remains `ogmocgobegbjbecakclahodnhhfmccad` and the
  existing Store browser ID, label, endpoint, and connection survive the update. Repeat
  the inactive open/select/snapshot/click smoke and monitor the one non-reproduced active
  tab change observed in the first aggregate v0.1 Store smoke.
- If the update fails, disable the Store copy before enabling the fixed-directory
  unpacked fallback. Never enable both copies in one profile during ordinary operation.
- Keep the publisher account Non-Trader only while the distribution remains genuinely
  personal, non-commercial open source; change and verify it as Trader if the activity
  becomes related to a trade, business, craft, or profession.
- Decide whether to move from Unlisted to Public only after the first real Store update
  and its rollback boundary have passed.
