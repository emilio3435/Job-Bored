/* global window, document, matchMedia -- evaluated in the browser page */
/**
 * LEADTABS Q1: the Leads surface, Filters and Chat, in a real browser.
 *
 *   Filters  filter the list, save a view, reload, reopen it.
 *   Chat     change a control and read the review bar's before → after.
 *   Save     POST /profile succeeds: one history entry, then undo it.
 *            POST /profile is local_only: the diff stays open, no history.
 *   Agent    a stubbed proposal renders through the real leads-agent.js
 *            transport, applies only on Apply, and the 503 "not connected"
 *            card applies nothing.
 *   Keys     toggle Filters/Chat and reach the review bar without a mouse.
 *
 * Hermetic: the harness fence answers Google, Sheets and every host path.
 * Each test stubs same-origin /profile (and /api/leads/chat where it needs a
 * proposal) and asserts that nothing reached :8080, :8644 or :3847, and that
 * no host path reached the in-process server.
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

let app;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  await app?.close();
});

const LIVE_PORTS = new Set(["8080", "8644", "3847"]);

/**
 * The fence answers every off-origin request inside the browser (the app's
 * boot asks the example materials origin, :3847, for its queue). What must
 * never happen is a request that reaches a real socket on a live port: a
 * finished response with a server address, or a failure other than the
 * fence's own block.
 */
function trackLivePortTraffic(page, sink) {
  const onLivePort = (req) => LIVE_PORTS.has(new URL(req.url()).port);
  page.on("requestfinished", async (req) => {
    if (!onLivePort(req)) return;
    const res = await req.response().catch(() => null);
    const addr = res ? await res.serverAddr().catch(() => null) : null;
    if (addr) sink.push(`${req.method()} ${req.url()} reached ${addr.ipAddress}:${addr.port}`);
  });
  page.on("requestfailed", (req) => {
    if (!onLivePort(req)) return;
    const why = req.failure()?.errorText || "";
    if (!/ERR_BLOCKED_BY_CLIENT/.test(why)) sink.push(`${req.method()} ${req.url()} failed: ${why}`);
  });
}

// A local calendar date at noon, so "Today" and "1d" hold at any hour.
function isoDaysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function row(n, title, company, location, salary, fit, status, days) {
  return {
    title,
    company,
    status,
    link: `https://jobs.example.test/${n}`,
    location,
    source: "greenhouse",
    salary,
    priority: "",
    tags: "",
    notes: "",
    followUpDate: "",
    responseFlag: "",
    favorite: false,
    fitScore: fit,
    matchScore: fit * 10,
    dateFoundRaw: isoDaysAgo(days),
    fitAssessment: "Fictional fixture row.",
    workMode: "",
    workModeSource: "",
  };
}

// Fictional rows. Target roles are Revenue Operations and Sales Operations;
// the floor of $120k hides the analyst and the intern.
const ROWS = [
  row(1, "Director, Revenue Operations", "Northwind Analytics", "Remote - US", "$185k - $215k", 9, "Researching", 1),
  row(2, "Senior Manager, Revenue Operations", "Kestrel Health", "Hybrid - Austin, TX", "$160k - $180k", 8, "New", 0),
  row(3, "Revenue Operations Manager", "Chronicle", "Remote", "$140k - $165k", 7, "Applied", 4),
  row(4, "Sales Operations Lead", "Meridian Labs", "On-site - Denver, CO", "$150k - $170k", 7, "New", 3),
  row(5, "Revenue Operations Analyst", "Umbrella Retail", "Remote", "$85k - $100k", 5, "New", 2),
  row(6, "Sales Operations Manager", "Vandelay Industries", "On-site - New York", "$125k - $135k", 6, "New", 11),
  row(7, "Account Executive", "Globex", "Remote", "$120k - $140k", 4, "New", 5),
  row(8, "Revenue Operations Intern", "Hooli", "Remote", "$40k - $50k", 3, "New", 1),
];

const PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Revenue Operations", "Sales Operations"],
    targetSeniority: "director",
    primaryNarrative: "I build revenue systems for B2B software teams.",
  },
  strengths: [{ name: "Forecasting", evidence: "Built a forecast process from scratch." }],
  hardConstraints: {
    workMode: "any",
    acceptableLocations: [],
    salaryFloor: 120000,
    salaryRequired: false,
    skipTitles: [],
    workAuth: "us_citizen",
  },
  wants: ["Owning revenue systems"],
  avoids: [],
};

const DISCOVERY = {
  targetRoles: "Revenue Operations, Sales Operations",
  seniority: "director",
  keywordsInclude: "RevOps, forecasting",
  keywordsExclude: "",
  maxLeadsPerRun: "15",
  groundedWebEnabled: true,
  sourcePreset: "browser_plus_ats",
  companyBlocklist: [],
};

const SAVE_LOCAL_ONLY =
  "Couldn't save: JobBored's profile service didn't answer, so nothing was saved.";

/**
 * Boot the real app hermetically, stub /profile, seed rows and show Leads.
 * `profilePost` decides how POST /profile answers: "ok" or "local_only".
 */
async function bootLeads(page, { profilePost = "ok", reload = false } = {}) {
  const errors = [];
  const posts = [];
  const livePortRequests = [];
  let fence = null;
  if (!reload) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.on("pageerror", (e) => errors.push(String(e)));
    trackLivePortTraffic(page, livePortRequests);
    fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
    let doc = structuredClone(PROFILE);
    // Registered after the fence, so this route answers /profile first.
    await page.route(`${app.baseUrl}/profile`, async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        if (profilePost === "local_only") {
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "profile_api_unreachable" }),
          });
          return;
        }
        doc = JSON.parse(req.postData());
        posts.push(doc);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, updatedAt: "2026-09-28T12:00:00.000Z" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profile: doc }),
      });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  } else {
    await page.reload({ waitUntil: "load" });
  }
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.waitForFunction(
    () =>
      !!(
        window.JobBoredApp?.core &&
        window.JobBoredApp.pipelineRender &&
        window.JobBoredLeads?.controller() &&
        window.JobBoredLeadsTune &&
        window.JobBoredLeadsAgent &&
        window.CommandCenterUserContent
      ),
  );
  await page.evaluate(
    async ({ rows, profile, discovery }) => {
      await window.CommandCenterUserContent.saveDiscoveryProfile(discovery);
      window.JobBoredApp.core.host?.revealDashboardShell?.();
      rows.forEach((r) => {
        r.dateFound = new Date(r.dateFoundRaw);
      });
      window.JobBoredApp.core.setPipelineData(rows);
      window.JobBoredApp.pipelineRender.renderPipeline();
      window.JobBoredLeads.setProfile({ ...profile, discoveryProfile: discovery });
      window.JobBoredFlowing.views.show("leads", { focus: false });
    },
    { rows: structuredClone(ROWS), profile: PROFILE, discovery: DISCOVERY },
  );
  await expect(page.locator('[data-region="leads"] .jbl-row').first()).toBeVisible();
  return { errors, posts, livePortRequests, fence };
}

async function openChat(page) {
  await page.locator('.jbl-modes__btn[data-leads-mode="chat"]').click();
  await waitChatReady(page);
}

async function waitChatReady(page) {
  await expect(page.locator(".jbt-now-next")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.JobBoredLeadsTune.controller().getState().status))
    .toBe("ready");
}

function visibleRowCount(page) {
  return page.locator('[data-region="leads"] .jbl-row:not(.jbl-row--hidden)').count();
}

function tuneHistoryLength(page) {
  return page.evaluate(() => window.JobBoredLeadsTune.controller().getState().history.length);
}

async function raiseFloor(page, value) {
  await page.fill("#jbtFloor", String(value));
  await page.locator("#jbtFloor").press("Tab");
  await expect(page.locator('[data-jbt="review"]')).toBeVisible();
}

function expectHermetic(ctx) {
  expect(ctx.errors).toEqual([]);
  expect(ctx.livePortRequests).toEqual([]);
  expect(ctx.fence.unexpectedExternal).toEqual([]);
  expect(app.hostRequests).toEqual([]);
}

test.afterEach(() => {
  // The server spy is shared by the file; each test asserts its own slice.
  app.hostRequests.length = 0;
});

test("Filters: filter the list, save a view, reload and reopen it", async ({ page }) => {
  const ctx = await bootLeads(page);
  const all = await visibleRowCount(page);
  // The floor hides the analyst and the intern; the targets lens hides the AE.
  expect(all).toBe(5);

  await page.fill("#leadsSearch", "revenue");
  await expect.poll(() => visibleRowCount(page)).toBe(3);
  await page.locator('input[data-facet="stages"][value="New"]').check();
  await expect.poll(() => visibleRowCount(page)).toBe(1);
  await expect(page.locator('[data-region="leads"] .jbl-row').first()).toContainText("Kestrel Health");
  await expect(page.locator('[data-jbl="count"]')).toContainText("1");

  await page.locator('[data-jbl="save-view"]').click();
  const dialog = page.locator('[data-jbl="save-dialog"]');
  await expect(dialog).toBeVisible();
  await page.fill("#leadsViewName", "New RevOps");
  await dialog.getByRole("button", { name: "Save view" }).click();
  const saved = page.locator('[data-jbl="views"] .jbl-view__open', { hasText: "New RevOps" });
  await expect(saved).toBeVisible();
  await expect(saved.locator(".jbl-view__count")).toHaveText("1");

  // The view lives in IndexedDB (jobbored-leads/records): it survives a reload.
  await bootLeads(page, { reload: true });
  await expect.poll(() => visibleRowCount(page)).toBe(5);
  const reopened = page.locator('[data-jbl="views"] .jbl-view__open', { hasText: "New RevOps" });
  await expect(reopened).toBeVisible();
  await reopened.click();
  await expect.poll(() => visibleRowCount(page)).toBe(1);
  await expect(reopened).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('input[data-facet="stages"][value="New"]')).toBeChecked();
  await expect(page.locator('[data-region="leads"] .jbl-row').first()).toContainText("Kestrel Health");
  expectHermetic(ctx);
});

test("Chat: a control change shows the review bar's before → after counts", async ({ page }) => {
  const ctx = await bootLeads(page);
  await openChat(page);
  await expect(page.locator(".jbl-modes__btn[data-leads-mode='chat']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-jbt="nn-find"]')).toHaveText("5");
  await expect(page.locator('[data-jbt="review"]')).toBeHidden();

  // The after count comes from LC's own floor rule; the spec pins only that
  // it is fewer than before and that the bar reports both numbers.
  await raiseFloor(page, 150000);
  await expect(page.locator('[data-jbt="rv-title"]')).toHaveText("1 unapplied change");
  const sub = page.locator('[data-jbt="rv-sub"]');
  await expect(sub).toHaveText(/^Find: 5 → \d+ leads · Future runs: 1 setting change$/);
  const after = Number((await sub.textContent()).match(/→ (\d+)/)[1]);
  expect(after).toBeLessThan(5);

  // Review opens the same diff; nothing is saved until Apply.
  await page.locator('[data-jbt-act="review"]').click();
  const dlg = page.locator('[data-jbt="review-dialog"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Salary floor");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  expect(ctx.posts).toHaveLength(0);

  // Discard puts the control back and closes the bar.
  await page.locator('[data-jbt-act="discard"]').click();
  await expect(page.locator('[data-jbt="review"]')).toBeHidden();
  await expect(page.locator("#jbtFloor")).toHaveValue("120000");
  expect(ctx.posts).toHaveLength(0);
  expect(await tuneHistoryLength(page)).toBe(0);
  expectHermetic(ctx);
});

test("Save: a synced save writes one history entry, and undo reverts it", async ({ page }) => {
  const ctx = await bootLeads(page);
  await openChat(page);
  await raiseFloor(page, 150000);
  await page.locator('[data-jbt="review"] [data-jbt-act="apply"]').click();
  await expect(page.locator('[data-jbt="review"]')).toBeHidden();

  expect(ctx.posts).toHaveLength(1);
  expect(ctx.posts[0].hardConstraints.salaryFloor).toBe(150000);
  // The full document goes back: required fields stay as loaded.
  expect(ctx.posts[0].identity.primaryNarrative).toBe(PROFILE.identity.primaryNarrative);
  expect(ctx.posts[0].strengths).toEqual(PROFILE.strengths);
  expect(await page.evaluate(() => window.JobBoredLeads.profile().hardConstraints.salaryFloor)).toBe(150000);

  await page.locator('[data-jbt-side="history"]').click();
  const items = page.locator(".jbt-hist__item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Salary floor");
  await expect(items.first().locator(".jbt-mono")).toHaveText(/^Find 5 → \d+$/);

  await items.first().locator(".jbt-hist__undo").click();
  // The undo is itself logged, and the original entry reads Undone.
  await expect(items).toHaveCount(2);
  await expect(page.locator(".jbt-hist__item.is-undone")).toHaveCount(1);
  expect(ctx.posts).toHaveLength(2);
  expect(ctx.posts[1].hardConstraints.salaryFloor).toBe(120000);
  await expect(page.locator("#jbtFloor")).toHaveValue("120000");
  expect(await page.evaluate(() => window.JobBoredLeads.profile().hardConstraints.salaryFloor)).toBe(120000);
  expectHermetic(ctx);
});

test("Save: a local_only save keeps the diff open and writes no history", async ({ page }) => {
  const ctx = await bootLeads(page, { profilePost: "local_only" });
  await openChat(page);
  await raiseFloor(page, 150000);
  await page.locator('[data-jbt="review"] [data-jbt-act="apply"]').click();

  const bar = page.locator('[data-jbt="review"]');
  await expect(bar.locator('[role="alert"]')).toContainText(SAVE_LOCAL_ONLY);
  await expect(bar.locator('[data-jbt="rv-title"]')).toHaveText("1 unapplied change");
  await expect(bar.locator('[data-jbt-act="apply"]')).toBeVisible();
  await expect(page.locator("#jbtFloor")).toHaveValue("150000");

  expect(await tuneHistoryLength(page)).toBe(0);
  await page.locator('[data-jbt-side="history"]').click();
  await expect(page.locator(".jbt-hist__item")).toHaveCount(0);
  await expect(page.locator(".jbt-hist__empty")).toBeVisible();
  // Filters did not move to the unsaved floor.
  expect(await page.evaluate(() => window.JobBoredLeads.profile().hardConstraints.salaryFloor)).toBe(120000);
  expect(ctx.posts).toHaveLength(0);
  expectHermetic(ctx);
});

test("Agent: a proposal renders, applies only on Apply, and records history", async ({ page }) => {
  const ctx = await bootLeads(page);
  const chatBodies = [];
  // Stub the model route itself so the real leads-agent.js transport runs.
  await page.route("**/api/leads/chat", async (route) => {
    chatBodies.push(JSON.parse(route.request().postData()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reply: "Raising your floor to $150k drops the lower-paid roles. I can also avoid Globex.",
        changes: [
          { field: "hardConstraints.salaryFloor", op: "set", value: 150000 },
          { field: "discoveryProfile.companyBlocklist", op: "add", value: ["Globex"] },
          { field: "tieBreakers.favoredCompanies", op: "add", value: ["Northwind Analytics"] },
        ],
      }),
    });
  });
  await openChat(page);
  await page.fill("#jbtAsk", "Nothing under $150k, and skip Globex");
  await page.locator("#jbtAsk").press("Enter");

  const card = page.locator(".jbt-msg--bot .jbt-diff");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Not applied");
  await expect(card).toContainText("Salary floor");
  await expect(card).toContainText("Globex");
  // The allowlist drops favoured companies (D5): never shown, never applied.
  await expect(card).not.toContainText("Northwind");
  await expect(card).toContainText("Proposed: 2 of 2 changes");
  await expect(card).toContainText("I left out 1 suggestion");
  expect(chatBodies).toHaveLength(1);
  expect(chatBodies[0].message).toBe("Nothing under $150k, and skip Globex");

  // Nothing changed silently: no POST, no history, Filters on the old floor.
  expect(ctx.posts).toHaveLength(0);
  expect(await tuneHistoryLength(page)).toBe(0);
  expect(await page.evaluate(() => window.JobBoredLeads.profile().hardConstraints.salaryFloor)).toBe(120000);
  await expect(page.locator("#jbtFloor")).toHaveValue("120000");

  // Untick the blocklist row: only the ticked row is applied.
  const ticks = card.locator('input[type="checkbox"]');
  await expect(ticks).toHaveCount(2);
  await ticks.nth(1).uncheck();
  const apply = card.locator("[data-jbt-apply]");
  await expect(apply).toHaveText("Apply 1 change");
  await apply.click();

  await expect(page.locator(".jbt-diff.is-applied")).toBeVisible();
  await expect(page.locator(".jbt-diff.is-applied")).toContainText("Applied 1 change");
  expect(ctx.posts).toHaveLength(1);
  expect(ctx.posts[0].hardConstraints.salaryFloor).toBe(150000);
  const blocklist = await page.evaluate(
    () => window.CommandCenterUserContent.getDiscoveryProfile().then((d) => d.companyBlocklist),
  );
  expect(blocklist).toEqual([]);
  expect(await tuneHistoryLength(page)).toBe(1);
  expectHermetic(ctx);
});

// Q1 bug 1: leads-agent.js pre-validates, so it reports what it dropped and
// the card adds that to its own left-out count.
test("Agent: the card says when the allowlist left a suggestion out", async ({ page }) => {
  const ctx = await bootLeads(page);
  await page.route("**/api/leads/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reply: "Raising your floor to $150k.",
        changes: [
          { field: "hardConstraints.salaryFloor", op: "set", value: 150000 },
          { field: "tieBreakers.favoredCompanies", op: "add", value: ["Northwind Analytics"] },
        ],
      }),
    }),
  );
  await openChat(page);
  await page.fill("#jbtAsk", "Nothing under $150k, and favour Northwind");
  await page.locator("#jbtAsk").press("Enter");
  await expect(page.locator(".jbt-msg--bot .jbt-diff")).toContainText("I left out 1 suggestion");
  expectHermetic(ctx);
});

test("Agent: when every suggestion is refused, the reply says none was a setting", async ({ page }) => {
  const ctx = await bootLeads(page);
  await page.route("**/api/leads/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reply: "Favouring Northwind.",
        changes: [{ field: "tieBreakers.favoredCompanies", op: "add", value: ["Northwind Analytics"] }],
      }),
    }),
  );
  await openChat(page);
  await page.fill("#jbtAsk", "Favour Northwind");
  await page.locator("#jbtAsk").press("Enter");
  const bot = page.locator(".jbt-msg--bot").last();
  await expect(bot).toContainText("Nothing you asked for is a setting I can change");
  await expect(bot).not.toContainText("already say");
  await expect(bot.locator(".jbt-diff")).toHaveCount(0);
  expect(ctx.posts).toHaveLength(0);
  expect(await tuneHistoryLength(page)).toBe(0);
  expectHermetic(ctx);
});

test("Agent: the 503 not-connected card shows and nothing is applied", async ({ page }) => {
  // No chat stub here: the harness answers POST /api/leads/chat with its
  // typed 503 agent_not_connected.
  const ctx = await bootLeads(page);
  await openChat(page);
  await page.fill("#jbtAsk", "Only fully remote");
  await page.locator("#jbtAsk").press("Enter");

  const err = page.locator(".jbt-err");
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute("role", "alert");
  await expect(err).toContainText("No settings were changed");
  await expect(err.locator("[data-jbt-retry]")).toHaveCount(0);
  await expect(page.locator(".jbt-msg--bot .jbt-diff")).toHaveCount(0);

  expect(ctx.posts).toHaveLength(0);
  expect(await tuneHistoryLength(page)).toBe(0);
  await expect(page.locator('[data-jbt="review"]')).toBeHidden();
  expect(await page.evaluate(() => window.JobBoredLeads.profile().hardConstraints.workMode)).toBe("any");
  expectHermetic(ctx);
});

test("Keys: toggle Filters and Chat and reach the review bar without a mouse", async ({ page }) => {
  const ctx = await bootLeads(page);
  const mode = () => page.evaluate(() => window.JobBoredLeads.mode());
  const active = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a ? a.id || a.getAttribute("data-fk") || a.getAttribute("data-leads-mode") || a.tagName : "";
    });

  // g c switches to Chat.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect.poll(mode).toBe("chat");
  await waitChatReady(page);

  // g f switches back from Chat.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await expect.poll(mode).toBe("filters");

  // The toggle is a real button: Tab to it, Enter switches.
  await page.locator('.jbl-modes__btn[data-leads-mode="filters"]').focus();
  await page.keyboard.press("Tab");
  expect(await active()).toBe("chat");
  await page.keyboard.press("Enter");
  await expect.poll(mode).toBe("chat");
  await waitChatReady(page);

  // Tab to the salary floor, type a value, then Tab on to the review bar.
  const tabUntil = async (predicate, limit = 120) => {
    for (let i = 0; i < limit; i += 1) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(predicate)) return true;
    }
    return false;
  };
  expect(await tabUntil(() => document.activeElement?.id === "jbtFloor")).toBe(true);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("150000");
  expect(
    await tabUntil(() => !!document.activeElement?.closest('[data-jbt="review"]')),
  ).toBe(true);
  await expect(page.locator('[data-jbt="rv-sub"]')).toContainText("Find: 5 →");
  expect(await tabUntil(() => document.activeElement?.getAttribute("data-fk") === "rv:apply", 5)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-jbt="review"]')).toBeHidden();
  expect(ctx.posts).toHaveLength(1);
  expect(ctx.posts[0].hardConstraints.salaryFloor).toBe(150000);
  expectHermetic(ctx);
});
