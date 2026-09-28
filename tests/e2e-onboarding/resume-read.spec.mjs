/**
 * RESJ2-EXTRACT — after a resume upload the user can see that an AI read
 * it, with which provider and model, and what it read.
 *
 * Jordan (2026-09-27 22:36): "I saw text appear in the text entry box,
 * which made me doubt it was sent to an LLM for interpretation or that any
 * processing happened." The text box filling is the browser's own text
 * extraction; the AI read is the step these probes make visible:
 *   - Portfolio → Resume: a status line that names the provider and model
 *     while it reads, the plain failure reason with Try again, then
 *     "Read by <model>: N roles across M employers, …" and the panel;
 *   - Settings → Your details: the "What JobBored read from your resume"
 *     panel, with every list and the numbers each achievement claims.
 *
 * Hermetic: the fence answers every host path; /profile/from-resume and
 * /profile/resume/read are stubbed per test with a read built by the real
 * server reader from a fictional resume. No live AI call.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISPOSABLE_AUTH,
  fulfillJson,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";
import { buildResumeRead } from "../../server/resume-read.mjs";
import { validateModelStructure } from "../../server/materials-resume-structure-model.mjs";

const RESUME = readFileSync(new URL("../fixtures/resumes/nested-roles-caps.txt", import.meta.url), "utf8");
const MODEL = "example/model-1";
const FACTS = {
  contact: {
    name: { text: "ALEX 'SANDY' MARTINEZ-QUINN", sourceQuote: "ALEX 'SANDY' MARTINEZ-QUINN" },
    email: { text: "user@example.com", sourceQuote: "user@example.com" },
    phone: { text: "555-555-0177", sourceQuote: "555-555-0177" },
    location: { text: "Tucson, AZ", sourceQuote: "Tucson, AZ" },
    links: [{ label: "LinkedIn", url: "linkedin.com/in/example-sandy", sourceQuote: "linkedin.com/in/example-sandy" }],
  },
  headline: { text: "Operations Leader", sourceQuote: "Operations Leader" },
  summary: {
    text: "Operations leader who builds go-to-market teams and the playbooks that keep them running.",
    sourceQuote: "Operations leader who builds go-to-market teams and the playbooks that keep them running.",
  },
  skills: [
    { text: "Operations strategy", kind: "hard", sourceQuote: "Operations strategy" },
    { text: "Process improvement", kind: "hard", sourceQuote: "Process improvement" },
    { text: "Budgeting", kind: "hard", sourceQuote: "Budgeting" },
    { text: "Salesforce", kind: "tools", sourceQuote: "Salesforce" },
    { text: "Excel", kind: "tools", sourceQuote: "Excel" },
    { text: "Leadership", kind: "soft", sourceQuote: "Leadership" },
    { text: "Negotiation", kind: "soft", sourceQuote: "Negotiation" },
  ],
  certifications: [
    { text: "Lean Six Sigma Green Belt", sourceQuote: "Lean Six Sigma Green Belt" },
    { text: "PMP", sourceQuote: "PMP" },
  ],
  awards: [{ text: "Tucson Business Journal 40 Under 40, 2021", sourceQuote: "Tucson Business Journal 40 Under 40, 2021" }],
  projects: [],
  languages: [
    { text: "Spanish", sourceQuote: "Spanish" },
    { text: "English", sourceQuote: "English" },
  ],
};
const STRUCTURE = validateModelStructure({
  employers: [{
    name: "Contoso Health (formerly Litware Clinics)",
    sourceQuote: "Contoso Health (formerly Litware Clinics) — Tucson, AZ Mar 2015 – Present",
    start: "Mar 2015", startSourceQuote: "Mar 2015", end: "Present", endSourceQuote: "Present",
    roles: [
      { title: "Vice President, Operations", sourceQuote: "Vice President, Operations Jan 2022 – Present", start: "Jan 2022", startSourceQuote: "Jan 2022", end: "Present", endSourceQuote: "Present", claims: [
        { text: "Grew clinic throughput 31% across 12 sites by redesigning scheduling and intake.", sourceQuote: "Grew clinic throughput 31% across 12 sites by redesigning scheduling and intake." },
        { text: "Built a go-to-market plan for two new service lines that added $4.2M in first-year revenue.", sourceQuote: "Built a go-to-market plan for two new service lines that added $4.2M in first-year revenue." },
      ] },
      { title: "Director of Operations", sourceQuote: "Director of Operations Jun 2018 – Dec 2021", start: "Jun 2018", startSourceQuote: "Jun 2018", end: "Dec 2021", endSourceQuote: "Dec 2021", claims: [
        { text: "Cut patient wait times from 42 to 18 minutes with a new triage workflow.", sourceQuote: "Cut patient wait times from 42 to 18 minutes with a new triage workflow." },
      ] },
      { title: "Operations Manager, Litware Clinics", sourceQuote: "Operations Manager, Litware Clinics Mar 2015 – May 2018", start: "Mar 2015", startSourceQuote: "Mar 2015", end: "May 2018", endSourceQuote: "May 2018", claims: [
        { text: "Hired and trained 25 front-desk staff and wrote the onboarding handbook still in use.", sourceQuote: "Hired and trained 25 front-desk staff and wrote the onboarding handbook still in use." },
      ] },
    ],
    claims: [],
  }],
  looseClaims: [],
  education: [{ text: "MBA | Example Business School — Phoenix, AZ 2014", sourceQuote: "MBA | Example Business School — Phoenix, AZ 2014" }],
  credentials: [
    { text: "Lean Six Sigma Green Belt", sourceQuote: "Lean Six Sigma Green Belt" },
    { text: "PMP", sourceQuote: "PMP" },
  ],
}, RESUME).structure;
const READ = buildResumeRead(RESUME, { facts: FACTS, structure: STRUCTURE, by: { provider: "openrouter", model: MODEL } });
const DONE_LINE =
  `Read by ${MODEL}: 3 roles across 1 employer, 4 achievements with numbers, 7 skills, ` +
  "education, certifications, awards, languages, links.";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function shotsDir(testInfo) {
  const dir = process.env.JB_RESUME_READ_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Stub the resume-read routes. `fromResume` answers each POST in turn; a
 * `hold` promise keeps the first one pending so the running line is seen.
 */
async function stubReadRoutes(page, { fromResume = [], savedRead = READ, hold = null } = {}) {
  const calls = { fromResume: [], readGets: 0 };
  await page.route(/\/profile(\/from-resume|\/resume\/read)?$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/profile" && request.method() === "GET") {
      await fulfillJson(route, { ok: false, reason: "no_profile" }, 404);
      return;
    }
    if (path === "/profile/resume/read" && request.method() === "GET") {
      calls.readGets += 1;
      await fulfillJson(route, { ok: true, read: savedRead });
      return;
    }
    if (path === "/profile/from-resume" && request.method() === "POST") {
      const index = calls.fromResume.length;
      calls.fromResume.push(request.postDataJSON());
      if (index === 0 && hold) await hold;
      const answer = fromResume[index] || fromResume[fromResume.length - 1];
      await fulfillJson(route, answer.body, answer.status || 200);
      return;
    }
    await route.fallback();
  });
  return calls;
}

async function bootSignedIn(page, stubOptions) {
  await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  const calls = await stubReadRoutes(page, stubOptions);
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  /* After the auth script (which rewrites the overrides on every load): a
   * connected OpenRouter, the provider B2 would have verified. */
  await page.addInitScript((model) => {
    const key = "command_center_config_overrides";
    const current = JSON.parse(globalThis.localStorage.getItem(key) || "{}");
    if (current.resumeProvider === "openrouter") return;
    globalThis.localStorage.setItem(
      key,
      JSON.stringify({
        ...current,
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "hermetic-openrouter-key",
        resumeOpenRouterModel: model,
      }),
    );
  }, MODEL);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  return calls;
}

async function openPortfolio(page) {
  await page.evaluate(() => globalThis.JobBoredApp.profileMaterials.openMaterialsModal());
  await expect(page.locator("#materialsModal")).toBeVisible();
}

test.describe("Portfolio → Resume: the AI read is visible", () => {
  test("should name the model while reading, say why it failed, and show what it read after Try again", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let release = () => {};
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    const calls = await bootSignedIn(page, {
      hold,
      savedRead: null,
      fromResume: [
        {
          status: 500,
          body: { ok: false, reason: "profile_provider_error", message: "OpenRouter HTTP 429: rate limited. Wait a minute." },
        },
        { body: { ok: true, profile: { version: 1 }, read: READ, source: "staged_request" } },
      ],
    });
    await openPortfolio(page);

    await page.locator("details.profile-disclosure", { hasText: "Paste text instead" }).locator("summary").click();
    await page.locator("#materialsPasteText").fill(RESUME);
    await page.locator("#materialsPasteBtn").click();

    const status = page.locator("#profileResumeReadStatus");
    await expect(status).toHaveAttribute("data-state", "running");
    await expect(status).toHaveText(`Reading your resume with OpenRouter (${MODEL})…`);
    release();

    await expect(status).toHaveAttribute("data-state", "failed");
    await expect(status).toContainText(
      "JobBored couldn't read your resume with AI. OpenRouter HTTP 429: rate limited. Wait a minute.",
    );
    await status.screenshot({ path: join(shotsDir(testInfo), "portfolio-status-failed.png") });
    await status.getByRole("button", { name: "Try again" }).click();

    await expect(status).toHaveAttribute("data-state", "done");
    await expect(status).toHaveText(DONE_LINE);
    await status.screenshot({ path: join(shotsDir(testInfo), "portfolio-status-done.png") });
    expect(calls.fromResume).toHaveLength(2);
    expect(calls.fromResume[1].resumeText).toContain("Contoso Health");
    expect(calls.fromResume[1].provider).toBe("openrouter");

    const panel = page.locator("#profileResumeRead .jb-resume-read");
    await expect(panel).toBeVisible();
    await panel.locator("summary").click();
    await expect(panel.getByText("Vice President, Operations, Jan 2022 – Present")).toBeVisible();
    await expect(panel.locator(".jb-resume-read__metric", { hasText: "$4.2M" })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir(testInfo), "portfolio-resume-read-1440.png") });
  });

  test("should say to connect a provider, with no Try again, when none is connected", async ({ page }) => {
    const calls = await bootSignedIn(page, { fromResume: [{ body: { ok: true, read: READ } }] });
    await openPortfolio(page);
    // The provider rule B3 owns says nothing is connected (no key).
    await page.evaluate(() => {
      globalThis.JobBoredOneFlowBeatResume.verifiedProviderConfig = () => null;
    });
    // Grok review (running-without-provider): record every state the line
    // takes; with no provider it must never claim to be reading.
    const states = await page.evaluate(async () => {
      const seen = [];
      const observer = new globalThis.MutationObserver(() => {
        const node = globalThis.document.getElementById("profileResumeReadStatus");
        if (node && node.dataset.state && seen[seen.length - 1] !== node.dataset.state) seen.push(node.dataset.state);
      });
      observer.observe(globalThis.document.body, { subtree: true, attributes: true, childList: true });
      await globalThis.JobBoredApp.profileMaterials.readResumeWithAi("A resume.");
      await new Promise((done) => setTimeout(done, 0));
      observer.disconnect();
      return seen;
    });
    expect(states).toEqual(["failed"]);
    const status = page.locator("#profileResumeReadStatus");
    await expect(status).toHaveAttribute("data-state", "failed");
    await expect(status).toContainText("Connect an AI provider in Settings so JobBored can read it.");
    await expect(status.getByRole("button", { name: "Try again" })).toHaveCount(0);
    expect(calls.fromResume).toHaveLength(0);
  });
});

test.describe("Settings → Your details: What JobBored read from your resume", () => {
  test("should list what was read, flag what was not found, and fit a phone", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const calls = await bootSignedIn(page, {});
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const panel = page.locator("#settingsResumeRead .jb-resume-read");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".jb-resume-read__counts")).toHaveText(DONE_LINE);
    expect(calls.readGets).toBeGreaterThan(0);

    await panel.locator("summary").click();
    for (const line of [
      "Alex Martinez-Quinn",
      "Contoso Health (formerly Litware Clinics)",
      "Director of Operations, Jun 2018 – Dec 2021",
      "Lean Six Sigma Green Belt",
      "Tucson Business Journal 40 Under 40, 2021",
    ]) {
      await expect(panel.getByText(line, { exact: true })).toBeVisible();
    }
    await expect(panel.locator(".jb-resume-read__chip", { hasText: "Negotiation" })).toBeVisible();
    await expect(panel.locator(".jb-resume-read__foot")).toContainText("Not found on your resume: projects.");
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir(testInfo), "settings-resume-read-1440.png") });

    await page.setViewportSize({ width: 375, height: 812 });
    await panel.scrollIntoViewIfNeeded();
    const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(shotsDir(testInfo), "settings-resume-read-375.png") });
  });
});
