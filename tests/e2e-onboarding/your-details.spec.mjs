/**
 * "Your details" in a real browser — the one-flow step after the resume,
 * and the section at the top of Settings → Fit Profile.
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs answers every Google
 * call and every host path; the /profile* routes this feature uses are
 * stubbed per test below (registered after the fence, so they win), and
 * the server spy proves none of them reached the dev server's proxy to the
 * real local API.
 *
 * Screenshots land in JB_DETAILS_SHOTS_DIR when it is set (the lane report
 * collects them there), else in the test's output folder.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DISPOSABLE_AUTH,
  fulfillJson,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

const RESUME = `JORDAN “JO” RIVERA
Growth Marketing Leader · AI Product Builder
Austin, TX | (512) 555-0147 | jordan.rivera@example.com | linkedin.com/in/jordan-rivera | jordanrivera.dev
`;

/** What POST /profile/contact/suggest answers for RESUME. */
const SUGGESTION = {
  ok: true,
  source: "request",
  suggestions: {
    fullName: { value: "Jordan Rivera", confidence: 0.8 },
    headline: { value: "Growth Marketing Leader · AI Product Builder", confidence: 0.75 },
    email: { value: "jordan.rivera@example.com", confidence: 0.95 },
    phone: { value: "(512) 555-0147", confidence: 0.9 },
    location: { value: { city: "Austin", state: "TX" }, confidence: 0.8 },
    links: {
      linkedin: { value: "https://linkedin.com/in/jordan-rivera", confidence: 0.9 },
      website: { value: "https://jordanrivera.dev", confidence: 0.6 },
      github: null,
      other: [],
    },
  },
  values: {
    fullName: "Jordan Rivera",
    headline: "Growth Marketing Leader · AI Product Builder",
    email: "jordan.rivera@example.com",
    phone: "(512) 555-0147",
    location: { city: "Austin", state: "TX" },
    links: {
      linkedin: "https://linkedin.com/in/jordan-rivera",
      website: "https://jordanrivera.dev",
    },
  },
};

const SAVED_PROFILE = {
  version: 1,
  updatedAt: "2026-09-27T12:00:00.000Z",
  identity: {
    targetRoles: ["Director of Growth"],
    targetSeniority: "director",
    primaryNarrative: "Growth leader who builds AI-assisted marketing systems.",
    fullName: "Jordan Rivera",
    email: "jordan.rivera@example.com",
    phone: "(512) 555-0147",
    location: { city: "Austin", state: "TX" },
    links: { linkedin: "https://linkedin.com/in/jordan-rivera" },
  },
  strengths: [{ name: "Lifecycle marketing", rank: 1 }],
  hardConstraints: { workMode: "remote_only" },
};

function shotsDir(testInfo) {
  const dir = process.env.JB_DETAILS_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Stub the three routes "Your details" talks to. Registered after the
 * fence, so these answer first; returns what the page sent.
 */
async function stubProfileRoutes(page, { profile = null, contactStatus = 409, suggestion = SUGGESTION } = {}) {
  const calls = { suggest: [], contact: [], profileGets: 0 };
  await page.route(/\/profile(\/contact(\/suggest)?)?$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/profile" && method === "GET") {
      calls.profileGets += 1;
      await fulfillJson(route, profile ? { ok: true, profile } : { ok: false, reason: "no_profile" });
      return;
    }
    if (path === "/profile/contact/suggest" && method === "POST") {
      calls.suggest.push(request.postDataJSON());
      await fulfillJson(route, suggestion);
      return;
    }
    if (path === "/profile/contact" && method === "POST") {
      const body = request.postDataJSON();
      calls.contact.push(body);
      if (contactStatus === 200) {
        await fulfillJson(route, { ok: true, updatedAt: "2026-09-27T12:30:00.000Z", contact: body });
      } else {
        await fulfillJson(route, { ok: false, reason: "no_profile", message: "Save your fit profile first." }, 409);
      }
      return;
    }
    await route.fallback();
  });
  return calls;
}

/** Cold start → the flow open on "Your details", with a pasted resume staged. */
/** Let the shell's entrance animations finish before measuring or shooting. */
async function settle(page) {
  await page.evaluate(async () => {
    const running = globalThis.document.getAnimations().filter((a) => a.playState === "running");
    await Promise.all(running.map((a) => a.finished.catch(() => {})));
    await new Promise((done) => globalThis.requestAnimationFrame(() => done()));
  });
}

async function openDetailsBeat(page) {
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await page.waitForSelector("#oneFlowDemoBoard .oneflow-demo__invite");
  await page.getByRole("button", { name: "Make it mine", exact: true }).click();
  await page.waitForSelector("#oneFlowMount .oneflow-beat");
  await page.evaluate(async (resume) => {
    const flow = globalThis.JobBoredOneFlow;
    // B3's own write: the text the details step pre-fills from.
    await flow.saveDraft("resumeText", resume);
    await flow.completeBeat("ai");
    // Completing the resume walks the flow to its next beat: this one.
    await flow.completeBeat("resume");
  }, RESUME);
  const beat = page.locator('#oneFlowMount .oneflow-beat[data-beat-id="details"]');
  await expect(beat).toBeVisible();
  await expect(beat.locator(".jb-details")).toHaveAttribute("data-prefill", "done");
  await settle(page);
  return beat;
}

function spineStep(page, id) {
  return page.locator(`#oneFlowMount .discovery-setup-wizard__spine-step[data-beat-id="${id}"]`);
}

test.describe("the one-flow \"Your details\" step", () => {
  test("should pre-fill from the resume, flag unsure fields, validate, and carry the confirmed details forward", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page);
    const beat = await openDetailsBeat(page);

    // Right after Resume on the spine, labelled for what it is.
    const labels = await page
      .locator("#oneFlowMount .discovery-setup-wizard__spine-label")
      .allTextContents();
    expect(labels.slice(2, 5)).toEqual(["Resume", "Your details", "Your voice"]);
    await expect(spineStep(page, "details")).toHaveAttribute("aria-current", "step");

    // Pre-filled from the resume the beat was handed.
    expect(calls.suggest).toEqual([{ resumeText: RESUME }]);
    await expect(beat.getByLabel("Full name", { exact: true })).toHaveValue("Jordan Rivera");
    await expect(beat.getByLabel("Headline", { exact: true })).toHaveValue("Growth Marketing Leader · AI Product Builder");
    await expect(beat.getByLabel("Email", { exact: true })).toHaveValue("jordan.rivera@example.com");
    await expect(beat.getByLabel("Phone", { exact: true })).toHaveValue("(512) 555-0147");
    await expect(beat.getByLabel("City", { exact: true })).toHaveValue("Austin");
    await expect(beat.getByLabel("State", { exact: true })).toHaveValue("TX");
    await expect(beat.getByLabel("LinkedIn", { exact: true })).toHaveValue("https://linkedin.com/in/jordan-rivera");
    // A low-confidence suggestion says so; a sure one just says where it came from.
    await expect(beat.getByLabel("Website or portfolio", { exact: true })).toHaveAttribute("data-provenance", "check");
    await expect(beat.getByText("From your resume — we weren't sure, check this.")).toBeVisible();
    await expect(beat.getByLabel("Email", { exact: true })).toHaveAttribute("data-provenance", "resume");
    // Nothing was saved just by pre-filling.
    expect(calls.contact).toEqual([]);

    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-your-details-1440.png"), fullPage: false });

    // A typo is caught before anything is sent, next to the field.
    await beat.getByLabel("Email", { exact: true }).fill("jordan.rivera@example");
    await beat.getByLabel("Website or portfolio", { exact: true }).fill("not a url");
    await page.getByRole("button", { name: "Confirm my details →" }).click();
    await expect(beat.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(beat.getByText("That email doesn't look right — check for a typo.")).toBeVisible();
    await expect(beat.getByLabel("Website or portfolio", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(beat.getByLabel("Email", { exact: true })).toBeFocused();
    expect(calls.contact).toEqual([]);

    // Fix, add one more link, confirm.
    await beat.getByLabel("Email", { exact: true }).fill("jordan.rivera@example.com");
    await beat.getByLabel("Website or portfolio", { exact: true }).fill("jordanrivera.dev");
    await beat.getByRole("button", { name: "+ Add a link" }).click();
    await beat.getByLabel("Link 1 label", { exact: true }).fill("Talk");
    await beat.getByLabel("Link 1 web address", { exact: true }).fill("https://example.com/talk");
    await page.getByRole("button", { name: "Confirm my details →" }).click();

    // "Your voice" follows; the fit review comes after it.
    await expect(page.locator('#oneFlowMount .oneflow-beat[data-beat-id="voice"]')).toBeVisible();
    await expect(spineStep(page, "details")).toHaveClass(/spine-step--done/);
    // No profile exists yet: nothing is POSTed; the details ride the
    // flow's draft to B4, whose save writes them.
    expect(calls.contact).toEqual([]);
    const state = await page.evaluate(() => globalThis.JobBoredOneFlow.getState());
    expect(state.completedBeats).toContain("details");
    const draft = await page.evaluate(() => globalThis.JobBoredOneFlow.getState().drafts.contactDraft);
    expect(draft.confirmed).toBe(true);
    expect(draft.contact).toEqual({
      fullName: "Jordan Rivera",
      headline: "Growth Marketing Leader · AI Product Builder",
      email: "jordan.rivera@example.com",
      phone: "(512) 555-0147",
      location: { city: "Austin", state: "TX" },
      links: {
        linkedin: "https://linkedin.com/in/jordan-rivera",
        website: "https://jordanrivera.dev",
        other: [{ label: "Talk", url: "https://example.com/talk" }],
      },
    });

    expect(fence.unexpectedExternal).toEqual([]);
    expect(app.hostRequests, "no /profile call reached the real local API").toEqual([]);
  });

  test("should fit a phone screen without sideways scroll", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    await stubProfileRoutes(page);
    await openDetailsBeat(page);
    const overflow = await page.evaluate(() => ({
      doc: globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      form: (() => {
        const node = globalThis.document.querySelector(".jb-details");
        return node ? node.scrollWidth - node.clientWidth : 0;
      })(),
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.form).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-your-details-390.png"), fullPage: false });
  });

  test("should let the user skip, and keep the step unchecked on the spine", async ({ page }) => {
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page);
    await openDetailsBeat(page);

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.locator('#oneFlowMount .oneflow-beat[data-beat-id="voice"]')).toBeVisible();
    const state = await page.evaluate(() => globalThis.JobBoredOneFlow.getState());
    expect(state.skipped.details).toBe(true);
    expect(state.completedBeats).not.toContain("details");
    await expect(spineStep(page, "details")).not.toHaveClass(/spine-step--done/);
    await expect(spineStep(page, "resume")).toHaveClass(/spine-step--done/);
    expect(calls.contact).toEqual([]);
  });
});

test.describe("Settings → Fit Profile → Your details", () => {
  /** Fence first, then the stubs (the route registered last answers first). */
  async function bootSignedIn(page, stubOptions) {
    const fence = await installHermeticNetworkFence(page, {
      baseUrl: app.baseUrl,
      pipelineStartsWithJob: true,
    });
    const calls = await stubProfileRoutes(page, stubOptions);
    await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
    await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
    await page.evaluate(async () => {
      await globalThis.CommandCenterUserContent.completeInfraSetup();
      await globalThis.CommandCenterUserContent.completeOnboarding();
    });
    await page.reload({ waitUntil: "load" });
    await expect(page.locator("#dashboard")).toBeVisible();
    return { fence, calls };
  }

  test("should load the saved details, re-fill empty fields from the resume, validate and save", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fence, calls } = await bootSignedIn(page, { profile: SAVED_PROFILE, contactStatus: 200 });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const section = page.locator("#settingsYourDetails");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Your details" })).toBeVisible();

    // The saved profile, not the resume.
    await expect(section.getByLabel("Full name", { exact: true })).toHaveValue("Jordan Rivera");
    await expect(section.getByLabel("Phone", { exact: true })).toHaveValue("(512) 555-0147");
    await expect(section.getByLabel("Headline", { exact: true })).toHaveValue("");

    // Re-fill fills only what is empty.
    await section.getByLabel("Full name", { exact: true }).fill("Jordan A. Rivera");
    await section.getByRole("button", { name: "Re-fill from my resume" }).click();
    await expect(section.getByLabel("Headline", { exact: true })).toHaveValue("Growth Marketing Leader · AI Product Builder");
    await expect(section.getByLabel("Website or portfolio", { exact: true })).toHaveValue("https://jordanrivera.dev");
    await expect(section.getByLabel("Full name", { exact: true })).toHaveValue("Jordan A. Rivera");
    await expect(section.getByText("Filled the empty fields from your resume. Check them, then save.")).toBeVisible();
    expect(calls.suggest).toHaveLength(1);

    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir(testInfo), "settings-your-details-1440.png"), fullPage: false });

    // A bad phone never leaves the browser.
    await section.getByLabel("Phone", { exact: true }).fill("call me");
    await section.getByRole("button", { name: "Save details" }).click();
    await expect(section.getByLabel("Phone", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(section.getByText("Fix the highlighted fields, then save.")).toBeVisible();
    expect(calls.contact).toEqual([]);

    // Clearing a field removes it; the saved set is exactly the form.
    await section.getByLabel("Phone", { exact: true }).fill("");
    await section.getByRole("button", { name: "Save details" }).click();
    await expect(section.getByText("Saved. New drafts will use these details.")).toBeVisible();
    expect(calls.contact).toEqual([
      {
        fullName: "Jordan A. Rivera",
        headline: "Growth Marketing Leader · AI Product Builder",
        email: "jordan.rivera@example.com",
        location: { city: "Austin", state: "TX" },
        links: {
          linkedin: "https://linkedin.com/in/jordan-rivera",
          website: "https://jordanrivera.dev",
        },
      },
    ]);

    // Opening Settings probes a local Ollama for the AI tab's model list
    // (model-catalog.js); the fence refuses it. Nothing of this feature
    // may leave the page.
    expect(fence.unexpectedExternal.filter((u) => /profile|contact/i.test(u))).toEqual([]);
    expect(app.hostRequests, "no /profile call reached the real local API").toEqual([]);
  });

  test("should say the details came from the saved resume when the browser's copy was broken", async ({ page }) => {
    // RESJ K2: the server ignored garbled browser text and read resume.txt.
    const { calls } = await bootSignedIn(page, {
      profile: null,
      contactStatus: 409,
      suggestion: { ...SUGGESTION, source: "stored", requestGarbled: true },
    });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const section = page.locator("#settingsYourDetails");
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "Re-fill from my resume" }).click();
    await expect(section.getByLabel("Email", { exact: true })).toHaveValue("jordan.rivera@example.com");
    await expect(
      section.getByText("Filled from your saved resume, because this browser's copy came out broken. Check the fields, then save."),
    ).toBeVisible();
    expect(calls.suggest).toHaveLength(1);
  });

  test("should say what to do when no fit profile exists yet", async ({ page }) => {
    await bootSignedIn(page, { profile: null, contactStatus: 409 });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const section = page.locator("#settingsYourDetails");
    await expect(section).toBeVisible();
    await section.getByLabel("Full name", { exact: true }).fill("Jordan Rivera");
    await section.getByRole("button", { name: "Save details" }).click();
    await expect(
      section.getByText("Save your fit profile below first — then your details can be saved with it."),
    ).toBeVisible();
  });
});
