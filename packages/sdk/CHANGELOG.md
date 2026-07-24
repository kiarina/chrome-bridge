# chrome-bridge-sdk changelog

User-visible changes to the `chrome-bridge-sdk` Python distribution are documented
here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-07-25

### Added

- Add typed browser-dialog page states and `browser_dialog_respond` support for accepting
  or dismissing the exact dialog returned by an operation.
- Model recording and completed-download metadata that can accompany a document state
  after a dialog continuation.

### Changed

- Allow `browser_tab_open` and `browser_navigate` to establish the first target through
  the connected extension, including recorded navigation from an empty target state.

## [0.3.0] - 2026-07-24

### Added

- Add typed `browser_wait_for` support for visible and hidden accessible text.
- Add typed `browser_download_file` results with sanitized download metadata and
  explicit unknown-outcome errors.

## [0.2.0] - 2026-07-22

### Added

- Introduce `chrome-bridge-sdk` with an async exclusive session over Direct API v1.
- Reuse a compatible Chrome Bridge server or start a shared managed server automatically,
  maintaining heartbeats and releasing the session on every context exit.
- Provide immutable typed models and Pythonic high-level methods for browser operations,
  plus raw `call()` and JSON Schema tool definitions for LLM adapters.
- Expose structured errors with retryability and unknown-outcome information, and
  optional session status callbacks for server, extension, and FIFO wait phases.

### Fixed

- Reject same-task nested sessions while allowing other tasks and processes to wait
  through the server-wide FIFO coordinator.

[Unreleased]: https://github.com/kiarina/chrome-bridge/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kiarina/chrome-bridge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kiarina/chrome-bridge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kiarina/chrome-bridge/releases/tag/v0.2.0
