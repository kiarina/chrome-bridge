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

## Status

Not started, and not blocked by anything external. The bound `mcp[cli]>=1.27,<2` is
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
