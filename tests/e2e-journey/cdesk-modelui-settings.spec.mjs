/**
 * CDESK MODELUI — Settings → AI shows the model the drafter really uses,
 * in a real browser.
 *
 * Hermetic: the C1 fence answers everything; this spec adds one route for
 * GET 127.0.0.1:3847/api/llm-config after the fence (later routes win).
 * The Save test answers the POST too; nothing reaches the live API.
 */
import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  installHermeticNetworkFence,
  startHermeticApp,
  stageSignedInDisposableAuth,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

async function bootSignedIn(page, overrides) {
  await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.addInitScript((patch) => {
    const key = "command_center_config_overrides";
    const current = JSON.parse(globalThis.localStorage.getItem(key) || "{}");
    globalThis.localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
  }, overrides);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
}

const BROWSER_GEMINI_35 = {
  resumeProvider: "gemini",
  resumeGeminiApiKey: "hermetic-gemini-key",
  resumeGeminiModel: "gemini-3.5-flash",
};

test("the AI tab names the drafting model, the last draft, and the mismatch fix", async ({ page }) => {
  await bootSignedIn(page, BROWSER_GEMINI_35);
  await page.route("http://127.0.0.1:3847/api/llm-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "gemini",
        alias: "",
        model: "gemini-3.8-flash",
        baseUrl: "",
        keyPresent: true,
        updatedAt: "2026-09-27T08:00:00.000Z",
        lastDraft: {
          slug: "acme-platform-engineer",
          company: "Acme",
          title: "Platform Engineer",
          feature: "resume",
          provider: "gemini",
          requestedModel: "gemini-3.8-flash",
          resolvedModel: "gemini-3.8-flash",
          finishedAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
        },
      }),
    });
  });

  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  const status = page.locator("#settingsLlmStatus");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Drafting with: Gemini · gemini-3.8-flash");
  await expect(status).toContainText("Last draft used gemini-3.8-flash for Platform Engineer at Acme · 2 hours ago");
  await expect(status).toContainText("This browser is set to gemini-3.5-flash, but your drafts use gemini-3.8-flash.");
  await expect(status.getByRole("button", { name: "Use gemini-3.8-flash in this browser" })).toBeVisible();

  // The status lines take the component's type, not `body.jb-v2 p`.
  const weight = await status.locator(".settings-llm-status__line--primary").evaluate(
    (el) => globalThis.getComputedStyle(el).fontWeight,
  );
  expect(weight).toBe("600");

  await page.locator("#settings-panel-ai").screenshot({
    path: test.info().outputPath("cdesk-modelui-mismatch.png"),
  });
});

test("the AI tab says the server is unreachable in one line and logs nothing of its own", async ({ page }) => {
  const consoleLines = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") consoleLines.push(msg.text());
  });
  page.on("pageerror", (err) => consoleLines.push(`pageerror: ${err.message}`));
  await bootSignedIn(page, BROWSER_GEMINI_35);
  await page.route("http://127.0.0.1:3847/api/llm-config", (route) => route.abort("connectionrefused"));

  consoleLines.length = 0;
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  const status = page.locator("#settingsLlmStatus");
  await expect(status).toHaveAttribute("data-state", "unreachable");
  await expect(status).toContainText("Can’t reach the JobBored server on this computer");
  await expect(status.locator("p")).toHaveCount(1);
  await expect(status.getByRole("button")).toHaveCount(0);

  // The browser's own network line for the refused request is not ours.
  const ours = consoleLines.filter((line) => !/Failed to load resource/.test(line));
  expect(ours).toEqual([]);
});

async function routeLlmConfig(page, pin, posts) {
  await page.route("http://127.0.0.1:3847/api/llm-config", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      posts.push(JSON.parse(req.postData() || "{}"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pin) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pin) });
  });
}

test("fixing the mismatch leaves nothing unsaved, so Esc closes Settings without a discard prompt", async ({ page }) => {
  await bootSignedIn(page, BROWSER_GEMINI_35);
  const posts = [];
  await routeLlmConfig(
    page,
    { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true },
    posts,
  );
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  const status = page.locator("#settingsLlmStatus");
  await status.getByRole("button", { name: "Use gemini-3.8-flash in this browser" }).click();
  await expect(status).not.toContainText("This browser is set to");
  expect(posts).toHaveLength(1);

  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsModal")).toBeHidden();
  expect(dialogs).toEqual([]);
});

test("Save never sends a blank key, so the server keeps the one it has", async ({ page }) => {
  await bootSignedIn(page, {
    resumeProvider: "local",
    resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
    resumeLocalModel: "gemma4:e2b",
    resumeLocalApiKey: "",
  });
  const posts = [];
  await routeLlmConfig(
    page,
    { provider: "openai_compatible", alias: "ollama", model: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434/v1", keyPresent: true },
    posts,
  );

  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await expect(page.locator("#settingsResumeLocalApiKey")).toHaveValue("");
  await page.locator("#settingsSaveBtn").click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].model).toBe("gemma4:e2b");
  expect("apiKey" in posts[0]).toBe(false);

  await expect(page.locator("#settingsModal")).toBeHidden();
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await page.locator("#settingsResumeLocalApiKey").fill("hermetic-local-key");
  await page.locator("#settingsSaveBtn").click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].apiKey).toBe("hermetic-local-key");
});
