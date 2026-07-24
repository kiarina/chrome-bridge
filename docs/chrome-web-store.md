# Chrome Web Store submission

## Status and distribution boundary

Chrome Web Store is the canonical distribution channel for the Chrome extension. PyPI distributes the separate `chrome-bridge-mcp` local server, and GitHub Releases provide source, checksums, and the same verified artifacts.

The initial Store release should be **Unlisted**, with deferred publishing when the dashboard exposes that control. Anyone with the Store URL can install an Unlisted item, but it is not shown in Store search. Public, Unlisted, and Private items all receive policy review. The publisher account is registered and currently declared Non-Trader for the present personal, non-commercial open-source distribution; update and verify that declaration if the publishing activity becomes related to a trade, business, craft, or profession. Do not submit until the public privacy-policy URL, support URL, and reviewer-accessible server package are ready.

### Current publication

- Store item ID: `ogmocgobegbjbecakclahodnhhfmccad`
- Published version: `0.3.0`
- Visibility: Unlisted
- Initial v0.1.0 publication: 2026-07-21
- v0.3.0 update approved and manually published: 2026-07-24
- Status at handoff: published and post-publication smoke tested
- Listing: [Chrome Bridge on Chrome Web Store](https://chromewebstore.google.com/detail/chrome-bridge/ogmocgobegbjbecakclahodnhhfmccad)
- Current ZIP SHA-256: `32d79d0d93be55ac5dbb9c50fbcc79e7e5f680347304486e7ecd0ee8da2b0d04`

The dashboard showed the expected warning that broad host permissions can lengthen
review, then accepted the submission. It exposed neither the automatic-publishing
checkbox during submission nor a `Defer publish` action afterward. Approval produced a
ready-to-publish state with a 2026-08-19 deadline, and v0.1.0 was manually published as
Unlisted on 2026-07-21.

The Store installation connected as the only protocol v2 browser with extension version
0.1.0. Two operation-boundary reruns preserved the existing active tab while opening,
selecting, snapshotting, and clicking an inactive controlled fixture. The Store copy was
then disabled, the verified ZIP was loaded from a fixed fallback directory, and the same
inactive snapshot/click smoke passed. After disabling the unpacked fallback and
re-enabling the Store copy, the Store browser ID and endpoint settings were preserved.
The first real Store update retained the same Store item and installed extension ID. The
post-update Store installation connected under browser ID
`44a25852-87a1-4165-9876-b7735888d339` with label `Browser 44a25852` and the default
loopback endpoint. No pre-update browser ID was recorded in the repository, so storage
identity continuity cannot be independently compared from the written record.

### v0.3 update publication and validation

Version 0.3.0 is the first planned Store runtime update. It adds accessible-text
condition waiting and strict-ref downloads observed through the selected target's CDP
Page events. It also adds the non-warning `alarms` permission so a dormant Manifest V3
worker can resume quiet local-server reachability checks without treating normal server
downtime as an extension error. `debugger` already supports target-scoped input and
observation, while `downloads` remains required for explicitly requested WebM recording
output. The verified 0.3.0 ZIP with SHA-256
`32d79d0d93be55ac5dbb9c50fbcc79e7e5f680347304486e7ecd0ee8da2b0d04` was uploaded to
the existing Unlisted item on 2026-07-24. The dashboard required and accepted the new
`alarms` justification, automatic publication was disabled in the confirmation dialog,
and the authoritative item row entered `審査待ち` at version 0.3.0. A transient submission
error toast appeared after that transition, so no duplicate submission was made. Review
later completed successfully and 0.3.0 was manually published on 2026-07-24.

With the fixed unpacked copy disabled, the Store copy connected as the only protocol v2
browser and reported extension version 0.3.0. The branded-Chrome smoke preserved the
original active tab while exercising background visible/hidden waits, stale-ref
rejection, immediate and delayed strict-ref downloads, the 60-second timeout range, an
intentional outcome-unknown timeout, and immediate debugger reuse. It removed its one
temporary tab and exactly two completed CSV downloads with no cleanup remaining. The
user chose not to repeat the old-ZIP fallback exercise after this update; the documented
fallback remains available from the earlier publication validation. Public visibility
and final-publication automation remain deferred decisions.

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

1. Keep the registered Chrome Web Store publisher account, email, trader declaration, and publisher name current. Trader contact information is verified and displayed publicly; reassess the declaration if the nature of the publishing activity changes.
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
> - Wait for accessible page text to appear or disappear and receive a fresh snapshot.
> - Start a download from an exact accessibility reference and report sanitized completion metadata without exposing its URL or filesystem path.
> - Capture viewport screenshots and current-document console messages.
> - Record explicitly requested operations as silent WebM files saved locally below Downloads/chrome-bridge.
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

The prepared v0.1 assets are:

- `apps/extension/icons/icon-128.png`
- `docs/assets/chrome-web-store-screenshot-1280x800.png`
- `docs/assets/chrome-web-store-small-promo-440x280.png`

The editable source for the small promotional image is
`docs/assets/chrome-web-store-small-promo.svg`. The first screenshot is derived from
the controlled Kiteframe operation-recording showcase and contains only synthetic
fixture data.

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
| `alarms` | Wake the Manifest V3 service worker for bounded, backoff-based reachability checks while the optional local server is stopped; no browsing data is collected by the alarm. |
| `debugger` | Attach temporarily to the selected page target for trusted mouse/keyboard input, screenshots, current-document console messages, file-chooser assignment, exact-target download completion events, and explicitly requested target recording frames; detach after each operation. |
| `downloads` | Save only an explicitly requested silent WebM recording below `Downloads/chrome-bridge/`, use uniquified names rather than overwrite, and remove only an interrupted partial download created by that command. |
| `offscreen` | Host the extension-packaged canvas and MediaRecorder needed to encode requested target-tab frames; the document is closed after each bounded recording. |
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
7. On a test page with delayed accessible text, call `browser_wait_for` and confirm it returns a fresh snapshot without activating the tab.
8. On a test page with a direct attachment link, capture a fresh snapshot and call `browser_download_file` with that exact ref. Confirm completed metadata is returned without a URL or filesystem path, then delete only the reviewer download.
9. Call `browser_record_video(filename="review.webm", duration=0.5)` and confirm a
   silent WebM appears below `Downloads/chrome-bridge/` without activating the target.
   Delete only that reviewer recording afterward.
10. Confirm the original active tab remains active. Close only the test tab.

Explain that the initial permission prompt is expected because operating arbitrary user-selected pages is the extension's single purpose. If review needs a deterministic page, publish a public static fixture that contains no login or credentials; do not ask reviewers to use a private account.

## Submission and rollout

1. Upload the verified ZIP in the Developer Dashboard.
2. Complete Package, Store Listing, Privacy, Distribution, and Test instructions.
3. Select **Unlisted** and disable automatic publishing when the submission UI exposes
   that option. If submission is already pending and the item menu exposes `Defer
   publish`, select it without cancelling review. If neither control is available, keep
   the valid review active and handle the resulting staged or automatically published
   state after approval.
4. Monitor the publisher email and dashboard. New items, broad host permissions, and sensitive execution permissions may require additional review time.
5. After approval, publish within the dashboard's staging window if the item is staged.
   If it was published automatically, proceed directly to installing the Unlisted Store
   build in branded Chrome.
6. Disable the unpacked development copy in that profile before validating the Store copy. Otherwise both installations can connect as separate browser IDs and make routing ambiguous.
7. Verify connection, stable Store extension ID across an update, inactive-tab operation, popup/Options UI, and rollback guidance before considering Public visibility.

The Store-assigned extension ID is distinct from the random `browserId` used by chrome-bridge routing. Store updates preserve the Store extension ID and Chrome-managed extension storage; changing between unpacked and Store installations creates a different extension installation and therefore a different browser ID.

## Update automation

The first submission, visibility selection, and publication were performed manually.
The Chrome Web Store API v2 can upload later ZIPs and submit them for review. Keep API
credentials in the CI secret store, use the existing verified ZIP without rebuilding,
and prefer staged publishing. See [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).

The first real update confirmed staged review, manual publication, the stable Store item
ID, and Store-copy background operation. Before automating final publication, make a
separate release-process decision about credentials, staged rollout, failure handling,
and whether the accepted but unexercised post-update fallback risk is appropriate.
