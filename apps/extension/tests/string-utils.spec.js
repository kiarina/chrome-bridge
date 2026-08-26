import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.join(directory, ".generated", "harness.js");

test("escapes backticks when generating a backtick-quoted string", async ({
  page,
}) => {
  await page.addScriptTag({ path: harnessPath });

  const escaped = await page.evaluate(() =>
    globalThis.chromeBridgeSnapshotTest.escapeWithQuotes("before`after", "`"),
  );

  expect(escaped).toBe("`before\\`after`");
});
