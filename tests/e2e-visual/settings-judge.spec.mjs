/** JUDGEUX FE2 · the optional Grading model row: empty, loaded, saved and key-error states. */
/* global document */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  DISPOSABLE_AUTH,
  installHermeticNetworkFence,
  startHermeticApp,
  stageSignedInDisposableAuth,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app = null;

test.beforeAll(async () => { app = await startHermeticApp(); });
test.afterAll(async () => { if (app) await app.close(); });

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const CATALOG = {
  models: [
    { id: "grok-4.2", label: "Grok 4.2", created: 400 },
    { id: "grok-4-mini", label: "Grok 4 mini", created: 500 },
    { id: "grok-4.1", label: "Grok 4.1", created: 300 },
  ],
  recommended: "grok-4.2",
};

function shotsDir(testInfo) {
  const dir = process.env.JB_MREV_SHOTS_DIR || testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function bootSignedIn(page, width) {
  await page.setViewportSize({ width, height: width < 500 ? 900 : 1000 });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl, pipelineStartsWithJob: true });
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.addInitScript((patch) => {
    const key = "command_center_config_overrides";
    const current = JSON.parse(globalThis.localStorage.getItem(key) || "{}");
    globalThis.localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
  }, { resumeProvider: "gemini", resumeGeminiApiKey: "hermetic-gemini-key", resumeGeminiModel: "gemini-3.8-flash" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#dashboard")).toBeVisible();
  return fence;
}

async function routeJudgeApis(page) {
  const state = { pin: { ...WRITER, judge: null }, posts: [] };
  await page.route("http://127.0.0.1:3847/api/llm-config", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      state.posts.push(body);
      if ("judge" in body) {
        state.pin = {
          ...state.pin,
          judge: body.judge
            ? {
              provider: body.judge.provider,
              model: body.judge.model,
              baseUrl: body.judge.baseUrl || "",
              keyPresent: Boolean(body.judge.apiKey) || Boolean(state.pin.judge && state.pin.judge.keyPresent),
            }
            : null,
        };
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.pin) });
  });
  await page.route("http://127.0.0.1:3847/api/llm-config/judge-models", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (body.apiKey === "fictional-bad-key") {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "That key didn't work: check it on the xAI console." }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG) });
  });
  return state;
}

async function openSettings(page) {
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await expect(page.locator("#settingsJudgeGroup")).toBeVisible();
}

async function captureGroup(page, dir, width, state) {
  const group = page.locator("#settingsJudgeGroup");
  await group.scrollIntoViewIfNeeded();
  const box = await group.boundingBox();
  expect(box, "the card has a visible box").not.toBeNull();
  expect(box.x + box.width, `the card fits a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, "the page has no sideways scroll").toBeLessThanOrEqual(0);
  await group.screenshot({ path: `${dir}/settings-judge-${width}-${state}.png`, animations: "disabled" });
}

for (const width of [1440, 375]) {
  test(`J-FE2 · ${width}px empty, loaded, saved and key-error states`, async ({ page }, testInfo) => {
    const fence = await bootSignedIn(page, width);
    const state = await routeJudgeApis(page);
    const dir = shotsDir(testInfo);

    await openSettings(page);
    const group = page.locator("#settingsJudgeGroup");
    await expect(page.locator("#settingsJudgeTitle")).toHaveText("Grading model (optional)");
    await expect(page.locator("#settingsJudgeStatus")).toHaveText("Not set. Your writing model grades its own work.");
    await expect(page.locator("#settingsJudgeFootnote")).toHaveText(
      "Check connection tests the key in this browser. Drafting and grading use the keys saved on this computer (~/.jobbored).",
    );
    await expect(page.locator("#settingsJudgeEditor")).toBeHidden();
    await captureGroup(page, dir, width, "empty");

    await page.locator("#settingsJudgeChange").click();
    await expect(page.locator("#settingsJudgeEditor")).toBeVisible();
    await expect(page.locator("#settingsJudgeProvider")).toHaveValue("xai");
    await expect(page.locator("#settingsJudgeKeyLink")).toHaveAttribute("href", "https://console.x.ai/");
    await expect(page.locator("#settingsJudgeKeyLink")).toHaveAttribute("target", "_blank");
    await expect(page.locator("#settingsJudgeKeyLink")).toHaveAttribute("rel", "noopener");
    const key = page.locator("#settingsJudgeApiKey");
    await key.fill("fictional-xai-key");
    await key.blur();
    const model = page.locator("#settingsJudgeModel");
    await expect(model.locator("option")).toHaveCount(3);
    await expect(model).toHaveValue("grok-4.2");
    await captureGroup(page, dir, width, "models-loaded");

    await page.locator("#settingsSaveBtn").click();
    await expect(page.locator("#settingsModal")).toBeHidden();
    expect(state.posts.at(-1)).toEqual({
      judge: { provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key" },
    });
    await openSettings(page);
    await expect(page.locator("#settingsJudgeTitle")).toHaveText("Grading model");
    await expect(page.locator("#settingsJudgeStatus")).toHaveText("Grok · grok-4.2 · key saved");
    await page.locator("#settingsJudgeChange").click();
    await expect(page.locator("#settingsJudgeKeyState")).toHaveText("Key saved");
    await expect(key).toHaveValue("");
    await captureGroup(page, dir, width, "saved");

    await key.fill("fictional-bad-key");
    await key.blur();
    await expect(page.locator("#settingsJudgeError")).toHaveText("That key didn't work: check it on the xAI console.");
    await expect(key).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#settingsJudgeRetry")).toBeVisible();
    await captureGroup(page, dir, width, "key-error");
    await expect(group).not.toContainText(/judge/i);
    const modalHtml = await page.locator("#settingsModal").innerHTML();
    expect(modalHtml).not.toContain("fictional-xai-key");
    expect(modalHtml).not.toContain("fictional-bad-key");
    expect(fence.unexpectedExternal.filter((url) => /x\.ai/.test(url))).toEqual([]);
  });
}
