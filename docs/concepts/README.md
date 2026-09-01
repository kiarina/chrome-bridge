# concepts

Design decisions, public contracts, investigation results, and the fixed values this
project keeps referring back to. These documents answer "how does it work" and "why is
it this way".

Fixed procedures live in `../runbooks/`; work patterns that require judgment live in
`../playbooks/`. The normative protocol and tool specification is the root `SPEC.md`.

| File | Contents |
|---|---|
| [architecture.md](architecture.md) | Component boundaries, transport, shared operation coordination, connection ownership, page-operation design, security decisions |
| [api.md](api.md) | User-facing MCP tool reference: arguments, results, routing conventions, target/ref lifecycle, errors, workflows |
| [multiple-browser-routing.md](multiple-browser-routing.md) | Stable browser identity, protocol v1/v2 migration, public schema, connection state machine, routing test matrix |
| [browser-dialogs.md](browser-dialogs.md) | Browser dialogs as a dominant page state, debugger ownership, snapshot/routing contract, validation results |
| [video-recording.md](video-recording.md) | Target-tab recording API, command-scoped debugger session, capture/encoding, shared screenshot and video dimensions |
| [isolated-chrome-e2e.md](isolated-chrome-e2e.md) | Isolated Chromium E2E harness contract: topology, lifecycle, minimum coverage, failure artifacts, CI/manual boundary |
| [chrome-web-store.md](chrome-web-store.md) | Store publication ledger, listing text, listing assets, privacy declarations, permission justifications, reviewer instructions, update automation |
