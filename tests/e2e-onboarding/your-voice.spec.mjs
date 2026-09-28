/**
 * "Your voice" in a real browser — the one-flow step after "Your details",
 * and the section in Settings → Fit Profile beside "Your details".
 *
 * Hermetic: tests/e2e-fixtures/hermetic-harness.mjs answers every Google
 * call and every host path; the /profile* routes this feature uses are
 * stubbed per test below (registered after the fence, so they win) over an
 * in-memory guide, a catch-all refuses any other /profile path, and the
 * server spy proves none of them reached the dev server's proxy to the
 * real local API.
 *
 * Screenshots land in JB_VOICE_SHOTS_DIR when it is set, else in the
 * test's output folder.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  DISPOSABLE_AUTH,
  fulfillJson,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The prompt, read from the shared module the page uses. */
const PROMPT = (() => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, "server", "profile-voice-shared.js"), "utf8"), sandbox);
  return sandbox.window.JobBoredProfileVoiceShared.VOICE_GUIDE_PROMPT;
})();

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

const PARTIAL_GUIDE = `# Voice guide — Jordan Rivera

## Voice summary
Plain, specific, a little dry. I sell with numbers and short stories.

## Approved facts
- Grew trial-to-paid conversion 38% in two quarters
`;

const FULL_GUIDE = `${PARTIAL_GUIDE}
## Cover letter rules
Three short paragraphs. Open with the work, never with flattery.
`;

const SAVED_AT = "2026-09-20T15:00:00.000Z";

const SAVED_PROFILE = {
  version: 1,
  updatedAt: "2026-09-27T12:00:00.000Z",
  identity: {
    targetRoles: ["Director of Growth"],
    targetSeniority: "director",
    primaryNarrative: "Growth leader who builds AI-assisted marketing systems.",
    fullName: "Jordan Rivera",
    email: "jordan.rivera@example.com",
  },
  strengths: [{ name: "Lifecycle marketing", rank: 1 }],
  hardConstraints: { workMode: "remote_only" },
};

function shotsDir(testInfo) {
  const dir = process.env.JB_VOICE_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Scroll a Settings section's top into view inside the modal, then shoot. */
async function shootSection(page, section, path) {
  await section.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await settle(page);
  await page.screenshot({ path, fullPage: false });
}

function wordsIn(text) {
  return (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) || []).length;
}

/**
 * Stub every /profile* route this page may call, over an in-memory guide.
 * Registered after the fence, so these answer first; anything else under
 * /profile is refused and recorded. Returns what the page sent.
 */
async function stubProfileRoutes(page, { voice = null, profile = null } = {}) {
  const store = voice ? { ...voice } : null;
  const calls = { voiceGets: 0, puts: [], deletes: 0, refused: [] };
  await page.route(/\/profile(\/.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Same-origin (fresh install) or the configured local API origin
    // (signed-in config); the fence would answer the latter with a
    // generic ok, which would hide a real call from these assertions.
    if (url.origin !== new URL(app.baseUrl).origin && url.origin !== DISPOSABLE_AUTH.materialsOrigin) {
      await route.fallback();
      return;
    }
    const path = url.pathname;
    const method = request.method();
    if (path === "/profile/voice" && method === "GET") {
      calls.voiceGets += 1;
      await fulfillJson(
        route,
        store
          ? { ok: true, exists: true, text: store.text, updatedAt: store.updatedAt, words: wordsIn(store.text) }
          : { ok: true, exists: false, text: "", updatedAt: null, words: 0 },
      );
      return;
    }
    if (path === "/profile/voice" && method === "PUT") {
      const body = request.postDataJSON();
      calls.puts.push(body);
      const current = store ? store.updatedAt : null;
      if ("ifUpdatedAt" in body && (body.ifUpdatedAt || null) !== current) {
        await fulfillJson(route, { ok: false, reason: "changed", updatedAt: current, message: "changed" }, 409);
        return;
      }
      const hadGuide = !!store;
      const next = { text: `${String(body.text).trim()}\n`, updatedAt: "2026-09-27T18:00:00.000Z" };
      const backup = hadGuide ? "voice.md.bak.2026-09-27T18-00-00.000Z" : null;
      Object.assign(calls, { store: next });
      if (store) Object.assign(store, next);
      else calls.created = next;
      await fulfillJson(route, {
        ok: true,
        exists: true,
        updatedAt: next.updatedAt,
        words: wordsIn(next.text),
        backup,
        unchanged: false,
      });
      return;
    }
    if (path === "/profile/voice" && method === "DELETE") {
      calls.deletes += 1;
      await fulfillJson(route, { ok: true, exists: false, backup: "voice.md.bak.2026-09-27T18-05-00.000Z" });
      return;
    }
    if (path === "/profile" && method === "GET") {
      await fulfillJson(route, profile ? { ok: true, profile } : { ok: false, reason: "no_profile" });
      return;
    }
    if (path === "/profile/contact/suggest" && method === "POST") {
      await fulfillJson(route, { ok: true, source: "none", suggestions: {}, values: {} });
      return;
    }
    // RESJ2-EXTRACT: Settings → Your details shows what was read from the resume.
    if (path === "/profile/resume/read" && method === "GET") {
      await fulfillJson(route, { ok: true, read: null });
      return;
    }
    calls.refused.push(`${method} ${path}`);
    await fulfillJson(route, { ok: false, hermetic: true, error: "Refused by the voice spec." }, 503);
  });
  return calls;
}

/** Let the shell's entrance animations finish before measuring or shooting. */
async function settle(page) {
  await page.evaluate(async () => {
    const running = globalThis.document.getAnimations().filter((a) => a.playState === "running");
    await Promise.all(running.map((a) => a.finished.catch(() => {})));
    await new Promise((done) => globalThis.requestAnimationFrame(() => done()));
  });
}

/** Cold start → the flow open on "Your voice". */
async function openVoiceBeat(page) {
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await page.waitForSelector("#oneFlowDemoBoard .oneflow-demo__invite");
  await page.getByRole("button", { name: "Make it mine", exact: true }).click();
  await page.waitForSelector("#oneFlowMount .oneflow-beat");
  await page.evaluate(async () => {
    const flow = globalThis.JobBoredOneFlow;
    await flow.completeBeat("ai");
    await flow.completeBeat("resume");
    // Completing "Your details" walks the flow to its next beat: this one.
    await flow.completeBeat("details");
  });
  const beat = page.locator('#oneFlowMount .oneflow-beat[data-beat-id="voice"]');
  await expect(beat).toBeVisible();
  await expect(beat.locator(".oneflow-voice")).toHaveAttribute("data-load", "done");
  await settle(page);
  return beat;
}

function spineStep(page, id) {
  return page.locator(`#oneFlowMount .discovery-setup-wizard__spine-step[data-beat-id="${id}"]`);
}

function guideField(scope) {
  return scope.getByLabel("Your voice guide", { exact: true });
}

async function noSideScroll(page, selector) {
  return page.evaluate((sel) => {
    const node = globalThis.document.querySelector(sel);
    return {
      doc: globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      node: node ? node.scrollWidth - node.clientWidth : 0,
    };
  }, selector);
}

test.describe("the one-flow \"Your voice\" step", () => {
  test("should copy the prompt, preview a pasted guide, warn about a missing section, and save it", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseUrl });
    const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page);
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    const beat = await openVoiceBeat(page);

    // Right after "Your details" on the spine, labelled for what it is.
    const labels = await page.locator("#oneFlowMount .discovery-setup-wizard__spine-label").allTextContents();
    expect(labels).toEqual(["Google", "AI", "Resume", "Your details", "Your voice", "Your fit", "Discovery", "Done"]);
    await expect(spineStep(page, "voice")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("With one, drafts sound like you, not like a machine.")).toBeVisible();

    // (a) the chatbot route is the default for someone with no guide yet.
    const chatbotTab = beat.getByRole("tab", { name: "Write it with your chatbot" });
    await expect(chatbotTab).toHaveAttribute("aria-selected", "true");
    const promptBox = beat.getByLabel("The prompt", { exact: true });
    await expect(promptBox).toHaveValue(PROMPT);
    await expect(promptBox).toHaveAttribute("readonly", "");
    await expect(beat.getByText("Paste it into ChatGPT, Claude or Gemini and answer its questions", { exact: false })).toBeVisible();

    await beat.getByRole("button", { name: "Copy the prompt" }).click();
    await expect(beat.getByText("Copied. Paste it into ChatGPT, Claude or Gemini.")).toBeVisible();
    expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe(PROMPT);
    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-voice-chatbot-1440.png"), fullPage: false });

    // The guide the chatbot wrote, pasted back without "Cover letter rules".
    await guideField(beat).fill(PARTIAL_GUIDE);
    const preview = beat.locator(".jb-voice__preview");
    await expect(preview.locator(".jb-voice__count")).toHaveText(`${wordsIn(PARTIAL_GUIDE)} words · 3 sections found`);
    await expect(preview.locator(".jb-voice__heading")).toHaveText([
      "Voice guide — Jordan Rivera",
      "Voice summary",
      "Approved facts",
    ]);
    await expect(preview.getByText("No “Cover letter rules” section yet.", { exact: false })).toBeVisible();
    await expect(preview.getByText("No “Approved facts” section yet.", { exact: false })).toHaveCount(0);

    await guideField(beat).fill(FULL_GUIDE);
    await expect(preview.locator(".jb-voice__heading")).toHaveCount(4);
    await expect(preview.locator(".jb-voice__warn")).toHaveCount(0);
    // Nothing is saved by typing.
    expect(calls.puts).toEqual([]);

    await page.getByRole("button", { name: "Save my voice guide →" }).click();
    await expect(page.locator('#oneFlowMount .oneflow-beat[data-beat-id="fit"]')).toBeVisible();
    await expect(spineStep(page, "voice")).toHaveClass(/spine-step--done/);
    // A fresh install saw no guide, so the save says so (ifUpdatedAt null):
    // one saved on this computer meanwhile would be a 409, not overwritten.
    expect(calls.puts).toEqual([{ text: FULL_GUIDE, ifUpdatedAt: null }]);
    const state = await page.evaluate(() => globalThis.JobBoredOneFlow.getState());
    expect(state.completedBeats).toContain("voice");

    expect(dialogs).toEqual([]);
    expect(calls.refused).toEqual([]);
    expect(fence.unexpectedExternal).toEqual([]);
    expect(app.hostRequests, "no /profile call reached the real local API").toEqual([]);
  });

  test("should select the prompt for a manual copy when the browser blocks the clipboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("blocked")) },
      });
      globalThis.document.execCommand = () => false;
    });
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    await stubProfileRoutes(page);
    const beat = await openVoiceBeat(page);
    await beat.getByRole("button", { name: "Copy the prompt" }).click();
    await expect(beat.getByText("The prompt is selected — press Ctrl+C (⌘C on a Mac) to copy it.", { exact: false })).toBeVisible();
    const selection = await page.evaluate(() => {
      const box = globalThis.document.activeElement;
      return box && typeof box.value === "string" ? box.value.slice(box.selectionStart, box.selectionEnd) : "";
    });
    expect(selection).toBe(PROMPT);
  });

  test("should take an uploaded .md file, refuse other files, and fit a phone", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page);
    const beat = await openVoiceBeat(page);

    await beat.getByRole("tab", { name: "I already have one" }).click();
    await expect(beat.getByRole("tab", { name: "I already have one" })).toHaveAttribute("aria-selected", "true");
    await expect(beat.getByLabel("The prompt", { exact: true })).toBeHidden();
    const input = beat.locator('input[type="file"]');

    await input.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n\u0000\u0001") });
    await expect(beat.getByText("Pick a Markdown (.md) or plain text (.txt) file.", { exact: false })).toBeVisible();
    await expect(guideField(beat)).toHaveValue("");

    await input.setInputFiles({ name: "voice.md", mimeType: "text/markdown", buffer: Buffer.from(FULL_GUIDE) });
    await expect(beat.getByText("Loaded voice.md. Check it below, then save.")).toBeVisible();
    await expect(guideField(beat)).toHaveValue(FULL_GUIDE.trim());
    await expect(beat.locator(".jb-voice__heading")).toHaveCount(4);
    await settle(page);
    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-voice-own-1440.png"), fullPage: false });

    // The same step on a phone: both tabs, no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    let overflow = await noSideScroll(page, ".oneflow-voice");
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.node).toBeLessThanOrEqual(0);
    await beat.locator(".oneflow-voice__tabs").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-voice-own-390.png"), fullPage: false });
    await beat.getByRole("tab", { name: "Write it with your chatbot" }).click();
    overflow = await noSideScroll(page, ".oneflow-voice");
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.node).toBeLessThanOrEqual(0);
    await beat.locator(".oneflow-voice__tabs").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shotsDir(testInfo), "wizard-voice-chatbot-390.png"), fullPage: false });
    expect(calls.puts).toEqual([]);
    expect(app.hostRequests).toEqual([]);
  });

  test("should let the user skip, refuse an empty save, and keep the step unfinished on the spine", async ({ page }) => {
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page);
    await openVoiceBeat(page);

    await page.getByRole("button", { name: "Save my voice guide →" }).click();
    await expect(page.getByText("Paste your voice guide first — or skip for now and add it later in Settings.")).toBeVisible();
    expect(calls.puts).toEqual([]);

    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.locator('#oneFlowMount .oneflow-beat[data-beat-id="fit"]')).toBeVisible();
    const state = await page.evaluate(() => globalThis.JobBoredOneFlow.getState());
    expect(state.skipped.voice).toBe(true);
    expect(state.completedBeats).not.toContain("voice");
    await expect(spineStep(page, "voice")).toHaveClass(/spine-step--skipped/);
    await expect(spineStep(page, "voice")).not.toHaveClass(/spine-step--done/);
    expect(calls.puts).toEqual([]);
  });

  test("should show a guide that already exists and replace it only knowingly", async ({ page }) => {
    await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    const calls = await stubProfileRoutes(page, { voice: { text: PARTIAL_GUIDE, updatedAt: SAVED_AT } });
    const beat = await openVoiceBeat(page);

    await expect(beat.getByText("You already have a voice guide", { exact: false })).toBeVisible();
    await expect(beat.getByRole("tab", { name: "I already have one" })).toHaveAttribute("aria-selected", "true");
    await expect(guideField(beat)).toHaveValue(PARTIAL_GUIDE);

    await guideField(beat).fill(FULL_GUIDE);
    await page.getByRole("button", { name: "Save my voice guide →" }).click();
    await expect(page.locator('#oneFlowMount .oneflow-beat[data-beat-id="fit"]')).toBeVisible();
    expect(calls.puts).toEqual([{ text: FULL_GUIDE, ifUpdatedAt: SAVED_AT }]);
  });
});

test.describe("Settings → Fit Profile → Your voice", () => {
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

  test("should show the saved guide, edit and save it, copy the prompt, replace from a file and remove it with an in-page confirm", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.baseUrl });
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    const { fence, calls } = await bootSignedIn(page, {
      voice: { text: PARTIAL_GUIDE, updatedAt: SAVED_AT },
      profile: SAVED_PROFILE,
    });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const section = page.locator("#settingsYourVoice");
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Your voice" })).toBeVisible();
    // Beside "Your details", right after it.
    await expect(page.locator("#profileDetailsSlot + #profileVoiceSlot #settingsYourVoice")).toHaveCount(1);
    await expect(section.locator("#profileVoiceSummary")).toHaveText(new RegExp(`^Saved .+ · ${wordsIn(PARTIAL_GUIDE)} words$`));

    await shootSection(page, section, join(shotsDir(testInfo), "settings-voice-1440.png"));

    // View / edit
    await section.getByRole("button", { name: "View / edit" }).click();
    await expect(guideField(section)).toHaveValue(PARTIAL_GUIDE);
    await expect(section.getByText("No “Cover letter rules” section yet.", { exact: false })).toBeVisible();
    await shootSection(page, section.locator(".jb-voice-settings__editor"), join(shotsDir(testInfo), "settings-voice-edit-1440.png"));

    await guideField(section).fill(FULL_GUIDE);
    await section.getByRole("button", { name: "Save guide" }).click();
    await expect(section.getByText("Saved. New drafts will follow it. Your previous guide is kept as a backup.")).toBeVisible();
    expect(calls.puts).toEqual([{ text: FULL_GUIDE, ifUpdatedAt: SAVED_AT }]);
    await expect(section.locator("#profileVoiceSummary")).toHaveText(new RegExp(`· ${wordsIn(FULL_GUIDE)} words$`));

    // Copy the prompt
    await section.getByRole("button", { name: "Copy the prompt" }).click();
    await expect(section.getByText("Copied. Paste it into ChatGPT, Claude or Gemini.")).toBeVisible();
    expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe(PROMPT);

    // Replace from a file: loaded into the editor to check, then saved.
    await section.locator('input[type="file"]').setInputFiles({
      name: "my-voice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("# Voice\n\n## Approved facts\n- one\n\n## Cover letter rules\n- short\n"),
    });
    await expect(section.getByText("Loaded my-voice.txt. Check it, then save to replace your guide.")).toBeVisible();
    await expect(guideField(section)).toHaveValue("# Voice\n\n## Approved facts\n- one\n\n## Cover letter rules\n- short");
    await section.getByRole("button", { name: "Cancel" }).click();
    expect(calls.puts).toHaveLength(1);

    // Remove: an in-page confirm, never window.confirm.
    await section.getByRole("button", { name: "Remove", exact: true }).click();
    const confirm = section.locator(".jb-voice-settings__confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Keep it" })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(confirm).toBeHidden();
    expect(calls.deletes).toBe(0);
    await section.getByRole("button", { name: "Remove", exact: true }).click();
    await confirm.getByRole("button", { name: "Remove it" }).click();
    await expect(section.getByText("Removed. Drafts no longer follow a voice guide.", { exact: false })).toBeVisible();
    expect(calls.deletes).toBe(1);
    await expect(section.locator("#profileVoiceSummary")).toHaveText("Not set yet");
    await expect(section.getByRole("button", { name: "Remove", exact: true })).toBeHidden();

    expect(dialogs).toEqual([]);
    expect(calls.refused).toEqual([]);
    expect(fence.unexpectedExternal.filter((u) => /profile|voice/i.test(u))).toEqual([]);
    expect(app.hostRequests, "no /profile call reached the real local API").toEqual([]);
  });

  test("should say when no guide is set, and fit a phone", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { calls } = await bootSignedIn(page, { profile: SAVED_PROFILE });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "fit_profile" }));
    const section = page.locator("#settingsYourVoice");
    await expect(section.locator("#profileVoiceSummary")).toHaveText("Not set yet");
    await expect(section.getByRole("button", { name: "Remove", exact: true })).toBeHidden();
    await shootSection(page, section, join(shotsDir(testInfo), "settings-voice-390.png"));
    await section.getByRole("button", { name: "Write or paste one" }).click();
    await guideField(section).fill(PARTIAL_GUIDE);
    const overflow = await noSideScroll(page, "#settingsYourVoice");
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.node).toBeLessThanOrEqual(0);
    await shootSection(page, section.locator(".jb-voice__field"), join(shotsDir(testInfo), "settings-voice-edit-390.png"));
    await section.getByRole("button", { name: "Save guide" }).click();
    await expect(section.getByText("Saved. New drafts will follow it.", { exact: true })).toBeVisible();
    expect(calls.puts).toEqual([{ text: PARTIAL_GUIDE, ifUpdatedAt: null }]);
  });
});
