/* ============================================================
   Shared fakes for the ONEFLOW L3 (engine · B5) probes.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite — it is imported by tests/oneflow-l3-*.test.mjs.

   Two loaders:

     loadDiscoveryBeat() — the L0 substrate (store + telemetry + shell +
       controller) plus oneflow-beat-discovery.js, in index.html's load
       order, with an injectable `fetch` and an injectable
       window.JobBoredDiscoveryWizard.ui bridge. The beat is driven
       through the REAL shell, so "renders through the message slot" is
       asserted against rendered DOM, never against a spy.

     loadWizardUi() — discovery-wizard-ui.js alone (the standalone
       wizard repairs), mirroring tests/discovery-cross-rec.test.mjs's
       minimal context so the two harnesses agree.

   The DOM/IndexedDB fakes come from the L0 harness — one set of fakes
   for the whole program.
   ============================================================ */
import vm from "node:vm";
import {
  FakeCustomEvent,
  FakeNode,
  makeFakeDocument,
  makeFakeIndexedDb,
  readRepoFile,
} from "./oneflow-l0-harness.mjs";

export { readRepoFile };

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

/**
 * The B5 beat on top of the real substrate.
 *
 * `fetchImpl` answers the beat's own network calls (the SerpApi env write
 * and the worker restart). `wizardUi` stands in for the discovery wizard's
 * exported bridge — pass a stub to drive the connect panel without booting
 * the whole wizard module.
 */
export function loadDiscoveryBeat({ fetchImpl, wizardUi } = {}) {
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
  const fetchCalls = [];
  ctx.fetch = async (url, options = {}) => {
    fetchCalls.push({
      url: String(url),
      method: options.method || "GET",
      body: options.body || null,
    });
    if (typeof fetchImpl === "function") return fetchImpl(url, options);
    return { ok: false, json: async () => ({}) };
  };
  vm.createContext(ctx);
  for (const file of [
    "user-content-store.js",
    "onboarding-telemetry.js",
    "discovery-wizard-shell.js",
    "onboarding-flow.js",
  ]) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  // The beat reads the wizard bridge lazily, so the stub can be installed
  // after the shell has claimed the JobBoredDiscoveryWizard namespace.
  win.JobBoredDiscoveryWizard.ui = wizardUi || {};
  vm.runInContext(readRepoFile("oneflow-beat-discovery.js"), ctx, {
    filename: "oneflow-beat-discovery.js",
  });
  const mount = doc.getElementById("oneFlowMount");
  return {
    window: win,
    document: doc,
    mount,
    fetchCalls,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    shell: win.JobBoredDiscoveryWizard.shell,
    beat: win.JobBoredOneFlowBeatDiscovery,
    events: doc._events,
    /** Fire a shell action exactly as a footer button click would. */
    async act(actionId) {
      const context = win.JobBoredDiscoveryWizard.shell.lastRender.context;
      context.onAction(actionId, {});
      await win.JobBoredOneFlowBeatDiscovery._internal.whenIdle();
    },
    button(actionId) {
      return mount.querySelector(`[data-action-id="${actionId}"]`);
    },
    text() {
      return mount.textContent;
    },
  };
}

/**
 * A host bridge with the calls a probe cares about spelled out, and a
 * harmless `() => ({})` for the rest. discovery-wizard-ui.js reaches into
 * ~90 app.js helpers to paint one wizard; enumerating all of them would
 * make every probe a maintenance tax on app.js. Anything a probe ASSERTS
 * on is always an explicit override — the fallback only keeps the render
 * path from throwing.
 */
export function makeWizardHost(overrides = {}) {
  return new Proxy(
    { ...overrides },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "symbol") return undefined;
        return () => ({});
      },
      has() {
        return true;
      },
    },
  );
}

/** discovery-wizard-ui.js alone, with a stubbed host bridge. */
export function loadWizardUi() {
  const win = {};
  const ctx = {
    // app-compat.js publishes these as bare globals on the page; the module
    // reads them unqualified, so the sandbox has to supply them too.
    getDiscoveryWizardDefaultDrafts: () => ({}),
    getDiscoveryWizardRuntime: () => {
      const host =
        win.JobBoredDiscoveryWizard &&
        win.JobBoredDiscoveryWizard.ui &&
        win.JobBoredDiscoveryWizard.ui.host;
      return host && host.getDiscoveryWizardRuntime
        ? host.getDiscoveryWizardRuntime()
        : {};
    },
    window: win,
    document: {
      createElement: () => ({
        appendChild() {},
        setAttribute() {},
        addEventListener() {},
        style: {},
      }),
      createTextNode: () => ({}),
      body: { appendChild() {}, removeChild() {} },
      getElementById: () => null,
    },
    console: {
      warn(...a) {
        if (process.env.ONEFLOW_DEBUG) console.log("WARN", ...a);
      },
      error() {},
      log() {},
    },
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-wizard-ui.js"), ctx, {
    filename: "discovery-wizard-ui.js",
  });
  return { window: win, ui: win.JobBoredDiscoveryWizard.ui };
}
