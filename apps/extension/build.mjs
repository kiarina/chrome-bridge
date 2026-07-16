import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  legalComments: "eof",
  logLevel: "info",
};

if (process.argv.includes("--test")) {
  await build({
    ...shared,
    entryPoints: ["tests/harness.ts"],
    outfile: "tests/.generated/harness.js",
  });
} else {
  await Promise.all([
    build({
      ...shared,
      banner: {
        js: "/*! Includes code derived from Playwright v1.51.1 under Apache-2.0. See THIRD_PARTY_NOTICES.md. */",
      },
      entryPoints: ["src/content-runtime.ts"],
      outfile: "dist/content-runtime.js",
    }),
    build({
      ...shared,
      format: "esm",
      entryPoints: ["src/protocol.ts"],
      outfile: "dist/protocol.js",
    }),
  ]);
}
