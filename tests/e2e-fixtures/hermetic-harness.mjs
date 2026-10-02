/**
 * Hermetic Playwright fixture harness (F4-D).
 *
 * Browser suites must run without real Google, Sheets, or checkout dirt.
 * This module:
 *   - starts the dashboard on loopback
 *   - serves config.example.js as /config.js (never writes config.js)
 *   - intercepts Google/Sheets/fonts/GSI and the local materials API
 *   - stages disposable signed-in storage (no live OAuth)
 *   - exports 320/375/393 phone geometry for F3-D
 *
 * Real OAuth, Sheets mutations, and paid providers stay closed.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { startDevServer } from "../../dev-server.mjs";
import {
  readScrapeTargetUrl,
  resolveScrapeJobFixture,
} from "./scrape-job-fixtures.mjs";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

export const PHONE_VIEWPORTS = [
  { name: "compact-320", width: 320, height: 568 },
  { name: "iphone-375", width: 375, height: 667 },
  { name: "iphone-393", width: 393, height: 852 },
];

export const DISPOSABLE_AUTH = {
  sheetId: "hermetic-sheet-id-1234567890",
  oauthClientId: "hermetic-client.apps.googleusercontent.com",
  userEmail: "hermetic@example.test",
  accessToken: "hermetic-access-token",
  // workers.dev is in the dashboard CSP connect-src; the fence intercepts it.
  discoveryOrigin: "https://hermetic-worker.workers.dev",
  discoveryWebhookUrl: "https://hermetic-worker.workers.dev/webhook",
  discoveryWebhookSecret: "hermetic-secret",
  materialsOrigin: "http://127.0.0.1:3847",
};

const CHAT_UNAVAILABLE = {
  ok: false,
  hermetic: true,
  error: "The chat agent is unavailable in the hermetic harness.",
  code: "agent_not_connected",
  retryable: false,
};

export const PIPELINE_HEADERS = [
  "Date Found",
  "Title",
  "Company",
  "Location",
  "Link",
  "Source",
  "Salary",
  "Fit Score",
  "Priority",
  "Tags",
  "Fit Assessment",
  "Contact",
  "Status",
  "Applied Date",
  "Notes",
  "Follow-up Date",
  "Talking Points",
  "Last contact",
  "Did they reply?",
  "Logo URL",
  "Match Score",
  "Favorite",
  "Dismissed At",
  "Approval Status",
  "Edit Lock",
];

export const DISCOVERED_JOB_ROW = [
  "2026-08-30",
  "Platform Engineer",
  "Acme",
  "Remote",
  "https://jobs.acme.test/platform-engineer",
  "Journey worker",
  "$150k–$180k",
  "9",
  "High",
  "Node.js, distributed systems",
  "Strong fit for the candidate's platform background.",
  "",
  "New",
  "",
  "",
  "",
  "Discuss reliability ownership and developer tooling.",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const APPLICATION_SLUG = "acme-platform-engineer";
const RUN_ID = "run-hermetic-001";

const quietLogger = { log() {}, warn() {}, error() {} };

export function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "authorization, content-type, x-discovery-secret",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  };
}

export async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders(),
    body: JSON.stringify(body),
  });
}

function emptyManifest() {
  return {
    slug: APPLICATION_SLUG,
    company: "Acme",
    title: "Platform Engineer",
    derived: false,
    updatedAt: "",
    documents: [],
  };
}

function pendingManifest() {
  return {
    ...emptyManifest(),
    pending: {
      feature: "cover_letter",
      company: "Acme",
      title: "Platform Engineer",
      jobUrl: "https://jobs.acme.test/platform-engineer",
      requestedAt: "2026-08-30T15:00:00.000Z",
      notes: "Emphasize reliable platforms and developer experience.",
      source: "jobbored-dossier",
      progress: {
        phase: "queued",
        message: "Queued for the drafting worker.",
        attempt: 1,
      },
    },
  };
}

function readyManifest() {
  return {
    ...emptyManifest(),
    updatedAt: "2026-08-30T15:05:00.000Z",
    documents: [
      {
        type: "cover_letter",
        label: "Cover Letter",
        status: "ready",
        primary: "cover-letter.pdf",
        lastModifiedAt: "2026-08-30T15:05:00.000Z",
        files: [
          {
            filename: "cover-letter.pdf",
            format: "pdf",
            size: 293275,
            modifiedAt: "2026-08-30T15:05:00.000Z",
          },
          {
            filename: "cover-letter.html",
            format: "html",
            size: 13478,
            modifiedAt: "2026-08-30T15:05:00.000Z",
          },
        ],
      },
    ],
  };
}

export function gsiStubScript() {
  return `window.google = { accounts: { oauth2: {
    initTokenClient: function () { return { requestAccessToken: function () {} }; },
    revoke: function (_token, callback) { if (callback) callback(); }
  } } };`;
}

export function hermeticConfigJs() {
  return readFileSync(join(REPO_ROOT, "config.example.js"), "utf8");
}

/**
 * Same-origin paths whose real dev-server handlers act on the host machine:
 * `/__proxy/*` can restart the live discovery worker, rewrite
 * ~/.jobbored .env files and install launchd agents; `/profile*` proxies to
 * the local API; `/api/leads/chat` calls a configured model. The fence
 * answers these in the browser; the server spy
 * below is the backstop that proves it (UX01 C1, incident 2026-09-25, FD-19).
 */
export function isHostPath(pathname) {
  return (
    pathname.startsWith("/__proxy/") ||
    pathname === "/api/leads/chat" ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/")
  );
}

/** Status the server spy answers with, so a leak is unmistakable. */
export const HOST_SPY_REFUSED_STATUS = 599;

/**
 * Wrap the in-process server's request listeners. A host path that reaches
 * the server is recorded in `hostRequests` and refused with 599, so its real
 * handler never executes — unless a spec explicitly allows that exact path
 * (`allowHostPath`) to exercise the proxy against its own stub API.
 */
function installHostPathSpy(server) {
  const hostRequests = [];
  const allowed = new Set();
  const listeners = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const pathname = new URL(req.url || "/", "http://hermetic.invalid")
      .pathname;
    if (isHostPath(pathname)) {
      hostRequests.push(`${req.method} ${pathname}`);
      if (!allowed.has(pathname)) {
        res.writeHead(HOST_SPY_REFUSED_STATUS, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify({
            ok: false,
            hermetic: true,
            error: "host_path_reached_server",
          }),
        );
        return;
      }
    }
    for (const listener of listeners) listener.call(server, req, res);
  });
  return {
    hostRequests,
    allowHostPath(pathname) {
      allowed.add(pathname);
      return () => allowed.delete(pathname);
    },
  };
}

export async function startHermeticApp({ logger = quietLogger } = {}) {
  const server = await startDevServer({ port: 0, logger });
  const spy = installHostPathSpy(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    repoRoot: REPO_ROOT,
    /** Every `/__proxy/*` or `/profile*` request that reached the server. */
    hostRequests: spy.hostRequests,
    /** Let one exact host path reach its real handler; returns a disposer. */
    allowHostPath: spy.allowHostPath,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

/**
 * Install one catch-all route before navigation. Same-origin static assets
 * continue to the in-process server except /config.js, which is always the
 * example file, and the host-acting paths (`/__proxy/*`, `/profile*`,
 * `/api/leads/chat`), which
 * the fence stubs so no suite can restart the live worker or edit .env. Every off-origin request must match an explicit mock or it
 * is aborted and recorded.
 */
export async function installHermeticNetworkFence(page, options = {}) {
  const baseUrl = options.baseUrl;
  if (!baseUrl) throw new Error("installHermeticNetworkFence requires baseUrl");
  const auth = { ...DISPOSABLE_AUTH, ...(options.auth || {}) };
  const discoveryOrigin = auth.discoveryOrigin;
  const materialsOrigin = auth.materialsOrigin;
  const unexpectedExternal = [];
  const hostPathRequests = [];
  const statusResponses = options.statusResponses || [];
  const statusGates = statusResponses.map(() => deferred());
  const materialsReadyGate = deferred();
  let statusResponseIndex = 0;
  let pipelineHasJob = options.pipelineStartsWithJob === true;
  let materialsRequestSubmitted = false;
  let pendingManifestDelivered = false;
  let materialsReady = false;
  const appOrigin = new URL(baseUrl).origin;
  const configJs = hermeticConfigJs();

  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    if (url.origin === appOrigin) {
      if (url.pathname === "/config.js") {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: configJs,
        });
        return;
      }
      if (isHostPath(url.pathname)) {
        // UX01 C1: the fence answers every host-acting path itself. A spec
        // that must exercise a real handler registers its own route after
        // the fence AND calls app.allowHostPath(path) on the server spy.
        hostPathRequests.push(`${method} ${url.pathname}`);
        if (url.pathname === "/__proxy/discovery-state") {
          await fulfillJson(route, {
            ok: true,
            recommendation: "ready",
            worker: { up: false, originAllowed: true },
            ngrok: {},
          });
          return;
        }
        if (url.pathname === "/profile" && method === "GET") {
          await fulfillJson(
            route,
            { ok: false, error: "No profile staged" },
            404,
          );
          return;
        }
        if (url.pathname === "/api/leads/chat" && method === "POST") {
          await fulfillJson(route, CHAT_UNAVAILABLE, 503);
          return;
        }
        // RESJ K1: every primary-resume save copies the text to the
        // server; answer as a saved copy so suites see the normal path.
        if (url.pathname === "/profile/resume" && method === "PUT") {
          await fulfillJson(route, {
            ok: true,
            chars: (request.postData() || "").length,
            savedAt: "2026-01-01T00:00:00.000Z",
          });
          return;
        }
        await fulfillJson(
          route,
          {
            ok: false,
            hermetic: true,
            error:
              "Blocked by the hermetic harness: this call would reach the host machine.",
          },
          503,
        );
        return;
      }
      await route.continue();
      return;
    }

    if (method === "OPTIONS") {
      if (
        url.origin === discoveryOrigin ||
        url.origin === materialsOrigin ||
        url.hostname === "sheets.googleapis.com" ||
        url.hostname === "www.googleapis.com" ||
        url.hostname === "accounts.google.com"
      ) {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
    }

    if (
      url.hostname === "accounts.google.com" &&
      url.pathname === "/gsi/client"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: corsHeaders(),
        body: gsiStubScript(),
      });
      return;
    }

    if (
      url.hostname === "fonts.googleapis.com" ||
      url.hostname === "fonts.gstatic.com"
    ) {
      await route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith(".css")
          ? "text/css"
          : "application/octet-stream",
        body: "",
      });
      return;
    }

    if (
      url.hostname === "www.googleapis.com" &&
      url.pathname === "/oauth2/v3/userinfo"
    ) {
      await fulfillJson(route, {
        email: auth.userEmail,
        name: "Hermetic Tester",
      });
      return;
    }

    if (url.hostname === "sheets.googleapis.com") {
      await fulfillJson(route, {
        range: "Pipeline!A:ZZ",
        majorDimension: "ROWS",
        values: pipelineHasJob
          ? [PIPELINE_HEADERS, DISCOVERED_JOB_ROW]
          : [PIPELINE_HEADERS],
      });
      return;
    }

    if (url.hostname === "autocomplete.clearbit.com") {
      await fulfillJson(route, []);
      return;
    }

    if (url.origin === discoveryOrigin && url.pathname === "/webhook") {
      if (method !== "POST") {
        unexpectedExternal.push(`${method} ${url.toString()}`);
        await route.abort("blockedbyclient");
        return;
      }
      await fulfillJson(
        route,
        {
          ok: true,
          status: "accepted",
          runId: options.runId || RUN_ID,
          statusPath: `/runs/${options.runId || RUN_ID}`,
          pollAfterMs: 10,
        },
        202,
      );
      return;
    }

    // RUNHIST: the Runs view lists history from GET /runs. The hermetic worker
    // holds no past runs; the live row still comes from the tracker.
    if (url.origin === discoveryOrigin && url.pathname === "/runs" && method === "GET") {
      await fulfillJson(route, { ok: true, runs: [], nextBefore: null });
      return;
    }

    const runId = options.runId || RUN_ID;
    if (url.origin === discoveryOrigin && url.pathname === `/runs/${runId}`) {
      const responseIndex = statusResponseIndex++;
      const response = statusResponses[responseIndex];
      const gate = statusGates[responseIndex];
      if (!response || !gate) {
        unexpectedExternal.push(
          `${method} ${url.toString()} (no lifecycle response queued)`,
        );
        await route.abort("blockedbyclient");
        return;
      }
      await gate.promise;
      if (response.status === "completed") pipelineHasJob = true;
      await fulfillJson(route, response);
      return;
    }

    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "8644"
    ) {
      if (url.pathname === "/health") {
        await fulfillJson(route, {
          status: "ok",
          service: "browser-use-discovery-worker",
        });
        return;
      }
      await fulfillJson(route, { ok: true, status: "ok", mode: "hermetic" });
      return;
    }

    // SCRAPE-E2E-1: the drawer's scraper base and the materials API share one
    // origin, so this explicit branch MUST precede the materials block — the
    // catch-all at its end used to answer a scrape with `{ok:true}`, which the
    // drawer rendered as a false "Scraped: Untitled" success. Bodies come from
    // the production scraper module; an unstaged target is a fence violation,
    // never a silently invented answer.
    if (url.pathname === "/api/scrape-job") {
      if (method !== "POST") {
        unexpectedExternal.push(`${method} ${url.toString()}`);
        await route.abort("blockedbyclient");
        return;
      }
      const target = readScrapeTargetUrl(request.postData());
      const fixture = await resolveScrapeJobFixture(target);
      if (!fixture) {
        unexpectedExternal.push(
          `${method} ${url.toString()} (no scrape fixture for ${target || "a body without { url }"})`,
        );
        await route.abort("blockedbyclient");
        return;
      }
      await fulfillJson(route, fixture.body, fixture.status);
      return;
    }

    if (url.origin === materialsOrigin) {
      if (url.pathname === "/api/leads/chat" && method === "POST") {
        await fulfillJson(route, CHAT_UNAVAILABLE, 503);
        return;
      }
      if (url.pathname === "/api/applications/queue" && method === "GET") {
        const queue =
          materialsRequestSubmitted && !materialsReady
            ? [
                {
                  slug: APPLICATION_SLUG,
                  company: "Acme",
                  title: "Platform Engineer",
                  feature: "cover_letter",
                  requestedAt: "2026-08-30T15:00:00.000Z",
                  progress: { phase: "queued" },
                },
              ]
            : [];
        await fulfillJson(route, { queue });
        return;
      }

      if (url.pathname === "/api/applications" && method === "GET") {
        await fulfillJson(route, {
          applications: pipelineHasJob
            ? [
                {
                  slug: APPLICATION_SLUG,
                  company: "Acme",
                  title: "Platform Engineer",
                },
              ]
            : [],
        });
        return;
      }

      if (
        url.pathname === `/api/applications/${APPLICATION_SLUG}/manifest` &&
        method === "GET"
      ) {
        if (!materialsRequestSubmitted) {
          await fulfillJson(route, emptyManifest());
          return;
        }
        if (!pendingManifestDelivered) {
          pendingManifestDelivered = true;
          await fulfillJson(route, pendingManifest());
          return;
        }
        await materialsReadyGate.promise;
        materialsReady = true;
        await fulfillJson(route, readyManifest());
        return;
      }

      if (
        url.pathname ===
          `/api/applications/${APPLICATION_SLUG}/job-description` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          exists: true,
          source: "hermetic-fixture",
          text: "A deterministic fixture job description.",
        });
        return;
      }

      if (
        url.pathname === `/api/applications/${APPLICATION_SLUG}/request` &&
        method === "POST"
      ) {
        materialsRequestSubmitted = true;
        await fulfillJson(route, { ok: true, slug: APPLICATION_SLUG }, 202);
        return;
      }

      await fulfillJson(route, { ok: true, applications: [], queue: [] });
      return;
    }

    unexpectedExternal.push(`${method} ${url.toString()}`);
    await route.abort("blockedbyclient");
  });

  return {
    unexpectedExternal,
    /** Same-origin `/__proxy/*` and `/profile*` requests the fence answered. */
    hostPathRequests,
    releaseStatus(responseIndex) {
      statusGates[responseIndex]?.resolve();
    },
    releaseMaterialsReady() {
      materialsReadyGate.resolve();
    },
  };
}

export async function stageSignedInDisposableAuth(page, auth = DISPOSABLE_AUTH) {
  await page.addInitScript(
    ({ clientId, discoveryWebhookUrl, materialsOrigin, sheetId, userEmail, accessToken }) => {
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
          discoveryWebhookUrl,
          discoveryWebhookSecret: "hermetic-secret",
          jobPostingScrapeUrl: materialsOrigin,
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
      globalThis.localStorage.setItem(
        "command_center_discovery_coach_done",
        "1",
      );

      globalThis.document.addEventListener("DOMContentLoaded", () => {
        if (globalThis.JobBoredApp?.setup) {
          globalThis.JobBoredApp.setup.showSheetAccessGate = () => {};
        }
      });
    },
    {
      clientId: auth.oauthClientId,
      discoveryWebhookUrl: auth.discoveryWebhookUrl,
      materialsOrigin: auth.materialsOrigin,
      sheetId: auth.sheetId,
      userEmail: auth.userEmail,
      accessToken: auth.accessToken,
    },
  );
}

export const HERMETIC_RUN_ID = RUN_ID;
export const HERMETIC_APPLICATION_SLUG = APPLICATION_SLUG;

const SCRIBE_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Scribe v2 (EDITOR Q1): a stateful stand-in for the B2 edit and version
 * routes under `/api/applications/:slug/`, plus that package's manifest and
 * rendered files. Install it after the fence so it wins for this slug; every
 * other request falls through to the fence unchanged.
 *
 * Runs are append-only, like B2: accept and restore add a run, nothing is
 * deleted. The caller supplies the pure renderer, `applyOps` and `nodesOf`
 * (server/materials-render.mjs, server/materials-nodes.mjs), so previews are
 * real template renders and the harness imports no server code.
 *
 * The edit stream is real SSE. `GET …/edits/:id/stream` is continued to a
 * relay on an ephemeral loopback port, and the spec writes each event with
 * `emit()`, so a proposal can be held open mid-stream. No model is called and
 * no live port (:8080, :8644, :3847) is ever opened. Call `close()` when done.
 */
export async function installScribeEditApi(page, options) {
  const { slug, render, applyOps, nodesOf } = options;
  const origin = options.origin || DISPOSABLE_AUTH.materialsOrigin;
  const prefix = `/api/applications/${slug}`;
  const runs = options.runs.map((run) => ({ starred: false, ...run }));
  const calls = [];
  const proposals = [];
  const streams = new Map();
  let seq = 0;

  const streamFor = (id) => {
    if (!streams.has(id)) streams.set(id, { res: null, backlog: [], opened: deferred() });
    return streams.get(id);
  };
  const relay = createServer((req, res) => {
    const s = streamFor(decodeURIComponent(req.url.slice(1)));
    res.writeHead(200, { ...SCRIBE_CORS, "content-type": "text/event-stream", "cache-control": "no-store" });
    res.flushHeaders();
    s.res = res;
    for (const chunk of s.backlog.splice(0)) res.write(chunk);
    s.opened.resolve();
  });
  await new Promise((done) => relay.listen(0, "127.0.0.1", done));
  const relayUrl = `http://127.0.0.1:${relay.address().port}`;

  const wordsOf = (model, doc) =>
    nodesOf(model)
      .filter((n) => (doc === "resume") !== ["paragraph", "salutation"].includes(n.kind))
      .map((n) => n.text)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;
  const current = () => runs[runs.length - 1];
  const find = (runId) => runs.find((r) => r.runId === runId);
  const docName = (doc) => (doc === "cover_letter" ? "coverLetter" : doc || "resume");
  const listing = (doc) => {
    const byId = new Map(runs.map((r, n) => [r.runId, n]));
    const rows = runs.map((r, n) => ({
      runId: r.runId,
      n,
      createdAt: r.createdAt,
      source: r.source,
      label: r.source === "restore" ? `Restored from v${byId.get(r.restoredFrom)}` : r.label || r.prompt || "Drafted",
      ...(r.prompt ? { prompt: r.prompt } : {}),
      ...(n ? { parentRunId: r.restoredFrom || runs[n - 1].runId } : {}),
      pinned: n === 0,
      starred: r.starred,
      pages: r.pages ?? 1,
      words: wordsOf(r.model, doc),
      family: r.model.template?.family,
    }));
    return { versions: rows.reverse(), currentRunId: current().runId };
  };
  const append = (fields) => {
    const run = { runId: `run-${String(runs.length).padStart(2, "0")}`, createdAt: new Date().toISOString(), starred: false, pages: 1, ...fields };
    runs.push(run);
    return run;
  };
  const reply = (route, status, body) =>
    route.fulfill({ status, headers: { ...SCRIBE_CORS, "content-type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });

  await page.route(`${origin}${prefix}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const tail = url.pathname.slice(prefix.length);
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: SCRIBE_CORS });
    let body = null;
    try {
      body = request.postData() ? JSON.parse(request.postData()) : null;
    } catch {
      body = request.postData();
    }
    calls.push({ method, path: tail + url.search, body });
    let m;
    if (method === "GET" && tail === "/manifest" && options.manifest) return reply(route, 200, options.manifest());
    if (method === "GET" && (m = /^\/files\/(resume|cover-letter)\.html$/.exec(tail))) {
      return route.fulfill({ status: 200, headers: { ...SCRIBE_CORS, "content-type": "text/html; charset=utf-8" }, body: render(current().model, m[1] === "resume" ? "resume" : "coverLetter") });
    }
    if (method === "GET" && tail === "/versions") return reply(route, 200, listing(docName(url.searchParams.get("doc"))));
    if (method === "GET" && (m = /^\/versions\/([^/]+)\/model$/.exec(tail))) {
      const run = find(decodeURIComponent(m[1]));
      return run ? reply(route, 200, { model: run.model, nodes: nodesOf(run.model) }) : reply(route, 404, { error: "Version not found", code: "version_not_found" });
    }
    if (method === "POST" && tail === "/preview") {
      const run = find(body?.baseRunId);
      if (!run) return reply(route, 404, { error: "Version not found", code: "version_not_found" });
      const doc = docName(body.doc);
      const model = applyOps(run.model, body.ops || []);
      return reply(route, 200, { html: render(model, doc), words: wordsOf(model, doc), pageBudget: model.template?.pageBudget ?? 1 });
    }
    if (method === "POST" && tail === "/edits") {
      if (body?.baseRunId !== current().runId) return reply(route, 409, { error: "The base version is not current.", code: "stale_base" });
      const id = `prop-${++seq}`;
      proposals.push({ id, body, baseRunId: body.baseRunId, ops: [], status: "open" });
      return reply(route, 202, { proposalId: id, streamUrl: `${prefix}/edits/${id}/stream` });
    }
    if (method === "GET" && (m = /^\/edits\/([^/]+)\/stream$/.exec(tail))) {
      return route.continue({ url: `${relayUrl}/${m[1]}` });
    }
    const p = (m = /^\/edits\/([^/]+)(\/stop|\/accept)?$/.exec(tail)) ? proposals.find((x) => x.id === decodeURIComponent(m[1])) : null;
    if (m && !p) return reply(route, 404, { error: "Proposal not found", code: "proposal_not_found" });
    if (method === "POST" && m?.[2] === "/stop") {
      p.status = "partial";
      const ops = [...p.ops, ...(p.stopOps || [])];
      write(p.id, "done", { status: "partial" });
      streams.get(p.id)?.res?.end();
      return reply(route, 200, { status: "partial", ops });
    }
    if (method === "POST" && m?.[2] === "/accept") {
      const all = [...p.ops, ...(p.stopOps || [])];
      const chosen = all.filter((op) => (body?.accept || []).includes(op.opId));
      const unconfirmed = chosen.find((op) => (op.flags || []).includes("unverified") && !(body?.confirmUnverified || []).includes(op.opId));
      if (unconfirmed) return reply(route, 400, { error: `Confirm ${unconfirmed.opId} first.`, code: "unverified_unconfirmed" });
      const run = append({ source: "edit", prompt: p.body.instruction, model: applyOps(find(p.baseRunId).model, chosen), parentRunId: p.baseRunId });
      p.status = "accepted";
      const n = runs.length - 1;
      return reply(route, 200, { run: { runId: run.runId, n, pages: run.pages, pdf: "ready" }, versions: listing(docName(p.body.doc)).versions });
    }
    if (method === "DELETE" && m && !m[2]) {
      p.status = "rejected";
      return reply(route, 204);
    }
    if (method === "POST" && (m = /^\/versions\/([^/]+)\/restore$/.exec(tail))) {
      const from = find(decodeURIComponent(m[1]));
      if (!from) return reply(route, 404, { error: "Version not found", code: "version_not_found" });
      const run = append({ source: "restore", restoredFrom: from.runId, model: from.model });
      return reply(route, 200, { run: { runId: run.runId, restoredFrom: from.runId, pdf: "ready" } });
    }
    if (method === "PUT" && (m = /^\/versions\/([^/]+)\/star$/.exec(tail))) {
      const run = find(decodeURIComponent(m[1]));
      if (run && run.runId !== runs[0].runId) run.starred = body?.starred === true;
      return reply(route, 200, { ok: true });
    }
    return route.fallback();
  });

  function write(id, event, data) {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const s = streamFor(id);
    if (s.res) s.res.write(chunk);
    else s.backlog.push(chunk);
  }

  return {
    /** Every request this stub answered: `{method, path, body}`. */
    calls,
    proposals,
    runs,
    /** Resolves once the browser has opened the proposal's event stream. */
    streamOpened: (id) => streamFor(id).opened.promise,
    /** Write one SSE event; an `op` event also becomes a validated op. */
    emit(id, event, data) {
      const p = proposals.find((x) => x.id === id);
      if (event === "op" && p) p.ops.push(data.op);
      write(id, event, data);
    },
    /** Ops the stop reply adds that the stream never delivered. */
    holdForStop(id, ops) {
      proposals.find((x) => x.id === id).stopOps = ops;
    },
    end(id) {
      streamFor(id).res?.end();
    },
    async close() {
      for (const s of streams.values()) s.res?.end();
      relay.closeAllConnections?.();
      await new Promise((done) => relay.close(done));
    },
  };
}

const RUN_FILE_TYPES = { pdf: "application/pdf", html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8" };

/**
 * GRADE (W-FE): the materials routes a v3 package reads, from the frozen
 * fixtures (tests/fixtures/materials-qa-v3.mjs): the manifest, GET /runs
 * (RunSummary[]), the run-scoped file route
 * (`/runs/:runId/files/:filename`, `?download=1` as an attachment) and
 * POST /runs/:runId/rescore. Install it after the fence so it wins for the
 * materials origin. Every other materials call is refused and recorded,
 * and same-origin /profile* never reaches the dev server.
 *
 * options: { slug, manifest(), runs(), origin }.
 */
export async function installGradeMaterialsApi(page, options) {
  const origin = options.origin || DISPOSABLE_AUTH.materialsOrigin;
  const slug = options.slug;
  const seen = { refused: [], rescores: [], files: [] };
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const prefix = `/api/applications/${slug}`;
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    if (path === "/api/applications" && method === "GET") {
      const m = options.manifest();
      await fulfillJson(route, { applications: [{ slug, company: m.company, title: m.title }] });
      return;
    }
    if (path === "/api/applications/queue" && method === "GET") {
      await fulfillJson(route, { queue: [] });
      return;
    }
    if (path === `${prefix}/manifest` && method === "GET") {
      await fulfillJson(route, options.manifest());
      return;
    }
    if (path === `${prefix}/job-description` && method === "GET") {
      await fulfillJson(route, { ok: true, exists: true });
      return;
    }
    if (path === `${prefix}/checklist` && method === "GET") {
      await fulfillJson(route, { contract: "materials.checklist.v1", slug, updatedAt: "2026-10-02T09:00:00.000Z", progress: { done: 0, total: 0 }, items: [] });
      return;
    }
    if (path === `${prefix}/files/jd-extract.json` && method === "GET") {
      await fulfillJson(route, { nouns: [] });
      return;
    }
    if (path === `${prefix}/runs` && method === "GET") {
      await fulfillJson(route, { slug, runs: options.runs ? options.runs() : [] });
      return;
    }
    const runFile = /^\/api\/applications\/[^/]+\/runs\/([^/]+)\/files\/([^/]+)$/.exec(path);
    if (runFile && method === "GET") {
      const filename = decodeURIComponent(runFile[2]);
      const ext = filename.split(".").pop();
      seen.files.push({ runId: decodeURIComponent(runFile[1]), filename, download: url.searchParams.get("download") === "1" });
      const body = ext === "pdf" ? "%PDF-1.4\n% hermetic GRADE fixture\n" : (ext === "html" ? "<!doctype html><title>Hermetic draft</title><p>Fictional Acme Robotics draft.</p>" : "Fictional Acme Robotics draft.\n");
      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders(),
          "content-type": RUN_FILE_TYPES[ext] || "application/octet-stream",
          "x-content-type-options": "nosniff",
          ...(url.searchParams.get("download") === "1" ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
        },
        body,
      });
      return;
    }
    const rescore = /^\/api\/applications\/[^/]+\/runs\/([^/]+)\/rescore$/.exec(path);
    if (rescore && method === "POST") {
      seen.rescores.push({ runId: decodeURIComponent(rescore[1]), body: request.postDataJSON() });
      await fulfillJson(route, { ok: true });
      return;
    }
    const text = /^\/api\/applications\/[^/]+\/files\/(resume|cover-letter)\.txt$/.exec(path);
    if (text && method === "GET") {
      await route.fulfill({ status: 200, headers: { ...corsHeaders(), "content-type": "text/plain; charset=utf-8" }, body: "Fictional Acme Robotics draft.\n" });
      return;
    }
    seen.refused.push(`${method} ${path}`);
    await fulfillJson(route, { error: "Not staged in this hermetic test", code: "hermetic_refused" }, 503);
  });
  await page.route(/\/profile(\/.*)?(\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).origin === origin) {
      await route.fallback();
      return;
    }
    await fulfillJson(route, { ok: false, reason: "hermetic_refused" }, 503);
  });
  return seen;
}
