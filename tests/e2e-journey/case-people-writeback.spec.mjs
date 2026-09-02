/**
 * case-people-writeback.spec.mjs — wire-level proof that The Case's People
 * controls issue Sheets writes for contact / last contact / reply / follow-up.
 *
 * `tests/role-writeback-bridge.test.mjs` already proves `jb:role:writeback`
 * with a mocked fetch. This spec is the missing browser proof: the actual
 * People inputs, in a real Chromium, produce PUT requests to
 * Pipeline!L / P / R / S.
 *
 * Run:
 *   npm run test:e2e-journey
 */

import { test, expect } from "@playwright/test";
import {
  corsHeaders,
  fulfillJson,
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const DEMO_BOARD = "#oneFlowDemoBoard";
const ROLE_REGION = '[data-region="role"]';

const FOLLOWUP = "2026-09-10";
const REPLY = "Yes";
const LAST_CONTACT = "2026-09-01";
const CONTACT = "Dana Reyes";

const PEOPLE_COLUMNS = new Set(["L", "P", "R", "S"]);

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

function isoDatePlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fixtureJobs() {
  const followUpDate = isoDatePlus(3);
  const scrapedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  return [
    {
      title: "Senior Product Manager",
      company: "Meridian Labs",
      location: "Austin, TX",
      link: "https://jobs.meridian-labs.test/senior-pm",
      source: "Ashby",
      salary: "$185–230k",
      fitScore: 8,
      priority: "⚡",
      tags: "Design Systems, Accessibility",
      status: "Researching",
      notes: "Recruiter: Dana",
      followUpDate,
      responseFlag: "No",
      favorite: true,
      dateFoundRaw: "2026-08-29",
      _postingEnrichment: {
        roleInOneLine: "Design **infrastructure** that ships.",
        mustHaves: ["5+ years of **bold** design systems", "- WCAG 2.2"],
        toolsAndStack: ["React", "Storybook"],
        talkingPoints: ["Shipped tokens; cut drift 80%"],
        requirements: ["5+ years design systems", "WCAG 2.2"],
        skills: ["React"],
        scrapedAt,
        _parseMode: "loose",
      },
    },
    {
      title: "Staff Platform Engineer",
      company: "Chronicle",
      location: "Remote",
      link: "https://jobs.chronicle.test/staff-platform",
      source: "Greenhouse",
      salary: "$210–250k",
      fitScore: 7,
      priority: "⚡",
      tags: "Distributed systems",
      status: "New",
      notes: "",
      followUpDate,
      responseFlag: "No",
      favorite: false,
      dateFoundRaw: "2026-08-30",
      _postingEnrichment: {
        roleInOneLine: "Keep the mesh boring and the pages fast.",
        mustHaves: ["**Kubernetes** at scale", "- Observability ownership"],
        toolsAndStack: ["Go", "Kubernetes"],
        talkingPoints: ["Ran a multi-region control plane"],
        requirements: ["Kubernetes at scale"],
        skills: ["Go"],
        scrapedAt,
      },
    },
    {
      title: "Design Systems Lead",
      company: "Meridian Labs",
      location: "Austin, TX",
      link: "https://jobs.meridian-labs.test/ds-lead",
      source: "Ashby",
      salary: "$175–210k",
      fitScore: 6,
      priority: "⚡",
      tags: "Design Systems",
      status: "Researching",
      notes: "",
      followUpDate,
      responseFlag: "No",
      favorite: true,
      dateFoundRaw: "2026-08-28",
      _postingEnrichment: {
        roleInOneLine: "Own the token pipeline.",
        mustHaves: ["Token pipeline"],
        toolsAndStack: ["Figma", "React"],
        talkingPoints: ["Cut visual drift"],
        requirements: ["Design tokens"],
        skills: ["Figma"],
        scrapedAt,
      },
    },
  ];
}

function pipelineColumnLetter(url) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(new URL(url).pathname);
  } catch {
    decoded = decodeURIComponent(url);
  }
  const match = decoded.match(/Pipeline!([A-Za-z]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function isSheetWrite(request) {
  return request.method === "PUT" || request.method === "POST";
}

async function installSheetsRecorder(page, jobs) {
  const sheetsRequests = [];
  await page.route("https://sheets.googleapis.com/**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    const body = request.postData() || "";
    sheetsRequests.push({ method, url: request.url(), body });
    const range = pipelineColumnLetter(request.url());
    await fulfillJson(route, {
      ok: true,
      updatedRange: range ? `Pipeline!${range}2` : "Pipeline!A1",
      values: [["Link"], ...jobs.map((job) => [job.link])],
    });
  });
  return sheetsRequests;
}

async function bootGreenfield(page) {
  const consoleErrors = [];
  const consoleMessages = [];
  page.on("console", (msg) => {
    const text = msg.text();
    consoleMessages.push(`${msg.type()}: ${text}`);
    if (msg.type() === "error") consoleErrors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = `pageerror: ${err.message}`;
    consoleMessages.push(text);
    consoleErrors.push(text);
  });
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  const jobs = fixtureJobs();
  const sheetsRequests = await installSheetsRecorder(page, jobs);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator(DEMO_BOARD)).toBeVisible({ timeout: 15_000 });
  expect(
    fence.unexpectedExternal,
    "greenfield boot must not escape the hermetic network fence",
  ).toEqual([]);
  return { consoleErrors, consoleMessages, fence, sheetsRequests, jobs };
}

/**
 * Greenfield wipes credentials and blanks oauthClientId, so restore at boot
 * cannot load a token. After S0 paints, stage the headless-recipe session
 * and push the token into the in-memory getter flowing-writes actually reads
 * (`window.JobBored.getAccessToken` → `JobBoredApp.auth.getAccessToken`).
 */
async function stageFakeSignedInSession(page) {
  const staged = await page.evaluate(() => {
    const grantedOauthScopes = [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" ");
    const expiresAt = Date.now() + 3600e3;
    const sheetId = "hermetic-sheet-id-1234567890";
    // config.example.js's placeholder is treated as missing by getOAuthClientId.
    // Greenfield blanks the real value. A non-placeholder id is the restore key.
    const oauthClientId =
      (window.COMMAND_CENTER_CONFIG &&
        window.COMMAND_CENTER_CONFIG.oauthClientId &&
        window.COMMAND_CENTER_CONFIG.oauthClientId !==
          "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com" &&
        window.COMMAND_CENTER_CONFIG.oauthClientId) ||
      "hermetic-client.apps.googleusercontent.com";
    const session = {
      accessToken: "fake",
      expiresAt,
      oauthClientId,
      hasOauthSession: true,
      userEmail: "test@example.com",
      grantedOauthScopes,
    };

    const overrides = window.JobBoredApp && window.JobBoredApp.configOverrides;
    if (overrides && typeof overrides.applyConfigOverridesToWindowConfig === "function") {
      overrides.applyConfigOverridesToWindowConfig({
        sheetId,
        oauthClientId,
        resumeProvider: "webhook",
      });
    }

    localStorage.setItem("command_center_oauth_session", JSON.stringify(session));
    sessionStorage.setItem("command_center_oauth_runtime", JSON.stringify(session));

    const appNs = window.JobBoredApp || {};
    if (typeof appNs.core?.setSHEET_ID === "function") appNs.core.setSHEET_ID(sheetId);
    if (typeof appNs.auth?.setAccessToken === "function") appNs.auth.setAccessToken("fake");
    if (typeof appNs.auth?.setTokenExpiresAt === "function") {
      appNs.auth.setTokenExpiresAt(expiresAt);
    }
    if (typeof appNs.auth?.setUserEmail === "function") {
      appNs.auth.setUserEmail("test@example.com");
    }
    if (typeof appNs.auth?.setGrantedOauthScopes === "function") {
      appNs.auth.setGrantedOauthScopes(grantedOauthScopes);
    }

    function stubGate(mod) {
      if (mod && typeof mod.showSheetAccessGate === "function") {
        mod.showSheetAccessGate = () => {};
      }
    }
    for (const value of Object.values(appNs)) stubGate(value);
    stubGate(appNs.core && appNs.core.host);
    stubGate(appNs.setup);
    stubGate(appNs.bootstrap && appNs.bootstrap.host);

    const token =
      (window.JobBored &&
        typeof window.JobBored.getAccessToken === "function" &&
        window.JobBored.getAccessToken()) ||
      "";
    const liveSheet =
      (window.JobBored &&
        typeof window.JobBored.getSheetId === "function" &&
        window.JobBored.getSheetId()) ||
      "";
    return { token, liveSheet, oauthClientId };
  });

  if (!staged.token) {
    throw new Error(
      "staging cannot find a token seam: flowing-writes reads window.JobBored.getAccessToken() → JobBoredApp.auth.getAccessToken (in-memory accessToken). auth-session.js restores that from sessionStorage key command_center_oauth_runtime (accessToken, expiresAt, oauthClientId, hasOauthSession) after matching host().getOAuthClientId(); localStorage key command_center_oauth_session is the identity marker and does not hold the bearer token.",
    );
  }
  if (!staged.liveSheet) {
    throw new Error(
      "staging cannot find a sheet-id seam: flowing-writes reads window.JobBored.getSheetId() (the SHEET_ID module var via core.setSHEET_ID), not COMMAND_CENTER_CONFIG.sheetId alone.",
    );
  }
  return staged;
}

async function seedPipelineThroughApp(page, jobs) {
  const result = await page.evaluate((fixtureJobs) => {
    const core = window.JobBoredApp && window.JobBoredApp.core;
    const render = window.JobBoredApp && window.JobBoredApp.pipelineRender;
    const host = core && core.host;
    if (!core || typeof core.setPipelineData !== "function") {
      return { ok: false, seam: "window.JobBoredApp.core.setPipelineData" };
    }
    if (!render || typeof render.renderPipeline !== "function") {
      return { ok: false, seam: "window.JobBoredApp.pipelineRender.renderPipeline" };
    }
    core.setPipelineData(fixtureJobs);
    render.renderPipeline();
    if (host && typeof host.revealDashboardShell === "function") {
      host.revealDashboardShell();
    }
    const overrides = window.JobBoredApp && window.JobBoredApp.configOverrides;
    if (overrides && typeof overrides.applyConfigOverridesToWindowConfig === "function") {
      overrides.applyConfigOverridesToWindowConfig({ resumeProvider: "webhook" });
    }
    const data = typeof core.getPipelineData === "function" ? core.getPipelineData() : [];
    const dashboard = document.getElementById("dashboard");
    return {
      ok: true,
      count: Array.isArray(data) ? data.length : 0,
      dashboardDisplay: dashboard ? dashboard.style.display : "",
    };
  }, jobs);
  if (!result.ok) {
    throw new Error(
      `Cannot seed the pipeline without touching app source; missing seam: ${result.seam}`,
    );
  }
  expect(result.count, "seeded pipeline should hold the three fixture jobs").toBe(3);
  expect(
    result.dashboardDisplay === "block" || result.dashboardDisplay === "flex",
    `v2 role region stays hidden unless #dashboard is shown (got display=${result.dashboardDisplay})`,
  ).toBe(true);
}

async function waitForPeopleWrite(sheetsRequests, since, column, value) {
  let found = null;
  await expect
    .poll(() => {
      const next = sheetsRequests.slice(since).filter(isSheetWrite);
      found =
        next.find((request) => {
          if (pipelineColumnLetter(request.url) !== column) return false;
          try {
            return JSON.stringify(JSON.parse(request.body)) === JSON.stringify({ values: [[value]] });
          } catch {
            return false;
          }
        }) || null;
      return found;
    }, {
      message: `expected a PUT/POST to Pipeline!${column}… with ${JSON.stringify([[value]])}`,
      timeout: 8_000,
    })
    .not.toBeNull();
  return found;
}

test("the Case People controls write contact, last contact, reply, and follow-up to the Sheet", async ({
  page,
}) => {
  const { consoleErrors, consoleMessages, fence, sheetsRequests, jobs } =
    await bootGreenfield(page);
  await page.waitForTimeout(3_000);

  await stageFakeSignedInSession(page);
  await seedPipelineThroughApp(page, jobs);

  await expect(page.locator('.kanban-card[data-stable-key="1"]')).toBeAttached({
    timeout: 10_000,
  });

  await page.evaluate(() => {
    window.JobBoredFlowing.openRole.set("1");
  });

  const caseRoot = page.locator(`${ROLE_REGION} .case`);
  await expect(caseRoot).toBeVisible({ timeout: 10_000 });
  await caseRoot.evaluate((el) => el.scrollIntoView({ block: "start" }));

  const peopleWritesStart = sheetsRequests.length;

  const followup = page.locator(`${ROLE_REGION} [data-field="followupAt"]`);
  await expect(followup).toBeVisible();
  await followup.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, FOLLOWUP);
  await waitForPeopleWrite(sheetsRequests, peopleWritesStart, "P", FOLLOWUP);

  const afterFollowup = sheetsRequests.length;
  await page.locator(`${ROLE_REGION} [data-field="reply"][data-value="Yes"]`).click();
  await waitForPeopleWrite(sheetsRequests, afterFollowup, "S", REPLY);

  const afterReply = sheetsRequests.length;
  const lastContact = page.locator(`${ROLE_REGION} [data-field="heardBack"]`);
  await lastContact.fill(LAST_CONTACT);
  await lastContact.blur();
  await waitForPeopleWrite(sheetsRequests, afterReply, "R", LAST_CONTACT);

  const afterLastContact = sheetsRequests.length;
  const contact = page.locator(`${ROLE_REGION} [data-field="contact"]`);
  await contact.fill(CONTACT);
  await contact.blur();
  await waitForPeopleWrite(sheetsRequests, afterLastContact, "L", CONTACT);

  const peopleWrites = sheetsRequests.slice(peopleWritesStart).filter(isSheetWrite);
  const otherColumns = peopleWrites
    .map((request) => pipelineColumnLetter(request.url))
    .filter((letter) => letter && !PEOPLE_COLUMNS.has(letter));
  expect(
    otherColumns,
    "People edits must not write Pipeline columns other than L/P/R/S",
  ).toEqual([]);

  const notSignedIn = consoleMessages.filter((text) => /Not signed in/i.test(text));
  expect(
    notSignedIn,
    'a "Not signed in" warn means the fake OAuth session did not reach flowing-writes',
  ).toEqual([]);
  expect(consoleErrors, "the People writeback run must be console-error free").toEqual([]);
  expect(fence.unexpectedExternal).toEqual([]);
});
