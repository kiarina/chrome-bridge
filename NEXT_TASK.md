# Next task

## P2.1: branded Chrome upload change-barrier smoke

Reload the unpacked extension containing the `change` barrier and perform final verification on a background target in branded Chrome.

- Assign a large image to the loopback fixture's hidden multiple input and confirm that the direct `browser_upload_file` result includes the basename written by the synchronous change handler.
- Confirm that the direct result shows the site-specific delayed status as pending, and that a new snapshot after `browser_wait` shows it as complete.
- Confirm that the active tab/window focus remains unchanged, debugger/interception state is cleaned up after errors, and no state leaks into another profile.

## P1.8: v0.1 publication policy and release

Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete locally and in CI. Finalize the rights and repository decisions required for publication.

- The copyright holder selects the project license. After comparing candidates and deciding, apply the same terms to the root `LICENSE`, Python SPDX metadata, and extension ZIP.
- Decide the Git remote, repository visibility, authority to create tags/releases, and whether to publish the wheel/sdist to a package index.
- After selecting publication destinations, implement upload of CI-verified artifacts, a GitHub Release for tag `v0.1.0`, and PyPI trusted publishing if needed.
- Confirm matching `SHA256SUMS` between the tag build and a local rebuild, notices/licenses in release assets, a fresh install, and a branded-Chrome manual smoke test.
- Do not publish artifacts to third parties while the project has no `LICENSE` or remote.
