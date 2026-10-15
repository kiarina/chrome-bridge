/// Chrome Bridge server in Dart, for apps that embed it: the extension
/// endpoint, the Direct API, MCP and `/health` on loopback, and the same
/// operations called in process. The same contract as the Python server
/// (`chrome-bridge-mcp`).
library;

export 'src/errors.dart';
export 'src/server.dart'
    show
        ChromeBridgeServer,
        ChromeBridgeSession,
        ChromeBridgeSettings,
        PortInUseError;
export 'src/version.dart';
