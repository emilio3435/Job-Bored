/**
 * GREENFIELD-SPEC §4.6 — the six integration claims for lanes A–D.
 *
 * Each test drives the real browser shell against hermetic Google, Sheets,
 * provider, and local-service boundaries. The integration base is expected to
 * fail every claim; the tests turn green only after the owning lane lands.
 */
import { expect, test } from "@playwright/test";
import {
  fulfillJson,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const CLIENT_ID = "jobbored-onboarding-e2e.apps.googleusercontent.com";
const ACCESS_TOKEN = "jobbored-onboarding-e2e-token";
const SHEET_ID = "jobboredOnboardingE2ESheet1234567890";
const USER_EMAIL = "qa@jobbored.example";
const OPENROUTER_KEY = "sk-or-jobbored-onboarding-e2e";
const OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const PAUSE_TOAST = "Setup paused — pick up right here anytime.";
const CONNECT_AI_MESSAGE =
  "Connect an AI provider first — your resume is drafted with it.";

const AUTH = Object.freeze({
  sheetId: SHEET_ID,
  oauthClientId: CLIENT_ID,
  userEmail: USER_EMAIL,
  accessToken: ACCESS_TOKEN,
});

let app;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function action(page, id) {
  return page.locator(
    `#oneFlowMount [data-action-id="${id}"], ` +
      `#oneFlowMount [data-action="${id}"]`,
  );
}

function beat(page, id) {
  return page.locator(`#oneFlowMount .oneflow-beat[data-beat-id="${id}"]`);
}

async function installBoundaries(page) {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    auth: AUTH,
  });

  // Settings probes local Ollama while it hydrates provider controls. Keep
  // that optional probe deterministic and inside the hermetic fence.
  await page.route("http://127.0.0.1:11434/v1/models", async (route) => {
    await fulfillJson(route, { data: [{ id: "gemma4:e2b" }] });
  });

  return fence;
}

async function waitForApp(page) {
  await page.waitForFunction(
    () =>
      typeof globalThis.JobBoredOneFlow?.open === "function" &&
      typeof globalThis.CommandCenterUserContent?.saveOnboardingFlowState ===
        "function",
  );
}

async function bootGreenfield(page) {
  await installBoundaries(page);
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await waitForApp(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("greenfield"))
    .toBeNull();
}

async function saveFlowState(page, partial) {
  await page.evaluate(
    async (next) =>
      globalThis.CommandCenterUserContent.saveOnboardingFlowState(next),
    partial,
  );
}

async function stageConfiguredInstall(page) {
  await page.addInitScript(
    ({ clientId, accessToken, sheetId, userEmail, providerKey, providerModel }) => {
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const grantedOauthScopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ].join(" ");

      globalThis.localStorage.setItem(
        "command_center_config_overrides",
        JSON.stringify({
          sheetId,
          oauthClientId: clientId,
          resumeProvider: "openrouter",
          resumeOpenRouterApiKey: providerKey,
          resumeOpenRouterModel: providerModel,
        }),
      );
      globalThis.localStorage.setItem(
        "command_center_oauth_session",
        JSON.stringify({
          expiresAt,
          userEmail,
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.sessionStorage.setItem(
        "command_center_oauth_runtime",
        JSON.stringify({
          accessToken,
          expiresAt,
          userEmail,
          grantedOauthScopes,
          oauthClientId: clientId,
          hasOauthSession: true,
        }),
      );
      globalThis.localStorage.setItem("command_center_discovery_coach_done", "1");
    },
    {
      clientId: CLIENT_ID,
      accessToken: ACCESS_TOKEN,
      sheetId: SHEET_ID,
      userEmail: USER_EMAIL,
      providerKey: OPENROUTER_KEY,
      providerModel: OPENROUTER_MODEL,
    },
  );
}

async function bootConfigured(page) {
  await stageConfiguredInstall(page);
  await installBoundaries(page);
  await page.goto(`${app.baseUrl}/`, { waitUntil: "load" });
  await waitForApp(page);
}

async function reachSavedResumeBeat(page) {
  await bootConfigured(page);
  await saveFlowState(page, {
    beat: "resume",
    completedBeats: ["google", "ai"],
    completed: false,
  });
  await page.reload({ waitUntil: "load" });
  await waitForApp(page);
  await expect(beat(page, "resume")).toBeVisible();
}

async function reachConfiguredBoard(page) {
  await bootConfigured(page);
  await page.evaluate(async () => {
    const store = globalThis.CommandCenterUserContent;
    await Promise.all([
      store.completeOnboarding(),
      store.completeInfraSetup(),
      store.completeDiscoverySetup(),
      store.saveOnboardingFlowState({
        beat: "payoff",
        completedBeats: [
          "google",
          "ai",
          "resume",
          "fit",
          "discovery",
          "payoff",
        ],
        completed: true,
      }),
    ]);
  });
  await page.reload({ waitUntil: "load" });
  await waitForApp(page);
  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#oneFlowMount")).toBeHidden();
}

test("E1 Beat 3 is gated on Beat 2", async ({ page }) => {
  await bootGreenfield(page);

  await page.evaluate(() => globalThis.JobBoredOneFlow.open("resume"));
  await expect(beat(page, "ai")).toBeVisible();
  await expect(page.locator('#oneFlowMount [data-gate-note="ai"]')).toHaveText(
    CONNECT_AI_MESSAGE,
  );

  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    globalThis.localStorage.setItem(
      "command_center_config_overrides",
      JSON.stringify({
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "",
        resumeOpenRouterModel: "openai/gpt-oss-120b:free",
      }),
    );
  });
  await saveFlowState(page, {
    beat: "ai",
    completedBeats: ["ai"],
    completed: false,
  });
  await page.reload({ waitUntil: "load" });
  await waitForApp(page);

  const profilePosts = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/profile/from-resume") {
      profilePosts.push(request.url());
    }
  });

  await page.evaluate(() => globalThis.JobBoredOneFlow.open("resume"));
  await expect(beat(page, "resume")).toBeVisible();
  await page.locator("#oneFlowResumePaste").fill(
    "Staff platform engineer with twelve years building reliable distributed " +
      "systems, developer platforms, observability, and incident response. ".repeat(4),
  );
  await page.getByRole("button", { name: "Draft from this text" }).click();

  await expect(page.getByText(CONNECT_AI_MESSAGE, { exact: true })).toBeVisible();
  expect(profilePosts).toEqual([]);

  const connectAi = page
    .locator('#oneFlowMount button')
    .filter({ hasText: /connect ai/i });
  await expect(connectAi).toBeVisible();
  await connectAi.click();
  await expect(beat(page, "ai")).toBeVisible();
});

test("E2 Pasted resume survives Escape and reload", async ({ browser }) => {
  for (const inputMethod of ["type", "fill"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await reachSavedResumeBeat(page);
      const resume =
        `${inputMethod.toUpperCase()} path: ` +
        "Staff engineer owning platform reliability, distributed systems, " +
          "developer tooling, observability, delivery, and incident response. ".repeat(4);

      const paste = page.locator("#oneFlowResumePaste");
      if (inputMethod === "type") await paste.type(resume);
      else await paste.fill(resume);

      await page.keyboard.press("Escape");
      await expect(page.getByText(PAUSE_TOAST, { exact: true })).toBeVisible();
      await page.reload({ waitUntil: "load" });
      await waitForApp(page);

      await expect(
        beat(page, "resume"),
        `${inputMethod} must resume on Beat 3 after reload`,
      ).toBeVisible();
      await expect(page.locator("#oneFlowResumePaste")).toHaveValue(resume);
    } finally {
      await context.close();
    }
  }
});

test("E3 Drawer setup lands in OneFlow", async ({ page }) => {
  await reachConfiguredBoard(page);

  await page.locator("#discoveryBtn").click();
  await expect(page.locator("#discoveryDrawer")).toBeVisible();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.locator("#settingsDiscoveryOpenSetupBtn").click();

  await expect(
    beat(page, "discovery"),
  ).toBeVisible();
  await expect(page.locator("#discoverySetupWizardMount")).toBeEmpty();
});

test("E4 Beat 1 never punts to Settings", async ({ page }) => {
  await bootGreenfield(page);
  await page.evaluate(() => globalThis.JobBoredOneFlow.open("google"));

  await action(page, "google_continue").click();

  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(
    page.locator("#oneFlowMount details.oneflow-google__detour"),
  ).toHaveJSProperty("open", true);
  await expect(page.locator("#oneFlowOauthClientIdInput")).toBeFocused();
  await expect(
    page.getByText("Paste your Client ID to continue.", { exact: true }),
  ).toBeVisible();
});

test("E5 Payoff is honest", async ({ page }) => {
  await bootGreenfield(page);
  await saveFlowState(page, {
    beat: "payoff",
    completedBeats: ["google"],
    completed: false,
  });

  await page.evaluate(() => {
    // A greenfield controller can know the persisted Beat 1 receipt even when
    // no live Sheet getter is available. The gate must honor that receipt;
    // Beat 6 itself owns the honest no-Sheet readiness state.
    if (globalThis.JobBoredApp?.core?.host) {
      globalThis.JobBoredApp.core.host.getSheetId = undefined;
    }
    return globalThis.JobBoredOneFlow.open("payoff");
  });

  const connectGoogle = action(page, "payoff_connect_google");
  await expect(connectGoogle).toBeVisible();
  await expect(connectGoogle).toHaveText("Connect Google to go live");
  await expect(action(page, "payoff_run_discovery")).toHaveCount(0);
  await expect(page.locator(".toast-error")).toHaveCount(0);

  await connectGoogle.click();
  await expect(beat(page, "google")).toBeVisible();
});

test("E6 Settings shows receipts", async ({ page }) => {
  await reachConfiguredBoard(page);
  await page.getByRole("button", { name: "Settings and setup" }).click();

  const settings = page.getByRole("dialog", { name: "JobBored settings" });
  await expect(settings).toBeVisible();
  await expect(settings.locator("#settingsDiscoveryWebhookUrl")).toHaveCount(0);
  await expect(settings.getByRole("tab", { name: "Google", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "AI", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("tab", { name: "Sheet", exact: true })).toHaveCount(0);

  const aiReceipt = settings.locator('[data-receipt="ai"]');
  await expect(aiReceipt).toContainText("OpenRouter");
  await expect(aiReceipt).toContainText(OPENROUTER_MODEL);

  await settings.getByRole("tab", { name: "Google", exact: true }).click();
  const googleReceipt = settings.locator('[data-receipt="google"]');
  await googleReceipt.locator('[data-action="settings_change_in_setup"]').click();

  await expect(settings).toBeHidden();
  await expect(beat(page, "google")).toBeVisible();
  await action(page, "google_continue").click();
  await expect(page.locator("#oneFlowMount")).toBeHidden();
  await expect(beat(page, "resume")).toHaveCount(0);
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
});
