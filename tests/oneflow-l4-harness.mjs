/* ============================================================
   Shared fakes for the ONEFLOW L4 (bookends) probes.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite — it is imported by tests/oneflow-l4-*.test.mjs.

   Builds on tests/oneflow-l0-harness.mjs (same FakeEl DOM, same vm
   sandbox recipe) so the substrate probes and the bookend probes can
   never disagree about what the DOM does. L4 adds:

     loadDemoBoard()   — oneflow-demo-board.js with a fetch() serving the
                         real fixtures/demo-pipeline.json off disk, a
                         sessionStorage fake for the corner pill, and a
                         document.body to mount into.
     loadCelebration() — onboarding-celebration.js alone, with the
                         overlay element graph the player drives.
     loadPayoff()      — the full substrate + oneflow-beat-payoff.js,
                         with stubs for every call-only collaborator B6
                         reads (auth session, fit profile, provider
                         config, sheet id, discovery preview, run).
   ============================================================ */
import vm from "node:vm";
import {
  FakeEl,
  FakeNode,
  FakeCustomEvent,
  makeFakeDocument,
  makeFakeIndexedDb,
  readRepoFile,
  repoRoot,
} from "./oneflow-l0-harness.mjs";

export { FakeEl, FakeNode, readRepoFile, repoRoot };

/** Same base globals as the L0 harness, kept in one place. */
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
      log() {},
    },
    setTimeout,
    clearTimeout,
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
    URL,
    Node: FakeNode,
  };
}

/** sessionStorage stand-in — the corner pill's "for this session" memory. */
export function makeFakeSessionStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * oneflow-demo-board.js in a sandbox. `fetchImpl` defaults to serving the
 * REAL fixture off disk, so the probes assert against shipped data rather
 * than a hand-written double that can drift from it.
 */
export function loadDemoBoard({ fetchImpl, sessionSeed = {} } = {}) {
  const doc = makeFakeDocument();
  const win = {};
  const ctx = baseSandbox(doc, win);
  ctx.CustomEvent = FakeCustomEvent;
  win.CustomEvent = FakeCustomEvent;
  ctx.sessionStorage = makeFakeSessionStorage(sessionSeed);
  win.sessionStorage = ctx.sessionStorage;
  ctx.fetch =
    fetchImpl ||
    (async (url) => {
      const text = readRepoFile(String(url));
      return {
        ok: true,
        status: 200,
        async json() {
          return JSON.parse(text);
        },
      };
    });
  win.fetch = ctx.fetch;
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("oneflow-demo-board.js"), ctx, {
    filename: "oneflow-demo-board.js",
  });
  return {
    window: win,
    document: doc,
    sessionStorage: ctx.sessionStorage,
    board: win.JobBoredOneFlowDemoBoard,
  };
}

/**
 * The fake DOM's `style` is a plain object; the confetti driver writes a
 * custom property through style.setProperty. Give every element the real
 * method so the probes exercise the shipped code path, not a stub of it.
 */
function withStyleSetProperty(doc) {
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = create(tag);
    el.style.setProperty = (name, value) => {
      el.style[name] = String(value);
    };
    return el;
  };
  const register = doc.register.bind(doc);
  doc.register = (id) => {
    const el = register(id);
    el.style.setProperty = (name, value) => {
      el.style[name] = String(value);
    };
    return el;
  };
  return doc;
}

/** The celebration overlay element graph, by id, as index.html ships it. */
export function makeCelebrationDom() {
  const doc = withStyleSetProperty(makeFakeDocument());
  const overlay = doc.register("onboardingCelebration");
  doc.body.appendChild(overlay);
  const other = doc.register("someOtherSurface");
  doc.body.appendChild(other);
  const ids = [
    "onboardingCelebrationConfetti",
    "onboardingCelebrationContinue",
    "onboardingCelebrationTitle",
    "onboardingCelebrationSub",
    "onboardingCelebrationAlt",
  ];
  const els = {};
  for (const id of ids) {
    const el = doc.register(id);
    overlay.appendChild(el);
    els[id] = el;
  }
  els.onboardingCelebrationAlt.hidden = true;
  return { doc, overlay, other, els };
}

/** onboarding-celebration.js alone, with a controllable timer queue. */
export function loadCelebrationModule({ withCta = true } = {}) {
  const { doc, overlay, other, els } = makeCelebrationDom();
  if (!withCta) {
    // Stale cached markup: the overlay exists, the CTA does not.
    doc.getElementById = ((original) => (id) =>
      id === "onboardingCelebrationContinue" ? null : original(id))(
      doc.getElementById.bind(doc),
    );
  }
  const win = {};
  const ctx = baseSandbox(doc, win);
  const timers = [];
  ctx.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  ctx.clearTimeout = () => {};
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("onboarding-celebration.js"), ctx, {
    filename: "onboarding-celebration.js",
  });
  return {
    window: win,
    document: doc,
    overlay,
    other,
    els,
    timers,
    drainTimers() {
      while (timers.length) timers.shift().fn();
    },
    celebration: win.JobBoredOnboardingCelebration,
  };
}

/**
 * The substrate + the payoff beat, with every call-only collaborator B6
 * reads stubbed. Everything in `stubs` is optional; the defaults describe
 * the happy "connected" path so a probe only states what it changes.
 */
export function loadPayoff(stubs = {}) {
  const doc = makeFakeDocument();
  doc.register("oneFlowMount");
  doc.register("discoverySetupWizardMount");
  const win = {};
  const ctx = baseSandbox(doc, win);
  ctx.indexedDB = makeFakeIndexedDb();
  ctx.crypto = {
    randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}`,
  };
  ctx.CustomEvent = FakeCustomEvent;
  win.CustomEvent = FakeCustomEvent;

  const calls = { celebration: [], discoveryRuns: [], toasts: [] };

  // --- Google session profile (B1's residue) --------------------------
  const auth = {
    getUserGivenName: () =>
      "givenName" in stubs ? stubs.givenName : "Priya",
    getUserEmail: () => stubs.email || "priya@example.com",
  };
  // --- Configured AI provider ------------------------------------------
  const config = {
    resumeProvider: "provider" in stubs ? stubs.provider : "openrouter",
    sheetId: "sheetId" in stubs ? stubs.sheetId : "SHEET_ABC",
  };
  win.COMMAND_CENTER_CONFIG = config;
  win.JobBoredApp = {
    auth,
    core: {
      host: {
        getConfig: () => config,
        getSHEET_ID: () => config.sheetId,
        triggerDiscoveryRun: (opts) => {
          calls.discoveryRuns.push(opts || {});
          return Promise.resolve(
            stubs.runResult || { ok: true, kind: "accepted_async" },
          );
        },
        showToast: (...a) => calls.toasts.push(a),
      },
    },
  };
  // --- The just-saved fit profile ---------------------------------------
  win.FitProfileForm = {
    fetchProfile: async () =>
      "fitProfile" in stubs
        ? stubs.fitProfile
        : {
            profile: {
              identity: {
                targetRoles: ["Staff Product Designer", "Design Systems Lead"],
              },
              strengths: [
                { name: "Design systems", rank: 1 },
                { name: "Cross-functional leadership", rank: 2 },
                { name: "Accessibility", rank: 3 },
                { name: "Prototyping", rank: 4 },
              ],
              hardConstraints: {
                acceptableLocations: ["Remote — US"],
                workMode: "remote",
                salaryFloor: 185000,
              },
            },
          },
  };
  // --- Discovery snapshot: how many source lanes are armed --------------
  win.JobBoredDiscoveryPayload = {
    buildSearchPlan: () => ({
      facets: {
        sourceLanes:
          stubs.sourceLanes || [
            "serpapi_google_jobs",
            "grounded_web",
            "ats_provider",
          ],
      },
    }),
  };
  win.JobBoredEffectiveIntent = {
    buildEffectiveIntent: () =>
      stubs.intent || { targetRoles: ["Staff Product Designer"], includeKeywords: [] },
    isBlankIntent: (intent) =>
      typeof stubs.isBlankIntent === "function"
        ? stubs.isBlankIntent(intent)
        : !(intent && intent.targetRoles && intent.targetRoles.length),
  };
  // --- The one celebration ---------------------------------------------
  win.JobBoredOnboardingCelebration = {
    STAGES: { flow_payoff: {} },
    playOnboardingCelebration(onDone, stage) {
      calls.celebration.push(stage);
      if (typeof onDone === "function") onDone();
    },
  };

  vm.createContext(ctx);
  const files = [
    "user-content-store.js",
    "onboarding-telemetry.js",
    "discovery-wizard-shell.js",
    "onboarding-flow.js",
    "oneflow-beat-payoff.js",
  ];
  for (const file of files) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  return {
    window: win,
    document: doc,
    calls,
    config,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    shell: win.JobBoredDiscoveryWizard.shell,
    payoff: win.JobBoredOneFlowPayoff,
    events: doc._events,
  };
}

/**
 * A vm context has its OWN Array/Object intrinsics, so a value built
 * inside the sandbox is never deepStrictEqual to a literal out here even
 * when it is structurally identical. Round-trip it into this realm first.
 */
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Rendered-text helper: the flat textContent of a rendered tree. */
export function textOf(node) {
  return node ? String(node.textContent || "") : "";
}
