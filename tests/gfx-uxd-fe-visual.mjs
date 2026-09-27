/* GFX UXD-FE — live run progress in a real browser.
 *
 * Run explicitly: `node --test tests/gfx-uxd-fe-visual.mjs`. It is not a
 * *.test.mjs file on purpose: `npm test` (scripts/run-tests.mjs) collects
 * those, and CI's `test` job installs no Chromium.
 *
 * The page is a fixture served from the hermetic port-0 dev-server: every
 * stylesheet index.html links (same order, so the real cascade), the real
 * Runs-modal and discovery-drawer partial markup, and the real render code
 * (discovery-run-tracker.js, runs-tab.js, discovery-drawer.js). No request
 * leaves the in-process server; nothing touches :8080/:8644/:3847.
 *
 * Screenshots land in .lane-evidence/ at 1440 and 375 px.
 */
/* global document, window, matchMedia, getComputedStyle -- evaluated in the browser page */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium } from "playwright";
import { REPO_ROOT, startHermeticApp } from "./e2e-fixtures/hermetic-harness.mjs";

const EVIDENCE = join(REPO_ROOT, ".lane-evidence");
const FIXTURE_PATH = "/__uxd-fe-fixture.html";

const indexHtml = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
const stylesheets = [...indexHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((href) => !/^https?:/.test(href));
const runsModalHtml = readFileSync(join(REPO_ROOT, "partials/discovery-runs-modal.html"), "utf8");
const drawerHtml = readFileSync(join(REPO_ROOT, "partials/discovery-drawer.html"), "utf8");

const fixtureHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${stylesheets.map((href) => `<link rel="stylesheet" href="/${href.replace(/^\//, "")}">`).join("\n")}
</head>
<body class="jb-v2">
<button type="button" class="btn btn-discovery run-running" id="discoveryBtn">Run discovery</button>
${runsModalHtml}
${drawerHtml}
<script src="/jb-a11y.js"></script>
<script src="/discovery-run-tracker.js"></script>
<script src="/runs-tab.js"></script>
<script src="/discovery-drawer.js"></script>
</body></html>`;

const PROGRESS = {
  phase: "scout",
  sequence: 14,
  checkpointedAt: "2026-09-26T21:00:00.000Z",
  heartbeatAt: "2026-09-26T21:00:00.000Z",
  counters: {
    companiesTotal: 3,
    companiesDone: 1,
    boardsDetected: 12,
    listingsSeen: 214,
    listingsProcessed: 90,
    leadsQualified: 4,
    matcherCalls: 8,
    queriesTotal: 5,
    queriesDone: 2,
  },
  current: { kind: "company", label: "Figma" },
  sources: [
    { id: "ats", state: "running", done: 1, total: 3 },
    { id: "serpapi_google_jobs", state: "running", done: 2, total: 5 },
  ],
};

let app;
let browser;

before(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  app = await startHermeticApp();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await app?.close();
});

async function openFixture({ width, reducedMotion = "no-preference" }) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 812 : 900 } });
  await page.emulateMedia({ reducedMotion });
  const origin = new URL(app.baseUrl).origin;
  const external = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === FIXTURE_PATH) {
      return route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml });
    }
    if (url.origin !== origin || /^\/(__proxy\/|profile)/.test(url.pathname)) {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(app.baseUrl + FIXTURE_PATH, { waitUntil: "load" });
  return { page, external };
}

/** Put the tracker in a live state `ageMs` after the last observed change. */
async function stageRun(page, { progress = PROGRESS, ageMs = 4000, status = "running" } = {}) {
  await page.evaluate(
    ({ progress, ageMs, status }) => {
      const now = Date.now();
      const rt = window.JobBoredDiscovery.runTracker;
      const t = rt.discoveryRunTracker;
      t.beginTracking({ runId: "run_fixture", statusPath: "/runs/run_fixture" });
      t._now = () => now - ageMs;
      t.updateFromStatusResponse({
        runId: "run_fixture",
        status,
        terminal: false,
        message: "",
        startedAt: new Date(now - 272_000).toISOString(),
        ...(progress ? { progress } : {}),
      });
      t._now = () => Date.now();
    },
    { progress, ageMs, status },
  );
}

async function showRunsModal(page) {
  await page.evaluate(() => {
    const t = window.JobBoredDiscovery.runTracker.discoveryRunTracker;
    const api = window.JobBoredRunsLog.__test;
    const run = api.normalizeJobDiscoveryRunState({ state: t.getState() });
    const modal = document.getElementById("runsModal");
    modal.style.display = "flex";
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    api.renderRunsTable(document.getElementById("runsTableBody"), [], { liveJobRun: run });
  });
}

async function showDrawer(page) {
  await page.evaluate(() => {
    const drawer = document.getElementById("discoveryDrawer");
    drawer.hidden = false;
    drawer.style.display = "flex";
    window.JobBoredDiscovery.drawer.syncDiscoveryDrawerLiveRun();
  });
}

describe("UXD-FE visual: live progress in the Runs modal and drawer", () => {
  for (const width of [1440, 375]) {
    it(`UXD-FE-35 Runs live row renders the contract at ${width}px without overflow`, async () => {
      const { page, external } = await openFixture({ width });
      await stageRun(page);
      await showRunsModal(page);
      const row = page.locator("[data-live-run-progress] .jb-live-run");
      await row.waitFor();
      assert.match(await row.innerText(), /Checking Figma/);
      assert.equal(await row.locator('[aria-current="step"]').count(), 1);
      const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `progress block overflows by ${overflow}px`);
      await page.locator("#runsModal .runs-table-wrap").screenshot({
        path: join(EVIDENCE, `uxd-fe-runs-live-${width}.png`),
      });
      assert.deepEqual(external, []);
      await page.close();
    });

    it(`UXD-FE-36 drawer card shows the run and a stall honestly at ${width}px`, async () => {
      const { page, external } = await openFixture({ width });
      await stageRun(page);
      await showDrawer(page);
      const card = page.locator(".dp-live-run .jb-live-run");
      await card.waitFor();
      await page.locator(".dp-live-run").screenshot({
        path: join(EVIDENCE, `uxd-fe-drawer-working-${width}.png`),
      });
      await stageRun(page, { ageMs: 150_000 });
      await page.evaluate(() => window.JobBoredDiscovery.drawer.syncDiscoveryDrawerLiveRun());
      assert.equal(await card.getAttribute("data-health"), "stalled");
      assert.match(await card.innerText(), /may have stopped/);
      await page.locator(".dp-live-run").screenshot({
        path: join(EVIDENCE, `uxd-fe-drawer-stalled-${width}.png`),
      });
      assert.deepEqual(external, []);
      await page.close();
    });
  }

  it("UXD-FE-37 legacy (no progress) row: elapsed + note, no phase line", async () => {
    const { page } = await openFixture({ width: 1440 });
    await stageRun(page, { progress: null });
    await showRunsModal(page);
    const row = page.locator("[data-live-run-progress] .jb-live-run");
    await row.waitFor();
    assert.equal(await row.getAttribute("data-mode"), "legacy");
    assert.equal(await row.locator(".jb-live-run__steps").count(), 0);
    assert.match(await row.innerText(), /doesn't send step-by-step progress/);
    await page.locator("#runsModal .runs-table-wrap").screenshot({
      path: join(EVIDENCE, "uxd-fe-runs-legacy-1440.png"),
    });
    await page.close();
  });

  it("UXD-FE-38 elapsed keeps moving between polls (drawer one-second tick)", async () => {
    const { page } = await openFixture({ width: 1440 });
    await stageRun(page);
    await showDrawer(page);
    const elapsed = page.locator(".dp-live-run .jb-live-run__elapsed");
    const first = await elapsed.innerText();
    await page.waitForTimeout(2100);
    const second = await elapsed.innerText();
    assert.notEqual(second, first, "elapsed must tick without a new poll");
    await page.close();
  });
});

describe("UXD-FE visual: motion", () => {
  it("UXD-FE-39 the live dot breathes only when motion is welcome", async () => {
    const { page } = await openFixture({ width: 1440 });
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), false);
    await stageRun(page);
    await showDrawer(page);
    const dot = page.locator(".dp-live-run .jb-live-run__dot");
    assert.equal(await dot.evaluate((el) => getComputedStyle(el).animationName), "jb-live-run-breathe");
    await page.close();
  });

  it("UXD-FE-40 reduced motion stops the live dot and the button pulse", async () => {
    const { page } = await openFixture({ width: 1440, reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    await stageRun(page);
    await showDrawer(page);
    const dot = page.locator(".dp-live-run .jb-live-run__dot");
    assert.equal(await dot.evaluate((el) => getComputedStyle(el).animationName), "none");
    const pulse = await page.evaluate(
      () => getComputedStyle(document.getElementById("discoveryBtn"), "::before").animationName,
    );
    assert.equal(pulse, "none");
    await page.close();
  });

  it("UXD-FE-41 a stalled run stops the button pulse even with motion allowed", async () => {
    const { page } = await openFixture({ width: 1440 });
    const before = await page.evaluate(
      () => getComputedStyle(document.getElementById("discoveryBtn"), "::before").animationName,
    );
    assert.equal(before, "jb-run-pulse");
    await page.evaluate(() => document.getElementById("discoveryBtn").setAttribute("data-run-health", "stalled"));
    const after = await page.evaluate(
      () => getComputedStyle(document.getElementById("discoveryBtn"), "::before").animationName,
    );
    assert.equal(after, "none");
    await page.close();
  });
});
