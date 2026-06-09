import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Anti-nag escape valve (#10).

   The setup bar is intentionally non-dismissible while either track is pending
   (only the session "Later" snooze hides it). But a user who genuinely won't
   finish shouldn't be nagged forever. After LATER_PERMANENT_THRESHOLD (3)
   "Later" presses — counted in localStorage, separate from the session snooze
   — the bar offers a confirmed permanent "Don't show again". The permanent
   #whatsNextDismiss control is NOT offered during setup (mandatory feel); the
   gated, confirmed escape is the only permanent out while setup is incomplete.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const whatsNextBannerJs = readFileSync(
  join(repoRoot, "whats-next-banner.js"),
  "utf8",
);
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");

function makeEl(id) {
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
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
    },
    addEventListener(type, fn) {
      this.__click = this.__click || [];
      if (type === "click") this.__click.push(fn);
    },
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
    __fireClick() {
      (this.__click || []).forEach((fn) => fn({}));
    },
  };
}

function loadBanner({ confirmResult = true } = {}) {
  const els = new Map();
  const region = makeEl("whats-next-region");
  const document = {
    readyState: "complete",
    body: makeEl("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    querySelector: (sel) =>
      sel === '[data-region="whats-next"]' ? region : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeEl("created"),
  };
  const mapStore = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });
  const localMap = new Map();
  const confirmCalls = [];
  const window = {
    JobBoredApp: {},
    sessionStorage: mapStore(new Map()),
    localStorage: mapStore(localMap),
    confirm: (msg) => {
      confirmCalls.push(msg);
      return confirmResult;
    },
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(whatsNextBannerJs, ctx, { filename: "whats-next-banner.js" });
  return {
    api: window.JobBoredApp.whatsNextBanner,
    window,
    document,
    region,
    localMap,
    confirmCalls,
    getButton: (id) => document.getElementById(id),
  };
}

function ucIncompleteSetup(dismissedWrites) {
  return {
    openDb: async () => {},
    isInfraSetupComplete: async () => true,
    getWhatsNextDismissed: async () => false,
    isOnboardingComplete: async () => true,
    isDiscoverySetupComplete: async () => false,
    isGoLiveSetupComplete: async () => false,
    setWhatsNextDismissed: async (v) => {
      if (dismissedWrites) dismissedWrites.push(v);
    },
  };
}

function wireHost(window, uc) {
  window.JobBoredApp.core = { host: { getUserContent: () => uc } };
}

// Pressing "Later" snoozes the bar for the rest of the session, so the gated
// "Don't show again" only surfaces on a LATER session (snooze cleared, the
// localStorage counter persisted). Simulate that next session.
function newSession(window) {
  window.sessionStorage.removeItem("jobbored.whatsNext.snoozed");
}

describe("whats-next-banner — anti-nag escape valve (#10)", () => {
  it("each 'Later' press increments a localStorage counter (separate from the session snooze)", () => {
    const env = loadBanner();
    wireHost(env.window, ucIncompleteSetup());
    env.api.handleLater();
    env.api.handleLater();
    assert.equal(
      env.localMap.get("jobbored.whatsNext.laterCount"),
      "2",
      "the persistent Later counter must survive sessions in localStorage",
    );
  });

  it("does NOT offer the permanent 'Don't show again' before the 3rd Later", async () => {
    const env = loadBanner();
    wireHost(env.window, ucIncompleteSetup());
    env.api.handleLater(); // count = 1
    env.api.handleLater(); // count = 2
    newSession(env.window);
    await env.api.refreshBanner();
    assert.equal(
      env.getButton("whatsNextDontShowAgain").hasAttribute("hidden"),
      true,
      "permanent dismiss must stay hidden until N Later presses",
    );
  });

  it("offers the permanent 'Don't show again' once Later has been pressed 3 times", async () => {
    const env = loadBanner();
    wireHost(env.window, ucIncompleteSetup());
    env.getButton("whatsNextDontShowAgain").setAttribute("hidden", "hidden");
    env.api.handleLater();
    env.api.handleLater();
    env.api.handleLater(); // count = 3 → threshold reached
    newSession(env.window);
    await env.api.refreshBanner();
    assert.equal(
      env.getButton("whatsNextDontShowAgain").hasAttribute("hidden"),
      false,
      "permanent dismiss must be revealed at the threshold",
    );
  });

  it("the permanent #whatsNextDismiss is NOT offered while setup is incomplete (mandatory feel)", async () => {
    const env = loadBanner();
    wireHost(env.window, ucIncompleteSetup());
    env.getButton("whatsNextDismiss").removeAttribute("hidden");
    await env.api.refreshBanner();
    assert.equal(
      env.getButton("whatsNextDismiss").hasAttribute("hidden"),
      true,
      "the always-on permanent dismiss must be hidden during setup",
    );
  });

  it("confirming 'Don't show again' writes the permanent flag and hides the bar", async () => {
    const dismissedWrites = [];
    const env = loadBanner({ confirmResult: true });
    wireHost(env.window, ucIncompleteSetup(dismissedWrites));
    await env.api.refreshBanner();
    await env.api.handlePermanentDismiss();
    assert.equal(env.confirmCalls.length, 1, "must ask for explicit confirmation");
    assert.deepEqual(
      dismissedWrites,
      [true],
      "confirmed dismiss must persist whatsNextDismissed=true",
    );
    assert.equal(env.api.isBannerVisible(), false, "bar hides after permanent dismiss");
  });

  it("cancelling 'Don't show again' does NOT dismiss (no permanent write)", async () => {
    const dismissedWrites = [];
    const env = loadBanner({ confirmResult: false });
    wireHost(env.window, ucIncompleteSetup(dismissedWrites));
    await env.api.refreshBanner();
    await env.api.handlePermanentDismiss();
    assert.equal(env.confirmCalls.length, 1);
    assert.equal(
      dismissedWrites.length,
      0,
      "a cancelled confirm must NOT write the permanent dismiss flag",
    );
  });

  it("index.html defines the #whatsNextDontShowAgain control", () => {
    assert.match(indexHtml, /id="whatsNextDontShowAgain"/);
  });
});
