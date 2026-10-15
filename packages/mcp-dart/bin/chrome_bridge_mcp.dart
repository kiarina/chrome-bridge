import 'dart:convert';
import 'dart:io';

import 'package:chrome_bridge_mcp/chrome_bridge_mcp.dart';

/// Runs the server until SIGINT/SIGTERM. Settings come from the environment
/// as for the Python server (`CHROME_BRIDGE_PORT`...); `CHROME_BRIDGE_E2E_PORT`
/// (0: any free port) overrides the port for the isolated E2E. Prints one
/// `{"event": "ready", ...}` line once it listens.
Future<void> main() async {
  var settings = ChromeBridgeSettings.fromEnvironment();
  final e2ePort = int.tryParse(
    Platform.environment['CHROME_BRIDGE_E2E_PORT'] ?? '',
  );
  if (e2ePort != null) {
    settings = ChromeBridgeSettings(
      host: settings.host,
      port: e2ePort,
      commandTimeout: settings.commandTimeout,
      operationWait: settings.operationWait,
      sessionIdleTtl: settings.sessionIdleTtl,
      sessionMaxLifetime: settings.sessionMaxLifetime,
    );
  }
  final ChromeBridgeServer server;
  try {
    server = await ChromeBridgeServer.start(settings);
  } on PortInUseError catch (e) {
    stderr.writeln(e.message);
    exit(1);
  }
  final base = 'http://127.0.0.1:${server.port}';
  stdout.writeln(
    jsonEncode({
      'event': 'ready',
      'httpUrl': base,
      'mcpUrl': '$base/mcp',
      'extensionUrl': 'ws://127.0.0.1:${server.port}/extension',
    }),
  );
  Future<void> stop(ProcessSignal _) async {
    await server.close();
    exit(0);
  }

  ProcessSignal.sigint.watch().listen(stop);
  if (!Platform.isWindows) ProcessSignal.sigterm.watch().listen(stop);
}
