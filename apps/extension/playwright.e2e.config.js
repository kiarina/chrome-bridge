import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 180_000,
  outputDir: "test-results/e2e",
});
