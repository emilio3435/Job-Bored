import { defineConfig } from "@playwright/test";

// Critical product journey suite. Run with:
//   npm run test:e2e-journey
//
// Kept separate from the broad root Playwright config and the fast boot smoke
// suite so CI can retain focused traces for a broken user journey.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
