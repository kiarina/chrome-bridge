# chrome_bridge_mcp (Dart) changelog

User-visible changes to the Dart server are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Its version follows the Python
server's (`chrome-bridge-mcp`).

## [Unreleased]

### Added

- The Chrome Bridge server in Dart for apps that embed it: the extension endpoint, the
  Direct API, MCP and `/health`, with the same contract as `chrome-bridge-mcp` 0.5.1, and
  in-process calls and exclusive sessions. A taken port is reported (`PortInUseError`,
  naming the server that holds it) instead of starting elsewhere.
- An extension answer that arrives after its command timed out (within 120 seconds) is
  logged and ignored; the extension stays connected (as in `chrome-bridge-mcp`).
