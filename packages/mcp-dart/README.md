# chrome_bridge_mcp (Dart)

The Chrome Bridge server in Dart, for apps that embed it: the extension endpoint
(`/extension`), the Direct API (`/api/v1`), MCP (`/mcp`) and `/health` on loopback, and
the same operations called in process. It has the same contract as the Python server
(`packages/mcp`, `chrome-bridge-mcp`), so the extension, MCP clients and the Python SDK
cannot tell them apart; `/api/v1/meta` says which one answers (`implementation`).

An app that embeds it needs no Python. The person installs only the extension.

```dart
import 'package:chrome_bridge_mcp/chrome_bridge_mcp.dart';

final server = await ChromeBridgeServer.start(); // 127.0.0.1:8765
final snapshot = await server.call('browser_snapshot', {});

// Hold Chrome for a series of operations: other clients wait meanwhile.
final session = await server.session();
try {
  await session.call('browser_click', {'element': 'Save', 'ref': 's3e1'});
} finally {
  session.release();
}
```

`start` throws `PortInUseError` when the port is taken. Its `message` names the Chrome
Bridge server that holds it (Python or Dart, and its version) when one does. Show it to the
person instead of starting elsewhere: the extension connects to the one port in its
settings, so there is one server per Chrome.

Run it on its own (for example for the isolated E2E):

```bash
dart run packages/mcp-dart/bin/chrome_bridge_mcp.dart
```

It reads `CHROME_BRIDGE_HOST`, `CHROME_BRIDGE_PORT` and the timeout variables as the
Python server does, and prints one `{"event": "ready", ...}` line once it listens.

## Keeping it the same as the Python server

- The protocol schemas, the MCP tool list and handshake, and the Direct API tool
  definitions are the Python server's, copied into `lib/src/generated/contract.g.dart` by
  `scripts/export_dart_contract.py`. Do not edit that file; `scripts/validate_static.py`
  fails when it is out of date.
- `scripts/check_server_conformance.py` runs one scenario through both servers with a
  fake extension and requires the same answers.
- The isolated Chromium E2E runs against it with `CHROME_BRIDGE_E2E_SERVER=dart`.
- A behavior change lands in both servers in the same change, with both changelogs. The
  version follows the Python server's.

## Distribution

The package is not on pub.dev (`publish_to: none`). Apps depend on it through git with a
pinned commit:

```yaml
chrome_bridge_mcp:
  git:
    url: https://github.com/kiarina/chrome-bridge.git
    path: packages/mcp-dart
    ref: <commit>
```

Publish it when another app needs it, or when a build cannot fetch from GitHub.

See [Architecture](../../docs/concepts/architecture.md) "Two server implementations".
