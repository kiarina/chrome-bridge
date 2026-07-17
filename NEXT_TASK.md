# Next task

## P1.8: v0.1 publication policy and release

Reproducible extension ZIP, wheel, and sdist builds and clean E2E are complete locally and in CI. Finalize the rights and repository decisions required for publication.

- The copyright holder selects the project license. After comparing candidates and deciding, apply the same terms to the root `LICENSE`, Python SPDX metadata, and extension ZIP.
- Decide the Git remote, repository visibility, authority to create tags/releases, and whether to publish the wheel/sdist to a package index.
- After selecting publication destinations, implement upload of CI-verified artifacts, a GitHub Release for tag `v0.1.0`, and PyPI trusted publishing if needed.
- Confirm matching `SHA256SUMS` between the tag build and a local rebuild, notices/licenses in release assets, a fresh install, and a branded-Chrome manual smoke test.
- Do not publish artifacts to third parties while the project has no `LICENSE` or remote.
