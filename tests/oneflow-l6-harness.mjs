/* ============================================================
   Shared sandbox for the ONEFLOW L6 (cutover) probes.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite — it is imported by tests/oneflow-l6-*.test.mjs and by the
   rewritten tests/integration/onboarding-chain-convergence.test.mjs.

   L6 is the lane that flips BOOT, so its probes need the boot files
   themselves running, not a regex over their source. One loader builds
   the whole page in one vm context, in index.html's load order:

     user-content-store · onboarding-telemetry · discovery-wizard-shell ·
     onboarding-flow · the six beats · the demo board · the celebration ·
     sheet-access-setup · welcome · discovery-status-handoff · app-bootstrap

   so a probe can call `bootstrap.init()` on a cold start and watch the
   demo board mount, or call `runPostAccessBootstrapOnce()` and watch the
   §3.3 migration route a legacy profile to its beat.

   The DOM / IndexedDB fakes come from the L0 harness — one set of fakes
   for the whole program (L1, L3 and L4 do the same).
   ============================================================ */
import vm from "node:vm";
import {
  FakeCustomEvent,
  FakeEl,
  FakeNode,
  makeFakeDocument,
  makeFakeIndexedDb,
  readRepoFile,
} from "./oneflow-l0-harness.mjs";

export { FakeNode, readRepoFile };

/** The page's script order for everything L6 boots. */
const PAGE_SCRIPTS = Object.freeze([
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
  "oneflow-demo-board.js",
  "onboarding-celebration.js",
  "sheet-access-setup.js",
  "welcome.js",
  "discovery-status-handoff.js",
  "app-bootstrap.js",
]);

/** Element ids app-bootstrap's cold-start path and the shell both need. */
const MOUNT_IDS = Object.freeze([
  "dashboard",
  "setupScreen",
  "sheetAccessGateScreen",
  "oneFlowMount",
  "discoverySetupWizardMount",
  "onboardingCelebration",
  "onboardingCelebrationConfetti",
  "onboardingCelebrationContinue",
  "onboardingCelebrationTitle",
  "onboardingCelebrationSub",
  "onboardingCelebrationAlt",
]);

/**
 * Two DOM methods the L0 FakeEl does not implement, added HERE rather
 * than worked around in the modules under test (same trade L4 made):
 * style.setProperty for the confetti driver, remove() for detaching.
 */
function upgradeElement(el) {
  el.style.setProperty = (name, value) => {
    el.style[name] = String(value);
  };
  el.remove = () => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.children = parent.children.filter((child) => child !== el);
    el.parentNode = null;
  };
  return el;
}

/**
 * app-bootstrap.js binds DOMContentLoaded and jb:closure:change at load,
 * and the demo board binds jb:pipeline:rendered on mount, so the fake
 * document needs a real listener table.
 */
function upgradeDocument(doc) {
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => upgradeElement(create(tag));
  const register = doc.register.bind(doc);
  doc.register = (id) => upgradeElement(register(id));
  upgradeElement(doc.body);
  // releaseAuthPrepaintGuard() reads documentElement.classList on every init.
  doc.documentElement = upgradeElement(new FakeEl("html"));
  const listeners = new Map();
  doc.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  doc.removeEventListener = (type, fn) => {
    const list = listeners.get(type) || [];
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  };
  doc.fire = (type, event = {}) => {
    for (const fn of [...(listeners.get(type) || [])]) fn(event);
  };
  // whats-next-banner.js finds its region by attribute selector off the
  // document, not by id.
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  doc.readyState = "complete";
  return doc;
}

/**
 * B3 writes a RESUME, and setPrimaryResume (user-content-store.js:856)
 * uses two things L0's IndexedDB fake does not model: objectStore.clear(),
 * and a transaction that reports oncomplete. Same wrapper L1's harness
 * applies (tests/oneflow-l1-harness.mjs) — L0's fake is single-owner, so
 * both lanes wrap rather than fork it.
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
    setInterval: () => 0,
    clearInterval: () => {},
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
    URLSearchParams,
    Node: FakeNode,
  };
}

/** sessionStorage stand-in — the S0 corner pill's "for this session" memory. */
function makeFakeSessionStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * The bridge surface app-bootstrap and the beats call into. Every entry
 * records, so a probe asserts the boot chain CALLED the existing path
 * rather than restating it.
 */
function makeHost(state, calls, overrides = {}) {
  const record =
    (name, result) =>
    (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : result;
    };
  const host = {
    __calls: calls,
    __state: state,
    getSheetId: () => state.sheetId,
    getSHEET_ID: () => state.runtimeSheetId,
    setSHEET_ID: (v) => {
      state.runtimeSheetId = v || "";
      state.sheetId = v || state.sheetId;
    },
    getOAuthClientId: () => state.oauthClientId,
    getAccessToken: () => (state.signedIn ? "token-abc" : ""),
    isSignedIn: () => state.signedIn,
    getUserEmail: () => state.userEmail,
    getConfig: () => null,
    // Lazily resolved: the store module has not run yet when this host is
    // built, and every legacy gate reads the store through this bridge.
    getUserContent: () => state.userContent(),
    signIn(...args) {
      calls.push({ name: "signIn", args });
      state.signedIn = true;
      state.userEmail = state.userEmail || "stranger@example.com";
    },
    handleSetupCreateStarterSheet: async (options = {}) => {
      calls.push({ name: "handleSetupCreateStarterSheet", args: [options] });
      state.sheetId = "created-sheet-id";
      state.runtimeSheetId = "created-sheet-id";
      if (typeof options.onCreated === "function") {
        options.onCreated({ spreadsheetId: "created-sheet-id" });
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
    showSheetAccessGate: record("showSheetAccessGate"),
    initAuth: record("initAuth"),
    initAuthUserMenu: record("initAuthUserMenu"),
    initResumeMaterialsFeature: record("initResumeMaterialsFeature"),
    initDiscoveryDrawer: record("initDiscoveryDrawer"),
    initDiscoverySubtabs: record("initDiscoverySubtabs"),
    initDiscoveryButton: record("initDiscoveryButton"),
    renderSetupStarterSheetUi: record("renderSetupStarterSheetUi"),
    setInitialSheetAccessResolved: record("setInitialSheetAccessResolved"),
    setDashboardSheetLinks: record("setDashboardSheetLinks"),
    resetPostAccessBootstrap: record("resetPostAccessBootstrap"),
    showToast: record("showToast"),
    loadAllData: record("loadAllData", async () => true),
    getConfigCore: () => ({
      APPS_SCRIPT_MANAGED_BY: "command-center",
      APPS_SCRIPT_PUBLIC_ACCESS_READY: "ready",
    }),
    getDiscoveryWebhookUrl: () => "",
    triggerDiscoveryRun: record("triggerDiscoveryRun", async () => ({
      ok: true,
      kind: "accepted_async",
    })),
    buildDiscoveryWebhookPayload: async () => ({
      discoveryProfile: { targetRoles: "Staff Engineer" },
      mergedUserProfile: { identity: { targetRoles: ["Staff Engineer"] } },
    }),
  };
  return Object.assign(host, overrides);
}

/**
 * Boot the page.
 *
 * @param {{
 *   sheetId?: string,
 *   oauthClientId?: string,
 *   signedIn?: boolean,
 *   userEmail?: string,
 *   givenName?: string,
 *   config?: Record<string, unknown>,
 *   gateMode?: string,
 *   fetchImpl?: Function,
 *   serverProfile?: unknown,
 *   verifyProvider?: Function|null,
 *   host?: Record<string, unknown>,
 *   withDemoBoard?: boolean,
 * }} [options]
 */
export function loadCutover(options = {}) {
  const doc = upgradeDocument(makeFakeDocument());
  for (const id of MOUNT_IDS) doc.register(id);
  doc.body.appendChild(doc.getElementById("dashboard"));
  const whatsNextRegion = doc.register("whatsNextRegion");
  whatsNextRegion.dataset.region = "whats-next";
  doc.body.appendChild(whatsNextRegion);
  // Pre-created so welcome.js's ensureRegionEl finds it instead of walking
  // for the comment anchor index.html carries.
  const welcomeRegion = doc.register("welcomeRegion");
  welcomeRegion.dataset.region = "welcome";
  doc.body.appendChild(welcomeRegion);
  if (options.gateMode) {
    doc.getElementById("sheetAccessGateScreen").dataset.gateMode =
      options.gateMode;
  }

  const win = {};
  const ctx = baseSandbox(doc, win);
  // Passing a previous run's indexedDB back in models a RELOAD: the page
  // is rebuilt from scratch, the user's stored state is not.
  ctx.indexedDB =
    options.indexedDB || withResumeTransactions(makeFakeIndexedDb());
  ctx.crypto = {
    randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}`,
  };
  ctx.CustomEvent = FakeCustomEvent;
  win.CustomEvent = FakeCustomEvent;
  ctx.sessionStorage = makeFakeSessionStorage();
  win.sessionStorage = ctx.sessionStorage;
  ctx.localStorage = makeFakeSessionStorage();
  win.localStorage = ctx.localStorage;
  // welcome.js's empty-state watcher polls through window, not the global.
  win.setInterval = ctx.setInterval;
  win.clearInterval = ctx.clearInterval;
  win.setTimeout = ctx.setTimeout;
  win.location = {
    protocol: "http:",
    origin: "http://localhost:8080",
    search: "",
    pathname: "/index.html",
    hash: "",
  };
  ctx.location = win.location;
  ctx.history = { replaceState() {} };
  ctx.navigator = { clipboard: { writeText: async () => {} } };
  win.navigator = ctx.navigator;

  const state = {
    sheetId: options.sheetId || "",
    runtimeSheetId: options.sheetId || "",
    oauthClientId:
      "oauthClientId" in options
        ? options.oauthClientId
        : "client-123.apps.googleusercontent.com",
    signedIn: !!options.signedIn,
    userEmail: options.userEmail || "",
    overrides: {},
    userContent: () => win.CommandCenterUserContent,
  };

  // Network: the demo fixture is served off disk (real shipped data), the
  // server fit profile answers from `serverProfile`, everything else is a
  // recorded 200 so a beat's round-trip is asserted, never guessed at.
  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", body: null };
    if (typeof init.body === "string") {
      try {
        call.body = JSON.parse(init.body);
      } catch (_) {
        call.body = init.body;
      }
    }
    fetchCalls.push(call);
    if (typeof options.fetchImpl === "function") {
      const custom = await options.fetchImpl(call, init);
      if (custom) return custom;
    }
    if (call.url.endsWith("fixtures/demo-pipeline.json")) {
      const text = readRepoFile("fixtures/demo-pipeline.json");
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    }
    if (/\/profile$/.test(call.url) && call.method === "GET") {
      const profile = options.serverProfile;
      return {
        ok: true,
        status: 200,
        json: async () =>
          profile ? { ok: true, profile } : { ok: false, reason: "not_found" },
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  ctx.fetch = fetchImpl;
  win.fetch = fetchImpl;

  win.COMMAND_CENTER_CONFIG = { ...(options.config || {}) };

  const calls = [];
  const host = makeHost(state, calls, options.host || {});
  win.JobBoredApp = {
    // sheet-access-setup.js reads the sheet id off `core`, not `core.host`
    // (sheet-access-setup.js:163, :411) — the gate's signin copy branches
    // on it, so the L7 gate-guard probe needs it here.
    core: {
      host,
      getSHEET_ID: () => state.runtimeSheetId,
      setSHEET_ID: (v) => host.setSHEET_ID(v),
    },
    auth: {
      getUserEmail: () => state.userEmail,
      getUserGivenName: () =>
        "givenName" in options ? options.givenName : "Priya",
    },
  };

  const verifyCalls = [];
  win.CommandCenterResumeGenerate = {
    getResumeGenerationConfig: () => ({
      provider: String(win.COMMAND_CENTER_CONFIG.resumeProvider || ""),
    }),
    async verifyResumeProviderLive(...args) {
      verifyCalls.push(args);
      if (options.verifyProvider === null) return { ok: false, message: "no" };
      if (typeof options.verifyProvider === "function") {
        return options.verifyProvider(...args);
      }
      return { ok: true, provider: "openrouter", model: "gpt-oss", ms: 9 };
    },
  };
  win.CommandCenterResumeIngest = {
    normalizeExtractedText: (t) => String(t || "").replace(/\r\n/g, "\n").trim(),
    async extractTextFromFile(file) {
      return `extracted:${(file && file.name) || "resume"}`;
    },
  };
  win.FitProfileForm = {
    async fetchProfile() {
      const res = await fetchImpl("/profile");
      return res.json();
    },
  };
  win.JobBoredDiscoveryPayload = {
    buildSearchPlan: () => ({
      facets: { sourceLanes: ["serpapi_google_jobs", "grounded_web"] },
    }),
  };
  win.JobBoredEffectiveIntent = {
    buildEffectiveIntent: () => ({ targetRoles: ["Staff Engineer"] }),
    isBlankIntent: (intent) =>
      !(intent && intent.targetRoles && intent.targetRoles.length),
  };

  vm.createContext(ctx);
  for (const file of PAGE_SCRIPTS) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  if (options.withBanner) {
    // The banner loads after JobBoredApp.core.host exists — same order
    // index.html uses.
    vm.runInContext(readRepoFile("whats-next-banner.js"), ctx, {
      filename: "whats-next-banner.js",
    });
  }

  // The discovery wizard bridge B5 reaches for, and the run tracker the
  // status handoff polls — both installed after the shell has claimed the
  // JobBoredDiscoveryWizard namespace, exactly as the page does.
  win.JobBoredDiscoveryWizard.ui = options.wizardUi || {};
  const trackerState = options.trackerState || { status: "idle" };
  const acknowledged = [];
  const TERMINAL = ["completed", "empty", "partial", "failed"];
  win.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => ({ ...trackerState }),
      isActive: () =>
        ["pending", "running", "polling_error"].includes(trackerState.status),
      isTerminal: () => TERMINAL.includes(trackerState.status),
      acknowledgeTerminalOutcome: () => {
        acknowledged.push(trackerState.status);
        trackerState.terminalAcknowledged = true;
      },
      resumeFromStatusPollingFailure: () => {},
    },
  };
  win.JobBoredDiscovery.status.host = host;
  win.JobBoredApp.bootstrap.host = host;

  const shell = win.JobBoredDiscoveryWizard.shell;

  return {
    window: win,
    document: doc,
    state,
    host,
    calls,
    fetchCalls,
    verifyCalls,
    acknowledged,
    sessionStorage: ctx.sessionStorage,
    indexedDB: ctx.indexedDB,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    shell,
    board: win.JobBoredOneFlowDemoBoard,
    status: win.JobBoredDiscovery.status,
    bootstrap: win.JobBoredApp.bootstrap,
    setup: win.JobBoredApp.setup,
    banner: win.JobBoredApp.whatsNextBanner,
    welcome: win.JobBoredWelcome,
    whatsNextRegion,
    welcomeRegion,
    events: doc._events,
    mount: () => doc.getElementById("oneFlowMount"),
    /**
     * The beat whose BODY is rendered, or "". Deliberately not
     * `[data-beat-id]`: the 6-segment spine carries that attribute too,
     * and its first segment would answer for every beat.
     */
    openBeat() {
      const bodies = doc
        .getElementById("oneFlowMount")
        .querySelectorAll(".oneflow-beat");
      const last = bodies[bodies.length - 1];
      return last ? last.dataset.beatId : "";
    },
    /** Fire a shell footer action exactly as a button click would. */
    act(actionId, detail = {}) {
      const context = shell.lastRender && shell.lastRender.context;
      if (!context) throw new Error(`no shell rendered for action ${actionId}`);
      return context.onAction(actionId, detail);
    },
    button(actionId) {
      return doc
        .getElementById("oneFlowMount")
        .querySelector(`[data-action-id="${actionId}"]`);
    },
    text() {
      return doc.getElementById("oneFlowMount").textContent;
    },
    /** Names of the host bridge functions the boot chain called. */
    called() {
      return calls.map((c) => c.name);
    },
  };
}

/**
 * auth-session.js on its own, with the storage + DOM it touches. Used by
 * the routed `given_name` probe: the flow's "You're live, {firstName}"
 * has to come from a real Google userinfo read, not a stub.
 */
export function loadAuthSession({ userInfo, oauthClientId = "client_123" } = {}) {
  const doc = upgradeDocument(makeFakeDocument());
  // updateAuthUI() paints these on every userinfo read; without them the
  // read throws into fetchUserEmail's catch and the probe silently tests
  // nothing.
  for (const id of [
    "signInBtn",
    "authUser",
    "authAvatarSlot",
    "authAvatarImg",
    "authAvatarFallback",
    "authMenuToggle",
  ]) {
    doc.register(id);
  }
  const win = {};
  const ctx = baseSandbox(doc, win);
  const local = makeFakeSessionStorage();
  const session = makeFakeSessionStorage();
  ctx.localStorage = local;
  ctx.sessionStorage = session;
  win.localStorage = local;
  win.sessionStorage = session;
  const fetchCalls = [];
  ctx.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => userInfo || {},
    };
  };
  win.fetch = ctx.fetch;
  win.JobBoredApp = {
    core: {
      host: {
        getOAuthClientId: () => oauthClientId,
        getSHEET_ID: () => "",
        getSheetId: () => "",
        setPendingSetupStarterSheetCreate() {},
        renderSetupStarterSheetUi() {},
        loadAllData: async () => true,
        revealDashboardShell() {},
        revealSetupScreenAfterAuth() {},
        showSheetAccessGate() {},
        maybeSyncSettingsModalModeAfterAuth() {},
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("auth-session.js"), ctx, {
    filename: "auth-session.js",
  });
  return {
    window: win,
    document: doc,
    localStorage: local,
    sessionStorage: session,
    fetchCalls,
    auth: win.JobBoredApp.auth,
  };
}

/** Telemetry events of one step, in emit order. */
export function stepEvents(events, step) {
  return events
    .filter((e) => e && e.detail && e.detail.step === step)
    .map((e) => e.detail);
}

/**
 * A vm context has its OWN intrinsics, so a sandbox value is never
 * deepStrictEqual to a literal out here. Round-trip it into this realm.
 */
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Let every queued microtask/macrotask settle (beats chain both). */
export function settle(turns = 6) {
  let p = Promise.resolve();
  for (let i = 0; i < turns; i += 1) {
    p = p.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return p;
}
