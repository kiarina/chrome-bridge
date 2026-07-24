# chrome-bridge-mcp changelog

User-visible changes to the `chrome-bridge-mcp` Python distribution are documented
here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Add `browser_dialog_respond` and return browser-native dialogs as a page-state variant
  from snapshots and dialog-opening operations.
- Preserve dialog response routing across MCP client disconnects and complete server
  restarts, including continuation of interrupted recording and download results.

### Fixed

- Attach the stable browser identity consistently to recording and download metadata
  returned after a dialog continuation.

## [0.3.0] - 2026-07-24

### Added

- Add `browser_wait_for` for visible or hidden normalized accessible text with a fresh
  snapshot on success.
- Add `browser_download_file` for strict-ref downloads with sanitized completed-download
  metadata and explicit unknown-outcome errors.
- Gate the new operations on a compatible connected extension version.

## [0.2.0] - 2026-07-22

### Added

- Add loopback Direct API v1 with tool discovery, structured calls, and exclusive
  session acquire, heartbeat, and release endpoints.
- Coordinate MCP and Direct API operations through one process-wide FIFO lease so an SDK
  workflow retains its target and snapshot state across calls.
- Add managed-server mode with compatible-server reuse and idle shutdown for the Python
  SDK.

### Fixed

- Release the exact FIFO session granted to a cancelled waiter instead of leaving an
  orphaned lease or affecting another request.

## [0.1.0] - 2026-07-18

### Added

- Provide a loopback-only FastMCP Streamable HTTP server and WebSocket bridge for the
  Chrome Bridge extension.
- Expose tab management, accessibility snapshots, strict-ref page operations, local file
  upload, screenshots, console logs, and target video recording as MCP tools.
- Route simultaneous Chrome profiles by stable browser ID without implicit fallback or
  foreground tab takeover.
- Validate protocol envelopes and commands against canonical JSON Schemas, with bounded
  command timeouts and fail-closed Host and Origin checks.

[Unreleased]: https://github.com/kiarina/chrome-bridge/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kiarina/chrome-bridge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiarina/chrome-bridge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kiarina/chrome-bridge/releases/tag/v0.1.0
