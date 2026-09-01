import { defineConfig } from "@playwright/test";

// Legacy tests/e2e config. Release-gate suites are:
//   tests/e2e-smoke/playwright.config.mjs
//   tests/e2e-journey/playwright.config.mjs
// Both must stay hermetic via tests/e2e-fixtures/hermetic-harness.mjs.

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.mjs/,
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
});
