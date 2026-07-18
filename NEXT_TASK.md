# Next task

## P1.8: v0.1 publication destinations and release

MIT licensing and the `chrome-bridge-mcp` Python distribution/CLI name are selected and applied. Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete. GitHub Release `v0.1.0` and PyPI project `chrome-bridge-mcp` are public, their SHA-256 values match the local reproducible build, and a no-cache public PyPI install passed a server health smoke test. Chrome Web Store item `ogmocgobegbjbecakclahodnhhfmccad`, version `0.1.0`, was submitted as Unlisted on 2026-07-18 and is pending review. Complete the Store review and post-approval validation.

- The Chrome Web Store publisher account is currently declared Non-Trader for the present personal, non-commercial open-source distribution. Change and verify it as Trader if the publishing activity becomes related to a trade, business, craft, or profession.
- While the Store item is pending review, monitor the publisher email and dashboard. Do not cancel review, edit metadata, or upload another ZIP unless review feedback requires a revision.
- The initial submission UI exposed neither the automatic-publishing checkbox nor a `Defer publish` action. After approval, branch on the resulting state: manually publish within the staging window if it is ready to publish, or accept an automatic Unlisted publication and immediately continue validation if it is already published.
- After Store approval/publication, disable the unpacked copy before testing the Store installation, then verify connection, inactive-tab operation, stable Store ID across update, and rollback before considering Public visibility.
