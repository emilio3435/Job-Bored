// G24: the browser call sites that talk to the relay, exercised end to end.
// Each call site is loaded in a vm next to discovery-wizard-relay.js and
// driven through its real entry point; the test inspects the requests it
// actually emits:
//   - a request to the relay origin carries `Authorization: Bearer <token>`;
//   - a request to any other destination carries no bearer;
//   - where the call site owns a deadline (AbortController + timeout), that
//     deadline still settles the request while the token route is stalled.
// This replaces a source-spelling check (`/JobBoredRelayAuth\.fetch/`) that
// passed for code that never sent the header and failed for equivalent code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (file) => readFileSync(join(ROOT, file), "utf8");

const TOKEN_ROUTE = "/__proxy/discovery-relay-token";
const WORKER = "https://jobbored-relay.example.workers.dev";
const OTHER = "https://other-worker.example.org";
const TOKEN = "tok_example_call_sites";
const BEARER = `Bearer ${TOKEN}`;

function headerOf(init, name) {
  const headers = init && init.headers;
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stalledUntilAborted(init) {
  return new Promise((_, reject) => {
    const signal = init && init.signal;
    if (!signal) return;
    signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      reject(err);
    });
  });
}

function makeElement(id) {
  const listeners = {};
  return {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    focus() {},
  };
}

// Loads the relay module and the given call-site files into one vm context.
// tokenRoute: "ok" | "stall"; relayRespond(url, init) answers relay-origin
// requests; every request is recorded in `requests`.
function load(
  files,
  { tokenRoute = "ok", relayRespond, timerScale, extra, hostname = "localhost", seedToken = false, readyState = "complete" } = {},
) {
  const store = new Map();
  const requests = [];
  const elements = new Map();
  const document = {
    readyState,
    body: makeElement("body"),
    documentElement: makeElement("html"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    createElement: (tag) => makeElement(tag),
  };
  const fetchImpl = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === TOKEN_ROUTE) {
      if (tokenRoute === "stall") return new Promise(() => {});
      return json(200, {
        ok: true,
        relay: { workerUrl: WORKER, relayToken: TOKEN, relayLocked: true },
      });
    }
    if (url.startsWith(WORKER) && relayRespond) return relayRespond(url, init);
    return json(200, { ok: true, accepted: true });
  };
  const scaledSetTimeout = (fn, ms, ...args) =>
    setTimeout(fn, timerScale ? timerScale(ms) : ms, ...args);
  const window = {
    location: {
      hostname,
      port: hostname === "localhost" ? "8080" : "",
      origin: hostname === "localhost" ? "http://localhost:8080" : `https://${hostname}`,
      href: hostname === "localhost" ? "http://localhost:8080/" : `https://${hostname}/`,
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: fetchImpl,
    setTimeout: scaledSetTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    document,
    JobBoredDiscoveryWizard: {},
    JobBoredDiscoveryHelpers: {},
    ...(extra || {}),
  };
  const ctx = {
    window,
    document,
    fetch: fetchImpl,
    localStorage: window.localStorage,
    setTimeout: scaledSetTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    DOMException,
    Response,
    Headers,
    URL,
    URLSearchParams,
    console: { ...console, info() {}, log() {}, warn() {}, error() {}, debug() {} },
    Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(src("discovery-wizard-relay.js"), ctx, { filename: "discovery-wizard-relay.js" });
  if (seedToken) {
    // A token this browser already holds for the relay (hydrated earlier).
    window.JobBoredRelayAuth.hydrateFromBootstrap({
      relay: { workerUrl: WORKER, relayToken: TOKEN, relayLocked: true },
    });
  }
  for (const file of files) vm.runInContext(src(file), ctx, { filename: file });
  return { window, requests, elements };
}

function relayRequests(requests) {
  return requests.filter((r) => r.url.startsWith(WORKER));
}

function otherRequests(requests) {
  return requests.filter((r) => r.url.startsWith(OTHER));
}

async function timed(promise) {
  const started = Date.now();
  let value;
  let error;
  try {
    value = await promise;
  } catch (err) {
    error = err;
  }
  return { value, error, ms: Date.now() - started };
}

// ---------------------------------------------------------------- verify ---
const VERIFY = ["discovery-wizard-verify.js"];
const verifyApi = (w) => w.JobBoredDiscoveryWizard.verify;

test("verify: the relay POST carries the bearer; another origin does not", async () => {
  const { window, requests } = load(VERIFY, {
    relayRespond: () => json(200, { ok: true, accepted: true }),
  });
  await verifyApi(window).verifyDiscoveryEndpoint(`${WORKER}/webhook`, { secret: "s1" });
  await verifyApi(window).verifyDiscoveryEndpoint(`${OTHER}/webhook`, { secret: "s1" });
  const relay = relayRequests(requests);
  assert.equal(relay.length, 1);
  assert.equal(relay[0].init.method, "POST");
  assert.equal(headerOf(relay[0].init, "authorization"), BEARER);
  assert.equal(headerOf(relay[0].init, "x-discovery-secret"), "s1");
  const other = otherRequests(requests);
  assert.equal(other.length, 1);
  assert.equal(headerOf(other[0].init, "authorization"), undefined);
});

test("verify: its deadline settles the check while the token route stalls", async () => {
  const { window, requests } = load(VERIFY, {
    tokenRoute: "stall",
    relayRespond: (_url, init) => stalledUntilAborted(init),
  });
  const { value, error, ms } = await timed(
    verifyApi(window).verifyDiscoveryEndpoint(`${WORKER}/webhook`, { timeoutMs: 1000 }),
  );
  assert.equal(error, undefined);
  assert.equal(value.ok, false);
  assert.ok(ms < 2000, `verify settled at its 1000ms deadline, took ${ms}ms`);
  assert.equal(relayRequests(requests).length, 0, "no relay request left after the deadline");
});

// ------------------------------------------------------ settings profile ---
// On a localhost dashboard settings always routes /discovery-profile to the
// local worker, so the relay path runs from a non-local dashboard with the
// relay token already held in this browser. The document stays "loading" so
// the tab's own status polls (bind) do not run; only the call under test does.
const SETTINGS = ["settings-profile-tab.js"];
function settingsOpts(url, more = {}) {
  return {
    hostname: "app.example.com",
    seedToken: true,
    readyState: "loading",
    extra: {
      COMMAND_CENTER_CONFIG: {
        discoveryWebhookUrl: url,
        discoveryWebhookSecret: "s2",
        sheetId: "sheet_example",
      },
    },
    ...more,
  };
}

test("settings: the /discovery-profile POST carries the bearer to the relay only", async () => {
  const relayLoad = load(SETTINGS, settingsOpts(`${WORKER}/webhook`, {
    relayRespond: () => json(200, { ok: true }),
  }));
  await relayLoad.window.JobBoredSettingsProfileTab.postProfileEndpoint({ mode: "manual" }, 2000);
  const relay = relayRequests(relayLoad.requests);
  assert.equal(relay.length, 1);
  assert.equal(relay[0].url, `${WORKER}/discovery-profile`);
  assert.equal(headerOf(relay[0].init, "authorization"), BEARER);
  assert.equal(headerOf(relay[0].init, "x-discovery-secret"), "s2");

  const otherLoad = load(SETTINGS, settingsOpts(`${OTHER}/webhook`));
  await otherLoad.window.JobBoredSettingsProfileTab.postProfileEndpoint({ mode: "manual" }, 2000);
  const other = otherRequests(otherLoad.requests);
  assert.equal(other.length, 1);
  for (const r of otherLoad.requests) {
    assert.equal(headerOf(r.init, "authorization"), undefined, `no bearer on ${r.url}`);
  }
});

test("settings: the request timeout cancels a stalled relay request", async () => {
  const { window, requests } = load(SETTINGS, settingsOpts(`${WORKER}/webhook`, {
    relayRespond: (_url, init) => stalledUntilAborted(init),
  }));
  const { error, ms } = await timed(
    window.JobBoredSettingsProfileTab.postProfileEndpoint({ mode: "manual" }, 150),
  );
  assert.ok(error, "the request failed at its deadline");
  assert.ok(ms < 1500, `settled near the 150ms deadline, took ${ms}ms`);
  const relay = relayRequests(requests);
  assert.equal(relay.length, 1);
  assert.equal(headerOf(relay[0].init, "authorization"), BEARER);
  assert.equal(relay[0].init.signal.aborted, true, "the relay request was cancelled");
});

// ------------------------------------------------------------ ingest URL ---
const INGEST = ["ingest-url-flow.js"];
function ingestHost(webhookUrl) {
  return {
    resolveDiscoveryRunWebhookUrl: async () => webhookUrl,
    getDiscoveryWebhookSecret: () => "s3",
    getSheetId: () => "sheet_example",
    getFreshDiscoveryRequestGoogleAccessToken: async () => "",
    showToast() {},
    isIngestSheetAuthFailure: () => false,
    isFetchNetworkError: () => false,
  };
}

test("ingest: the /ingest-url POST carries the bearer to the relay only", async () => {
  const relayLoad = load(INGEST, {
    relayRespond: () => json(200, { ok: true, appended: true }),
  });
  const flow = relayLoad.window.JobBoredDiscovery.ingestUrlFlow;
  flow.host = ingestHost(`${WORKER}/webhook`);
  await flow.handleIngestUrlSubmit("https://jobs.example.com/role/1", null);
  const relay = relayRequests(relayLoad.requests);
  assert.equal(relay.length, 1);
  assert.equal(relay[0].url, `${WORKER}/ingest-url`);
  assert.equal(headerOf(relay[0].init, "authorization"), BEARER);
  assert.equal(headerOf(relay[0].init, "x-discovery-secret"), "s3");

  const otherLoad = load(INGEST);
  const otherFlow = otherLoad.window.JobBoredDiscovery.ingestUrlFlow;
  otherFlow.host = ingestHost(`${OTHER}/webhook`);
  await otherFlow.handleIngestUrlSubmit("https://jobs.example.com/role/1", null);
  const other = otherRequests(otherLoad.requests);
  assert.equal(other.length, 1);
  assert.equal(headerOf(other[0].init, "authorization"), undefined);
});

test("ingest: its 60s deadline (scaled to 100ms) fires while the token route stalls", async () => {
  const { window, requests } = load(INGEST, {
    tokenRoute: "stall",
    relayRespond: (_url, init) => stalledUntilAborted(init),
    // Compress only the ingest request deadline; the relay's own hydration
    // timeout keeps its real length so the caller's deadline is what fires.
    timerScale: (ms) => (ms === 60000 ? 100 : ms),
  });
  const flow = window.JobBoredDiscovery.ingestUrlFlow;
  flow.host = ingestHost(`${WORKER}/webhook`);
  const { error, ms } = await timed(flow.handleIngestUrlSubmit("https://jobs.example.com/role/1", null));
  assert.ok(error, "the ingest request failed at its deadline");
  assert.equal(error.message, "timeout");
  assert.ok(ms < 1500, `settled near the scaled deadline, took ${ms}ms`);
  assert.equal(relayRequests(requests).length, 0);
});

// ------------------------------------------------- expired-review cleanup ---
const EXPIRED = ["expired-review-ui.js"];
async function runCleanup(baseUrl, opts = {}) {
  const loaded = load(EXPIRED, {
    ...opts,
    extra: {
      JobBoredConfig: {
        discoveryWorker: { baseUrl, webhookSecret: "s4" },
        spreadsheetId: "sheet_example",
      },
    },
  });
  loaded.window.JobBoredApp.core = {
    getAccessToken: () => "",
    getPipelineData: () => [],
    host: { loadAllData: async () => {} },
  };
  loaded.window.JobBoredApp.expiredReview.initExpiredReviewUi();
  const button = loaded.elements.get("expiredReviewRunCleanup");
  assert.ok(button && button.listeners.click, "the Run cleanup button is wired");
  await Promise.all(button.listeners.click.map((fn) => fn({ preventDefault() {} })));
  return loaded;
}

test("expired review: the /cleanup-expired POST carries the bearer to the relay only", async () => {
  const relayLoad = await runCleanup(WORKER, {
    relayRespond: () => json(200, { ok: true, needsReview: 0, updated: 0 }),
  });
  const relay = relayRequests(relayLoad.requests);
  assert.equal(relay.length, 1);
  assert.equal(relay[0].url, `${WORKER}/cleanup-expired`);
  assert.equal(headerOf(relay[0].init, "authorization"), BEARER);

  const otherLoad = await runCleanup(OTHER);
  const other = otherRequests(otherLoad.requests);
  assert.equal(other.length, 1);
  assert.equal(headerOf(other[0].init, "authorization"), undefined);
});

// ------------------------------------------------------- run-status poll ---
const HANDOFF = ["discovery-status-handoff.js"];
function pollWith(webhookUrl, opts = {}) {
  const loaded = load(HANDOFF, opts);
  const pollErrors = [];
  loaded.window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => ({ runId: "run_1", statusPath: "/runs/run_1" }),
      markPollError: (msg) => pollErrors.push(msg),
    },
  };
  return { ...loaded, pollErrors, poll: () => loaded.window.JobBoredDiscovery.status.pollRunStatus(webhookUrl) };
}

test("run-status poll: the relay GET carries the bearer; another origin does not", async () => {
  const relay = pollWith(`${WORKER}/webhook`, {
    relayRespond: () => json(200, { runId: "run_1", status: "running" }),
  });
  const data = await relay.poll();
  assert.equal(data && data.status, "running");
  const sent = relayRequests(relay.requests);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${WORKER}/runs/run_1`);
  assert.equal(headerOf(sent[0].init, "authorization"), BEARER);

  const other = pollWith(`${OTHER}/webhook`);
  await other.poll();
  const otherSent = otherRequests(other.requests);
  assert.equal(otherSent.length, 1);
  assert.equal(headerOf(otherSent[0].init, "authorization"), undefined);
});

test("run-status poll: a stalled token route delays the poll only by the hydration timeout", async () => {
  const relay = pollWith(`${WORKER}/webhook`, {
    tokenRoute: "stall",
    relayRespond: () => json(401, { ok: false }),
  });
  const limit = relay.window.JobBoredRelayAuth.HYDRATION_TIMEOUT_MS;
  const { value, ms } = await timed(relay.poll());
  assert.equal(value, null);
  assert.ok(ms < limit * 2 + 1000, `poll settled within the bounded hydration, took ${ms}ms`);
  assert.equal(relay.pollErrors.length, 1);
});
