# Decide the Dart server's follow-ups

## Background

The Dart server (`packages/mcp-dart`) landed on 2026-10-15 (`HISTORY.md`). Two choices
were left open.

## To decide

- **A late extension answer.** When the extension answers after the command timed out,
  both servers treat the answer as an unknown response id, a protocol error, and close
  the extension's connection; the extension then reconnects with backoff. Options: keep
  it (strict), or ignore a late answer to a request the server gave up on (keep the
  connection; remember recently timed-out IDs). A change lands in both servers and in
  `scripts/check_server_conformance.py` (its last steps cover it).
- **Distribution of the Dart package.** It is `publish_to: none`; the Spirits Garden
  prototype depends on it through git (`ref` pinned). Options: keep git, or publish to
  pub.dev (name `chrome_bridge_mcp`, versions following the Python server, and a release
  step in `docs/runbooks/release.md`).

## State

Waiting for kiarina's decision.
