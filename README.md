# chrome-bridge

chrome-bridge is a Chrome extension and HTTP MCP server that lets LLM agents operate every tab in the Chrome browser you use every day.

It operates your existing Chrome through accessibility snapshots, strict element references, and a virtual cursor, with the following principles:

- Do not select one tab at connection time; make every tab in every window available for operation.
- Provide tab listing, creation, closing, and selection as MCP tools.
- Use Streamable HTTP, rather than stdio, as the MCP transport.
- Implement the MCP server in Python with uv.

The current vertical slice supports simultaneous connections from multiple Chrome profiles and provides the following 20 tools. When multiple browsers are connected, use `browser_instances` to find their IDs and pass `browser_id` to each tool. It may be omitted when only one browser is connected.

| Tool | Function |
| --- | --- |
| `browser_instances` | List IDs and labels of connected browser instances |
| `browser_tabs` | List tabs across all windows |
| `browser_tab_open` | Open an HTTP(S) URL or a blank tab |
| `browser_tab_close` | Close a tab by tab ID |
| `browser_tab_select` | Select the page-operation target without foregrounding Chrome UI |
| `browser_tab_activate` | Select the page-operation target and foreground its window |
| `browser_snapshot` | Capture an accessibility snapshot of the target tab |
| `browser_click` | Click the element identified by a snapshot ref and return a post-operation snapshot |
| `browser_hover` | Move the pointer to the element identified by a snapshot ref and return a post-operation snapshot |
| `browser_type` | Type into the editable element identified by a snapshot ref and return a post-operation snapshot |
| `browser_upload_file` | Assign local files to the file chooser opened by a snapshot ref and return a snapshot after the change completes |
| `browser_select_option` | Select values in the select identified by a snapshot ref and return a post-operation snapshot |
| `browser_press_key` | Send a single key or key chord to the target tab |
| `browser_navigate` | Navigate the target tab to an HTTP(S) URL and return a post-operation snapshot |
| `browser_go_back` | Go back in the target tab's history and return a post-operation snapshot |
| `browser_go_forward` | Go forward in the target tab's history and return a post-operation snapshot |
| `browser_wait` | Wait for a specified number of seconds while retaining the target tab |
| `browser_screenshot` | Capture the target tab's viewport as PNG image content |
| `browser_get_console_logs` | Retrieve up to 100 console entries and exceptions from the target tab |
| `browser_drag` | Drag between two snapshot refs and return a post-operation snapshot |

## Comparison with similar tools

This feature comparison is based on public documentation available as of 2026-07-16. Because each project has a different scope, the table is intended as a guide for choosing a tool, not as a simple ranking.

| Item | chrome-bridge | [Browser MCP](https://docs.browsermcp.io/) | [mcp-chrome](https://github.com/hangwin/mcp-chrome) |
| --- | --- | --- | --- |
| Existing Chrome login state | Uses it | Uses it | Uses it |
| MCP transport | Streamable HTTP | stdio | Streamable HTTP and stdio |
| Operation target | Lists all windows/tabs and selects a persistent target | The current single tab connected through the extension popup | Tab-ID addressing and cross-tab operations |
| Background-tab operation | Target selection does not foreground; only explicit activation does | Operates the connected tab | `background` option on some tools (best effort) |
| Simultaneous routing to multiple Chrome profiles | Stable ID per installation | Not mentioned in public setup documentation | Not mentioned in public README |
| Element discovery and operation | Accessibility YAML and generation-scoped strict refs | Accessibility snapshot and element specification | Accessibility-like tree, refs, selectors, and coordinates |
| Local file upload | 1–20 files to the chooser opened by a strict ref | Not mentioned in public tool documentation | Not mentioned in public tool documentation |
| Screenshot | Target viewport, up to 1024×768 | Connected tab | Viewport/full page/element, configurable size |
| Console logs | Up to 100 console entries/exceptions from the target | Supported | Supported |
| Network monitoring/arbitrary requests | Out of scope | Not mentioned in public tool documentation | Supported |
| History/bookmark management | Out of scope | Not mentioned in public tool documentation | Supported |
| Semantic cross-tab search | Out of scope | Not mentioned in public tool documentation | Supported |

Sources: [Browser MCP server setup](https://docs.browsermcp.io/setup-server),
[Browser MCP extension setup](https://docs.browsermcp.io/setup-extension),
[Browser MCP changelog](https://docs.browsermcp.io/changelog),
[mcp-chrome README](https://github.com/hangwin/mcp-chrome),
[mcp-chrome tool reference](https://github.com/hangwin/mcp-chrome/blob/master/docs/TOOLS.md).

## Structure

```text
apps/
├── extension/  # Manifest V3 Chrome extension
└── server/     # Python FastMCP + Streamable HTTP + WebSocket bridge
```

The MCP client connects to `http://127.0.0.1:8765/mcp`. The Chrome extension makes an outbound connection to `ws://127.0.0.1:8765/extension` and returns results from Chrome API operations.

## Quick start

```bash
uv sync --all-groups
npm --prefix apps/extension ci
npm --prefix apps/extension run build
uv run chrome-bridge-mcp
```

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select `apps/extension`.
3. If needed, set a Browser label in Options to identify the profile.
4. Connect the MCP client to `http://127.0.0.1:8765/mcp`.

A typical Streamable HTTP configuration looks like this. Adjust field names for your MCP client.

```json
{
  "mcpServers": {
    "chrome-bridge": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

Connectivity check:

```bash
curl http://127.0.0.1:8765/health
uv run pytest
```

Local CI-equivalent validation:

```bash
uv sync --all-groups --locked
uv run ruff check apps/server scripts
uv run ruff format --check apps/server scripts
uv run pytest
uv run python scripts/validate_static.py
npm --prefix apps/extension ci
npm --prefix apps/extension run lint
npm --prefix apps/extension test
```

To run isolated E2E without using your everyday Chrome profile or default port 8765, install bundled Chromium once and invoke the test explicitly.

```bash
npm --prefix apps/extension exec playwright install --no-shell chromium
npm --prefix apps/extension run test:e2e
```

[GitHub Actions](.github/workflows/ci.yml) runs the same gates with Python 3.11/3.12, Node 20, and bundled Chromium.

Build reproducible extension ZIP and Python wheel/sdist artifacts with SHA-256 checksums, then run a clean-install smoke test:

```bash
uv run python scripts/build_release.py
uv run python scripts/validate_release.py
uv run python scripts/check_release_reproducible.py
```

The verified extension ZIP is also the Chrome Web Store submission artifact; do not create a separate Store build. See the [Chrome Web Store submission guide](docs/chrome-web-store.md) for the Unlisted-first rollout, listing assets, privacy declarations, permission justifications, reviewer instructions, and update automation. The public [privacy policy](PRIVACY.md) describes extension data handling.

See [docs/development.md](docs/development.md) for detailed procedures, [docs/api.md](docs/api.md) for the tool API, [docs/architecture.md](docs/architecture.md) for design, [docs/release.md](docs/release.md) for distribution, and [SPEC.md](SPEC.md) for the normative specification. [docs/operations.md](docs/operations.md) is canonical for routine operation, configuration, logging, and incident response.

## License

chrome-bridge is licensed under the [MIT License](LICENSE). Playwright-derived extension code remains under Apache-2.0; see [THIRD_PARTY_NOTICES.md](apps/extension/THIRD_PARTY_NOTICES.md) for provenance and license details.
