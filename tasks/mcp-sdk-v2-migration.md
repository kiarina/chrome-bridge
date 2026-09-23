# Migrate chrome-bridge-mcp to MCP Python SDK v2

## Background

`packages/mcp` declares `mcp[cli]>=1.27,<2` and resolves to 1.29.1. The MCP Python SDK
released 2.0.0 on 2026-07-28 and is at 2.1.1; upstream states that **1.x is in maintenance
mode and receives security fixes only**. There is no open advisory today, so this is not
urgent, but the 1.x line will stop being a place where fixes land.

Surveyed on 2026-09-05 (see `HISTORY.md`). `mcp.server.fastmcp` does not exist in 2.x at
all: importing it raises `ModuleNotFoundError` with a pointer to the migration guide at
<https://py.sdk.modelcontextprotocol.io/v2/migration/>.

The whole SDK surface this repository uses is four lines of
`packages/mcp/src/chrome_bridge_mcp/app.py`:

- `from mcp.server.fastmcp import FastMCP, Image` (line 12)
- the `FastMCP(...)` construction (line 55)
- `mcp.tool(name=name)` inside the `tool` decorator (line 80)
- `mcp.streamable_http_app()` (line 469)

## What actually changes

The mechanical part is small, and each piece has a confirmed 2.1.1 equivalent:

- `FastMCP` is renamed to `MCPServer`, exported together with `Image` from
  `mcp.server.mcpserver`.
- `MCPServer.tool()` keeps the `name=` keyword, so the coordinated `tool` decorator
  wrapper needs no change.
- `stateless_http`, `json_response`, and `streamable_http_path` are **gone from the
  constructor** and are now keyword arguments of
  `streamable_http_app(streamable_http_path=..., json_response=..., stateless_http=...)`,
  which also gained `max_request_body_size`, `transport_security`, and `host`.

The part that needs a decision is the error contract:

- In 2.1.0 an unexpected exception from a tool handler is logged once at ERROR and the
  client is shown only `Error executing tool <name>` instead of the exception text.
- The MCP tools here raise domain exceptions (`ExtensionUnavailableError`,
  `CoordinatorBusyError`, `ExtensionCommandError`, `DirectArgumentError`, and the stale
  and unknown ref errors) and rely on the message reaching the agent. `docs/concepts/api.md`
  documents that contract, and the tests assert those messages.
- `mcp.server.mcpserver.exceptions.ToolError` is the supported way to keep a message
  visible, so migrating means deciding which of the domain errors are part of the public
  tool contract and mapping exactly those.

Note that `_api_error` in `app.py` serves the `/api/v1/*` REST surface, not the MCP tools,
so the direct API error contract is unaffected either way.

Also check while migrating whether `transport_security` overlaps or conflicts with the
repository's own loopback and Origin middleware in `security.py`; two layers enforcing the
same rule differently would be worse than one.

## Steps

- [ ] Read the migration guide and confirm nothing beyond the four call sites is affected
- [ ] Swap the import and constructor, and move the transport options to
      `streamable_http_app()`
- [ ] Decide which domain exceptions are part of the public MCP tool error contract and
      map them onto `ToolError`, updating `docs/concepts/api.md` and `SPEC.md` to match
- [ ] Check `transport_security` against `security.py` and keep exactly one enforcement point
- [ ] Raise the bound to `mcp[cli]>=2,<3` and refresh `uv.lock`
- [ ] Run the full Python, extension, isolated Chromium E2E, and release reproducibility
      gates in `docs/runbooks/development.md`
- [ ] Re-run a real-Chrome smoke, because the tool error text is what an agent actually sees

## Survey results (2026-09-23)

A trial migration was run in a throwaway worktree (not committed). Findings:

**Mechanical part works.** `uv lock` with `mcp[cli]>=2` resolved mcp 2.2.0 (adds
`mcp-types` and `opentelemetry-api`, drops `httpx-sse` and `pydantic-settings`, none of
which the repository imports). Swapping to `MCPServer`/`Image` from
`mcp.server.mcpserver` and moving the three transport options into
`streamable_http_app(...)` passes ruff and `validate_static.py`. Python tests: 169 passed,
1 failed (`test_app.py::test_mcp_call_cannot_enter_during_direct_session`, which expects
`exclusive session` and now gets `Error executing tool browser_instances`). SDK tests: 8
passed. The isolated E2E was not run, but about 30 `toolText(...).toContain(...)` checks
in `multiple-profiles.spec.js` and `browser-dialogs.spec.js` depend on the message text
and would fail without a mapping.

**Surface beyond the four call sites:**

- `DirectDispatcher(controller, mcp._tool_manager)` (`app.py`) uses private internals
  (`_tool_manager.list_tools()`, `tool.parameters`, `tool.fn_metadata.arg_model`). They
  still work on 2.2.0 but are unsupported API.
- `examples/recording-demo/record_journey.py` uses the removed `streamablehttp_client`
  (now `streamable_http_client`, yielding 2 values) and `isError`/`structuredContent`
  (now `is_error`/`structured_content`).
- Docs name "FastMCP" in `README.md`, `docs/concepts/architecture.md`,
  `docs/concepts/multiple-browser-routing.md`, and
  `docs/playbooks/adding-tools-and-page-operations.md`.
- The bound should become `mcp[cli]>=2.2` with **no** upper bound (preventive upper bounds
  are forbidden by `AGENTS.md`); update the pyproject comment and the AGENTS.md list.

**Error contract.** Raising `ToolError(str(e)) from e` in v2 yields
`Error executing tool X: <msg>`, byte-identical to v1. Exceptions that can escape an MCP
tool handler:

| Class | Example | In api.md? |
| --- | --- | --- |
| `ExtensionUnavailableError` | `No Chrome extension is connected...`, ambiguous browser, disconnected | Yes |
| `ExtensionCommandError` (relayed) | `Stale aria-ref`, `Operation outcome unknown: ...`, `Recording failed: ...` | Yes |
| `ExtensionCommandError` (server-built) | timeout; `requires Chrome Bridge extension 0.4.0 or newer`; invalid response | Timeout only |
| `CoordinatorBusyError` | `Chrome Bridge is held by an exclusive session` | Only as the direct-API `busy` code |
| `ValueError` (~25 argument checks) | `url must use http:// or https://` | Partly |
| `ProtocolValidationError` (ValueError) | `Invalid server message at ...` | No |
| plain `RuntimeError` | `Coordinator closed` (shutdown race) | No |

Session and `Direct*` errors cannot reach MCP tools. Options for the decision:

- (A, proposed) In the `tool` decorator wrapper, map
  `ExtensionUnavailableError, ExtensionCommandError, CoordinatorBusyError, ValueError` to
  `ToolError`; everything else stays a generic crash with a server-side traceback. Keeps
  every api.md row and E2E check identical to v1; api.md then needs a "busy" row and the
  version-gate message becomes contract.
- (B) Map every `Exception`: identical to v1, but internal bug text reaches clients.
- (C) Introduce a common `ChromeBridgeError` base and map only that: cleaner, but touches
  ~25 `ValueError` sites and 16 tests.

**transport_security vs `security.py`.** Both layers are already active on v1 (the SDK
enables its DNS-rebinding check for `/mcp` when the host is loopback); v2 only moves the
option. On `/mcp` the SDK is stricter than `SPEC.md`, measured identically on 1.29.1 and
2.2.0:

| Request | `security.py` | SDK on `/mcp` |
| --- | --- | --- |
| `Origin: chrome-extension://...` | allowed (per SPEC) | 403 |
| `Host: localhost` without port | allowed | 421 |
| `Origin: http://localhost` without port | allowed | 403 |
| `Host: testserver` | allowed | 421 |

Proposal: keep `security.py` as the single enforcement point by passing
`TransportSecuritySettings(enable_dns_rebinding_protection=False)`. **Decision needed:**
that relaxes `/mcp` to SPEC, which means any `chrome-extension://` origin could call MCP
tools; if that is unintended, restrict `chrome-extension://` to `/extension` in
`security.py` and update SPEC instead. Separately, `testserver` (a test-client host) is in
the production allow-list and should probably move to test configuration.

**Protocol revisions.** 2.2.0 negotiates 2024-11-05, 2025-03-26, 2025-06-18, and
2025-11-25 via `initialize` (a 2026-07-28 request negotiates down to 2025-11-25), and also
serves the stateless 2026-07-28 revision without `initialize`. `SPEC.md` should state the
served revisions, preferably tied to the SDK floor.

## Status

Surveyed on 2026-09-23 (above); implementation not started. **Waiting on the maintainer's
decisions:** the error mapping (A/B/C) and whether `/mcp` should accept
`chrome-extension://` origins. Not blocked by anything external. The bound `mcp[cli]>=1.27,<2` is
deliberate until this is done. On 2026-09-05 every other preventive upper bound in the
published distributions was removed; this one and the SDK's lockstep on the server are
the only survivors, and both are listed with their reasons under "依存の version 制約"
in `AGENTS.md`. Keep that list in sync when this migration lands.

## Handoff

- Do not do this as part of a dependency sweep. The error-contract mapping changes what
  MCP clients see and is a public-specification decision, not a version bump.
- The npm `@modelcontextprotocol/sdk` used by the extension is a separate package still on
  1.30.0 with no 2.x release, so it does not need to move with this.
- v2 also serves the 2026-07-28 protocol revision while still serving earlier revisions
  from the same server, so check whether `SPEC.md` should state which revisions are served.
