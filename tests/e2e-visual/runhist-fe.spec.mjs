/* RUNHIST FE — the Runs modal in a real browser.
 *
 * Hermetic by construction: the page is served from disk through page.route
 * on a fake origin, the worker (GET /runs, GET /runs/:id) and Google Sheets
 * are answered by route stubs, and installHostIsolation refuses everything
 * else (including same-origin /profile/* and /__proxy/*). No port is bound.
 * Real runs-tab.js + discovery-status-handoff.js + the real stylesheets.
 *
 * Screenshots land in .lane-evidence/ for the lane report.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import {
  detailLegacy,
  detailRunA,
  listPage1,
  listPage2,
  manyCompanies,
  repoRoot,
  sheetValues,
} from "../runhist-fe-fixtures.mjs";

const ORIGIN = "http://runhist.test";
const WORKER = "http://127.0.0.1:18999";
const EVIDENCE = join(repoRoot, ".lane-evidence");
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

// Every stylesheet index.html links, in its cascade order.
const STYLESHEETS = ["vendor/fonts/fonts.css", "tokens-v2.css", "style.css", "css/onboarding-celebration.css", "css/login-gate.css", "css/overlay.css", "css/brief.css", "css/cards-drawer.css", "css/materials.css", "css/discovery-setup-wizard.css", "css/materials-modal.css", "css/settings-profile.css", "css/runs-log.css", "css/discovery-drawer.css", "css/discovery-run-preview.css", "css/fit-profile-overlay.css", "css/discovery-coachmark.css", "settings-tabs.css", "jb-v2.css", "jb-type.css", "jb-deco.css", "jb-ui.css", "jb-a11y.css", "dawn.css", "today.css", "flowing-chrome.css", "pipeline.css", "role.css", "role-case.css", "recruiter-strip.css", "materials-queue.css", "scribe-v2.css", "fit-profile.css", "css/oneflow.css", "jb-v2-legacy-hide.css"];
const TYPES = { ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".html": "text/html" };

function pageHtml() {
  const partial = readFileSync(join(repoRoot, "partials/discovery-runs-modal.html"), "utf8");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${STYLESHEETS.map((h) => `<link rel="stylesheet" href="/${h}">`).join("\n")}
<script>
  window.JobBored = { getSheetId: () => "sheet_example", getAccessToken: () => "token-example" };
  window.JobBoredDiscovery = {
    runTracker: { discoveryRunTracker: { getState: () => ({}) } },
    status: { host: {
      getDiscoveryWebhookUrl: () => "${WORKER}/webhook",
      normalizeDiscoveryWebhookIdentity: (u) => String(u || "").trim(),
      isLocalDashboardOrigin: () => false,
      getConfigCore: () => ({ getDiscoveryWebhookSecret: () => "" }),
      showToast() {},
    } },
  };
</script>
</head><body class="jb-v2">
<button type="button" id="runsBtn">Runs</button>
${partial}
<script src="/discovery-status-handoff.js"></script>
<script src="/runs-tab.js"></script>
</body></html>`;
}

function cors(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

/** Fence: only the fake origin's static files and the named stubs answer. */
async function installHostIsolation(page, opts = {}) {
  const calls = { list: [], detail: [] };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) {
      if (url.pathname.startsWith("/__proxy/") || url.pathname.startsWith("/profile/")) {
        return route.fulfill({ status: 404, body: "fenced" });
      }
      if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: pageHtml() });
      const file = join(repoRoot, decodeURIComponent(url.pathname));
      if (!file.startsWith(repoRoot) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        status: 200,
        contentType: TYPES[extname(file)] || "application/octet-stream",
        body: readFileSync(file),
      });
    }
    if (url.origin === WORKER) {
      if (url.pathname === "/runs") {
        calls.list.push(url.search);
        if (opts.workerDown) return route.abort("connectionrefused");
        return route.fulfill(cors(url.searchParams.get("before") === "cursor_1" ? listPage2() : listPage1()));
      }
      const m = /^\/runs\/([^/]+)$/.exec(url.pathname);
      if (m) {
        calls.detail.push(m[1]);
        if (m[1] === "run_a") {
          const d = detailRunA();
          d.runStats.searched.companies = manyCompanies(16).map((c, i) => ["Figma", "Notion", "Linear"][i] || c);
          return route.fulfill(cors(d));
        }
        return route.fulfill(cors({ ...detailLegacy(), runId: m[1] }));
      }
    }
    if (url.hostname === "sheets.googleapis.com") {
      return route.fulfill(cors({ values: sheetValues() }));
    }
    return route.abort("blockedbyclient");
  });
  return calls;
}

async function openRuns(page) {
  await page.goto(`${ORIGIN}/`);
  await page.click("#runsBtn");
  await expect(page.locator("#runsTableBody .runs-row").first()).toBeVisible();
}

/** Evidence only: let the table grow so a whole story fits one screenshot. */
async function unclipForEvidence(page) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 2400 });
  await page.addStyleTag({
    content: ".runs-modal{max-height:none!important;overflow:visible!important}" +
      ".runs-table-wrap{overflow:visible!important}#runsModal{overflow:auto!important}",
  });
}

test.beforeAll(() => mkdirSync(EVIDENCE, { recursive: true }));

test("lists worker and Sheet history newest first, joined by Run ID", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const calls = await installHostIsolation(page);
  await openRuns(page);
  const rows = page.locator("#runsTableBody tr.runs-row");
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#runsStatus")).toHaveText(/Showing 4 of 4 runs\.$/);
  expect(calls.detail).toEqual([]);
  await expect(page.locator("#runsShowMoreBtn")).toBeVisible();
  await page.locator(".runs-modal").screenshot({ path: join(EVIDENCE, "runhist-list-1440.png") });
});

test("expanding a run lazily loads its story once; keyboard and aria stay in step", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const calls = await installHostIsolation(page);
  await openRuns(page);
  const toggle = page.locator("#runsTableBody tr.runs-row").nth(1).locator(".runs-row-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panelId = await toggle.getAttribute("aria-controls");
  const region = page.locator(`#${panelId} [role="region"]`);
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("aria-labelledby", await toggle.getAttribute("id"));
  await expect(region.locator('[data-runs-section="funnel"]')).toBeVisible();
  await expect(region.locator(".runs-story__lede")).toHaveText(
    "Saved 9 new roles and updated 3 from 539 listings in 8m 32s.",
  );
  await expect(page.getByRole("region", { name: /Sep|:/ })).toHaveCount(1);
  expect(calls.detail).toEqual(["run_a"]);

  // "+N more" discloses the rest of the companies.
  const more = region.locator("[data-runs-more]").first();
  await expect(more).toHaveText("+4 more");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(region.getByText("Company 16", { exact: true })).toBeVisible();
  await more.click();

  await page.waitForTimeout(700);
  await unclipForEvidence(page);
  await region.screenshot({ path: join(EVIDENCE, "runhist-detail-1440.png") });
  await page.locator(".runs-modal").screenshot({ path: join(EVIDENCE, "runhist-modal-open-1440.png") });

  // Collapse and reopen: no second fetch, focus stays on the toggle.
  await page.keyboard.press("Tab");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(`#${panelId}`)).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(region.locator('[data-runs-section="fit"]')).toBeVisible();
  expect(calls.detail).toEqual(["run_a"]);
  await expect(toggle).toBeFocused();
});

test("an older run and a Sheet-only row render the coarse view", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const calls = await installHostIsolation(page);
  await openRuns(page);
  const workerOld = page.locator("#runsTableBody tr.runs-row").nth(0).locator(".runs-row-toggle");
  await workerOld.click();
  const oldPanel = page.locator(`#${await workerOld.getAttribute("aria-controls")}`);
  await expect(oldPanel).toContainText("Detailed stats weren’t recorded for this run.");
  await expect(oldPanel.locator("[data-runs-section]")).toHaveCount(0);
  const sheetOnly = page.locator("#runsTableBody tr.runs-row").nth(3).locator(".runs-row-toggle");
  await sheetOnly.click();
  await expect(page.locator(`#${await sheetOnly.getAttribute("aria-controls")}`)).toContainText("Trigger");
  expect(calls.detail).toEqual(["run_d"]);
});

test("show more pages the worker history with its cursor", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const calls = await installHostIsolation(page);
  await openRuns(page);
  await page.click("#runsShowMoreBtn");
  await expect(page.locator("#runsTableBody tr.runs-row")).toHaveCount(5);
  expect(calls.list.some((q) => q.includes("before=cursor_1"))).toBe(true);
  await expect(page.locator("#runsShowMoreBtn")).toBeHidden();
});

test("worker unreachable: the Sheet history lists with a quiet note, no spinner", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installHostIsolation(page, { workerDown: true });
  await openRuns(page);
  await expect(page.locator("#runsTableBody tr.runs-row")).toHaveCount(3);
  await expect(page.locator("#runsStatus")).toContainText("these rows come from your Sheet.");
  await expect(page.locator("#runsStatus")).not.toHaveClass(/runs-status--error/);
  await expect(page.locator(".runs-row--skeleton")).toHaveCount(0);
  await page.locator(".runs-modal").screenshot({ path: join(EVIDENCE, "runhist-worker-down-1440.png") });
});

test("the reveal animates once and not at all under reduced motion", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await installHostIsolation(page);
  await openRuns(page);
  const toggle = page.locator("#runsTableBody tr.runs-row").nth(1).locator(".runs-row-toggle");
  await toggle.click();
  await expect(page.locator('[data-runs-section="funnel"]')).toBeVisible();
  const moving = await page.evaluate(() => globalThis.document.getAnimations().length);
  expect(moving).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await toggle.click();
  await page.evaluate(() => globalThis.document.getAnimations().forEach((a) => a.finish()));
  await toggle.click();
  const still = await page.evaluate(() =>
    globalThis.document.getAnimations()
      // The reveal is a CSS animation; hover colour transitions on the outer
      // row cells answer the pointer and are not part of this claim.
      .filter((a) => a.playState === "running" && a.constructor.name === "CSSAnimation")
      .map((a) => `${a.animationName || a.constructor.name} on ${a.effect && a.effect.target ? a.effect.target.className : "?"}`),
  );
  expect(still).toEqual([]);
  const anim = await page.locator(".runs-funnel__bar").first().evaluate((el) => globalThis.getComputedStyle(el).animationName);
  expect(anim).toBe("none");
});

test("375 px: the story stacks without sideways scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await installHostIsolation(page);
  await openRuns(page);
  const toggle = page.locator("#runsTableBody tr.runs-row").nth(1).locator(".runs-row-toggle");
  await toggle.click();
  const region = page.locator(`#${await toggle.getAttribute("aria-controls")} .runs-story`);
  await expect(region.locator('[data-runs-section="timeline"]')).toBeVisible();
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const regionOverflow = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(regionOverflow).toBeLessThanOrEqual(0);
  const nums = await region.locator(".runs-story__num").first().evaluate((el) => globalThis.getComputedStyle(el).fontVariantNumeric);
  expect(nums).toContain("tabular-nums");
  await unclipForEvidence(page);
  await region.screenshot({ path: join(EVIDENCE, "runhist-detail-375.png") });
  await page.screenshot({ path: join(EVIDENCE, "runhist-modal-375.png"), fullPage: false });
});

