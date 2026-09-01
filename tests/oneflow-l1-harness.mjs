/* ============================================================
   Shared sandbox for the ONEFLOW L1 (arrival) probes.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite. It reuses L0's DOM/IndexedDB fakes verbatim (importing, never
   editing, L0's harness) and adds the three things beats B1–B3 need
   that the substrate probes did not:

     · window.JobBoredApp.core.host — the bridge surface B1/B2 call into
       (sign-in, starter-sheet creation, the config override store).
     · an injectable fetch, so the live provider check, the Gemini
       write-through, and /profile/from-resume are asserted as REAL
       round-trips against a recording double.
     · window.CommandCenterResumeIngest / ResumeGenerate doubles, so a
       beat's behavior is probed without dragging pdf.js into node.

   loadResumeGenerate() is separate: it runs the REAL resume-generate.js
   so verifyResumeProviderLive() is tested against its own provider
   plumbing rather than a restatement of it.
   ============================================================ */
import vm from "node:vm";
import {
  FakeCustomEvent,
  FakeNode,
  makeFakeDocument,
  makeFakeIndexedDb,
  readRepoFile,
} from "./oneflow-l0-harness.mjs";

export { readRepoFile, serializeTree } from "./oneflow-l0-harness.mjs";

/** Records every call so a probe can assert the request, not just the result. */
export function makeFetchDouble(handler) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    const call = { url: String(url), options, body: null };
    if (options && typeof options.body === "string") {
      try {
        call.body = JSON.parse(options.body);
      } catch (_) {
        call.body = options.body;
      }
    }
    calls.push(call);
    const result = await handler(call);
    if (result instanceof Error) throw result;
    const payload = result && typeof result === "object" ? result : {};
    const status = payload.status || (payload.ok === false ? 500 : 200);
    return {
      ok: payload.ok !== false,
      status,
      json: async () => (payload.json !== undefined ? payload.json : {}),
      text: async () => (payload.text !== undefined ? payload.text : ""),
    };
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * L0's IndexedDB fake covers the `settings` store, which is all the
 * substrate probes needed. B3 writes a RESUME, and setPrimaryResume
 * (user-content-store.js:856) uses two things that fake does not model:
 * objectStore.clear(), and a transaction that reports oncomplete — it
 * deliberately runs the clear and the put in ONE transaction so a failed
 * put cannot leave the user with no resume at all.
 *
 * Rather than fork L0's fake (single-owner file), wrap it: every db that
 * comes out of open() gets a transaction whose stores can clear and whose
 * completion fires once the synchronous request block has run.
 */
function withResumeTransactions(idb) {
  const openDb = idb.open.bind(idb);

  function wrapStore(store) {
    if (typeof store.clear === "function") return store;
    store.clear = () => {
      store.rows.clear();
      const request = { result: undefined, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    };
    return store;
  }

  function wrapDb(db) {
    if (!db || db.__resumeWrapped) return db;
    const transaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const tx = transaction(...args);
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name) => wrapStore(objectStore(name));
      tx.error = null;
      tx.abort = () => {
        if (tx.onabort) tx.onabort();
      };
      // The real API completes after the caller's synchronous request block;
      // a macrotask is the closest honest stand-in.
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 0);
      return tx;
    };
    db.__resumeWrapped = true;
    return db;
  }

  idb.open = (name) => {
    const request = openDb(name);
    let result = request.result;
    Object.defineProperty(request, "result", {
      configurable: true,
      get: () => result,
      set: (value) => {
        result = wrapDb(value);
      },
    });
    return request;
  };
  return idb;
}

function baseSandbox(doc, win) {
  return {
    window: win,
    document: doc,
    console: {
      warn(...a) {
        if (process.env.ONEFLOW_DEBUG) console.log("WARN", ...a);
      },
      error(...a) {
        if (process.env.ONEFLOW_DEBUG) console.log("ERROR", ...a);
      },
      info() {},
      log() {},
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    requestAnimationFrame: () => {},
    Object,
    Set,
    Map,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Promise,
    Math,
    Error,
    Symbol,
    RegExp,
    URL,
    Node: FakeNode,
  };
}

/**
 * The default bridge host. Every entry is a spy so a probe can assert the
 * beat CALLED the existing path instead of forking its own.
 */
function makeHostDouble(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
  };
  const state = {
    sheetId: "",
    signedIn: false,
    userEmail: "",
    oauthClientId: "client-123.apps.googleusercontent.com",
    overrides: {},
  };
  const host = {
    __calls: calls,
    __state: state,
    getSheetId: () => state.sheetId,
    getSHEET_ID: () => state.sheetId,
    setSHEET_ID: (v) => {
      state.sheetId = v;
    },
    isSignedIn: () => state.signedIn,
    getUserEmail: () => state.userEmail,
    getAccessToken: () => (state.signedIn ? "token-abc" : ""),
    getOAuthClientId: () => state.oauthClientId,
    signIn(...args) {
      calls.push({ name: "signIn", args });
      state.signedIn = true;
      state.userEmail = state.userEmail || "stranger@example.com";
    },
    handleSetupCreateStarterSheet: async (options = {}) => {
      calls.push({ name: "handleSetupCreateStarterSheet", args: [options] });
      state.sheetId = "created-sheet-id";
      if (typeof options.onStatus === "function") {
        options.onStatus("Creating your starter sheet…", false);
      }
      if (typeof options.onCreated === "function") {
        options.onCreated({
          spreadsheetId: "created-sheet-id",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/created-sheet-id/edit",
        });
      }
    },
    mergeStoredConfigOverridePatch(patch) {
      calls.push({ name: "mergeStoredConfigOverridePatch", args: [patch] });
      Object.assign(state.overrides, patch);
    },
    parseGoogleSheetId(raw) {
      const s = String(raw || "").trim();
      const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/);
      if (m) return m[1];
      return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
    },
    applyOAuthClientChange: record("applyOAuthClientChange"),
    setInitialSheetAccessResolved: record("setInitialSheetAccessResolved"),
    setDashboardSheetLinks: record("setDashboardSheetLinks"),
    copyTextToClipboard: record("copyTextToClipboard"),
    showToast: record("showToast"),
    getConfig: () => ({}),
  };
  return Object.assign(host, overrides);
}

/**
 * The arrival half in one sandbox, in index.html's load order.
 *
 * @param {{
 *   config?: Record<string, unknown>,
 *   fetchImpl?: Function,
 *   host?: Record<string, unknown>,
 *   verifyProvider?: Function,
 *   extractTextFromFile?: Function,
 * }} [options]
 */
export function loadArrival(options = {}) {
  const doc = makeFakeDocument();
  doc.register("oneFlowMount");
  doc.register("discoverySetupWizardMount");
  const win = {};
  const ctx = baseSandbox(doc, win);
  ctx.indexedDB = withResumeTransactions(makeFakeIndexedDb());
  ctx.crypto = { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` };
  ctx.CustomEvent = FakeCustomEvent;
  win.CustomEvent = FakeCustomEvent;
  win.location = { protocol: "http:", origin: "http://localhost:8080", search: "" };
  ctx.location = win.location;
  ctx.navigator = { clipboard: { writeText: async () => {} } };
  win.navigator = ctx.navigator;

  const fetchImpl =
    options.fetchImpl ||
    makeFetchDouble(() => ({ ok: true, json: { ok: true } }));
  ctx.fetch = fetchImpl;
  win.fetch = fetchImpl;

  win.COMMAND_CENTER_CONFIG = { ...(options.config || {}) };

  const host = makeHostDouble(options.host || {});
  // The existing-sheet validator B1 reuses still lives on the first-run
  // wizard's namespace (see LANE-REPORT-L1 §5 — L7 must relocate it when it
  // deletes that module).
  const sheetAccessCalls = [];
  const firstRunWizard = {
    async verifyExistingSheetAccess(input) {
      sheetAccessCalls.push(input);
      if (typeof options.verifyExistingSheetAccess === "function") {
        return options.verifyExistingSheetAccess(input);
      }
      return { ok: true, reason: "headers_ok" };
    },
  };
  win.JobBoredApp = { core: { host }, firstRunWizard };

  // The two collaborators a beat consumes but does not own.
  const verifyCalls = [];
  win.CommandCenterResumeGenerate = {
    getResumeGenerationConfig: () => ({
      provider: String(win.COMMAND_CENTER_CONFIG.resumeProvider || "openrouter"),
    }),
    async verifyResumeProviderLive(opts) {
      verifyCalls.push(opts || {});
      if (typeof options.verifyProvider === "function") {
        return options.verifyProvider(opts, win);
      }
      return { ok: true, provider: "openrouter", model: "openai/gpt-oss-120b:free", ms: 12 };
    },
  };
  win.CommandCenterResumeIngest = {
    normalizeExtractedText: (t) => String(t || "").replace(/\r\n/g, "\n").trim(),
    async extractTextFromFile(file) {
      if (typeof options.extractTextFromFile === "function") {
        return options.extractTextFromFile(file);
      }
      return `extracted:${(file && file.name) || "resume"}`;
    },
  };

  vm.createContext(ctx);
  const files = [
    "user-content-store.js",
    "onboarding-telemetry.js",
    "discovery-wizard-shell.js",
    "onboarding-flow.js",
    "oneflow-beat-google.js",
    "oneflow-beat-ai.js",
    "oneflow-beat-resume.js",
    "oneflow-beat-fit.js",
    "oneflow-beat-discovery.js",
    "oneflow-beat-payoff.js",
  ];
  for (const file of files) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }

  return {
    window: win,
    document: doc,
    host,
    fetchImpl,
    verifyCalls,
    sheetAccessCalls,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    shell: win.JobBoredDiscoveryWizard.shell,
    events: doc._events,
    mount: () => doc.getElementById("oneFlowMount"),
    beats: {
      google: win.JobBoredOneFlowBeatGoogle,
      ai: win.JobBoredOneFlowBeatAi,
      resume: win.JobBoredOneFlowBeatResume,
    },
  };
}

/** The REAL resume-generate.js, for probing verifyResumeProviderLive(). */
export function loadResumeGenerate({ config = {}, fetchImpl } = {}) {
  const doc = makeFakeDocument();
  const win = {};
  const ctx = baseSandbox(doc, win);
  const doFetch = fetchImpl || makeFetchDouble(() => ({ ok: true, json: {} }));
  ctx.fetch = doFetch;
  win.fetch = doFetch;
  win.COMMAND_CENTER_CONFIG = { ...config };
  win.location = { protocol: "http:", origin: "http://localhost:8080" };
  ctx.location = win.location;
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("resume-generate.js"), ctx, {
    filename: "resume-generate.js",
  });
  return { window: win, api: win.CommandCenterResumeGenerate, fetchImpl: doFetch };
}

/** Telemetry events of one step, in emit order. */
export function stepEvents(events, step) {
  return events
    .filter((e) => e && e.detail && e.detail.step === step)
    .map((e) => e.detail);
}

/** The shell's rendered footer action, by its action id. */
export function actionButton(mount, actionId) {
  return mount.querySelector(`[data-action-id="${actionId}"]`);
}

/** Every text node the shell rendered, joined — for copy assertions. */
export function renderedText(mount) {
  return mount ? mount.textContent : "";
}
