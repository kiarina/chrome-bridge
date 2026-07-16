# Third-party notices

## Microsoft Playwright v1.51.1

The files under `src/vendor/playwright-v1.51.1/` are derived from Microsoft Playwright at commit
`0ad26b38902449d9347536c97a34cc5dedbec729` and are licensed under Apache License 2.0. The complete
license text is stored at `src/vendor/playwright-v1.51.1/LICENSE`.

Upstream source paths:

- `packages/playwright-core/src/server/injected/ariaSnapshot.ts`
- `packages/playwright-core/src/server/injected/roleUtils.ts`
- `packages/playwright-core/src/server/injected/domUtils.ts`
- `packages/playwright-core/src/server/injected/yaml.ts`
- `packages/playwright-core/src/utils/isomorphic/stringUtils.ts`
- `packages/playwright-core/src/utils/isomorphic/ariaSnapshot.ts`

Local changes are intentionally narrow:

- replace Playwright monorepo import aliases with local relative imports;
- render `[ref=s<generation>e<element-id>]` attributes;
- include a link's source `href` as a `/url` property;
- wrap tree generation and rendering with extension-wide snapshot generation and strict ref resolution.
