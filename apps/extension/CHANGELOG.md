# Chrome Bridge extension changelog

User-visible changes to the Chrome extension are documented here. The extension is
versioned independently from the Python distributions, so only versions actually
released through the extension ZIP or Chrome Web Store appear below.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.6.0] - 2026-10-15

### Changed

- Keep each tab's element refs when another tab is selected as the target. After
  selecting tab B and then tab A again, A's refs work with no new snapshot, as long as
  A's document did not change. A ref is still rejected while its tab is not the target,
  and after its tab navigated, also while another tab was the target.

## [0.5.0] - 2026-10-15

### Changed

- Keep element refs across snapshots of the same document. An element keeps its ref
  until it leaves the page or its role or accessible name changes, so several
  operations can use refs from one snapshot, and clicks, typing, key presses and waits
  no longer make every ref stale. Refs still become stale on navigation, a target
  change, or a browser-native dialog. The ref prefix is now the document's ref epoch,
  not the snapshot's generation. An element that is hidden for a while (a button shown
  only on hover) keeps its ref.

### Fixed

- Stop clicks, hovers, typing, uploads, downloads and drags from landing on another
  element on pages that scroll smoothly (CSS `scroll-behavior: smooth`). Scrolling the
  element into view no longer animates, and the point is checked to hit the ref right
  before input is sent; a page that moved is measured once more, and otherwise the
  operation fails with nothing sent.

## [0.4.1] - 2026-09-23

### Fixed

- Stop a video recording from stalling when Chrome never answers a screenshot capture
  that was in flight while the page switched documents (seen with Chromium 153's
  RenderDocument). Each frame capture now gives up after 2 seconds and counts as a
  dropped frame instead of blocking every later operation on the tab.

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
