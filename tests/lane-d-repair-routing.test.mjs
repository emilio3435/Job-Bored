import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { loadCutover, settle } from "./oneflow-l6-harness.mjs";

/* ============================================================
   LANE D — repair routing: failures open the beat that owns them.

   D1 · A sign-in gate opened by a FAILURE (expired session, dead
       restore — the callers that pass a {title, detail} override)
       offers "Fix sign-in": the one-flow's Google beat with
       returnTo:"close". When the flow module never loaded, the
       click falls back to the current behavior (the GIS popup).
       The plain signed-out gate is untouched — one primary.

   D2 · The what's-next banner's discovery nudge (incomplete or
       broken discovery) delegates to the shared
       setupModals.openDiscoverySetupBeat helper (OneFlow-first,
       returnTo:"close"), and only falls back to the legacy
       requestDiscoverySetup chain when the helper is absent. The
       banner itself never touches the flow controller (L0).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX_BTN = "sheetAccessGateFixSignInBtn";
const SESSION_ENDED = {
  title: "Your Google session ended",
  detail: "Sign in again to pick up where you left off.",
};

function fixButton(env) {
  return env.document
    .getElementById("sheetAccessGateScreen")
    .querySelector("#" + FIX_BTN);
}

function openGateOnFailure(env) {
  env.setup.showSheetAccessGate("signin", { ...SESSION_ENDED });
}

describe("lane D · D1 — the failed sign-in gate offers 'Fix sign-in'", () => {
  it("renders 'Fix sign-in' when the gate names a session failure", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    openGateOnFailure(env);
    await settle();

    const btn = fixButton(env);
    assert.ok(btn, "the repair action must be rendered on a sign-in failure");
    assert.notEqual(btn.hidden, true, "…and visible");
    assert.equal(btn.textContent, "Fix sign-in");
  });

  it("does NOT offer it on the plain signed-out gate (one primary there)", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    env.setup.showSheetAccessGate("signin");
    await settle();

    const btn = fixButton(env);
    assert.ok(!btn || btn.hidden === true);
  });

  it("clicking it opens Beat 1 with returnTo: close", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    openGateOnFailure(env);
    await settle();
    const openCalls = [];
    env.window.JobBoredOneFlow = {
      open(beatId, options) {
        openCalls.push([beatId, options]);
        return Promise.resolve(true);
      },
    };

    fixButton(env).dispatch("click");
    await settle();

    assert.equal(openCalls.length, 1, "the flow is opened exactly once");
    assert.equal(openCalls[0][0], "google", "Beat 1 owns sign-in repair");
    assert.equal(
      openCalls[0][1] && openCalls[0][1].returnTo,
      "close",
      "a repair deep link closes where it opened",
    );
    assert.notEqual(
      env.document.getElementById("sheetAccessGateScreen").style.display,
      "flex",
      "the gate stands down for the beat",
    );
    assert.ok(
      !env.called().includes("signIn"),
      "the bare popup must not fire when the flow takes it",
    );
  });

  it("the real flow lands on the google beat", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    openGateOnFailure(env);
    await settle();

    fixButton(env).dispatch("click");
    await settle();

    assert.equal(env.openBeat(), "google");
  });

  it("falls back to the GIS sign-in when the flow module never loaded", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    openGateOnFailure(env);
    await settle();
    delete env.window.JobBoredOneFlow;

    fixButton(env).dispatch("click");
    await settle();

    assert.ok(
      env.called().includes("signIn"),
      "an absent flow falls back to the current sign-in behavior",
    );
  });

  it("falls back to the GIS sign-in when the flow open rejects", async () => {
    const env = loadCutover({ sheetId: "SHEET_1", signedIn: false });
    openGateOnFailure(env);
    await settle();
    env.window.JobBoredOneFlow = {
      open() {
        return Promise.reject(new Error("shell blew up"));
      },
    };

    fixButton(env).dispatch("click");
    await settle();

    assert.ok(
      env.called().includes("signIn"),
      "a rejected open must not strand the repair behind a hidden gate",
    );
  });
});

/* ---------- D2 · the banner's discovery nudge ----------
   The banner must not touch the flow controller (oneflow-l0-wiring);
   it reaches Beat 5 through the shared setupModals.openDiscoverySetupBeat
   helper, falling back to the legacy chain when the helper is absent. */

const bannerSource = readFileSync(
  join(repoRoot, "whats-next-banner.js"),
  "utf8",
);
const setupModalsSource = readFileSync(
  join(repoRoot, "discovery-setup-modals.js"),
  "utf8",
);

function makeBannerEl(id) {
  const attrs = new Map();
  const classes = new Set();
  return {
    id,
    style: {},
    dataset: {},
    textContent: "",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    hasAttribute: (n) => attrs.has(n),
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
  };
}

function loadBanner({ setupModals = null, hostExtras = {}, globalSetup = null } = {}) {
  const els = new Map();
  const region = makeBannerEl("whats-next-region");
  const document = {
    readyState: "complete",
    body: makeBannerEl("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeBannerEl(id));
      return els.get(id);
    },
    querySelector: (sel) =>
      sel === '[data-region="whats-next"]' ? region : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeBannerEl("created"),
  };
  const store = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });
  const window = {
    JobBoredApp: {},
    sessionStorage: store(new Map()),
    localStorage: store(new Map()),
  };
  if (setupModals) window.JobBoredDiscovery = { setupModals };
  if (globalSetup) window.requestDiscoverySetup = globalSetup;
  const ctx = {
    window,
    document,
    console: { warn() {}, error() {}, log() {}, info() {} },
    setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(bannerSource, ctx, { filename: "whats-next-banner.js" });
  window.JobBoredApp.core = {
    host: { getUserContent: () => null, ...hostExtras },
  };
  return { api: window.JobBoredApp.whatsNextBanner, window };
}

describe("lane D · D2 — the broken-discovery nudge opens the discovery beat", () => {
  it("never touches the flow controller directly (oneflow-l0-wiring)", () => {
    assert.equal(
      bannerSource.includes("JobBoredOneFlow"),
      false,
      "the banner reaches Beat 5 through setupModals.openDiscoverySetupBeat",
    );
  });

  it("delegates to the shared beat opener instead of the legacy wizard", () => {
    const helperCalls = [];
    const legacyCalls = [];
    const env = loadBanner({
      setupModals: {
        openDiscoverySetupBeat(options) {
          helperCalls.push(options);
        },
      },
      hostExtras: {
        requestDiscoverySetup(options) {
          legacyCalls.push(options);
          return Promise.resolve({ deferred: false });
        },
      },
    });

    env.api.handleOpenDiscovery();

    assert.equal(helperCalls.length, 1, "the helper is called exactly once");
    assert.equal(
      helperCalls[0].entryPoint,
      "whats_next",
      "the banner's entry point survives the delegation",
    );
    assert.deepEqual(
      legacyCalls,
      [],
      "the legacy wizard must not fire when the helper exists",
    );
  });

  it("falls back to host.requestDiscoverySetup when the helper is absent", () => {
    const legacyCalls = [];
    const env = loadBanner({
      setupModals: null,
      hostExtras: {
        requestDiscoverySetup(options) {
          legacyCalls.push(options);
          return Promise.resolve({ deferred: false });
        },
      },
    });

    env.api.handleOpenDiscovery();
    assert.equal(legacyCalls.length, 1, "the legacy path stays reachable");
    assert.equal(legacyCalls[0].entryPoint, "whats_next");

    // A present namespace without the helper is the same absence.
    env.window.JobBoredDiscovery = {};
    env.api.handleOpenDiscovery();
    assert.equal(legacyCalls.length, 2);
  });

  it("falls through to the legacy chain when the helper throws", () => {
    const legacyCalls = [];
    const env = loadBanner({
      setupModals: {
        openDiscoverySetupBeat() {
          throw new Error("half-loaded setupModals");
        },
      },
      hostExtras: {
        requestDiscoverySetup(options) {
          legacyCalls.push(options);
          return Promise.resolve({ deferred: false });
        },
      },
    });

    env.api.handleOpenDiscovery();

    assert.equal(
      legacyCalls.length,
      1,
      "a broken helper must not strand the nudge",
    );
  });

  it("keeps the window-level fallback when the host cannot open setup", () => {
    const globalCalls = [];
    const env = loadBanner({
      setupModals: null,
      hostExtras: {},
      globalSetup(options) {
        globalCalls.push(options);
        return Promise.resolve();
      },
    });

    env.api.handleOpenDiscovery();

    assert.equal(globalCalls.length, 1);
    assert.equal(globalCalls[0].entryPoint, "whats_next");
  });
});

function loadSetupModalsHelper({ oneFlow = null } = {}) {
  const window = {};
  if (oneFlow) window.JobBoredOneFlow = oneFlow;
  const hostCalls = [];
  const ctx = {
    window,
    document: { getElementById: () => null },
    console: { warn() {}, error() {}, log() {}, info() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(setupModalsSource, ctx, {
    filename: "discovery-setup-modals.js",
  });
  const setupModals = window.JobBoredDiscovery.setupModals;
  setupModals.host = {
    requestDiscoverySetup(options) {
      hostCalls.push(options);
      return Promise.resolve({ deferred: false });
    },
  };
  return { setupModals, hostCalls };
}

describe("lane D · D2 — the shared openDiscoverySetupBeat helper", () => {
  // Flow-first and absent-flow fallback are covered behaviorally through
  // the real settings button in greenfield-c-drawer; these pin the two
  // branches only the helper owns.
  it("falls back with the caller's entryPoint when the flow open throws", () => {
    const openCalls = [];
    const { setupModals, hostCalls } = loadSetupModalsHelper({
      oneFlow: {
        open(beatId, options) {
          openCalls.push([beatId, options]);
          throw new Error("shell blew up");
        },
      },
    });

    setupModals.openDiscoverySetupBeat({ entryPoint: "whats_next" });

    assert.equal(openCalls.length, 1, "the flow is attempted first");
    assert.equal(openCalls[0][0], "discovery", "Beat 5 IS discovery setup");
    assert.equal(hostCalls.length, 1, "…then the legacy chain catches it");
    assert.equal(hostCalls[0].entryPoint, "whats_next");
    assert.equal(hostCalls[0].allowWhileOnboarding, true);
  });

  it("defaults entryPoint to settings when omitted", () => {
    const { setupModals, hostCalls } = loadSetupModalsHelper({
      oneFlow: null,
    });

    setupModals.openDiscoverySetupBeat();

    assert.equal(hostCalls.length, 1);
    assert.equal(hostCalls[0].entryPoint, "settings");
  });
});
