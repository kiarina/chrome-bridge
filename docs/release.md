# Release artifacts

## Status and publication boundary

The current build produces five local artifacts plus checksums. Python server/SDK 0.2.x
is versioned independently from the unchanged Store extension 0.1.0:

- `chrome-bridge-extension-0.1.0.zip`: Extension runtime for Load unpacked.
- `chrome_bridge_mcp-0.2.0-py3-none-any.whl` and `.tar.gz`: server distribution.
- `chrome_bridge_sdk-0.2.0-py3-none-any.whl` and `.tar.gz`: Direct API SDK.
- `SHA256SUMS`: SHA-256 checksums for all five artifacts.

Build, clean install, and artifact-based isolated Chromium E2E are automated. The project is licensed under MIT; the extension ZIP and Python distribution include the project license. The extension ZIP also includes `THIRD_PARTY_NOTICES.md` and the full Apache-2.0 text for Playwright-derived portions. The same verified extension ZIP is used for GitHub Releases, manual Load unpacked installation, and Chrome Web Store submission. The public source repository is `kiarina/chrome-bridge`, and its owner controls tags and releases. PyPI trusted publishing for both `chrome-bridge-mcp` and the pending `chrome-bridge-sdk` project uses `.github/workflows/release-pypi.yml` and the `pypi` GitHub environment; the server project successfully published v0.1.0 through this boundary.

## Canonical file selection

[`apps/extension/extension-files.json`](../apps/extension/extension-files.json) is canonical for extension runtime and notice files. The E2E harness, static validation, and release build use the same allowlist. Do not include source TypeScript, tests, `node_modules`, Playwright output, or Chrome profile data in the release ZIP.

The Python distributions are `chrome-bridge-mcp` and `chrome-bridge-sdk`; each packages
only its `src` package and MIT license, and each sdist excludes tests. The SDK depends on
the compatible server series `chrome-bridge-mcp>=0.2,<0.3` so its interpreter can start
the managed server module directly.

## Build and validation

After preparing Node dependencies and the Python workspace, run:

```bash
uv sync --all-groups --locked
npm --prefix apps/extension ci
uv run python scripts/build_release.py
uv run python scripts/validate_release.py
uv run python scripts/check_release_reproducible.py
```

`build_release.py` regenerates the extension bundle and builds both Python distributions
with `SOURCE_DATE_EPOCH=315532800`. `check_release_reproducible.py` requires all five
artifacts to have identical bytes across two builds from the same checkout.

`validate_release.py` installs the wheel and dependencies in a fresh temporary venv, confirming imports do not come from the source checkout and checking packaged schemas. It extracts the ZIP to a temporary directory and runs two-profile isolated E2E on a random port with that extension and the installed server. It never uses an everyday Chrome profile or default port 8765. Use `--skip-e2e` only for a quick archive/clean-import check.

Checksum examples:

```bash
cd release
shasum -a 256 -c SHA256SUMS       # macOS
sha256sum -c SHA256SUMS           # Linux
```

## Version bump

Update server and SDK together:

- root `pyproject.toml`
- `apps/server/pyproject.toml`
- `packages/sdk/pyproject.toml`

Update extension manifest/package versions only when extension runtime content changes.
Do not create a content-free Store update to match a Python-only release.

Update the extension package and lockfile together with the following command. A Chrome extension version contains one to four integer components.

```bash
npm --prefix apps/extension version 0.1.1 --no-git-tag-version
```

Set root/server/SDK versions to the same value, then run builds, tests, and
`scripts/validate_static.py`. The extension version is validated separately.

## Install

After the Store item is approved, Chrome Web Store is the normal extension installation and update channel. Users still install and run `chrome-bridge-mcp` separately. Before Store publication and for artifact validation or emergency fallback, use the fixed-directory Load unpacked procedure below.

Extract the extension ZIP into a fixed installation directory. To preserve the unpacked extension ID and `chrome.storage.local` browser identity, do not Load unpacked from a different path per version; use the same directory for upgrades and rollbacks.

```bash
mkdir -p /path/to/chrome-bridge-extension
unzip chrome-bridge-extension-0.1.0.zip -d /path/to/chrome-bridge-extension
uv tool install ./chrome_bridge_mcp-0.2.0-py3-none-any.whl
chrome-bridge-mcp
```

Applications install both local wheels together, or install the published SDK which
declares the server dependency:

```bash
uv add ./chrome_bridge_mcp-0.2.0-py3-none-any.whl ./chrome_bridge_sdk-0.2.0-py3-none-any.whl
```

Enable Developer mode at Chrome's `chrome://extensions` and Load unpacked from the fixed directory. Connect the MCP client to `http://127.0.0.1:8765/mcp`. Check server and extension connection counts with `curl http://127.0.0.1:8765/health`. See the [Operations guide](operations.md) for everyday operation and incident response.

## Upgrade and rollback

1. Stop new page commands and back up the current extension directory and server wheel with versioned names.
2. Verify SHA-256 of the new artifacts.
3. Stop the current server normally and confirm the port is released.
4. Replace the server tool environment with `uv tool install ./new-wheel.whl` and start the new server.
5. Completely replace the fixed extension directory's contents with the new ZIP contents, then Reload each Chrome profile.
6. Check `/health`, `browser_instances`, and snapshot/click on an inactive fixture.

Rollback follows the same procedure for Load unpacked installations, restoring the backed-up wheel and ZIP to the fixed directory. Because the extension directory does not change, Chrome's extension ID and stable browser ID in `chrome.storage.local` are preserved. A Store-managed installation cannot be downgraded by uploading an older manifest version; publish corrected code with a higher version or disable the Store copy and use the verified unpacked fallback while the replacement is reviewed. Never enable Store and unpacked copies in the same profile during ordinary operation because they register separate browser IDs.

If a protocol-incompatible version is introduced later, separately define a migration order that updates the server to a backward-compatible version first and updates the extension afterward. If health or the inactive smoke test fails, do not resume normal operation; keep new page commands stopped and use the appropriate rollback path.

## Publishing checklist

Complete the following before publication:

1. Confirm the root, extension ZIP, wheel, and sdist carry the MIT license while retaining Playwright's Apache-2.0 notice and license.
2. Use the public `kiarina/chrome-bridge` repository; its owner authorizes tag and GitHub Release creation.
3. Keep the `chrome-bridge-mcp` trusted publisher aligned with workflow `release-pypi.yml` and GitHub environment `pypi`.
4. Confirm both PyPI projects still use the same trusted publisher workflow/environment.
   Push tag `v0.2.0` only after the version commit is on `main`; the workflow publishes
   both Python wheel/sdist pairs and attaches all five verified artifacts to the GitHub
   Release.
5. Publish `PRIVACY.md` and support information at stable HTTPS URLs, prepare Store listing assets, and complete the permission/data declarations in the [Chrome Web Store guide](chrome-web-store.md).
6. Upload the same verified extension ZIP as an Unlisted item with deferred publishing, pass review, and complete the Store-specific branded-Chrome smoke test before considering Public visibility.
