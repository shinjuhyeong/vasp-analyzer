import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/layout",
  outputDir: "./node_modules/.cache/playwright-test-results",
  fullyParallel: false,
  reporter: "line",
  use: {
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
