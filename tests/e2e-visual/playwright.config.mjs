import { defineConfig } from "@playwright/test";

// SIXBEATS visual gate. Run with:
//   npm run test:e2e-visual
//
// The third browser suite, beside tests/e2e-smoke (boot) and
// tests/e2e-journey (the product promise). This one keeps the program's
// LOOK honest: structure, bounding boxes, and computed styles at the two
// viewports the SIXBEATS lanes shipped against.
//
// Deliberately NOT pixel diffing. Font rasterization, DPR, and the
// Google Fonts stub differ machine to machine, so a screenshot baseline
// would fail for reasons that have nothing to do with the claims. What
// is asserted instead is what a designer would actually check: is the
// header there, is the ask on screen, is there ONE progress system, can
// the thumb reach the actions, and does anything overflow sideways.
//
// Specs must use tests/e2e-fixtures/hermetic-harness.mjs — no live
// Google, no Sheets, no config.js in the checkout.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  // One retry on CI only, so a single runner-congestion timeout reports the
  // test as "flaky" instead of failing the job. Locally a failure is final.
  // trace retain-on-failure keeps the failed attempt's trace for diagnosis.
  retries: process.env.CI ? 1 : 0,
  // A normal run never writes a screenshot baseline (leads.spec.mjs); record
  // one only with an explicit --update-snapshots=missing.
  updateSnapshots: "none",
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
