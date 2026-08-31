import { defineConfig } from "@playwright/test";

// Critical product journey suite. Run with:
//   npm run test:e2e-journey
//
// Kept separate from the broad root Playwright config and the fast boot smoke
// suite so CI can retain focused traces for a broken user journey. Specs must
// use tests/e2e-fixtures/hermetic-harness.mjs for disposable signed-in state
// and the network fence. CI: advisory until Gates A–D; see
// docs/HERMETIC-BROWSER-GATE.md.
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
