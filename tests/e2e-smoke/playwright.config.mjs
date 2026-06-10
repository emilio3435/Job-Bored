import { defineConfig } from "@playwright/test";

// Boot-and-visibility smoke suite. Run with:
//   npm run test:e2e-smoke
// (or: npx playwright test --config tests/e2e-smoke/playwright.config.mjs)
//
// Kept separate from the root playwright.config.mjs (tests/e2e) so CI can run
// just this fast, hermetic suite. scripts/run-tests.mjs never picks these
// files up — the unit gate stays browser-free.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  // Headroom for slow externals (Google Fonts/GSI) on congested runners;
  // a healthy run finishes each test in well under 10s.
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
