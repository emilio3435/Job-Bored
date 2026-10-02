/**
 * materials-mrev.spec.mjs — MREV lane C in a real browser.
 *
 *   D1  the quality check (GRADE D7): the verdict word and first reason,
 *       the deciding claims with their sentences, background gaps — no score
 *   D2  an old (rubric) run renders read-only
 *   D3  Repair asks what to change and posts K4 (+ G5 base hash, request id)
 *   D4  when the repair lands, its diff opens by itself; "No material
 *       change" and "Kept your previous version" say so
 *   D5  "Change template" is a link, apart from Repair
 *   D6  a drafting row shows the K7 steps
 *   D8  1440 and 375, no sideways scroll, screenshots
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs answers Google and the
 * host paths; this spec answers only the materials paths each test stages
 * and refuses the rest (recorded, and asserted empty). /profile* is refused.
 */

/* page.evaluate callbacks run in the browser. */
/* global window, document */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  corsHeaders,
  fulfillJson,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import {
  LETTER_AFTER,
  LETTER_BEFORE,
  V1_RESUME_FAIL,
  V2_LETTER_FAIL,
  V2_RESUME_READY_SAME_MODEL,
} from "../fixtures/materials-qa-v2.mjs";

const MATERIALS = "http://127.0.0.1:3847";
const SLUG = "meridian-labs-senior-product-manager";
const ROLE = '[data-region="role"]';
const SECTION = `${ROLE} .brief-materials--rows`;
const PARENT_RUN = V2_LETTER_FAIL.qa.runId;
const CHILD_RUN = "mr_20260928093000_meridian_f6";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function shotsDir(testInfo) {
  const dir = process.env.JB_MREV_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const FILE = (name) => ({ filename: name, format: name.split(".").pop(), size: 2048, modifiedAt: "2026-09-28T09:00:00.000Z" });

function doc(type) {
  const stem = type === "resume" ? "resume" : "cover-letter";
  return {
    type,
    label: type === "resume" ? "Tailored Resume" : "Cover Letter",
    status: "ready",
    primary: `${stem}.pdf`,
    lastModifiedAt: "2026-09-28T09:00:00.000Z",
    files: [FILE(`${stem}.pdf`), FILE(`${stem}.html`)],
    text: FILE(`${stem}.txt`),
    exports: { docx: true, linkedin: type === "resume" },
  };
}

function readyManifest({ resume = V2_RESUME_READY_SAME_MODEL, letter = V2_LETTER_FAIL, extra = {} } = {}) {
  return {
    slug: SLUG,
    company: "Meridian Labs",
    title: "Senior Product Manager",
    derived: false,
    updatedAt: "2026-09-28T09:10:00.000Z",
    runId: PARENT_RUN,
    documents: [doc("resume"), doc("cover_letter")],
    quality: { version: "materials-quality.v1", status: "fail", documents: { resume, cover_letter: letter } },
    ...extra,
  };
}

/* K7 stages mid-run: prepared, written, now checking. */
const K7_MID_RUN = [
  { stage: "repair", status: "ok", ms: 1, detail: "source run; cache bypassed" },
  { stage: "prepare", status: "ok", ms: 40 },
  { stage: "write", status: "ok", ms: 9000 },
];

function repairingManifest(stages = K7_MID_RUN) {
  return {
    ...readyManifest(),
    pending: {
      feature: "cover_letter",
      company: "Meridian Labs",
      title: "Senior Product Manager",
      jobUrl: "https://jobs.meridian-labs.test/senior-pm",
      requestedAt: new Date(Date.now() - 12_000).toISOString(),
      notes: "",
      source: "jobbored-dossier",
      progress: {
        phase: "drafting",
        message: "Checking the rewrite…",
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        attempt: 1,
        elapsedSeconds: 10,
        stages,
      },
    },
  };
}

function runsAfterRepair(repair) {
  return {
    slug: SLUG,
    runs: [
      { runId: CHILD_RUN, date: new Date().toISOString(), feature: "cover_letter", template: "signal", source: "request", documents: ["cover_letter"], verdicts: {}, active: repair && repair.adopted === false ? [] : ["cover_letter"], ...(repair ? { repair: { parentRunId: PARENT_RUN, instruction: "x", issueIds: ["i1"], ...repair } } : {}) },
      { runId: PARENT_RUN, date: "2026-09-28T09:00:00.000Z", feature: "cover_letter", template: "signal", source: "request", documents: ["cover_letter"], verdicts: {}, active: repair && repair.adopted === false ? ["cover_letter"] : [] },
    ],
  };
}

function diffOf(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  const lines = [];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    if (left[i] === right[i]) lines.push({ op: "same", text: left[i] });
    else {
      if (left[i] !== undefined) lines.push({ op: "del", text: left[i] });
      if (right[i] !== undefined) lines.push({ op: "add", text: right[i] });
    }
  }
  return { slug: SLUG, doc: "cover_letter", a: PARENT_RUN, b: CHILD_RUN, added: lines.filter((l) => l.op === "add").length, removed: lines.filter((l) => l.op === "del").length, lines };
}

/**
 * The materials API for one test. `state.manifest()` answers the manifest;
 * `state.onRepair(body)` answers POST /repair ({ status, body }); `state.runs`
 * and `state.diff` answer the history routes. Everything else is refused.
 */
async function stubMaterials(page, state) {
  const seen = { refused: [], repairs: [], regenerates: [], runsDiff: [], jdPuts: [] };
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
      await fulfillJson(route, { ok: true, exists: !state.jdMissing });
      return;
    }
    if (path === `/api/applications/${SLUG}/job-description` && method === "PUT") {
      seen.jdPuts.push(request.postDataJSON());
      state.jdMissing = false;
      await fulfillJson(route, { ok: true });
      return;
    }
    if (path === `/api/applications/${SLUG}/scrape-job-description` && method === "POST" && state.jdMissing) {
      await fulfillJson(route, { ok: true, text: "" });
      return;
    }
    if (path === `/api/applications/${SLUG}/files/jd-extract.json` && method === "GET") {
      await fulfillJson(route, { nouns: [{ term: "pricing" }, { term: "roadmap" }] });
      return;
    }
    const text = /^\/api\/applications\/[^/]+\/files\/(resume|cover-letter)\.txt$/.exec(path);
    if (text && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8" },
        body: text[1] === "resume" ? "Jordan Rivera\nProduct manager who owns pricing and the roadmap.\n" : LETTER_BEFORE,
      });
      return;
    }
    if (path === `/api/applications/${SLUG}/checklist` && method === "GET") {
      await fulfillJson(route, { contract: "materials.checklist.v1", slug: SLUG, updatedAt: new Date().toISOString(), progress: { done: 0, total: 0 }, items: [] });
      return;
    }
    if (path === `/api/applications/${SLUG}/repair` && method === "POST") {
      const body = request.postDataJSON();
      seen.repairs.push(body);
      const answer = state.onRepair ? state.onRepair(body) : { status: 200, body: { ok: true, slug: SLUG, accepted: true } };
      await fulfillJson(route, answer.body, answer.status || 200);
      return;
    }
    if (path === `/api/applications/${SLUG}/regenerate` && method === "POST") {
      seen.regenerates.push(request.postDataJSON());
      await fulfillJson(route, { ok: true });
      return;
    }
    if (path === `/api/applications/${SLUG}/runs` && method === "GET" && state.runs) {
      await fulfillJson(route, state.runs());
      return;
    }
    if (path === `/api/applications/${SLUG}/runs-diff` && method === "GET" && state.diff) {
      seen.runsDiff.push(Object.fromEntries(url.searchParams));
      await fulfillJson(route, state.diff());
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
    _postingEnrichment: { roleInOneLine: "Own pricing and the roadmap that ships it.", scrapedAt: new Date(Date.now() - 2 * 3600e3).toISOString() },
  }];
}

/** Boot, seed one role through the app's own setter, open its Case. */
async function openCase(page, state, { width = 1440, height = 1100 } = {}) {
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
  await page.addStyleTag({ content: 'body.jb-v2 [data-region="role"] .case .case__docket { position: static !important; }' });
  await page.mouse.move(0, 0);
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.screenshot({ path: `${shotsDir(testInfo)}/${name}.png`, animations: "disabled" });
}

async function expectNoSidewaysScroll(page, width) {
  const box = await page.locator(SECTION).boundingBox();
  expect(box, "the materials section has a box").not.toBeNull();
  expect(box.x + box.width, `the materials section fits a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
  const overflow = await page.locator(SECTION).evaluate((el) => {
    const bad = [];
    const right = el.getBoundingClientRect().right + 1;
    el.querySelectorAll(".mat-score *, .mat-repair *, .mat-repaired *").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width && r.right > right) bad.push(n.className || n.tagName);
    });
    return bad.slice(0, 5);
  });
  expect(overflow, "nothing in the scorecard or the Repair panels spills out of the section").toEqual([]);
}

function expectHermetic(fence, seen, testInfo) {
  expect(fence.unexpectedExternal, "nothing escaped the hermetic fence").toEqual([]);
  expect(seen.refused, "every materials call this test made was staged").toEqual([]);
  expect(app.hostRequests, "no /profile* or /__proxy/* reached the dev server").toEqual([]);
  testInfo.annotations.push({ type: "hermetic", description: "materials + profile routes stubbed" });
}

/* HOLES SCORE (§0.3): the row carries one grade button; the scorecard and
   its Repair live in the score modal. */
async function openScore(row) {
  await row.locator("[data-score-open]").click();
  const modal = row.page().locator(".jb-score");
  await expect(modal).toBeVisible();
  return modal;
}

async function openRepair(row) {
  const modal = await openScore(row);
  await modal.locator("[data-score-repair]").click();
  await expect(modal).toHaveCount(0);
}

async function setResume(page) {
  await page.evaluate(() => globalThis.CommandCenterUserContent.setPrimaryResume({
    source: "paste",
    label: "jordan-resume.txt",
    extractedText: "Jordan Rivera. Product manager. Owned the pricing roadmap for a B2B SaaS line.",
  }));
}

for (const width of [1440, 375]) {
  test.describe(`at ${width}px`, () => {
    /* GRADE (D1, D4, D7): a v2 judge record is an old checker's now — its
       verdict word and the claims that decided it, never "64 of 100". */
    test("D1 · the quality check says why: the verdict, the deciding claims with their sentences, background gaps", async ({ page }, testInfo) => {
      const { fence, seen, section } = await openCase(page, { manifest: () => readyManifest() }, { width, height: width === 375 ? 1600 : 1100 });
      const letter = section.locator('[data-doc="cover_letter"]');
      await expect(letter.locator(".case__docst")).toHaveText(/^ready$/i);
      const grade = letter.locator("[data-score-open]");
      await expect(grade).toHaveAttribute("aria-label", /^Cover letter: Fails — 1 claim needs a source\. Open the quality check\.$/);
      await expect(grade).toHaveText("Fails · 1 claim needs a source");
      await expect(letter.locator(".mat-verdict__why, .mat-dims, .mat-gaps, [data-group]")).toHaveCount(0);

      const modal = await openScore(letter);
      await expect(modal.locator(".jb-score__verdict")).toHaveText("1 claim needs a source");
      await expect(modal.locator(".jb-score__prov")).toHaveText("Graded by the old checker");
      const claims = modal.locator('[data-step="why"] [data-group="sentence"]');
      await expect(claims.first().locator(".jb-score__quote")).toHaveText("At Contoso I cut churn by 40% across the enterprise book.");
      await expect(modal.locator('[data-step="why"] [data-group="background"]')).toHaveCount(2);
      await expect(modal).not.toContainText(/\/ 100|of 100|One sentence claims/);
      await shoot(modal.locator(".jb-score__card"), testInfo, `mrev-score-modal-${width}`);
      await modal.locator(".jb-score__foot [data-score-close]").click();
      await expect(modal).toHaveCount(0);
      await expect(grade).toBeFocused();

      const resume = section.locator('[data-doc="resume"]');
      await expect(resume.locator(".case__docst")).toHaveText(/^ready$/i);
      await expect(resume.locator("[data-score-open]")).toHaveAttribute("aria-label", /^Resume: Ready\. Open the quality check\.$/);
      await expectNoSidewaysScroll(page, width);
      await shoot(letter, testInfo, `mrev-scorecard-${width}`);
      expectHermetic(fence, seen, testInfo);
    });

    test("D3 + D4 · Repair asks what to change, posts K4, and opens the diff when it lands", async ({ page }, testInfo) => {
      let phase = "ready";
      const state = {
        manifest: () => (phase === "ready" ? readyManifest() : (phase === "repairing" ? repairingManifest() : readyManifest())),
        onRepair: () => { phase = "repairing"; return { status: 200, body: { ok: true, slug: SLUG, accepted: true } }; },
        runs: () => runsAfterRepair({ changed: true, adopted: true }),
        diff: () => diffOf(LETTER_BEFORE, LETTER_AFTER),
      };
      const { fence, seen, section } = await openCase(page, state, { width, height: width === 375 ? 1600 : 1100 });
      await setResume(page);
      const letter = section.locator('[data-doc="cover_letter"]');
      await openRepair(letter);

      const form = letter.locator("form.mat-repair");
      await expect(form).toBeVisible();
      const box = form.getByLabel("What should change?");
      await expect(box).toBeFocused();
      await expect(box).toHaveAttribute("placeholder", "e.g. make it less formulaic; end on something specific to them");
      await expect(box).toHaveAttribute("maxlength", "600");
      await expect(form.locator('input[value="i1"]')).toBeChecked();
      await expect(form.locator('input[value="i2"]')).not.toBeChecked();
      await expect(form.locator('input[value="i3"]')).not.toBeChecked();
      await box.fill("Make it less formulaic; end on their pricing launch.");
      await expect(form.locator("[data-repair-count]")).toHaveText("52 / 600");
      await form.locator('input[value="i3"]').check();
      await expectNoSidewaysScroll(page, width);
      await shoot(letter, testInfo, `mrev-repair-dialog-${width}`);

      await form.getByRole("button", { name: "Repair the cover letter" }).click();
      await expect.poll(() => seen.repairs.length).toBe(1);
      const body = seen.repairs[0];
      expect(body).toMatchObject({
        feature: "cover_letter",
        jobUrl: "https://jobs.meridian-labs.test/senior-pm",
        instruction: "Make it less formulaic; end on their pricing launch.",
        issueIds: ["i1", "i3"],
        baseDocumentHash: V2_LETTER_FAIL.qa.textHash,
        parentRunId: PARENT_RUN,
      });
      expect(body.requestId).toMatch(UUID);
      expect(body.resume, "the resume attachment rides along, as before").toBeTruthy();

      /* D6: the rewrite runs under the K7 names. */
      const steps = letter.locator(".mat-tl__step");
      await expect(steps).toHaveCount(6, { timeout: 15_000 });
      await expect(steps.locator(".mat-tl__label")).toContainText(["Prepare", "Write", "Check & render", "Grade", "Repair pass", "Save"]);
      await expect(letter.locator('[data-step="check"]')).toHaveAttribute("data-state", "running");

      phase = "done";
      const outcome = letter.locator(".mat-repaired");
      await expect(outcome).toBeVisible({ timeout: 20_000 });
      await expect(outcome).toHaveAttribute("data-outcome", "changed");
      await expect(outcome).toContainText("What changed in the cover letter");
      await expect(outcome.locator(".mat-diff__l--del").filter({ hasText: "At Contoso I cut churn by 40% across the enterprise book." })).toHaveCount(1);
      await expect(outcome.locator(".mat-diff__l--add").first()).toContainText("renewal pricing review");
      await expect(outcome).toBeFocused();
      expect(seen.runsDiff, "G5: the diff keeps a/b/doc, parent to child").toEqual([{ a: PARENT_RUN, b: CHILD_RUN, doc: "cover_letter" }]);
      await expectNoSidewaysScroll(page, width);
      await shoot(letter, testInfo, `mrev-repair-diff-${width}`);

      await outcome.getByRole("button", { name: "Close" }).click();
      await expect(outcome).toHaveCount(0);
      expectHermetic(fence, seen, testInfo);
    });
  });
}

test("D4 · a repair that changed nothing says No material change", async ({ page }, testInfo) => {
  let phase = "ready";
  const state = {
    manifest: () => (phase === "repairing" ? repairingManifest() : readyManifest()),
    onRepair: () => { phase = "repairing"; return { status: 200, body: { ok: true, accepted: true } }; },
    runs: () => runsAfterRepair({ changed: false, adopted: true }),
    diff: () => diffOf(LETTER_BEFORE, LETTER_BEFORE),
  };
  const { fence, seen, section } = await openCase(page, state);
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  await letter.getByLabel("What should change?").fill("Shorter.");
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  await expect.poll(() => seen.repairs.length).toBe(1);
  phase = "done";
  const outcome = letter.locator(".mat-repaired");
  await expect(outcome).toBeVisible({ timeout: 20_000 });
  await expect(outcome).toHaveAttribute("data-outcome", "same");
  await expect(outcome).toContainText("No material change: try a more specific instruction");
  await expect(outcome.locator(".mat-diff__l")).toHaveCount(0);
  expectHermetic(fence, seen, testInfo);
});

test("D4 · a rewrite that added a factual problem keeps the previous version, and shows its diff", async ({ page }, testInfo) => {
  let phase = "ready";
  const state = {
    manifest: () => (phase === "repairing" ? repairingManifest() : readyManifest()),
    onRepair: () => { phase = "repairing"; return { status: 200, body: { ok: true, accepted: true } }; },
    runs: () => runsAfterRepair({ changed: true, adopted: false, reason: "new unsupported sentence" }),
    diff: () => diffOf(LETTER_BEFORE, LETTER_AFTER),
  };
  const { fence, seen, section } = await openCase(page, state);
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  await expect.poll(() => seen.repairs.length).toBe(1);
  expect(seen.repairs[0].issueIds, "the hard issue went pre-ticked").toEqual(["i1"]);
  phase = "done";
  const outcome = letter.locator(".mat-repaired");
  await expect(outcome).toBeVisible({ timeout: 20_000 });
  await expect(outcome).toHaveAttribute("data-outcome", "kept");
  await expect(outcome).toContainText("Kept your previous version: the rewrite introduced a factual problem");
  await expect(outcome.locator(".mat-diff__l--add").first()).toBeVisible();
  await shoot(letter, testInfo, "mrev-repair-kept-1440");
  expectHermetic(fence, seen, testInfo);
});

test("G5 · a stale base keeps the dialog open and says to refresh", async ({ page }, testInfo) => {
  const state = {
    manifest: () => readyManifest(),
    onRepair: () => ({ status: 409, body: { error: "The document changed.", code: "repair_base_stale" } }),
  };
  const { fence, seen, section } = await openCase(page, state);
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  await letter.getByLabel("What should change?").fill("End on their launch.");
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  const alert = letter.locator(".mat-repair").getByRole("alert");
  await expect(alert).toHaveText("This document changed since you opened it; refresh");
  await expect(alert, "Grok P2: the new alert takes focus").toBeFocused();
  await expect(letter.getByLabel("What should change?")).toHaveValue("End on their launch.");
  await expect(letter.getByRole("button", { name: "Repair the cover letter" })).toBeEnabled();

  /* A refused request is done: the retry is a new request. */
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  await expect.poll(() => seen.repairs.length).toBe(2);
  expect(seen.repairs[1].requestId).not.toBe(seen.repairs[0].requestId);
  expectHermetic(fence, seen, testInfo);
});

test("D2 · an old rubric run renders read-only in the old style", async ({ page }, testInfo) => {
  const { fence, seen, section } = await openCase(page, { manifest: () => readyManifest({ resume: V1_RESUME_FAIL }) });
  const resume = section.locator('[data-doc="resume"]');
  await expect(resume.locator(".case__docst")).toHaveText(/^ready$/i);
  await expect(resume.locator(".mat-rubric")).toHaveCount(0);
  const modal = await openScore(resume);
  await expect(modal).toContainText("Graded by the old checker");
  await expect(modal.locator("[data-score-repair]"), "an old run is read-only").toHaveCount(0);
  await modal.locator(".jb-score__foot [data-score-close]").click();
  await expect(resume.getByRole("button", { name: "Repair" })).toHaveCount(0);
  await resume.getByRole("button", { name: "Download", exact: true }).click();
  await resume.getByRole("menuitem", { name: /PDF/ }).click();
  const confirm = resume.getByRole("alertdialog");
  await expect(confirm.getByRole("button", { name: "Repair first" })).toHaveCount(0);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expectHermetic(fence, seen, testInfo);
});

test("D5 · Change template is a link, visibly apart from Repair", async ({ page }, testInfo) => {
  const state = {
    manifest: () => readyManifest({ extra: { template: { family: "signal", version: "1.0", source: "default" } } }),
  };
  const { fence, seen, section } = await openCase(page, state);
  const bar = section.locator(".case__template");
  await expect(bar).toContainText("Change template:");
  await expect(section).not.toContainText("Regenerate");
  const change = bar.getByRole("button", { name: "Change template to Dossier" });
  await expect(change).toBeVisible();
  const look = (el) => el.evaluate((n) => {
    const s = globalThis.getComputedStyle(n);
    return { border: s.borderTopWidth, transform: s.textTransform, radius: s.borderTopLeftRadius };
  });
  const changeLook = await look(change);
  /* HOLES SCORE: Repair is the score modal's footer action now. */
  const modal = await openScore(section.locator('[data-doc="cover_letter"]'));
  const repair = modal.locator("[data-score-repair]");
  await expect(repair).toBeVisible();
  expect(changeLook, "the template switch does not look like the Repair button").not.toEqual(await look(repair));
  await modal.locator(".jb-score__foot [data-score-close]").click();
  await expect(modal).toHaveCount(0);
  await change.click();
  await expect.poll(() => seen.regenerates.length).toBe(1);
  expect(seen.regenerates[0]).toEqual({ template: "dossier" });
  await expect(page.locator(".toast").filter({ hasText: "Changed the template to Dossier. Nothing was rewritten." })).toBeVisible();
  expectHermetic(fence, seen, testInfo);
});

const PASTED_JD = "Senior Product Manager, Pricing. Own the pricing roadmap from research to launch across the platform.";

test("Grok P2 · a 409 after the job-description paste still lands in the Repair dialog", async ({ page }, testInfo) => {
  const state = {
    jdMissing: true,
    manifest: () => readyManifest(),
    onRepair: () => ({ status: 409, body: { error: "The document changed.", code: "repair_base_stale" } }),
  };
  const { fence, seen, section } = await openCase(page, state);
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  await letter.getByLabel("What should change?").fill("End on their launch.");
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  const paste = page.locator(".brief-materials__jd-form");
  await expect(paste).toBeVisible();
  await expect(letter.getByRole("button", { name: "Repair the cover letter" }), "not stuck on Sending while the paste is pending").toBeEnabled();
  await paste.locator("textarea").fill(PASTED_JD);
  await paste.getByRole("button", { name: "Save & draft" }).click();
  await expect.poll(() => seen.repairs.length).toBe(1);
  expect(seen.jdPuts).toHaveLength(1);
  const alert = letter.locator(".mat-repair").getByRole("alert");
  await expect(alert).toHaveText("This document changed since you opened it; refresh");
  await expect(letter.getByRole("button", { name: "Repair the cover letter" })).toBeEnabled();
  await expect(letter.getByLabel("What should change?")).toHaveValue("End on their launch.");
  expectHermetic(fence, seen, testInfo);
});

test("Grok P2 · a Repair cancelled while the paste form is open sends nothing", async ({ page }, testInfo) => {
  const state = { jdMissing: true, manifest: () => readyManifest() };
  const { fence, seen, section } = await openCase(page, state);
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  const paste = page.locator(".brief-materials__jd-form");
  await expect(paste).toBeVisible();
  await letter.locator(".mat-repair").getByRole("button", { name: "Cancel" }).click();
  await expect(letter.locator(".mat-repair")).toHaveCount(0);
  await paste.locator("textarea").fill(PASTED_JD);
  await paste.getByRole("button", { name: "Save & draft" }).click();
  await expect.poll(() => seen.jdPuts.length).toBe(1);
  await page.waitForTimeout(1_000);
  expect(seen.repairs, "the cancelled repair never posts").toEqual([]);
  expectHermetic(fence, seen, testInfo);
});

test("Grok P2 · Escape closes Repair and returns to its button; an error takes focus", async ({ page }, testInfo) => {
  const { fence, seen, section } = await openCase(page, { manifest: () => readyManifest() });
  const letter = section.locator('[data-doc="cover_letter"]');
  /* HOLES SCORE: Repair opens from the score modal, so focus comes back
     to the grade button that opened it. */
  const repair = letter.locator("[data-score-open]");
  await openRepair(letter);
  await expect(letter.getByLabel("What should change?")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(letter.locator(".mat-repair")).toHaveCount(0);
  await expect(repair).toBeFocused();

  /* Nothing asked for: the validation message takes focus. */
  await openRepair(letter);
  await letter.locator('.mat-repair input[value="i1"]').uncheck();
  await letter.getByRole("button", { name: "Repair the cover letter" }).click();
  const alert = letter.locator(".mat-repair").getByRole("alert");
  await expect(alert).toHaveText("Say what should change, or tick an issue to fix.");
  await expect(alert).toBeFocused();
  expect(seen.repairs).toEqual([]);

  /* Cancel returns focus the same way. */
  await letter.locator(".mat-repair").getByRole("button", { name: "Cancel" }).click();
  await expect(repair).toBeFocused();
  expectHermetic(fence, seen, testInfo);
});

test("Grok P2 · at 375px the new controls meet the 44px touch floor and the instruction box does not zoom", async ({ page }, testInfo) => {
  const { fence, seen, section } = await openCase(page, { manifest: () => readyManifest() }, { width: 375, height: 1600 });
  const letter = section.locator('[data-doc="cover_letter"]');
  await openRepair(letter);
  const heights = async (selector) => letter.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  /* HOLES SCORE: the dimension and gap disclosures moved into the score modal. */
  for (const selector of [".mat-repair__issue label"]) {
    const hs = await heights(selector);
    expect(hs.length, `${selector} rendered`).toBeGreaterThan(0);
    expect(Math.min(...hs), `${selector} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
  const size = await letter.getByLabel("What should change?").evaluate((el) => parseFloat(globalThis.getComputedStyle(el).fontSize));
  expect(size, "16px or more, so focusing it does not zoom the page on a phone").toBeGreaterThanOrEqual(16);
  expectHermetic(fence, seen, testInfo);
});
