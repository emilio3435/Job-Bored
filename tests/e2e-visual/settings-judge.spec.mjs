/**
 * MREV D7 + D8 · Settings → AI → Judge model, in a real browser.
 *
 * The judge group sits at the end of the AI pane, fills from GET
 * /api/llm-config, shows a stored key only as present, and posts K1 `judge`
 * through the main Save only when a judge field changed. A Save with no
 * judge edit posts exactly what it posted before this group existed.
 *
 * Hermetic: the C1 fence answers everything; this spec adds one route for
 * 127.0.0.1:3847/api/llm-config after the fence (later routes win).
 */
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

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const BROWSER_GEMINI = { resumeProvider: "gemini", resumeGeminiApiKey: "hermetic-gemini-key", resumeGeminiModel: "gemini-3.8-flash" };

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
  }, BROWSER_GEMINI);
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

/** GET answers `state.pin`; POST records the body and answers in the GET shape. */
async function routeLlmConfig(page, state) {
  const posts = [];
  await page.route("http://127.0.0.1:3847/api/llm-config", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      posts.push(body);
      if ("judge" in body) {
        state.pin = {
          ...state.pin,
          judge: body.judge
            ? { provider: body.judge.provider, model: body.judge.model, baseUrl: body.judge.baseUrl || "", keyPresent: Boolean(body.judge.apiKey) || Boolean(state.pin.judge && state.pin.judge.keyPresent) }
            : null,
        };
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.pin) });
  });
  return posts;
}

for (const width of [1440, 375]) {
  test(`at ${width}px · the judge group shows its fields, the helper, and a stored key only as present`, async ({ page }, testInfo) => {
    const fence = await bootSignedIn(page, width);
    await routeLlmConfig(page, {
      pin: { ...WRITER, judge: { provider: "openai_compatible", model: "grok-judge-1", baseUrl: "https://api.x.ai/v1", keyPresent: true } },
    });
    await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
    const group = page.locator("#settingsJudgeGroup");
    await expect(group).toBeVisible();
    await expect(group).toContainText("Judge model (optional)");
    await expect(group).toContainText("A different model grades the writing. Leave empty to use your writing model.");
    await expect(page.locator("#settingsJudgeProvider")).toHaveValue("openai_compatible");
    await expect(page.locator("#settingsJudgeModel")).toHaveValue("grok-judge-1");
    await expect(page.locator("#settingsJudgeBaseUrl")).toHaveValue("https://api.x.ai/v1");
    await expect(page.locator("#settingsJudgeApiKey")).toHaveValue("");
    await expect(page.locator("#settingsJudgeApiKey")).toHaveAttribute("type", "password");
    await expect(page.locator("#settingsJudgeKeyState")).toHaveText(/A key is saved for the judge/);
    await expect(page.getByLabel("Judge provider")).toBeVisible();

    await group.scrollIntoViewIfNeeded();
    const box = await group.boundingBox();
    expect(box, "the judge group has a box").not.toBeNull();
    expect(box.x + box.width, `the judge group fits a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, "no sideways scroll").toBeLessThanOrEqual(0);
    await group.screenshot({ path: `${shotsDir(testInfo)}/mrev-settings-judge-${width}.png`, animations: "disabled" });
    /* Settings' own live model lists (Gemini, local Ollama) are fenced and
       predate this group; the judge group itself never calls its provider. */
    expect(fence.unexpectedExternal.filter((u) => /x\.ai/.test(u))).toEqual([]);
  });
}

test("Save posts the judge only when a judge field changed, and keeps the writer's key", async ({ page }) => {
  await bootSignedIn(page, 1440);
  const state = { pin: { ...WRITER, judge: null } };
  const posts = await routeLlmConfig(page, state);

  /* A Save with no judge edit: the same one writer POST as before. */
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await expect(page.locator("#settingsJudgeGroup")).toBeVisible();
  await expect(page.locator("#settingsJudgeKeyState")).toHaveText(/No key saved for the judge/);
  await page.locator("#settingsSaveBtn").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
  expect(posts).toHaveLength(1);
  expect("judge" in posts[0], "no judge in the writer's POST").toBe(false);
  const writerPost = posts[0];

  /* A judge edit: one more POST, the server's writer pin plus K1 judge. */
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await page.locator("#settingsJudgeProvider").selectOption("openai_compatible");
  await page.locator("#settingsJudgeModel").fill("grok-judge-1");
  await page.locator("#settingsJudgeBaseUrl").fill("https://api.x.ai/v1");
  await page.locator("#settingsJudgeApiKey").fill("xai-hermetic-key");
  await page.locator("#settingsSaveBtn").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
  expect(posts).toHaveLength(3);
  expect(posts[1], "the writer's own POST is unchanged").toEqual(writerPost);
  expect(posts[2]).toEqual({
    provider: "gemini",
    model: "gemini-3.8-flash",
    baseUrl: "",
    judge: { provider: "openai_compatible", model: "grok-judge-1", baseUrl: "https://api.x.ai/v1", apiKey: "xai-hermetic-key" },
  });

  /* Reopened, the key shows as present and never as its value. */
  await page.evaluate(() => globalThis.openCommandCenterSettingsModal({ tab: "ai" }));
  await expect(page.locator("#settingsJudgeKeyState")).toHaveText(/A key is saved for the judge/);
  await expect(page.locator("#settingsJudgeApiKey")).toHaveValue("");
  const html = await page.locator("#settingsModal").innerHTML();
  expect(html).not.toContain("xai-hermetic-key");

  /* Grok P1: choosing None alone posts judge: null (use the writing model)
     and empties the other judge boxes. */
  await page.locator("#settingsJudgeProvider").selectOption("");
  await expect(page.locator("#settingsJudgeModel")).toHaveValue("");
  await expect(page.locator("#settingsJudgeBaseUrl")).toHaveValue("");
  await page.locator("#settingsSaveBtn").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
  expect(posts.at(-1).judge).toBeNull();
});
