# Release artifacts

## Status and publication boundary

The v0.1 build produces three local artifacts plus checksums:

- `chrome-bridge-extension-0.1.0.zip`: Extension runtime for Load unpacked.
- `chrome_bridge_server-0.1.0-py3-none-any.whl`: Wheel for the Python server tool.
- `chrome_bridge_server-0.1.0.tar.gz`: Python server source distribution.
- `SHA256SUMS`: SHA-256 checksums for the three files above.

Build, clean install, and artifact-based isolated Chromium E2E are automated. However, the repository has no project `LICENSE` and no Git remote. Do not publish to third parties, create a GitHub Release, or upload to a package index until the copyright holder decides the project license and publication destinations. The extension ZIP includes `THIRD_PARTY_NOTICES.md` and the full Apache-2.0 text for Playwright-derived portions.

## Canonical file selection

[`apps/extension/extension-files.json`](../apps/extension/extension-files.json) is canonical for extension runtime and notice files. The E2E harness, static validation, and release build use the same allowlist. Do not include source TypeScript, tests, `node_modules`, Playwright output, or Chrome profile data in the release ZIP.

The Python wheel packages only `src/chrome_bridge_server` and includes protocol schemas as package data. Hatch target settings exclude `tests/` from the sdist. Release validation lists entries in the wheel, sdist, and extension ZIP and rejects forbidden paths or missing console entry points/schemas.

## Build and validation

After preparing Node dependencies and the Python workspace, run:

```bash
uv sync --all-groups --locked
npm --prefix apps/extension ci
uv run python scripts/build_release.py
uv run python scripts/validate_release.py
uv run python scripts/check_release_reproducible.py
```

`build_release.py` regenerates the extension bundle and builds Python artifacts with `SOURCE_DATE_EPOCH=315532800`. ZIP entries are written in path order with fixed timestamps, fixed permissions, and deflate level 9. `check_release_reproducible.py` fails unless all three artifacts have identical bytes across two builds from the same source checkout.

`validate_release.py` installs the wheel and dependencies in a fresh temporary venv, confirming imports do not come from the source checkout and checking packaged schemas. It extracts the ZIP to a temporary directory and runs two-profile isolated E2E on a random port with that extension and the installed server. It never uses an everyday Chrome profile or default port 8765. Use `--skip-e2e` only for a quick archive/clean-import check.

Checksum examples:

```bash
cd release
shasum -a 256 -c SHA256SUMS       # macOS
sha256sum -c SHA256SUMS           # Linux
```

## Version bump

Update the following files to the same release version:

- root `pyproject.toml`
- `apps/server/pyproject.toml`
- `apps/extension/manifest.json`
- `apps/extension/package.json` and `package-lock.json`

Update the extension package and lockfile together with the following command. A Chrome extension version contains one to four integer components.

```bash
npm --prefix apps/extension version 0.1.1 --no-git-tag-version
```

Set the root/server `pyproject.toml` files and manifest to the same value, then run builds, tests, and `scripts/validate_static.py`. Use `rg` to confirm no old version remains in artifact names, tags, release notes, or installation examples. Never create the tag before the version commit.

## Install

Extract the extension ZIP into a fixed installation directory. To preserve the unpacked extension ID and `chrome.storage.local` browser identity, do not Load unpacked from a different path per version; use the same directory for upgrades and rollbacks.

```bash
mkdir -p /path/to/chrome-bridge-extension
unzip chrome-bridge-extension-0.1.0.zip -d /path/to/chrome-bridge-extension
uv tool install ./chrome_bridge_server-0.1.0-py3-none-any.whl
chrome-bridge-server
```

Enable Developer mode at Chrome's `chrome://extensions` and Load unpacked from the fixed directory. Connect the MCP client to `http://127.0.0.1:8765/mcp`. Check server and extension connection counts with `curl http://127.0.0.1:8765/health`. See the [Operations guide](operations.md) for everyday operation and incident response.

## Upgrade and rollback

1. Stop new page commands and back up the current extension directory and server wheel with versioned names.
2. Verify SHA-256 of the new artifacts.
3. Stop the current server normally and confirm the port is released.
4. Replace the server tool environment with `uv tool install ./new-wheel.whl` and start the new server.
5. Completely replace the fixed extension directory's contents with the new ZIP contents, then Reload each Chrome profile.
6. Check `/health`, `browser_instances`, and snapshot/click on an inactive fixture.

Rollback follows the same procedure, restoring the backed-up wheel and ZIP to the fixed directory. Because the extension directory does not change, Chrome's extension ID and stable browser ID in `chrome.storage.local` are preserved. If a protocol-incompatible version is introduced later, separately define a migration order that updates the server to a backward-compatible version first and Reloads the extension afterward. If health or the inactive smoke test fails, do not resume normal operation; keep new page commands stopped and roll back to the backup.

## Publishing checklist

Complete the following before publication:

1. Select a project license and apply it to the root `LICENSE`, Python metadata, and extension ZIP.
2. Decide the Git remote, repository visibility, and release signing/retention policies.
3. Attach GitHub Actions-verified artifacts to tag `v0.1.0` and confirm SHA-256 matches a local rebuild.
4. If publishing wheel/sdist to a package index, configure project-name ownership and trusted publishing.
