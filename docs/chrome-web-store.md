# Chrome Web Store submission

## Status and distribution boundary

Chrome Web Store is the canonical distribution channel for the Chrome extension. PyPI distributes the separate `chrome-bridge-mcp` local server, and GitHub Releases provide source, checksums, and the same verified artifacts.

The initial Store release should be **Unlisted** with deferred publishing. Anyone with the Store URL can install an Unlisted item, but it is not shown in Store search. Public, Unlisted, and Private items all receive policy review. Do not submit until the Git remote, public privacy-policy URL, support URL, reviewer-accessible server package, and publisher account are ready.

Official references:

- [Register a developer account](https://developer.chrome.com/docs/webstore/register)
- [Prepare an extension](https://developer.chrome.com/docs/webstore/prepare)
- [Complete the Store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Configure distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Publish and defer publishing](https://developer.chrome.com/docs/webstore/publish)
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)

## Submission artifact

Upload `release/chrome-bridge-extension-<version>.zip`, produced by `scripts/build_release.py`. Do not create a second Store-specific build. The ZIP has `manifest.json` at its root and includes the MIT project license, third-party notice, and Playwright Apache-2.0 license. Source files, tests, `node_modules`, profiles, cookies, and developer artifacts remain excluded.

Before every upload:

```bash
uv run python scripts/build_release.py
uv run python scripts/validate_release.py
uv run python scripts/check_release_reproducible.py
```

Confirm the ZIP checksum against `release/SHA256SUMS`. Chrome Web Store requires each uploaded `manifest.version` to be greater than the previous Store version, so never reuse a submitted version number after changing the package.

## Developer account and public URLs

1. Register a dedicated Chrome Web Store developer account, pay the one-time registration fee shown by the dashboard, verify its email, and select the publisher name.
2. Publish [the privacy policy](../PRIVACY.md) at a stable public HTTPS URL. The Store dashboard privacy-policy field must use that public URL, not a local or unpublished path.
3. Provide stable public product and support URLs. The support destination must be monitored for review questions, security reports, and user issues.
4. Keep publisher credentials, OAuth tokens, service-account keys, and signing keys outside the repository and release artifacts.

## Store listing draft

Use the manifest name `Chrome Bridge` and keep the summary within the Store's 132-character limit.

Suggested summary:

> Connect Chrome tabs to a local MCP server for explicit, background-safe agent operations.

Suggested detailed description:

> Chrome Bridge connects the Chrome browser you already use to a local Model Context Protocol (MCP) server. An MCP client can list and select tabs, capture accessibility snapshots, and perform explicit page operations without automatically bringing a background target to the foreground.
>
> Main features:
>
> - Operate tabs across Chrome windows and multiple profiles with explicit routing.
> - Select a background target independently from Chrome's active tab.
> - Use generation-scoped accessibility references for click, type, select, drag, and file-upload operations.
> - Capture viewport screenshots and current-document console messages.
> - Connect to a user-configured WebSocket endpoint; the supported default is the local Chrome Bridge MCP server on `127.0.0.1`.
>
> Chrome Bridge requires the separate `chrome-bridge-mcp` local server and an MCP-compatible client. It does not provide a cloud relay, analytics, or advertising.

Include a prominent disclosure in the listing before the feature list:

> Chrome Bridge can read and interact with HTTP and HTTPS pages when instructed by the user's MCP client. Page information and operation results are sent to the WebSocket endpoint configured by the user, which defaults to the Chrome Bridge server on the same machine. The Chrome Bridge project does not operate a server that receives this data.

Keep listing claims aligned with the current release. Do not claim Store badges, rankings, remote operation, or support for pages and browsers outside [the specification](../SPEC.md).

## Listing assets

Required assets:

- Store icon: the packaged 128×128 PNG.
- At least one current product screenshot at 1280×800 or 640×400; prefer 1280×800 and provide up to five.
- Small promotional image: 440×280 PNG or JPEG.

The 1400×560 marquee image is optional. Capture screenshots from branded Chrome using only controlled fixture pages and synthetic data. Show the popup connection state, Options identity/routing, a background target indicator, and an MCP operation result without exposing real tabs, account names, URLs, cookies, messages, file paths, or profile data. Use full-bleed images with square corners and keep overlaid text minimal.

## Privacy declarations

The dashboard declarations, listing disclosure, and [privacy policy](../PRIVACY.md) must describe the same behavior. Declare every current dashboard category that covers:

- browsing activity, URLs, and tab metadata;
- website content and accessibility snapshots;
- user activity, form/input data, and files selected for explicit upload;
- screenshots and console messages;
- the random browser ID, browser label, endpoint, and session state.

State that processing is limited to the extension's single purpose, the supported endpoint is local by default, no developer-operated cloud service receives the data, and no data is sold or used for advertising. Local-only processing still needs disclosure.

Single-purpose text for the Privacy tab:

> Connect user-selected Chrome tabs to the user's MCP client through the Chrome Bridge server so the client can inspect and perform explicit browser operations.

## Permission justifications

| Permission | Required use |
| --- | --- |
| `debugger` | Attach temporarily to the selected page target for trusted mouse/keyboard input, screenshots, current-document console messages, and file-chooser assignment; detach after each operation. |
| `scripting` | Inject the packaged content runtime into an already-open supported page when the manifest content script is not yet present. No remote code is downloaded or executed. |
| `storage` | Persist the random browser ID, user label, endpoint, connection status, target state, and snapshot generation state. |
| `tabs` | List, open, close, select, activate, and navigate tabs while keeping the agent target separate from the foreground tab. |
| `webNavigation` | Detect top-frame navigation and history changes so operations wait correctly and stale element references are invalidated. |
| `http://*/*`, `https://*/*` | Run the packaged content runtime on the HTTP(S) page explicitly targeted by the user or MCP client. Chrome internal, file, data, and JavaScript URLs remain unsupported. |

Broad host access and `debugger` are central to the product but can increase review scrutiny. Keep every permission connected to shipped functionality, and update this table, the Store declarations, and reviewer instructions whenever the manifest changes.

## Reviewer test instructions

No account credentials are required. Before submitting the extension, make `chrome-bridge-mcp` installable from the public PyPI project or provide a stable public GitHub Release wheel.

Suggested dashboard instructions:

1. Install the local server with `uv tool install chrome-bridge-mcp` or the linked release wheel.
2. Run `chrome-bridge-mcp` in a terminal. It binds to `127.0.0.1:8765` only.
3. Install the submitted extension and wait for its toolbar icon to become pink. Open the popup and confirm `connected`.
4. Check `http://127.0.0.1:8765/health`; `extensionConnected` should be `true`.
5. Connect MCP Inspector or another MCP client to `http://127.0.0.1:8765/mcp` using Streamable HTTP.
6. Call `browser_tabs`, open an HTTP(S) test page as inactive, select it, capture `browser_snapshot`, and use one returned ref with `browser_click`.
7. Confirm the original active tab remains active. Close only the test tab.

Explain that the initial permission prompt is expected because operating arbitrary user-selected pages is the extension's single purpose. If review needs a deterministic page, publish a public static fixture that contains no login or credentials; do not ask reviewers to use a private account.

## Submission and rollout

1. Upload the verified ZIP in the Developer Dashboard.
2. Complete Package, Store Listing, Privacy, Distribution, and Test instructions.
3. Select **Unlisted** and submit with automatic publishing disabled.
4. Monitor the publisher email and dashboard. New items, broad host permissions, and sensitive execution permissions may require additional review time.
5. After approval, publish within the dashboard's staging window and install the Store build in branded Chrome.
6. Disable the unpacked development copy in that profile before validating the Store copy. Otherwise both installations can connect as separate browser IDs and make routing ambiguous.
7. Verify connection, stable Store extension ID across an update, inactive-tab operation, popup/Options UI, and rollback guidance before considering Public visibility.

The Store-assigned extension ID is distinct from the random `browserId` used by chrome-bridge routing. Store updates preserve the Store extension ID and Chrome-managed extension storage; changing between unpacked and Store installations creates a different extension installation and therefore a different browser ID.

## Update automation

Perform the first submission, visibility selection, and publication manually. Once the Store item and publisher IDs exist, the Chrome Web Store API v2 can upload later ZIPs and submit them for review. Keep API credentials in the CI secret store, use the existing verified ZIP without rebuilding, and prefer staged publishing. See [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).

Do not automate Store publication until the manual v0.1 submission has passed review and the rollback path has been exercised.
