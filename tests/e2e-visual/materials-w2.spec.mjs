/**
 * materials-w2.spec.mjs — Materials Wave 2 in a real browser.
 *
 *   U-1  a FAIL draft asks in the page before Download, then downloads
 *   U-4  a drafting row shows the seven named steps, a fallback in amber,
 *        and no raw "stage: status" strings
 *   U-3  the Download menu (PDF, ATS text, Word, LinkedIn copy); a REVIEW
 *        draft downloads without a confirm
 *   U-5  Draft both sends one resume request that queues the letter, and
 *        the letter row says it is next in line
 *   ✓    the manual-apply checklist ticks, persists and counts progress
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs answers Google and the
 * host paths. This spec registers its own routes after the fence: the
 * materials API on 127.0.0.1:3847 answers only the paths each test stages
 * and refuses everything else (recorded, and asserted empty), and /profile*
 * is refused outright — nothing reaches the live :3847 server or the
 * dev server's proxy to it.
 *
 * Screenshots (1440 and 390) land in JB_W2_SHOTS_DIR when set, else in the
 * test's output folder.
 */

/* page.evaluate callbacks run in the browser. */
/* global window, document */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { W3_INTEL, W3_MANIFEST_EXTRA, W3_OUTREACH } from "../fixtures/materials-w3-package.mjs";
import {
  corsHeaders,
  fulfillJson,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const MATERIALS = "http://127.0.0.1:3847";
const SLUG = "meridian-labs-senior-product-manager";
const ROLE = '[data-region="role"]';
const SECTION = `${ROLE} .brief-materials--rows`;

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function shotsDir(testInfo) {
  const dir = process.env.JB_W2_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 2048, modifiedAt: "2026-09-27T09:00:00.000Z" });

function doc(type) {
  const stem = type === "resume" ? "resume" : "cover-letter";
  return {
    type,
    label: type === "resume" ? "Tailored Resume" : "Cover Letter",
    status: "ready",
    primary: `${stem}.pdf`,
    lastModifiedAt: "2026-09-27T09:00:00.000Z",
    files: [FILE(`${stem}.pdf`), FILE(`${stem}.html`)],
    text: FILE(`${stem}.txt`),
    exports: { docx: true, linkedin: type === "resume" },
  };
}

/* The Northwind failure the spec traced, on this fixture role. */
const QUALITY = {
  version: "materials-quality.v1",
  status: "fail",
  documents: {
    resume: {
      status: "fail",
      issues: [{ code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" }],
      qa: {
        runId: "mr_20260927090000_meridian_a1",
        status: "fail",
        disposition: "FAIL",
        dispositionReason: "Resume is missing an experience section.",
        degraded: [
          "jd.extract: deterministic half (output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts)",
          "claims.select: deterministic ranks (reply was not valid JSON after 2 attempts)",
        ],
        rubric: {
          score: 6, max: 12, threshold: 10,
          rows: [
            { id: "outcome_coverage", score: 0, max: 2, note: "0/3 outcomes mapped by kept claims" },
            { id: "noun_fidelity", score: 0, max: 2, note: "0/24 role nouns appear in the resume" },
            { id: "proof_density", score: 1, max: 2, note: "1/4 kept claims carry metrics" },
            { id: "transfer_honesty", score: 2, max: 2, note: "every tool is evidenced" },
            { id: "delint_clean", score: 2, max: 2, note: "clean" },
            { id: "underfill", score: 1, max: 2, note: "page 48% full; 0 experience bullets" },
          ],
        },
      },
    },
    cover_letter: {
      status: "review",
      issues: [{ code: "metric_in_letter", message: "The letter carries no traced number.", severity: "review" }],
      qa: {
        runId: "mr_20260927091000_meridian_b2",
        status: "review",
        disposition: "REVIEW",
        dispositionReason: "The letter carries no traced number.",
        degraded: [],
        rubric: {
          score: 9, max: 12, threshold: 10,
          rows: [
            { id: "company_specificity", score: 2, max: 2, note: "names Meridian Labs twice" },
            { id: "metric_in_letter", score: 0, max: 2, note: "no traced metric" },
            { id: "sounds_human", score: 2, max: 2, note: "no tells" },
          ],
        },
      },
    },
  },
};

function readyManifest() {
  return {
    slug: SLUG,
    company: "Meridian Labs",
    title: "Senior Product Manager",
    derived: false,
    updatedAt: "2026-09-27T09:10:00.000Z",
    runId: "mr_20260927091000_meridian_b2",
    documents: [doc("resume"), doc("cover_letter")],
    quality: QUALITY,
  };
}

/* MREV G8: a current run records the K7 stages (prepare, write,
   validate, render, judge, save, plus an optional repair pass). */
const STAGES_MID_RUN = [
  { stage: "prepare", status: "ok", ms: 40 },
  { stage: "write", status: "review", ms: 9000, degraded: true, reason: "fell back to rules: output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts" },
  { stage: "validate", status: "ok", ms: 12 },
];

/* A run recorded before MREV keeps its old step names. */
const LEGACY_STAGES_MID_RUN = [
  { stage: "intake", status: "ok" },
  { stage: "jd.resolve", status: "ok" },
  { stage: "jd.gate", status: "ok" },
  { stage: "claims.load", status: "ok" },
  { stage: "cache.lookup", status: "ok" },
  { stage: "jd.extract", status: "review", reason: "fell back to rules: output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts" },
  { stage: "claims.score", status: "ok" },
  { stage: "claims.select", status: "ok" },
  { stage: "outline", status: "ok" },
];

function draftingManifest({ feature = "resume", next, stages = STAGES_MID_RUN, docs = [] } = {}) {
  return {
    slug: SLUG,
    company: "Meridian Labs",
    title: "Senior Product Manager",
    derived: false,
    updatedAt: "2026-09-27T09:00:00.000Z",
    documents: docs,
    pending: {
      feature,
      company: "Meridian Labs",
      title: "Senior Product Manager",
      jobUrl: "https://jobs.meridian-labs.test/senior-pm",
      requestedAt: new Date(Date.now() - 20_000).toISOString(),
      notes: "",
      source: "jobbored-dossier",
      ...(next ? { next } : {}),
      progress: {
        phase: "drafting",
        message: "Writing your resume…",
        startedAt: new Date(Date.now() - 14_000).toISOString(),
        updatedAt: new Date().toISOString(),
        attempt: 1,
        elapsedSeconds: 14,
        stages,
      },
    },
  };
}

const CHECKLIST_ITEMS = [
  { id: "resume", label: "Download your tailored resume (PDF)", detail: "It failed its quality check. Repair it or read it closely first.", tone: "warn", action: { kind: "download", doc: "resume", filename: "resume.pdf", gate: true, label: "Download" } },
  { id: "letter", label: "Review your cover letter", detail: "Quality check says review. Give it a read.", action: { kind: "preview", doc: "cover_letter", filename: "cover-letter.html", label: "Read it" } },
  { id: "links", label: "Check your portfolio and profile links", detail: "Open each one: linkedin.com/in/jordan-rivera." },
  { id: "salary", label: "If the form asks about salary, hold it for the recruiter", detail: "Your voice guide: \"Hold comp for the recruiter call.\"" },
  { id: "submit", label: "Submit the application on Meridian Labs's site", detail: "The posting opens in a new tab.", action: { kind: "open", href: "https://jobs.meridian-labs.test/senior-pm", label: "Open posting" } },
  { id: "confirmation", label: "Save the confirmation", detail: "Keep the confirmation email or a screenshot of the thank-you page." },
  { id: "outreach", label: "Send a short note to Dana", detail: "Two lines: the role you applied for and the one result that fits it best." },
  { id: "follow-up", label: "Follow up in 7 days", detail: "7 days after you submit, a short check-in keeps you on their list." },
  { id: "status", label: "Mark the role Applied in your pipeline", detail: "Moves the card and records the date in your sheet.", action: { kind: "stage", stage: "applied", label: "Mark Applied" } },
];

/**
 * The materials API for one test. `state.manifest()` answers the manifest;
 * every path not staged here is refused (503) and recorded.
 */
async function stubMaterials(page, state) {
  const seen = { refused: [], requests: [], fileDownloads: [], checklistPuts: [] };
  const checklist = CHECKLIST_ITEMS.map((i) => ({ ...i, done: false, doneAt: null }));
  const envelope = () => ({
    contract: "materials.checklist.v1",
    slug: SLUG,
    updatedAt: new Date().toISOString(),
    progress: { done: checklist.filter((i) => i.done).length, total: checklist.length },
    items: checklist,
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
      await fulfillJson(route, { applications: [{ slug: SLUG, company: "Meridian Labs", title: "Senior Product Manager" }] });
      return;
    }
    if (path === "/api/applications/queue" && method === "GET") {
      await fulfillJson(route, { queue: [] });
      return;
    }
    if (path === `/api/applications/${SLUG}/manifest` && method === "GET") {
      await fulfillJson(route, state.manifest());
      return;
    }
    if (path === `/api/applications/${SLUG}/job-description` && method === "GET") {
      await fulfillJson(route, { ok: true, exists: true });
      return;
    }
    if (path === `/api/applications/${SLUG}/request` && method === "POST") {
      seen.requests.push(request.postDataJSON());
      if (state.onRequest) state.onRequest(request.postDataJSON());
      await fulfillJson(route, { ok: true, slug: SLUG, accepted: true });
      return;
    }
    const staged = /^\/api\/applications\/[^/]+\/files\/([^/]+)$/.exec(path);
    if (staged && method === "GET" && state.files && Object.prototype.hasOwnProperty.call(state.files, staged[1])) {
      await fulfillJson(route, state.files[staged[1]]);
      return;
    }
    if (path === `/api/applications/${SLUG}/files/jd-extract.json` && method === "GET") {
      await fulfillJson(route, { nouns: [{ term: "roadmap" }, { term: "pricing" }, { term: "experimentation" }, { term: "B2B SaaS" }] });
      return;
    }
    const file = /^\/api\/applications\/[^/]+\/(files|export)\/([^/]+)$/.exec(path);
    if (file && method === "GET") {
      const name = decodeURIComponent(file[2]);
      if (/\.txt$/.test(name)) {
        const body = "Jordan Rivera\nSenior Product Manager\n\nEXPERIENCE\n- Owned the pricing roadmap for a B2B SaaS line.\n";
        if (url.searchParams.get("download") === "1") seen.fileDownloads.push(name);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8", ...(url.searchParams.get("download") === "1" ? { "content-disposition": `attachment; filename="${name}"` } : {}) },
          body,
        });
        return;
      }
      if (/\.(pdf|docx)$/.test(name) && url.searchParams.get("download") === "1") {
        seen.fileDownloads.push(name);
        await route.fulfill({
          status: 200,
          headers: { ...corsHeaders(), "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"` },
          body: "%PDF-1.4 hermetic",
        });
        return;
      }
    }
    if (path === `/api/applications/${SLUG}/checklist` && method === "GET") {
      await fulfillJson(route, envelope());
      return;
    }
    if (path === `/api/applications/${SLUG}/checklist` && method === "PUT") {
      const body = request.postDataJSON();
      seen.checklistPuts.push(body);
      const item = checklist.find((i) => i.id === body.id);
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
    title: "Senior Product Manager",
    company: "Meridian Labs",
    location: "Austin, TX",
    link: "https://jobs.meridian-labs.test/senior-pm",
    source: "Ashby",
    salary: "$185–230k",
    fitScore: 8,
    priority: "⚡",
    tags: "Pricing, B2B SaaS",
    status: "Researching",
    notes: "",
    followUpDate: "",
    responseFlag: "No",
    favorite: false,
    dateFoundRaw: "2026-09-20",
    _postingEnrichment: {
      roleInOneLine: "Own pricing and the roadmap that ships it.",
      mustHaves: ["5+ years B2B SaaS product"],
      toolsAndStack: ["Amplitude"],
      talkingPoints: ["Shipped usage-based pricing"],
      requirements: ["B2B SaaS"],
      skills: ["Pricing"],
      scrapedAt,
    },
  }];
}

/** Boot, seed one role through the app's own setter, open its Case. */
async function openCase(page, state, { width = 1440, height = 1000 } = {}) {
  await page.setViewportSize({ width, height });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const seen = await stubMaterials(page, state);
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
  await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
  return { fence, seen, section };
}

async function shoot(locator, testInfo, name) {
  const page = locator.page();
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((el) => el.remove()));
  /* The sticky docket would paint over a tall element's capture. */
  await page.addStyleTag({ content: 'body.jb-v2 [data-region="role"] .case .case__docket { position: static !important; }' });
  await page.mouse.move(0, 0);
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.screenshot({ path: `${shotsDir(testInfo)}/${name}.png`, animations: "disabled" });
}

async function expectNoSidewaysScroll(page, width) {
  const box = await page.locator(SECTION).boundingBox();
  expect(box, "the materials section has a box").not.toBeNull();
  expect(box.x + box.width, `the materials section fits a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
}

function expectHermetic(fence, seen, testInfo) {
  expect(fence.unexpectedExternal, "nothing escaped the hermetic fence").toEqual([]);
  expect(seen.refused, "every materials call this test made was staged").toEqual([]);
  expect(app.hostRequests, "no /profile* or /__proxy/* reached the dev server").toEqual([]);
  testInfo.annotations.push({ type: "hermetic", description: "materials + profile routes stubbed" });
}

for (const width of [1440, 390]) {
  test.describe(`at ${width}px`, () => {
    test("a FAIL draft asks before it downloads, then downloads (U-1)", async ({ page }, testInfo) => {
      const state = { manifest: readyManifest };
      const { fence, seen, section } = await openCase(page, state, { width, height: width === 390 ? 1500 : 1100 });
      const resume = section.locator('[data-doc="resume"]');
      /* HOLES SCORE (§0.3): the row shows the grade button; the why, the
         fallbacks and the profile fix open in the score modal. */
      await expect(resume.locator(".case__docst")).toHaveText(/^drafted$/i);
      await expect(resume.locator(".mat-rubric")).toHaveCount(0);
      await resume.locator("[data-score-open]").click();
      const modal = page.locator(".jb-score");
      await expect(modal).toBeVisible();
      await expect(modal.locator(".jb-score__verdict")).toContainText("experience section");
      await expect(modal).toContainText("Reading the job fell back to rules: the AI’s answer was cut off.");
      await expect(modal.getByRole("button", { name: "Review your details" })).toBeVisible();
      await shoot(modal.locator(".jb-score__card"), testInfo, `w2-score-modal-${width}`);
      await modal.locator(".jb-score__foot [data-score-close]").click();
      await expect(modal).toHaveCount(0);
      await expectNoSidewaysScroll(page, width);
      await shoot(resume, testInfo, `w2-scorecard-${width}`);

      await resume.getByRole("button", { name: "Download", exact: true }).click();
      await resume.getByRole("menuitem", { name: /PDF/ }).click();
      const confirm = resume.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      /* GRADE G7: a FAIL root is held, and its confirm says why. */
      await expect(confirm).toHaveAttribute("data-gate", "held");
      await expect(confirm).toContainText(/^This version is held — .+\. Download anyway\?/);
      /* MREV D2: this fixture is an old rubric run, which is read-only. */
      await expect(confirm.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(confirm.getByRole("button", { name: "Repair first" })).toHaveCount(0);
      expect(seen.fileDownloads, "nothing downloaded before the confirm").toEqual([]);
      await shoot(resume, testInfo, `w2-fail-confirm-${width}`);

      const download = page.waitForEvent("download");
      await confirm.getByRole("button", { name: "Download anyway" }).click();
      expect((await download).suggestedFilename()).toBe("resume.pdf");
      await expect(confirm).toHaveCount(0);
      expect(seen.fileDownloads).toEqual(["resume.pdf"]);
      expectHermetic(fence, seen, testInfo);
    });

    test("a drafting row shows the named steps, never raw stage strings (U-4)", async ({ page }, testInfo) => {
      const state = { manifest: () => draftingManifest() };
      const { fence, seen, section } = await openCase(page, state, { width, height: width === 390 ? 1500 : 1100 });
      const resume = section.locator('[data-doc="resume"]');
      const steps = resume.locator(".mat-tl__step");
      await expect(steps).toHaveCount(5);
      await expect(steps.locator(".mat-tl__label")).toHaveText(["Prepare", "Write", "Check & render", "Grade", "Save"]);
      await expect(resume.locator('[data-step="write"]')).toHaveAttribute("data-state", "degraded");
      await expect(resume.locator('[data-step="write"]')).toContainText("Fallback");
      await expect(resume.locator('[data-step="write"]')).toContainText("the AI’s answer was cut off");
      await expect(resume.locator('[data-step="check"]')).toHaveAttribute("data-state", "running");
      const text = await page.locator(ROLE).innerText();
      expect(text).not.toMatch(/jd\.extract|claims\.select|cache\.lookup|\bvalidate\b|: running|: review/);
      await expectNoSidewaysScroll(page, width);
      await shoot(resume, testInfo, `w2-timeline-${width}`);
      expectHermetic(fence, seen, testInfo);
    });

    test("the Download menu offers PDF, ATS text, Word and LinkedIn copy (U-3)", async ({ page }, testInfo) => {
      const state = { manifest: readyManifest };
      const { fence, seen, section } = await openCase(page, state, { width, height: width === 390 ? 1500 : 1100 });
      const resume = section.locator('[data-doc="resume"]');
      const toggle = resume.getByRole("button", { name: "Download", exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const items = resume.getByRole("menuitem");
      await expect(items).toHaveCount(4);
      await expect(items.locator(".mat-dl__title")).toHaveText(["PDF", "ATS plain text", "Word document", "Copy for LinkedIn"]);
      await expectNoSidewaysScroll(page, width);
      await shoot(resume, testInfo, `w2-download-menu-${width}`);
      await page.keyboard.press("Escape");
      await expect(resume.locator(".mat-dl__menu")).toBeHidden();

      /* A REVIEW letter downloads its ATS text straight away. */
      const letter = section.locator('[data-doc="cover_letter"]');
      await expect(letter.locator(".case__docst")).toHaveText(/^drafted$/i);
      await letter.getByRole("button", { name: "Download", exact: true }).click();
      await expect(letter.getByRole("menuitem")).toHaveCount(3);
      const download = page.waitForEvent("download");
      await letter.getByRole("menuitem", { name: /ATS plain text/ }).click();
      expect((await download).suggestedFilename()).toBe("cover-letter.txt");
      await expect(letter.getByRole("alertdialog")).toHaveCount(0);
      expectHermetic(fence, seen, testInfo);
    });

    test("the manual-apply checklist ticks, persists and counts progress", async ({ page }, testInfo) => {
      const state = { manifest: readyManifest };
      const { fence, seen, section } = await openCase(page, state, { width, height: width === 390 ? 1500 : 1100 });
      const row = section.locator('[data-doc="manual_apply_checklist"]');
      const list = row.locator("jb-apply-checklist");
      /* MREV CHECKLIST: a horizontal strip, one step in focus plus a peek. */
      const total = CHECKLIST_ITEMS.length;
      await expect(list.locator(".jb-cl__now")).toHaveAttribute("data-item", "resume");
      /* GRADE-F FIX1-F6: the server's checklist details carry no score. */
      await expect(list, "GRADE-F FIX1-F6: no score in the resume step").not.toContainText(/\/ 12/);
      await expect(list.locator(".jb-cl__count")).toHaveText(`${total} steps remaining · 0 completed`);
      await expect(row.locator(".case__docst")).toHaveText(new RegExp(`0 / ${total} done`, "i"));

      await list.getByRole("button", { name: "Next step" }).click();
      await expect(list.locator(".jb-cl__now")).toHaveAttribute("data-item", "letter");
      await expect(list, "GRADE-F FIX1-F6: no score in the letter step").not.toContainText(/\/ 12/);
      await list.getByRole("button", { name: "Next step" }).click();
      await list.getByLabel("Check your portfolio and profile links").check();
      await expect(list.locator(".jb-cl__count")).toHaveText(`${total - 1} steps remaining · 1 completed`);
      /* Ticking hands the strip to the next step (salary); two more reach confirmation. */
      for (let i = 0; i < 2; i += 1) await list.getByRole("button", { name: "Next step" }).click();
      await list.getByLabel("Save the confirmation").check();
      await expect(list.locator(".jb-cl__count")).toHaveText(`${total - 2} steps remaining · 2 completed`);
      await expect(list.locator('.jb-cl__done [data-item="links"]')).toHaveClass(/jb-cl__item--done/);
      await expect(list.locator(".jb-cl__done summary")).toHaveText("Review 2 completed steps");
      await expect(list.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
      expect(seen.checklistPuts).toEqual([{ id: "links", done: true, contact: "" }, { id: "confirmation", done: true, contact: "" }]);

      /* Back to the first step. */
      while (await list.getByRole("button", { name: "Previous step" }).isEnabled()) {
        await list.getByRole("button", { name: "Previous step" }).click();
      }
      await expect(list.locator(".jb-cl__now")).toHaveAttribute("data-item", "resume");

      /* The checklist's resume download goes through the same FAIL gate. */
      await list.locator('[data-item="resume"]').getByRole("link", { name: "Download" }).click();
      await expect(list.locator('[data-item="resume"]').getByRole("alertdialog")).toBeVisible();
      expect(seen.fileDownloads).toEqual([]);
      /* MREV D2: an old rubric run is read-only, so the confirm offers Cancel. */
      await list.locator('[data-item="resume"]').getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
      await expect(list.locator('[data-item="resume"]').getByRole("alertdialog")).toHaveCount(0);

      await expectNoSidewaysScroll(page, width);
      await shoot(row, testInfo, `w2-checklist-${width}`);
      expectHermetic(fence, seen, testInfo);
    });
  });
}

test("an old run's drafting row keeps its old step names (G8)", async ({ page }, testInfo) => {
  const state = { manifest: () => draftingManifest({ stages: LEGACY_STAGES_MID_RUN }) };
  const { fence, seen, section } = await openCase(page, state);
  const resume = section.locator('[data-doc="resume"]');
  await expect(resume.locator(".mat-tl__step")).toHaveCount(7);
  await expect(resume.locator(".mat-tl__step .mat-tl__label")).toContainText(["Read the job", "Load facts", "Pick facts", "Write", "Check facts", "Render", "Check quality"]);
  await expect(resume.locator('[data-step="read"]')).toHaveAttribute("data-state", "degraded");
  await expect(resume.locator('[data-step="write"]')).toHaveAttribute("data-state", "running");
  expectHermetic(fence, seen, testInfo);
});

test("Draft both queues the resume, then the letter as its own run (U-5)", async ({ page }, testInfo) => {
  let phase = "empty";
  const state = {
    manifest: () => {
      if (phase === "empty") return { slug: SLUG, company: "Meridian Labs", title: "Senior Product Manager", derived: false, updatedAt: "", documents: [] };
      if (phase === "resume") return draftingManifest({ feature: "resume", next: "cover_letter" });
      if (phase === "letter") return draftingManifest({ feature: "cover_letter", stages: STAGES_MID_RUN.slice(0, 4), docs: [doc("resume")] });
      return readyManifest();
    },
    onRequest: () => { phase = "resume"; },
  };
  const { fence, seen, section } = await openCase(page, state);
  await page.evaluate(() => globalThis.CommandCenterUserContent.setPrimaryResume({
    source: "paste",
    label: "jordan-resume.txt",
    extractedText: "Jordan Rivera. Product manager. Owned the pricing roadmap for a B2B SaaS line.",
  }));
  await section.getByRole("button", { name: "Draft both" }).click();
  await expect.poll(() => seen.requests.length).toBe(1);
  expect(seen.requests[0].feature).toBe("resume");
  expect(seen.requests[0].then).toBe("cover_letter");
  const letter = section.locator('[data-doc="cover_letter"]');
  await expect(letter.locator(".case__docst")).toHaveText(/next/i, { timeout: 15_000 });
  await expect(letter).toContainText("Drafts after the resume finishes, with its own quality check.");
  await expect(section.locator('[data-doc="resume"] .mat-tl')).toBeVisible();

  /* The resume finished; the server queued the letter as its own run. */
  phase = "letter";
  await expect(letter.locator(".mat-tl")).toBeVisible({ timeout: 20_000 });
  phase = "done";
  /* The verdict lands on the grade button; the pill keeps the document's state. */
  await expect(section.locator('[data-doc="resume"] [data-score-open]')).toHaveAttribute("data-verdict", "FAIL", { timeout: 20_000 });
  await expect(section.locator('[data-doc="resume"] .case__docst')).toHaveText(/^drafted$/i);
  await expect(letter.locator(".case__docst")).toHaveText(/^drafted$/i);
  expect(seen.requests, "one request: the server chains the letter").toHaveLength(1);
  expectHermetic(fence, seen, testInfo);
});

for (const width of [1440, 390]) {
  test(`at ${width}px · Wave 3 fields: outreach note row, company facts, and the option (staged package)`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseUrl }).catch(() => {});
    const state = {
      manifest: () => ({ ...readyManifest(), ...W3_MANIFEST_EXTRA }),
      files: { "outreach.json": W3_OUTREACH, "intel.json": W3_INTEL },
    };
    const { fence, seen, section } = await openCase(page, state, { width, height: width === 390 ? 1500 : 1100 });
    const row = section.locator('[data-doc="outreach_note"]');
    await expect(row.locator(".case__docst")).toHaveText(/review/i);
    await expect(row.locator('[data-out="linkedin"] .mat-out__text')).toHaveText(W3_OUTREACH.linkedin.text);
    await expect(row.locator('[data-out="email"]')).toContainText("Subject: Senior Product Manager: pricing roadmap");
    const copy = row.locator('[data-out="linkedin"]').getByRole("button", { name: "Copy the LinkedIn note" });
    await copy.click();
    await expect(copy).toHaveText(/Copied|Selected/);

    const facts = section.locator(".mat-intel");
    await expect(facts.locator("summary")).toHaveText("Company facts about Meridian Labs · 3");
    await facts.locator("summary").click();
    await expect(facts.getByRole("link", { name: "news.example.com" })).toHaveAttribute("href", "https://news.example.com/meridian-series-b");
    await expect(facts).toContainText("2026-08");

    await expectNoSidewaysScroll(page, width);
    await shoot(row, testInfo, `w2-outreach-${width}`);
    await shoot(facts, testInfo, `w2-company-facts-${width}`);
    expectHermetic(fence, seen, testInfo);
  });
}

test("Include outreach note sends extras with the letter and with Draft both", async ({ page }, testInfo) => {
  const state = { manifest: () => ({ slug: SLUG, company: "Meridian Labs", title: "Senior Product Manager", derived: false, updatedAt: "", documents: [] }) };
  const { fence, seen, section } = await openCase(page, state);
  await page.evaluate(() => globalThis.CommandCenterUserContent.setPrimaryResume({
    source: "paste",
    label: "jordan-resume.txt",
    extractedText: "Jordan Rivera. Product manager. Owned the pricing roadmap for a B2B SaaS line.",
  }));
  await expect(section.locator('[data-doc="outreach_note"]')).toHaveCount(0);
  await expect(section.locator(".mat-intel")).toHaveCount(0);
  await section.getByLabel("Include outreach note").check();
  await section.getByRole("button", { name: "Draft both" }).click();
  await expect.poll(() => seen.requests.length).toBe(1);
  expect(seen.requests[0]).toMatchObject({ feature: "resume", then: "cover_letter", extras: ["outreach"] });
  expectHermetic(fence, seen, testInfo);
});
