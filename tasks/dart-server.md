# Add a Dart implementation of the server for apps that embed it

## Background

Chrome Bridge was built for Spirits Garden. Its body was going to run in Python, so the
server (`packages/mcp`) is Python. The body now runs in Dart (Flutter, macOS and
Windows), and it reaches Chrome through the Direct API of a `chrome-bridge-mcp` that the
machine must have (`uv tool install chrome-bridge-mcp`). That is fine on the owner's
machines but cannot ship: people would have to install Python and uv. A Dart
implementation lets an app hold the server itself; the only thing a person installs is
the extension.

Decided with kiarina on 2026-10-15, after comparing it with shipping the Python server as
a single executable (PyInstaller-style): the main user is now the Dart body, so an
in-process server avoids a child process, a bundled binary, macOS signing of it, and
antivirus false positives on Windows. The Python server stays for MCP clients (Claude
Code and others).

## Scope

- Where: `packages/dart` (a Dart package; name to settle, for example `chrome_bridge`).
  Not `mcp-dart`: the first version has no MCP endpoint.
- First version, what the Spirits Garden body needs:
  - The extension endpoint: WebSocket `/extension` on loopback with the same Host and
    Origin checks as `security.py`, protocol v2 only (the Store extension speaks v2;
    v1 is a legacy slot), the browser registry with stable browser IDs
    (`bridge.py` `BrowserConnection`/`BrowserRegistry`)
  - The operations of `BrowserController` with the same argument validation (refs,
    URLs, upload paths, recording file names) and result checks
  - Coordination: one operation at a time, FIFO, and the exclusive session
    (`coordination.py`)
  - An in-process API for the embedding app, and the Direct API over HTTP
    (`/api/v1/meta`, `tools`, `sessions`, `call`) so other local clients can share it
- Later, if wanted: the MCP Streamable HTTP endpoint
- Port policy for an embedding app: always use the embedded server, one code path. If
  the port is taken, do not start and do not fall back to the other server: say so in the
  app's settings and in every tool error, naming the occupant from its `/api/v1/meta`
  when it answers (for example "port 8765 is used by Chrome Bridge server (Python
  0.5.1); stop it to let this app use Chrome"). Decided with kiarina on 2026-10-15:
  reusing whatever answers would make behavior depend silently on the machine (two code
  paths, and an older server behaves differently). Another port does not help: the
  extension connects only to the one port in its settings, so one server per Chrome
- Out of scope: changing the extension or the protocol

## Keeping the two servers the same

- The protocol schema (`protocol_v2.schema.json`) stays the single source; the Dart
  package reads or generates from it, and `scripts/validate_static.py` checks both
- The isolated Chromium E2E chooses its server (`apps/extension/e2e/harness.js`
  `startServer` runs `packages/mcp/tests/e2e_server.py` today): run the same specs
  against the Python and the Dart server
- Error codes and messages of the Direct API stay identical (`docs/concepts/api.md`
  "Errors"); the Spirits Garden body maps them
- A change to server behavior lands in both, in the same change, with both changelogs

## Done when

- `packages/dart` passes its own tests and the isolated E2E specs that do not need MCP
  (`stable-refs`, `browser-dialogs`, and the Direct API parts of `multiple-profiles`)
  against the Dart server
- The Spirits Garden prototype's body (`prototypes/spirits/app/lib/body/browser.dart`)
  embeds it on Mac and Windows and drives the everyday Chrome with no Python installed,
  and reports a taken port (settings and tool errors) instead of starting
- `docs/` describe the two servers, what each serves, and how to keep them in step;
  `README.md` says which to use

## Handoff

- Read `docs/concepts/architecture.md` (transport, coordination, security) and
  `docs/concepts/multiple-browser-routing.md` (browser identity) first; `bridge.py`
  (~1,000 lines) is the bulk of what moves
- Check the Dart SDK version the Spirits Garden app uses, and that `dart:io`'s
  `HttpServer`/`WebSocketTransformer` cover the Origin check and the WebSocket upgrade
- Decide whether the package is published on pub.dev or used by path/git first
