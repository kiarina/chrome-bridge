# Chrome Bridge extension changelog

User-visible changes to the Chrome extension are documented here. The extension is
versioned independently from the Python distributions, so only versions actually
released through the extension ZIP or Chrome Web Store appear below.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-07-25

### Added

- Represent JavaScript dialogs and `beforeunload` prompts as a dominant page state and
  accept or dismiss the exact generation-scoped dialog without foregrounding the tab.
- Retain an interrupted dialog across MCP client disconnects and server restarts, and
  provide fail-safe recovery after debugger detach, service-worker replacement, or
  extension reload without answering the dialog automatically.
- Resume operation-scoped recording and strict-ref download handling after a dialog is
  answered.

### Changed

- Make the first newly opened tab the target when none exists, and let navigation create
  its own inactive target tab instead of requiring a separate list/select round trip.

### Fixed

- Preserve the underlying page title across repeated extension reloads without adding
  duplicate target-state markers or overwriting page-owned title text.

## [0.3.0] - 2026-07-24

### Added

- Wait for normalized accessible text to become visible or hidden on the selected tab.
- Start a download from an exact snapshot reference and report sanitized completion
  metadata using target-scoped Chrome DevTools Protocol events.
- Wake the Manifest V3 service worker with alarms so it reconnects after the optional
  local server becomes available.

### Changed

- Treat normal local-server downtime as a disconnected state instead of an extension
  error while retaining bounded exponential reconnect backoff.

## [0.1.0] - 2026-07-18

### Added

- Connect Manifest V3 Chrome installations to the loopback Chrome Bridge server with a
  stable per-profile browser identity and configurable label and endpoint.
- List, open, close, select, and explicitly activate tabs across Chrome windows while
  keeping ordinary target selection in the background.
- Capture accessibility snapshots with generation-scoped strict references and perform
  click, hover, type, select, key, drag, navigation, history, wait, and local file-upload
  operations against the selected tab.
- Capture viewport screenshots and console entries, and record bounded or
  operation-scoped silent WebM videos under `Downloads/chrome-bridge/`.
- Show connection and target state in the popup, Options page, tab title, and virtual
  cursor without injecting an in-page status badge.

[Unreleased]: https://github.com/kiarina/chrome-bridge/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kiarina/chrome-bridge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kiarina/chrome-bridge/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/kiarina/chrome-bridge/releases/tag/v0.1.0
