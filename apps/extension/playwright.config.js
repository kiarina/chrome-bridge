import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
});
