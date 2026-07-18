# Next task

## P1.8: v0.1 publication destinations and release

MIT licensing and the `chrome-bridge-mcp` Python distribution/CLI name are selected and applied. Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete. GitHub Release `v0.1.0` and PyPI project `chrome-bridge-mcp` are public, their SHA-256 values match the local reproducible build, and a no-cache public PyPI install passed a server health smoke test. Chrome Web Store is selected as the extension distribution channel, starting Unlisted with deferred publishing. Complete the Store review and post-approval validation.

- The Chrome Web Store publisher account is currently declared Non-Trader for the present personal, non-commercial open-source distribution. Change and verify it as Trader if the publishing activity becomes related to a trade, business, craft, or profession.
- Submit the already-uploaded verified extension ZIP as Unlisted with deferred publishing; reviewer installation through PyPI is now live.
- After Store approval, disable the unpacked copy before testing the Store installation, then verify connection, inactive-tab operation, stable Store ID across update, and rollback before publishing or considering Public visibility.
