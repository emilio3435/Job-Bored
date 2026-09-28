/**
 * apply-checklist-strip.spec.mjs — the apply checklist as a horizontal
 * progress strip (MREV lane CHECKLIST), in a real browser.
 *
 *   K2  one step in focus plus one peek, chevrons, "N steps remaining ·
 *       X completed", a slim track, completed steps in a disclosure
 *   K3  ticks PUT exactly as before; the copy and download actions work
 *   K4  arrows and chevrons move, Space ticks, the progressbar carries
 *       values, focus is visible, 44px targets and no sideways scroll at
 *       375px, reduced motion honoured
 *   K5  empty, all done and error
 *   K6  screenshots at 1440 and 375: not started, mid-way, all done
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs answers Google and the
 * host paths (/profile*, /__proxy/*). The materials API on 127.0.0.1:3847
 * is answered in the browser, never bound: it serves only the paths staged
 * here and records anything else, which each test asserts is empty.
 *
 * Screenshots land in JB_CL_SHOTS_DIR when set, else the test's output.
 */

/* page.evaluate callbacks run in the browser. */
/* global window, document, navigator, getComputedStyle */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  corsHeaders,
  fulfillJson,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const MATERIALS = "http://127.0.0.1:3847";
const SLUG = "harbor-analytics-product-lead";
const ROLE = '[data-region="role"]';
const SECTION = `${ROLE} .brief-materials--rows`;
const NOTE = "Hi Priya, I just applied for the Product Lead role. The pricing launch I ran fits it best.";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 2048, modifiedAt: "2026-09-27T09:00:00.000Z" });

function manifest() {
  return {
    slug: SLUG,
    company: "Harbor Analytics",
    title: "Product Lead",
    derived: false,
    updatedAt: "2026-09-27T09:10:00.000Z",
    documents: [{
      type: "resume",
      label: "Tailored Resume",
      status: "ready",
      primary: "resume.pdf",
      lastModifiedAt: "2026-09-27T09:00:00.000Z",
      files: [FILE("resume.pdf"), FILE("resume.html")],
      text: FILE("resume.txt"),
      exports: { docx: true, linkedin: true },
    }],
    quality: {
      version: "materials-quality.v1",
      status: "fail",
      documents: {
        resume: {
          status: "fail",
          issues: [{ code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" }],
          qa: { runId: "mr_20260927090000_harbor_a1", status: "fail", disposition: "FAIL", dispositionReason: "Resume is missing an experience section.", degraded: [], rubric: { score: 6, max: 12, threshold: 10, rows: [] } },
        },
      },
    },
  };
}

/* Fictional steps with the server's shapes (server/materials-checklist.mjs). */
const STEPS = [
  { id: "resume", label: "Download your tailored resume (PDF)", detail: "It failed its quality check (6 / 12). Repair it or read it closely first.", tone: "warn", action: { kind: "download", doc: "resume", filename: "resume.pdf", gate: true, label: "Download" } },
  { id: "links", label: "Check your portfolio and profile links", detail: "Open each one: portfolio.example.test/sam-okafor." },
  { id: "salary", label: "If the form asks about salary, hold it for the recruiter", detail: "Leave it blank or write \"open to discuss\"." },
  { id: "submit", label: "Submit the application on Harbor Analytics's site", detail: "The posting opens in a new tab.", action: { kind: "open", href: "https://jobs.harbor-analytics.test/product-lead", label: "Open posting" } },
  { id: "outreach", label: "Send a short note to Priya", detail: "Two lines: the role you applied for and the one result that fits it best.", action: { kind: "copy", text: NOTE, label: "Copy note" } },
  { id: "follow-up", label: "Follow up in 7 days", detail: "A short check-in keeps you on their list." },
];

/**
 * The materials API for one test. `opts.done` pre-ticks steps by id;
 * `opts.items` replaces the steps; `opts.failing` answers every checklist
 * GET with a 500 until `seen.heal()`.
 */
async function stubMaterials(page, opts = {}) {
  const seen = { refused: [], puts: [], fileDownloads: [] };
  const done = new Set(opts.done || []);
  const steps = (opts.items || STEPS).map((s) => ({ ...s, done: done.has(s.id), doneAt: done.has(s.id) ? "2026-09-27T12:00:00.000Z" : null }));
  let failing = !!opts.failing;
  seen.heal = () => { failing = false; };
  const envelope = () => ({
    contract: "materials.checklist.v1",
    slug: SLUG,
    updatedAt: new Date().toISOString(),
    progress: { done: steps.filter((i) => i.done).length, total: steps.length },
    items: steps,
  });
  await page.route(`${MATERIALS}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    if (path === "/api/applications" && method === "GET") {
      await fulfillJson(route, { applications: [{ slug: SLUG, company: "Harbor Analytics", title: "Product Lead" }] });
      return;
    }
    if (path === "/api/applications/queue" && method === "GET") {
      await fulfillJson(route, { queue: [] });
      return;
    }
    if (path === `/api/applications/${SLUG}/manifest` && method === "GET") {
      await fulfillJson(route, manifest());
      return;
    }
    if (path === `/api/applications/${SLUG}/job-description` && method === "GET") {
      await fulfillJson(route, { ok: true, exists: true });
      return;
    }
    if (path === `/api/applications/${SLUG}/files/jd-extract.json` && method === "GET") {
      await fulfillJson(route, { nouns: [{ term: "pricing" }] });
      return;
    }
    if (/^\/api\/applications\/[^/]+\/files\/resume\.txt$/.test(path) && method === "GET") {
      await route.fulfill({ status: 200, headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8" }, body: "Sam Okafor\nProduct Lead\n" });
      return;
    }
    if (/^\/api\/applications\/[^/]+\/files\/resume\.pdf$/.test(path) && method === "GET" && url.searchParams.get("download") === "1") {
      seen.fileDownloads.push("resume.pdf");
      await route.fulfill({ status: 200, headers: { ...corsHeaders(), "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="resume.pdf"' }, body: "%PDF-1.4 hermetic" });
      return;
    }
    if (path === `/api/applications/${SLUG}/checklist` && method === "GET") {
      if (failing) {
        await fulfillJson(route, { error: "The checklist store is locked" }, 500);
        return;
      }
      await fulfillJson(route, envelope());
      return;
    }
    if (path === `/api/applications/${SLUG}/checklist` && method === "PUT") {
      const body = request.postDataJSON();
      seen.puts.push(body);
      const item = steps.find((i) => i.id === body.id);
      if (!item) {
        await fulfillJson(route, { error: "Unknown checklist item", code: "unknown_item" }, 400);
        return;
      }
      item.done = body.done === true;
      item.doneAt = item.done ? "2026-09-27T12:00:00.000Z" : null;
      await fulfillJson(route, envelope());
      return;
    }
    seen.refused.push(`${method} ${path}`);
    await fulfillJson(route, { error: "Not staged in this hermetic test", code: "hermetic_refused" }, 503);
  });
  /* Same-origin /profile* never reaches the dev server's proxy. */
  await page.route(/\/profile(\/.*)?(\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).origin === MATERIALS) {
      await route.fallback();
      return;
    }
    await fulfillJson(route, { ok: false, reason: "hermetic_refused" }, 503);
  });
  return seen;
}

function fixtureJobs() {
  const scrapedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  return [{
    title: "Product Lead",
    company: "Harbor Analytics",
    location: "Remote",
    link: "https://jobs.harbor-analytics.test/product-lead",
    source: "Ashby",
    salary: "$170–210k",
    fitScore: 8,
    priority: "⚡",
    tags: "Pricing",
    status: "Researching",
    notes: "",
    followUpDate: "",
    responseFlag: "No",
    favorite: false,
    dateFoundRaw: "2026-09-20",
    _postingEnrichment: {
      roleInOneLine: "Lead pricing and packaging for an analytics product.",
      mustHaves: ["5+ years product"],
      toolsAndStack: ["Amplitude"],
      talkingPoints: ["Ran a pricing launch"],
      requirements: ["B2B SaaS"],
      skills: ["Pricing"],
      scrapedAt,
    },
  }];
}

/** Boot, seed one role, open its Case, and return the checklist strip. */
async function openStrip(page, opts = {}, width = 1440) {
  await page.setViewportSize({ width, height: width < 500 ? 1400 : 1100 });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const seen = await stubMaterials(page, opts);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator("#oneFlowDemoBoard")).toBeVisible({ timeout: 15_000 });
  const seeded = await page.evaluate((jobs) => {
    const core = window.JobBoredApp && window.JobBoredApp.core;
    const render = window.JobBoredApp && window.JobBoredApp.pipelineRender;
    if (!core || typeof core.setPipelineData !== "function" || !render) return false;
    core.setPipelineData(jobs);
    render.renderPipeline();
    if (core.host && typeof core.host.revealDashboardShell === "function") core.host.revealDashboardShell();
    const overrides = window.JobBoredApp.configOverrides;
    if (overrides && typeof overrides.applyConfigOverridesToWindowConfig === "function") {
      overrides.applyConfigOverridesToWindowConfig({ resumeProvider: "webhook" });
    }
    return true;
  }, fixtureJobs());
  expect(seeded, "the pipeline seam is reachable").toBe(true);
  await expect(page.locator('[data-region="pipeline"] .pipe-sticker[data-stable-key="0"]')).toBeAttached({ timeout: 10_000 });
  await page.evaluate(() => window.JobBoredFlowing.openRole.set("0"));
  const section = page.locator(SECTION);
  await expect(section).toBeVisible({ timeout: 15_000 });
  const row = section.locator('[data-doc="manual_apply_checklist"]');
  const strip = row.locator("jb-apply-checklist");
  await expect(strip.locator(".jb-cl__strip")).toBeVisible({ timeout: 10_000 });
  await strip.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return { fence, seen, row, strip };
}

async function shoot(locator, testInfo, name) {
  const dir = process.env.JB_CL_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  const page = locator.page();
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((el) => el.remove()));
  await page.addStyleTag({ content: 'body.jb-v2 [data-region="role"] .case .case__docket { position: static !important; }' });
  await page.mouse.move(0, 0);
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.screenshot({ path: `${dir}/${name}.png`, animations: "disabled" });
}

function expectHermetic(fence, seen) {
  expect(fence.unexpectedExternal, "nothing escaped the hermetic fence").toEqual([]);
  expect(seen.refused, "every materials call this test made was staged").toEqual([]);
  expect(app.hostRequests, "no /profile* or /__proxy/* reached the dev server").toEqual([]);
}

async function expectNoSidewaysScroll(page, width) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(0);
}

async function expectTarget(locator, what) {
  const box = await locator.boundingBox();
  expect(box, `${what} has a box`).not.toBeNull();
  expect(box.height, `${what} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${what} is at least 44px wide`).toBeGreaterThanOrEqual(44);
}

for (const width of [1440, 375]) {
  test.describe(`at ${width}px`, () => {
    test("K2 · K4 · not started: one step in focus, one peek, the track and summary", async ({ page }, testInfo) => {
      const { fence, seen, strip } = await openStrip(page, {}, width);
      await expect(strip.locator(".jb-cl__now")).toHaveCount(1);
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "resume");
      await expect(strip.locator(".jb-cl__now .jb-cl__pos")).toHaveText("Step 1 of 6");
      await expect(strip.locator(".jb-cl__peek")).toHaveCount(1);
      await expect(strip.locator(".jb-cl__peek")).toContainText("Check your portfolio and profile links");
      await expect(strip.locator("[data-item]")).toHaveCount(1);
      await expect(strip.locator(".jb-cl__count")).toHaveText("6 steps remaining · 0 completed");
      const bar = strip.getByRole("progressbar");
      await expect(bar).toHaveAttribute("aria-valuenow", "0");
      await expect(bar).toHaveAttribute("aria-valuemax", "6");
      await expect(strip.locator(".jb-cl__tick")).toHaveCount(6);
      await expect(strip.locator(".jb-cl__done")).toHaveCount(0);
      await expect(strip.getByRole("button", { name: "Previous step" })).toBeDisabled();

      await expectNoSidewaysScroll(page, width);
      if (width === 375) {
        await expectTarget(strip.getByRole("button", { name: "Previous step" }), "the back chevron");
        await expectTarget(strip.getByRole("button", { name: "Next step" }), "the forward chevron");
        await expectTarget(strip.locator(".jb-cl__now .jb-cl__label"), "the step's tick label");
        await expectTarget(strip.locator(".jb-cl__now .jb-cl__input"), "the step's tick box");
        await expectTarget(strip.locator(".jb-cl__peek"), "the peek");
        await expectTarget(strip.locator(".jb-cl__now .jb-cl__btn"), "the step's action");
      }
      await shoot(strip, testInfo, `checklist-not-started-${width}`);
      expectHermetic(fence, seen);
    });

    test("K3 · K4 · mid-way: Space ticks, arrows and chevrons move, completed folds away", async ({ page }, testInfo) => {
      const { fence, seen, row, strip } = await openStrip(page, {}, width);
      /* Arrow right peeks forward; the tick box of the step in view takes focus. */
      await strip.locator(".jb-cl__now .jb-cl__input").focus();
      await page.keyboard.press("ArrowRight");
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "links");
      await expect(strip.locator(".jb-cl__now .jb-cl__input")).toBeFocused();
      await expect(strip.locator(".jb-cl__tick").nth(1)).toHaveClass(/jb-cl__tick--now/);

      /* Space ticks it; the strip hands focus to the next undone step. */
      await page.keyboard.press("Space");
      await expect(strip.locator(".jb-cl__count")).toHaveText("5 steps remaining · 1 completed");
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "salary");
      await expect(strip.locator(".jb-cl__now .jb-cl__input")).toBeFocused();
      await expect(strip.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
      await expect(row.locator(".case__docst")).toHaveText(/1 \/ 6 done/i);

      /* The peek and the chevrons move too. */
      await strip.locator(".jb-cl__peek").click();
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "submit");
      await strip.getByRole("button", { name: "Next step" }).click();
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "outreach");
      await strip.getByRole("button", { name: "Previous step" }).click();
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "submit");
      await page.keyboard.press("ArrowLeft");
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "salary");

      /* A mouse tick works like before. */
      await strip.getByLabel("If the form asks about salary, hold it for the recruiter").check();
      await expect(strip.locator(".jb-cl__count")).toHaveText("4 steps remaining · 2 completed");
      expect(seen.puts).toEqual([{ id: "links", done: true, contact: "" }, { id: "salary", done: true, contact: "" }]);

      /* Completed steps fold into a disclosure, and can be unticked. */
      const done = strip.locator(".jb-cl__done");
      await expect(done.locator("summary")).toHaveText("Review 2 completed steps");
      await expect(done.getByLabel("Check your portfolio and profile links")).toBeHidden();
      await expectNoSidewaysScroll(page, width);
      await shoot(strip, testInfo, `checklist-mid-way-${width}`);
      await done.locator("summary").click();
      await expect(done.getByLabel("Check your portfolio and profile links")).toBeChecked();
      await done.getByLabel("Check your portfolio and profile links").uncheck();
      await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "links");
      await expect(strip.locator(".jb-cl__count")).toHaveText("5 steps remaining · 1 completed");
      expect(seen.puts.at(-1)).toEqual({ id: "links", done: false, contact: "" });
      await expect(strip.locator(".jb-cl__done")).toHaveAttribute("open", "");
      expectHermetic(fence, seen);
    });

    test("K5 · all done: a quiet success, the steps still reviewable", async ({ page }, testInfo) => {
      const { fence, seen, row, strip } = await openStrip(page, { done: STEPS.map((s) => s.id) }, width);
      await expect(strip.locator(".jb-cl__strip")).toHaveAttribute("data-cl-state", "done");
      await expect(strip.locator(".jb-cl__count")).toHaveText("All 6 steps done");
      await expect(strip.locator(".jb-cl__alldone")).toHaveText("Nothing left to do before you apply.");
      await expect(strip.locator(".jb-cl__now")).toHaveCount(0);
      await expect(strip.locator(".jb-cl__tick--done")).toHaveCount(6);
      await expect(strip.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
      await expect(strip.locator(".jb-cl__done summary")).toHaveText("Review 6 completed steps");
      await expect(row.locator(".case__docst")).toHaveText(/6 \/ 6 done/i);
      await expectNoSidewaysScroll(page, width);
      await shoot(strip, testInfo, `checklist-all-done-${width}`);
      expectHermetic(fence, seen);
    });
  });
}

test("K2 · a wide container lays the strip out on one row", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page);
  /* The Case keeps the checklist in a side column at 1440; lift it out to
     prove the one-row layout its container query switches to. */
  await strip.evaluate((el) => {
    el.style.position = "fixed";
    el.style.left = "40px";
    el.style.top = "320px";
    el.style.width = "760px";
    el.style.zIndex = "2147483000";
    el.style.background = "var(--jb-paper)";
  });
  const now = await strip.locator(".jb-cl__now").boundingBox();
  const peek = await strip.locator(".jb-cl__peek").boundingBox();
  const prev = await strip.getByRole("button", { name: "Previous step" }).boundingBox();
  const next = await strip.getByRole("button", { name: "Next step" }).boundingBox();
  expect(prev.x + prev.width).toBeLessThanOrEqual(now.x);
  expect(now.x + now.width).toBeLessThanOrEqual(peek.x);
  expect(peek.x + peek.width).toBeLessThanOrEqual(next.x);
  expect(Math.abs(now.y - peek.y), "the step and the peek share a row").toBeLessThan(2);
  expectHermetic(fence, seen);
});

test("K3 · the copy action still copies the outreach note", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseUrl });
  const { fence, seen, strip } = await openStrip(page, { done: ["resume", "links", "salary", "submit"] });
  await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "outreach");
  await strip.getByRole("button", { name: "Copy note" }).click();
  await expect(strip.locator("[data-cl-note]")).toHaveText("Copied. Paste it into LinkedIn or an email.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NOTE);
  expectHermetic(fence, seen);
});

test("K3 · a FAIL resume download in the strip still asks first", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page);
  const step = strip.locator('.jb-cl__now[data-item="resume"]');
  await step.getByRole("link", { name: "Download" }).click();
  await expect(step.getByRole("alertdialog")).toBeVisible();
  expect(seen.fileDownloads).toEqual([]);
  await step.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(step.getByRole("alertdialog")).toHaveCount(0);
  expectHermetic(fence, seen);
});

test("K4 · focus is visible on the chevron and motion is off under reduced motion", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page);
  expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const next = strip.getByRole("button", { name: "Next step" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "links");
  /* The chevron keeps focus while it can go on, and shows it. */
  await expect(next).toBeFocused();
  const ring = await next.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring, "the focus ring is drawn").not.toBe("none");
  const anim = await strip.locator(".jb-cl__now").evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe("none");
  expectHermetic(fence, seen);
});

test("K4 · arrow keys inside the FAIL confirm never move the strip or dismiss the gate", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page);
  const step = strip.locator('.jb-cl__now[data-item="resume"]');
  await step.getByRole("link", { name: "Download" }).click();
  const confirm = step.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(confirm).toBeVisible();
  await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "resume");
  expect(seen.fileDownloads).toEqual([]);
  expectHermetic(fence, seen);
});

test("K4 · ticking the last open step leaves focus on something visible", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page, { done: ["resume", "links", "salary", "submit", "outreach"] });
  await expect(strip.locator(".jb-cl__now")).toHaveAttribute("data-item", "follow-up");
  await strip.locator(".jb-cl__now .jb-cl__input").focus();
  await page.keyboard.press("Space");
  await expect(strip.locator(".jb-cl__strip")).toHaveAttribute("data-cl-state", "done");
  const sum = strip.locator(".jb-cl__done summary");
  await expect(sum).toBeFocused();
  await expect(sum).toBeVisible();
  /* A second Space opens the review; it never silently unticks a hidden step. */
  await page.keyboard.press("Space");
  expect(seen.puts).toEqual([{ id: "follow-up", done: true, contact: "" }]);
  expectHermetic(fence, seen);
});

test("K5 · an empty checklist says why", async ({ page }) => {
  const { fence, seen, strip } = await openStrip(page, { items: [] });
  await expect(strip.locator(".jb-cl__strip")).toHaveAttribute("data-cl-state", "empty");
  await expect(strip.locator(".jb-cl__empty")).toHaveText("No steps yet. They appear once this role has a resume or cover letter to send.");
  await expect(strip.getByRole("progressbar")).toHaveCount(0);
  expectHermetic(fence, seen);
});

test("K5 · a failed load explains itself and retries", async ({ page }, testInfo) => {
  const { fence, seen, strip } = await openStrip(page, { failing: true });
  const alert = strip.getByRole("alert");
  await expect(alert).toContainText("Couldn’t load the checklist: The checklist store is locked");
  await shoot(strip, testInfo, "checklist-error-1440");
  seen.heal();
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(strip.locator(".jb-cl__count")).toHaveText("6 steps remaining · 0 completed");
  expectHermetic(fence, seen);
});
