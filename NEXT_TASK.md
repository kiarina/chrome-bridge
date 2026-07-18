# Next task

## P1.8: v0.1 publication destinations and release

MIT licensing and the `chrome-bridge-mcp` Python distribution/CLI name are selected and applied. Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete locally and in CI. The public repository is `kiarina/chrome-bridge`, its owner authorizes releases, and PyPI has a pending trusted publisher bound to `release-pypi.yml` and environment `pypi`. Chrome Web Store is selected as the extension distribution channel, starting Unlisted with deferred publishing. Finalize the remaining publication setup.

- Re-run the tag-triggered `v0.1.0` release workflow after its artifact-E2E assertion fix. The first successful PyPI upload creates the project; the pending publisher does not reserve its name beforehand.
- The Chrome Web Store publisher account is registered and currently declared Non-Trader for the present personal, non-commercial open-source distribution. Change and verify it as Trader if the publishing activity becomes related to a trade, business, craft, or profession. Publish `PRIVACY.md`, the product page, and a monitored support destination at stable HTTPS URLs.
- Produce the required Store screenshot and 440×280 promotional image using only controlled fixture data. Complete listing text, privacy declarations, permission justifications, and reviewer instructions from `docs/chrome-web-store.md`.
- Make the server installable to reviewers through PyPI or a public GitHub Release, upload the same verified extension ZIP as Unlisted, and submit with deferred publishing.
- Confirm matching `SHA256SUMS` between the tag build and a local rebuild, notices/licenses in release assets, a fresh install, and a branded-Chrome manual smoke test.
- After Store approval, disable the unpacked copy before testing the Store installation, then verify connection, inactive-tab operation, stable Store ID across update, and rollback before publishing or considering Public visibility.
- Do not submit to Chrome Web Store until the GitHub Release and PyPI publication have completed and a clean public install has been verified.
