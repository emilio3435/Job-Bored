/**
 * UX01 audit harness — shared by the eight Phase 1 auditors.
 *
 * Wraps tests/e2e-fixtures/hermetic-harness.mjs so every auditor captures the
 * app under identical conditions: the dashboard served in-process on a random
 * loopback port, config.example.js as /config.js (a stranger's config), every
 * off-origin request fenced, and — in the signed-in modes — a 12-role fictional
 * pipeline across all stages plus a DiscoveryRuns history.
 *
 * Read-only against product code. Nothing here writes config.js, the Sheet,
 * or anything outside audit/shots/.
 *
 * Usage (from the worktree root):
 *
 *   import { openApp, shoot, runAxe } from
 *     "./docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
 *   const app = await openApp({ mode: "signed-in", viewport: "desktop" });
 *   await shoot(app.page, "track", "pipeline-board");
 *   await app.close();
 *
 * Modes:
 *   "greenfield"      — no staged auth, URL gets ?greenfield=1 (first run).
 *   "signed-in"       — staged disposable OAuth + the 12-role fixture.
 *   "signed-in-empty" — staged disposable OAuth, Pipeline has headers only.
 *   "signed-in-error" — staged disposable OAuth, Sheets reads return 403.
 *
 * Signed-in modes mark setup + onboarding complete (IndexedDB) and reload, so
 * the dashboard is not covered by the one-flow. Pass { setupDone: false } to
 * see a signed-in user who has not finished setup.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PIPELINE_HEADERS,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../../../../../tests/e2e-fixtures/hermetic-harness.mjs";

export const PROGRAM_DIR = resolve(import.meta.dirname, "..", "..");
export const SHOTS_DIR = join(PROGRAM_DIR, "audit", "shots");

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 375, height: 812 },
};

const AXE_PATH =
  process.env.UX01_AXE_PATH ||
  "/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/axe/node_modules/axe-core/axe.min.js";

// Fictional companies only. Column order matches PIPELINE_HEADERS (25 cols):
// Date Found, Title, Company, Location, Link, Source, Salary, Fit Score,
// Priority, Tags, Fit Assessment, Contact, Status, Applied Date, Notes,
// Follow-up Date, Talking Points, Last contact, Did they reply?, Logo URL,
// Match Score, Favorite, Dismissed At, Approval Status, Edit Lock.
function row(o) {
  return [
    o.date, o.title, o.company, o.location, o.link, o.source, o.salary,
    String(o.fit ?? ""), o.priority ?? "", o.tags ?? "", o.assessment ?? "",
    o.contact ?? "", o.status ?? "New", o.applied ?? "", o.notes ?? "",
    o.followUp ?? "", o.talking ?? "", o.lastContact ?? "", o.replied ?? "",
    "", o.match ?? "", o.favorite ?? "", "", "", "",
  ];
}

export const FIXTURE_ROWS = [
  row({ date: "2026-09-25", title: "Senior Product Designer", company: "Lumen Labs", location: "Remote (US)", link: "https://jobs.ashbyhq.test/lumen/senior-product-designer", source: "Ashby", salary: "$170k–$210k", fit: 9, priority: "🔥", tags: "Design systems, Figma, Prototyping", assessment: "Strong fit: you led a design-system migration and prototype in code, which this role asks for by name.", status: "New", match: "88" }),
  row({ date: "2026-09-25", title: "Senior UI Engineer", company: "Harbor Analytics", location: "New York, NY", link: "https://boards.greenhouse.test/harbor/senior-ui-engineer", source: "Greenhouse", salary: "$165k–$195k", fit: 6, priority: "", tags: "React, D3, Accessibility", assessment: "Partial fit: strong UI craft, but the role is heavy on data-viz you have not shipped.", status: "New", match: "61" }),
  row({ date: "2026-09-24", title: "Full-Stack Engineer", company: "Parcel", location: "Remote", link: "https://jobs.lever.test/parcel/full-stack-engineer", source: "Lever", salary: "$150k–$180k", fit: 7, priority: "⚡", tags: "Node.js, Postgres, TypeScript", assessment: "Good fit on product engineering; light on the logistics domain.", status: "New", match: "72" }),
  row({ date: "2026-09-23", title: "Staff Frontend Engineer", company: "Kestrel", location: "Remote (US/Canada)", link: "https://boards.greenhouse.test/kestrel/staff-frontend", source: "Greenhouse", salary: "$190k–$240k", fit: 8, priority: "⚡", tags: "Performance, Design systems, Mentoring", assessment: "Strong fit for scope; staff title is a stretch on org-wide influence.", status: "Researching", notes: "Ask about the frontend platform team size.", match: "79" }),
  row({ date: "2026-09-22", title: "Web Platform Engineer", company: "Canopy", location: "Toronto, ON", link: "https://jobs.ashbyhq.test/canopy/web-platform", source: "Ashby", salary: "CA$160k–$190k", fit: 7, priority: "", tags: "Build tooling, Vite, Monorepos", assessment: "Good fit on tooling; relocation or Canadian work authorization required.", status: "Researching", match: "70" }),
  row({ date: "2026-09-18", title: "Product Engineer", company: "Juniper Bank", location: "Brooklyn, NY", link: "https://jobs.lever.test/juniper/product-engineer", source: "Lever", salary: "$160k–$200k", fit: 8, priority: "⚡", tags: "Fintech, React, Experimentation", assessment: "Strong fit: consumer fintech plus a growth-experiment track record.", status: "Applied", applied: "2026-09-19", followUp: "2026-09-26", notes: "Referred by a former teammate.", match: "81" }),
  row({ date: "2026-09-16", title: "Frontend Engineer", company: "Tidewater Health", location: "Boston, MA (hybrid)", link: "https://boards.greenhouse.test/tidewater/frontend-engineer", source: "Greenhouse", salary: "$145k–$175k", fit: 7, priority: "", tags: "Healthcare, Accessibility, Vue", assessment: "Good fit; Vue is new to you but the a11y work transfers directly.", contact: "Maya Chen (Recruiter)", status: "Phone Screen", applied: "2026-09-12", lastContact: "2026-09-22", replied: "Yes", talking: "Accessibility audits you led; shipping to regulated users.", match: "74" }),
  row({ date: "2026-09-10", title: "Design Engineer", company: "Orbital", location: "Remote", link: "https://jobs.ashbyhq.test/orbital/design-engineer", source: "Ashby", salary: "$175k–$215k", fit: 9, priority: "🔥", tags: "Motion, Prototyping, React", assessment: "Excellent fit: motion and prototyping portfolio lines up with the team's roadmap.", contact: "Dev Patel (Hiring manager)", status: "Interviewing", applied: "2026-09-03", lastContact: "2026-09-24", replied: "Yes", followUp: "2026-09-27", talking: "The onboarding redesign that lifted activation 18%.", match: "90" }),
  row({ date: "2026-08-28", title: "Software Engineer, Payments UI", company: "Brightline Pay", location: "Seattle, WA", link: "https://boards.greenhouse.test/brightline/payments-ui", source: "Greenhouse", salary: "$175k", fit: 8, priority: "⚡", tags: "Payments, React, Testing", assessment: "Strong fit on payments UI and test discipline.", contact: "Ana Ruiz (Recruiter)", status: "Offer", applied: "2026-08-29", lastContact: "2026-09-23", replied: "Yes", notes: "Offer deadline Oct 1.", match: "83" }),
  row({ date: "2026-08-25", title: "UX Engineer", company: "Fathom Studio", location: "Remote", link: "https://jobs.lever.test/fathom/ux-engineer", source: "Lever", salary: "$140k–$160k", fit: 5, priority: "", tags: "Agency, Prototyping", assessment: "Weak fit: agency pace and client-facing load.", status: "Rejected", applied: "2026-08-26", replied: "No", match: "52" }),
  row({ date: "2026-08-20", title: "Frontend Developer", company: "Relay Logistics", location: "Austin, TX", link: "https://jobs.lever.test/relay/frontend-developer", source: "Lever", salary: "$120k–$140k", fit: 4, priority: "↓", tags: "Angular, Logistics", assessment: "Low fit: Angular-only stack and below your comp floor.", status: "Passed", match: "40" }),
  row({ date: "2026-08-14", title: "Senior Frontend Engineer", company: "Northwind Media", location: "Chicago, IL", link: "https://boards.greenhouse.test/northwind/senior-frontend", source: "Greenhouse", salary: "$150k–$180k", fit: 6, priority: "", tags: "Media, Next.js", assessment: "Moderate fit; posting may be stale.", status: "Expired", match: "58" }),
];

export const FIXTURE_RUNS = [
  ["2026-09-25T13:00:00Z", "scheduled", "success", "212", "38", "4", "2", "browser-use", "morning-a", ""],
  ["2026-09-24T13:00:00Z", "scheduled", "partial", "340", "41", "1", "0", "browser-use", "morning-b", "2 of 5 sources timed out"],
  ["2026-09-23T18:12:00Z", "manual", "success", "188", "29", "3", "1", "browser-use", "manual-1", ""],
  ["2026-09-22T13:00:00Z", "scheduled", "failure", "12", "0", "0", "0", "browser-use", "morning-c", "Webhook secret rejected (401)"],
];

/**
 * Host-isolation fence. The in-process dev server forwards same-origin
 * /profile/* to the live API on :3847 and runs /__proxy/* handlers that start
 * the real discovery worker, rewrite ~/.jobbored/browser-use-discovery/.env,
 * install launchd agents, and so on. None of that may reach the host during
 * an audit, so every such request is answered here and never hits the server.
 * Registered after the hermetic fence, so it runs first.
 */
async function installHostIsolation(page, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const json = (body, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route(
    (url) =>
      url.origin === origin &&
      (url.pathname.startsWith("/__proxy/") ||
        url.pathname === "/profile" ||
        url.pathname.startsWith("/profile/")),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/__proxy/discovery-state") {
        await route.fulfill(json({ ok: true, hermetic: true, configured: false }));
        return;
      }
      if (url.pathname === "/profile" && route.request().method() === "GET") {
        await route.fulfill(json({ ok: false, error: "No profile staged" }, 404));
        return;
      }
      await route.fulfill(
        json(
          { ok: false, hermetic: true, error: "Blocked by the UX01 audit harness: this call would reach the host machine." },
          503,
        ),
      );
    },
  );
}

async function installSheetsFixture(page, mode) {
  // Registered after the fence, so Playwright runs it first for Sheets URLs.
  await page.route("https://sheets.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...headers, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" } });
      return;
    }
    if (mode === "signed-in-error" && req.method() === "GET") {
      await route.fulfill({ status: 403, headers, body: JSON.stringify({ error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } }) });
      return;
    }
    if (req.method() !== "GET") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ spreadsheetId: "hermetic", updatedRows: 1, replies: [] }) });
      return;
    }
    if (url.searchParams.get("fields") === "sheets.properties") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ sheets: [{ properties: { sheetId: 0, title: "Pipeline" } }, { properties: { sheetId: 1, title: "DiscoveryRuns" } }] }) });
      return;
    }
    const range = decodeURIComponent(url.pathname.split("/values/")[1] || "");
    if (/DiscoveryRuns/i.test(range)) {
      const values = mode === "signed-in" ? FIXTURE_RUNS : [];
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ range, majorDimension: "ROWS", values }) });
      return;
    }
    const values = mode === "signed-in" ? [PIPELINE_HEADERS, ...FIXTURE_ROWS] : [PIPELINE_HEADERS];
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ range: range || "Pipeline!A:ZZ", majorDimension: "ROWS", values }) });
  });
}

/**
 * Start the in-process app, a browser, and one page in the given mode.
 * Returns { page, context, browser, baseUrl, unexpectedExternal, close }.
 */
export async function openApp({
  mode = "signed-in",
  viewport = "desktop",
  path = "/",
  reducedMotion = "no-preference",
  settleMs = 1500,
  setupDone = true,
} = {}) {
  const app = await startHermeticApp();
  const browser = await chromium.launch({ headless: true });
  const size = typeof viewport === "string" ? VIEWPORTS[viewport] : viewport;
  const context = await browser.newContext({ viewport: size, reducedMotion });
  const page = await context.newPage();
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await installHostIsolation(page, app.baseUrl);
  if (mode !== "greenfield") {
    await installSheetsFixture(page, mode);
    await stageSignedInDisposableAuth(page);
  }
  const target = new URL(path, app.baseUrl);
  if (mode === "greenfield") target.searchParams.set("greenfield", "1");
  await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (mode !== "greenfield" && setupDone) {
    // Same seam critical-journey.spec.mjs bootSignedIn uses: mark setup and
    // onboarding complete in the user's IndexedDB, then reload.
    await page.waitForFunction(() => globalThis.CommandCenterUserContent?.completeOnboarding, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => {
      await globalThis.CommandCenterUserContent?.completeInfraSetup?.();
      await globalThis.CommandCenterUserContent?.completeOnboarding?.();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  if (settleMs) await page.waitForTimeout(settleMs);
  return {
    page,
    context,
    browser,
    baseUrl: app.baseUrl,
    unexpectedExternal: fence?.unexpectedExternal || [],
    async close() {
      await browser.close().catch(() => {});
      await app.close().catch(() => {});
    },
  };
}

/** Save a PNG to audit/shots/<lens>/<name>-<width>.png and return its repo-relative path. */
export async function shoot(page, lens, name, { fullPage = false, locator } = {}) {
  const dir = join(SHOTS_DIR, lens);
  mkdirSync(dir, { recursive: true });
  const width = page.viewportSize()?.width || 0;
  const file = join(dir, `${name}-${width}.png`);
  if (locator) await page.locator(locator).first().screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  return file.slice(file.indexOf("docs/programs/"));
}

/** Inject axe-core and run it. Returns violations as {id, impact, help, nodes, targets}. */
export async function runAxe(page, { include, tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } = {}) {
  await page.addScriptTag({ content: readFileSync(AXE_PATH, "utf8") });
  const result = await page.evaluate(
    async ({ include, tags }) => {
      const ctx = include ? { include: [include] } : document;
      const r = await window.axe.run(ctx, { runOnly: { type: "tag", values: tags } });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      }));
    },
    { include, tags },
  );
  return result;
}
