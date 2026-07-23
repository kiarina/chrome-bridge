# Chrome Bridge Privacy Policy

Effective date: 2026-07-23

## Scope and purpose

Chrome Bridge is a Chrome extension that connects tabs in the user's browser to an MCP server endpoint configured by the user. Its single purpose is to let a user-authorized AI agent inspect and operate those tabs through explicit MCP tool calls.

This policy describes the data handled by the Chrome Bridge extension. It does not govern the websites a user visits, the MCP client the user chooses, or other software and services outside the Chrome Bridge project.

## Data handled by the extension

Chrome Bridge can handle the following data when required by an explicit MCP operation:

- Browser and tab information, including tab IDs, window IDs, URLs, titles, active state, and navigation state.
- Website content and accessibility information used to produce snapshots, strict element references, and explicit waits for normalized accessible text to appear or disappear.
- User interactions and page state involved in clicks, pointer movement, keyboard input, form input, selection, drag operations, screenshots, and console messages.
- Target-tab image frames and silent WebM output created only for an explicit bounded recording command. The recording is saved under the selected Chrome profile's Downloads directory; Chrome Bridge does not upload it to a developer-operated service.
- Local file paths supplied by the MCP server for an explicit upload command. Chrome Bridge assigns those files to the file chooser opened on the target page. It does not return the paths in tool results. The target website may receive and process the selected files according to that website's own privacy practices.
- Target-scoped download progress for an explicit strict-reference download command. The extension returns only the suggested filename, completion state, and byte counts; it does not return or retain the download URL, filesystem path, actual saved name, MIME type, Chrome download ID, or a download from another tab.
- Extension configuration and identity: a random browser ID, a user-editable browser label, the configured WebSocket endpoint, connection status, target tab state, and snapshot generation state.

Chrome Bridge does not use this data for advertising, profiling, credit decisions, or any purpose unrelated to its user-facing browser-control function.

## Chrome Web Store Limited Use

The use of information received from Google APIs will adhere to the Chrome Web
Store User Data Policy, including the Limited Use requirements. Chrome Bridge
uses user data only to provide or improve its disclosed browser-control purpose
and does not use or transfer it for unrelated purposes.

## Processing, transmission, and sharing

The extension sends commands and results only over the WebSocket endpoint configured by the user. The default endpoint is `ws://127.0.0.1:8765/extension`, which connects to the Chrome Bridge MCP server on the same machine. Results may then be returned by that server to the MCP client selected and configured by the user.

The Chrome Bridge project does not operate a cloud relay, analytics service, advertising service, or other developer-controlled server that receives extension data. Chrome Bridge does not sell user data. It does not transfer user data to third parties for advertising or unrelated purposes.

If a user replaces the default WebSocket endpoint, the user is responsible for trusting and securing that endpoint. Data handled by the user's MCP client is subject to that client's configuration and privacy practices.

## Storage and retention

The extension stores its random browser ID, browser label, and configured endpoint in `chrome.storage.local` so they persist across browser restarts. Connection, target, operation, and snapshot-generation state is kept in extension session storage or memory for operation and recovery.

Chrome Bridge does not maintain a developer-accessible history of visited pages, snapshots, screenshots, console messages, form content, or uploaded files. Page references are invalidated after a new snapshot, target change, or navigation. Uninstalling the extension removes its Chrome-managed local and session storage according to Chrome's behavior.

Download progress metadata is kept only for the duration of the requested operation and
is not stored as a separate download history. The downloaded file itself is managed by
Chrome and the destination website/browser settings; Chrome Bridge does not expose its
absolute saved path.

An explicitly requested recording remains as a WebM file in the selected profile's
`Downloads/chrome-bridge/` directory until the user deletes it. Chrome Bridge does not
maintain a separate recording index or upload a copy.

Websites and MCP clients may retain data independently of Chrome Bridge. Users should review their policies and settings separately.

## Permissions

Chrome Bridge requests access to HTTP and HTTPS pages and the `alarms`, `debugger`, `downloads`, `offscreen`, `scripting`, `storage`, `tabs`, and `webNavigation` permissions. These permissions are used only to provide resilient local-server reconnection, browser control, and explicitly requested recording features described above. Detailed permission reasons are maintained in the project's [Chrome Web Store submission guide](docs/chrome-web-store.md#permission-justifications).

## Security

The supported Chrome Bridge MCP server accepts only loopback connections and validates Host and Origin boundaries. Chrome Bridge does not support a project-operated remote connection. Users should not configure an endpoint they do not control and trust.

## Changes and contact

Material changes to data handling will be reflected in this policy and disclosed with the corresponding extension update. For privacy or support questions, use the support contact shown on the Chrome Web Store listing or the public repository's issue tracker.
