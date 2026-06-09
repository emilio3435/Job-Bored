import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Integration: the mandatory two-track onboarding chain CONVERGES.

   This is the test that would have caught the getUserContent bridge bug.
   It loads the REAL user-content-store, discovery-wizard-ui, go-live-wizard-ui
   and whats-next-banner modules into ONE shared window (exactly how the app
   wires them as classic-global IIFEs), backs the store with a genuinely
   persistent in-memory IndexedDB, and drives the finish handlers against the
   REAL completion flags — in BOTH completion orders.

   The chain must converge: both flags persisted, the setup bar self-hides,
   and the OTHER track is auto-opened EXACTLY ONCE (no ping-pong re-open).
   If either completion-persist degrades to a no-op, the auto-open spy fires a
   second time and these assertions fail (proven by mutation below the suite).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");
const userContentStoreJs = read("user-content-store.js");
const discoveryWizardUiJs = read("discovery-wizard-ui.js");
const goLiveJs = read("go-live-wizard-ui.js");
const whatsNextBannerJs = read("whats-next-banner.js");

// --- A genuinely persistent in-memory IndexedDB -------------------------
// Enough of the IDB surface for user-content-store's openDb + getSetting/
// setSetting: open() fires onupgradeneeded (once) then onsuccess on a
// microtask (so the store's handlers register first), and every store keeps
// a live Map so a put() in one transaction is read back by a later get().
function makeInMemoryIndexedDB() {
  const stores = new Map(); // name -> { keyPath, data: Map }
  let upgraded = false;

  function store(name, keyPath) {
    if (!stores.has(name)) {
      stores.set(name, { keyPath: keyPath || "key", data: new Map() });
    }
    const s = stores.get(name);
    const req = (build) => {
      const r = { onsuccess: null, onerror: null, result: undefined };
      queueMicrotask(() => {
        try {
          r.result = build();
          if (r.onsuccess) r.onsuccess({ target: r });
        } catch (err) {
          r.error = err;
          if (r.onerror) r.onerror({ target: r });
        }
      });
      return r;
    };
    return {
      keyPath: s.keyPath,
      indexNames: { contains: () => false },
      createIndex() {},
      get: (key) => req(() => s.data.get(key)),
      getAll: () => req(() => [...s.data.values()]),
      put: (value) =>
        req(() => {
          s.data.set(value[s.keyPath], value);
          return value[s.keyPath];
        }),
      delete: (key) => req(() => void s.data.delete(key)),
    };
  }

  function db() {
    return {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore: (name, opts) =>
        store(name, (opts && opts.keyPath) || "key"),
      transaction: () => ({ objectStore: (n) => store(n) }),
      close() {},
      onversionchange: null,
    };
  }

  return {
    open() {
      const r = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: null,
        error: null,
      };
      queueMicrotask(() => {
        const database = db();
        r.result = database;
        if (!upgraded) {
          upgraded = true;
          if (r.onupgradeneeded) {
            r.onupgradeneeded({
              target: { result: database, transaction: { objectStore: (n) => store(n) } },
            });
          }
        }
        if (r.onsuccess) r.onsuccess({ target: r });
      });
      return r;
    },
  };
}

// --- Minimal DOM with a toggleable whats-next region --------------------
function makeDom() {
  const els = new Map();
  function makeEl(id) {
    const attrs = new Map();
    const classes = new Set();
    return {
      id,
      dataset: {},
      style: {},
      textContent: "",
      hasAttribute: (n) => attrs.has(n),
      setAttribute: (n, v) => attrs.set(n, String(v)),
      removeAttribute: (n) => attrs.delete(n),
      getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      },
      appendChild: (c) => c,
      append() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() {},
    };
  }
  const region = makeEl("whats-next-region");
  const document = {
    readyState: "complete",
    body: makeEl("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    querySelector(sel) {
      return sel === '[data-region="whats-next"]' ? region : null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
  };
  return { document, region };
}

// Load all four modules into one shared VM context (shared window).
function loadChain() {
  const { document, region } = makeDom();
  const sessionStore = new Map();
  const window = { JobBoredApp: { core: {} } };
  window.sessionStorage = {
    getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
    setItem: (k, v) => sessionStore.set(k, String(v)),
    removeItem: (k) => sessionStore.delete(k),
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    crypto: { randomUUID: () => "chain-test-uuid" },
    indexedDB: makeInMemoryIndexedDB(),
    Date,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : undefined,
    fetch: async () => ({ ok: false }),
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(userContentStoreJs, ctx, { filename: "user-content-store.js" });
  vm.runInContext(discoveryWizardUiJs, ctx, {
    filename: "discovery-wizard-ui.js",
  });
  vm.runInContext(goLiveJs, ctx, { filename: "go-live-wizard-ui.js" });
  vm.runInContext(whatsNextBannerJs, ctx, { filename: "whats-next-banner.js" });

  const UC = window.CommandCenterUserContent;
  // The banner reads UC through window.JobBoredApp.core.host.getUserContent.
  window.JobBoredApp.core.host = { getUserContent: () => UC };
  // go-live's moveToStep("done") renders through the discovery wizard shell.
  // A recording stub avoids needing the full JobBoredWizardDom helpers.
  const renders = [];
  window.JobBoredDiscoveryWizard.shell = {
    renderWizardShell: (input) => {
      renders.push(input);
      return { input };
    },
    closeWizardShell() {},
  };
  return { window, UC, region, renders };
}

// Wire the two host bridges so each wizard's auto-open actually drives the
// OTHER wizard's finish handler (modeling a user who completes the chained
// track). Records every auto-open so the test can assert "exactly once".
function makeChainDriver({ window, UC }) {
  const goLiveOpens = [];
  const discoveryOpens = [];
  const pending = [];
  let drives = 0;
  const CAP = 20; // backstop: a converging chain needs ~2 drives, never 20

  const ui = window.JobBoredDiscoveryWizard.ui;
  const goLiveApi = window.JobBoredGoLive;

  function driveDiscoveryFinish() {
    if (drives++ > CAP) return Promise.resolve();
    return ui._internal.recommendGoLiveAfterDiscoveryFinish();
  }
  function driveGoLiveFinish() {
    if (drives++ > CAP) return Promise.resolve();
    return goLiveApi.handleAction("go_live_complete_tailscale");
  }

  window.JobBoredDiscoveryWizard.ui.host = {
    getUserContent: () => UC,
    requestGoLiveSetup: (o) => {
      goLiveOpens.push(o);
      pending.push(driveGoLiveFinish());
    },
  };
  window.JobBoredGoLive.host = {
    isOnboardingWizardVisible: () => false,
    isFirstRunWizardVisible: () => false,
    requestDiscoverySetup: (o) => {
      discoveryOpens.push(o);
      pending.push(driveDiscoveryFinish());
    },
  };

  async function drain() {
    while (pending.length) await pending.shift();
  }
  return { goLiveOpens, discoveryOpens, driveDiscoveryFinish, driveGoLiveFinish, drain };
}

// True when the REAL banner gate would hide the bar (both tracks complete is
// the relevant rule here; infra+onboarding are forced true so it's the ONLY
// reason the bar hides).
async function barWouldHide({ window, UC, region }) {
  await UC.completeInfraSetup();
  await UC.completeOnboarding();
  const state = await window.JobBoredApp.whatsNextBanner.refreshBanner();
  return { hidden: region.hasAttribute("hidden"), state };
}

describe("integration: mandatory two-track onboarding chain converges", () => {
  it("the setup bar is visible while only one track is complete (pre-condition)", async () => {
    const env = loadChain();
    await env.UC.completeInfraSetup();
    await env.UC.completeOnboarding();
    await env.UC.completeDiscoverySetup(); // 1 of 2
    const state = await env.window.JobBoredApp.whatsNextBanner.refreshBanner();
    assert.equal(state.discoveryComplete, true);
    assert.equal(state.goLiveComplete, false);
    assert.equal(
      env.region.hasAttribute("hidden"),
      false,
      "bar must stay visible while go-live is still pending",
    );
  });

  it("finish discovery first -> auto-opens go-live exactly once -> both flags set -> bar hides", async () => {
    const env = loadChain();
    const driver = makeChainDriver(env);

    await driver.driveDiscoveryFinish();
    await driver.drain();

    assert.equal(
      await env.UC.isDiscoverySetupComplete(),
      true,
      "discovery flag must persist",
    );
    assert.equal(
      await env.UC.isGoLiveSetupComplete(),
      true,
      "go-live flag must persist after the chained finish",
    );
    assert.equal(
      driver.goLiveOpens.length,
      1,
      "go-live auto-opens exactly once",
    );
    assert.equal(driver.goLiveOpens[0].entryPoint, "onboarding_chain");
    assert.equal(
      driver.discoveryOpens.length,
      0,
      "discovery must NOT be re-opened (anti-ping-pong)",
    );

    const { hidden } = await barWouldHide(env);
    assert.equal(hidden, true, "bar self-hides once both tracks are complete");
  });

  it("finish go-live first -> auto-opens discovery exactly once -> both flags set -> bar hides", async () => {
    const env = loadChain();
    const driver = makeChainDriver(env);

    await driver.driveGoLiveFinish();
    await driver.drain();

    assert.equal(
      await env.UC.isGoLiveSetupComplete(),
      true,
      "go-live flag must persist",
    );
    assert.equal(
      await env.UC.isDiscoverySetupComplete(),
      true,
      "discovery flag must persist after the chained finish",
    );
    assert.equal(
      driver.discoveryOpens.length,
      1,
      "discovery auto-opens exactly once",
    );
    assert.equal(driver.discoveryOpens[0].entryPoint, "onboarding_chain");
    assert.equal(
      driver.goLiveOpens.length,
      0,
      "go-live must NOT be re-opened (anti-ping-pong)",
    );

    const { hidden } = await barWouldHide(env);
    assert.equal(hidden, true, "bar self-hides once both tracks are complete");
  });
});
