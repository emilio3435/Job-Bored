import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Go-live honest exits (ONE-FLOW-ONBOARDING-SPEC §6, §10 Phase 0).

   WHY: the go-live wizard is the tail of the mandatory two-track
   onboarding, and it had no honest way out. A single-device user was
   nudged forever by a banner they could never satisfy; a cloud deploy
   whose `no-cors` probe failed — which it does for reasons that say
   nothing about whether the URL is up, because an opaque response
   carries no status — left Finish permanently disabled; and the
   Tailscale ready step made "Verify" the primary even though verifying
   is optional and finishing is the step. Each of these is a dead end,
   which is the exact defect this spec exists to remove.

   The DOM harness is the go-live wizard's own (tests/go-live-wizard.test.mjs)
   so both suites agree on what the wizard renders.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const goLiveJs = readFileSync(join(repoRoot, "go-live-wizard-ui.js"), "utf8");
const bannerJs = readFileSync(join(repoRoot, "whats-next-banner.js"), "utf8");

function makeEl(tagName) {
  const children = [];
  const attrs = new Map();
  const classes = new Set();
  return {
    tagName: String(tagName || "div").toLowerCase(),
    children,
    attrs,
    dataset: {},
    style: {},
    textContent: "",
    value: "",
    get className() {
      return [...classes].join(" ");
    },
    set className(v) {
      classes.clear();
      String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    append(...a) {
      a.forEach((x) => children.push(x));
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    },
    removeAttribute: (n) => attrs.delete(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    _findAll(pred) {
      const out = [];
      if (pred(this)) out.push(this);
      for (const c of children) {
        if (c && typeof c._findAll === "function") out.push(...c._findAll(pred));
      }
      return out;
    },
    _text() {
      return (
        String(this.textContent || "") +
        children.map((c) => (c && c._text ? c._text() : "")).join(" ")
      );
    },
  };
}

function loadGoLive({ fetchImpl, uc, host } = {}) {
  const document = {
    readyState: "complete",
    body: makeEl("body"),
    getElementById: () => makeEl("div"),
    createElement: (tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const shell = {
    lastRender: null,
    renderWizardShell(input) {
      const bodies = {};
      for (const step of input.steps || []) {
        if (typeof step.body === "function") bodies[step.id] = step.body();
      }
      shell.lastRender = { input, bodies };
      return shell.lastRender;
    },
    closeWizardShell() {},
  };
  const window = {
    JobBoredApp: { core: { host: {} } },
    JobBoredDiscoveryWizard: { shell },
    JobBoredWizardDom: null,
    JobBoredGoLive: { host: host || null },
    CommandCenterUserContent: uc || null,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : null,
  };
  const ctx = {
    window,
    document,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : undefined,
    fetch: fetchImpl || (async () => ({ ok: true })),
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(goLiveJs, ctx, { filename: "go-live-wizard-ui.js" });
  return { api: window.JobBoredGoLive, window, shell };
}

/** The action list the shell would render for one step. */
function actionsFor(api, stepId) {
  const steps = api.buildGoLiveWizardSteps(api._internal.getRuntime());
  const step = steps.find((s) => s.id === stepId);
  assert.ok(step, `no step "${stepId}"`);
  return (step.actions || []).map((a) => ({
    id: a.id,
    label: a.label,
    variant: a.variant,
    disabled: !!a.disabled,
  }));
}

describe("single-device exit — 'I only use JobBored on this computer' (spec §6)", () => {
  it("path_select offers it as a first-class third answer, not fine print", async () => {
    const { api, shell } = loadGoLive();
    await api.openGoLiveSetupWizard();
    const body = shell.lastRender.bodies.path_select;
    const control = body._findAll(
      (n) => n.dataset && n.dataset.actionId === "go_live_only_this_computer",
    );
    assert.equal(control.length, 1, "exactly one single-device answer");
    assert.equal(
      String(control[0].textContent).trim(),
      "I only use JobBored on this computer",
      "spec §6 names this answer — ship the string",
    );
    assert.equal(
      control[0].dataset.wizardAction,
      "action",
      "it dispatches through the shell like every other choice",
    );
  });

  it("choosing it writes goLiveSetupSkipped and closes the wizard", async () => {
    const writes = [];
    const closes = [];
    const { api, window } = loadGoLive({
      uc: {
        setGoLiveSetupSkipped: async () => writes.push("goLiveSetupSkipped"),
        isDiscoverySetupComplete: async () => true,
      },
    });
    window.JobBoredDiscoveryWizard.shell.closeWizardShell = (r) => closes.push(r);
    await api.openGoLiveSetupWizard();
    await api.handleAction("go_live_only_this_computer");
    assert.deepEqual(writes.join(","), "goLiveSetupSkipped");
    assert.equal(closes.length, 1, "the answer ends the wizard — it is an exit");
  });

  it("refreshes the banner so the nudge disappears in the same click", async () => {
    const refreshes = [];
    const { api, window } = loadGoLive({
      uc: { setGoLiveSetupSkipped: async () => {} },
    });
    window.JobBoredApp.whatsNextBanner = {
      refreshBanner: async () => refreshes.push(1),
    };
    await api.openGoLiveSetupWizard();
    await api.handleAction("go_live_only_this_computer");
    assert.equal(refreshes.length, 1);
  });

  it("still exits cleanly when the store cannot record the answer", async () => {
    const closes = [];
    const { api, window } = loadGoLive({
      uc: {
        setGoLiveSetupSkipped: async () => {
          throw new Error("IndexedDB blocked");
        },
      },
    });
    window.JobBoredDiscoveryWizard.shell.closeWizardShell = (r) => closes.push(r);
    await api.openGoLiveSetupWizard();
    await api.handleAction("go_live_only_this_computer");
    assert.equal(closes.length, 1, "bookkeeping must never trap the user");
  });
});

describe("cloud path — a failed no-cors probe warns, it does not block (spec §10 Phase 0)", () => {
  async function cloudWithVerify(verify) {
    const { api } = loadGoLive();
    await api.openGoLiveSetupWizard();
    api._internal.updateRuntime({
      cloudPath: "cloud",
      cloudUrl: "https://my-dashboard.vercel.app",
      cloudVerify: verify,
    });
    return api;
  }

  it("leaves 'I added it to Google OAuth — finish' enabled after a failed probe", async () => {
    const api = await cloudWithVerify({ ok: false, reason: "TypeError: Failed to fetch" });
    const finish = actionsFor(api, "cloud").find(
      (a) => a.id === "go_live_complete_cloud",
    );
    assert.ok(finish, "the finish action exists");
    assert.equal(
      finish.disabled,
      false,
      "an opaque no-cors response carries no status — it cannot prove the URL is down",
    );
  });

  it("keeps finish enabled before any probe has run at all", async () => {
    const api = await cloudWithVerify(null);
    const finish = actionsFor(api, "cloud").find(
      (a) => a.id === "go_live_complete_cloud",
    );
    assert.equal(finish.disabled, false);
  });

  it("still SAYS the probe failed — enabled is not the same as silent", async () => {
    const { api, shell } = loadGoLive();
    await api.openGoLiveSetupWizard();
    api._internal.updateRuntime({
      cloudPath: "cloud",
      cloudUrl: "https://my-dashboard.vercel.app",
      cloudVerify: { ok: false, reason: "TypeError: Failed to fetch" },
    });
    api.renderGoLiveSetupWizard();
    const text = shell.lastRender.bodies.cloud._text();
    assert.match(
      text,
      /couldn't confirm|browser can't read|can't be read/i,
      "the honest warning has to name why the check is inconclusive",
    );
    assert.match(
      text,
      /open it in a new tab|check it yourself|try the URL/i,
      "spec §8.4 — every error names the next action",
    );
  });

  it("still requires a URL before offering to verify one", async () => {
    const api = await cloudWithVerify(null);
    api._internal.updateRuntime({ cloudUrl: "" });
    const verify = actionsFor(api, "cloud").find(
      (a) => a.id === "wizard_cloud_verify",
    );
    assert.equal(verify.disabled, true, "verifying nothing is still nothing");
  });
});

describe("Tailscale ready step — finish is the primary (spec §10 Phase 0)", () => {
  async function readyStep() {
    const { api } = loadGoLive();
    await api.openGoLiveSetupWizard();
    api._internal.updateRuntime({
      cloudPath: "tailscale",
      tailscaleState: {
        installed: true,
        loggedIn: true,
        serving: { 8080: true },
        recommendation: "ready",
        dnsName: "laptop.tail1234.ts.net",
      },
      installDoctor: { ok: true, tools: {} },
    });
    return api;
  }

  it("finish is primary and verify is secondary — the step is finishing, not verifying", async () => {
    const api = await readyStep();
    const actions = actionsFor(api, "tailscale");
    assert.deepEqual(
      actions.map((a) => `${a.id}:${a.variant}`).join(","),
      "go_live_complete_tailscale:primary,wizard_tailscale_verify:secondary",
    );
  });

  it("keeps both labels verbatim", async () => {
    const api = await readyStep();
    const actions = actionsFor(api, "tailscale");
    assert.equal(actions[0].label, "I added it to Google OAuth — finish");
    assert.equal(actions[1].label, "Verify URL is reachable");
  });

  it("leaves the non-ready recommendations alone", async () => {
    const { api } = loadGoLive();
    await api.openGoLiveSetupWizard();
    api._internal.updateRuntime({
      tailscaleState: {
        installed: true,
        loggedIn: true,
        serving: {},
        recommendation: "needs_serve",
      },
      installDoctor: { ok: true },
    });
    const actions = actionsFor(api, "tailscale");
    assert.equal(
      actions[0].id,
      "wizard_tailscale_serve",
      "when something is blocking, the blocker is still the primary",
    );
  });
});

describe("done step — the discovery callout is conditional (spec §10 Phase 0)", () => {
  async function doneBody(discoveryCtaVisible) {
    const { api, shell } = loadGoLive();
    await api.openGoLiveSetupWizard();
    api._internal.updateRuntime({
      cloudPath: "cloud",
      cloudUrl: "https://my-dashboard.vercel.app",
      _discoveryCtaVisible: discoveryCtaVisible,
    });
    api.renderGoLiveSetupWizard();
    return shell.lastRender.bodies.done._text();
  }

  it("recommends discovery only while discovery is incomplete", async () => {
    assert.match(await doneBody(true), /turn on job discovery/i);
  });

  it("says nothing about discovery once it is already on", async () => {
    // Recommending a step the user finished is the "Task #6" class of
    // fossil the spec's §7 deletions table exists to end.
    const text = await doneBody(false);
    assert.ok(
      !/turn on job discovery/i.test(text),
      "a completed track must not be recommended back at the user",
    );
    assert.match(text, /reachable from other devices/i, "the real receipt stays");
  });
});

/** whats-next-banner.js in a sandbox, driven by a stubbed content store. */
function loadBanner(flags) {
  const els = new Map();
  const makeNode = (id) => {
    const attrs = new Map();
    const classes = new Set();
    return {
      id,
      attrs,
      textContent: "",
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      setAttribute: (n, v) => attrs.set(n, String(v)),
      removeAttribute: (n) => attrs.delete(n),
      getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
      hasAttribute: (n) => attrs.has(n),
      addEventListener() {},
      removeEventListener() {},
      appendChild() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      focus() {},
    };
  };
  const region = makeNode("region");
  const document = {
    readyState: "complete",
    body: makeNode("body"),
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeNode(id));
      return els.get(id);
    },
    querySelector: (sel) =>
      sel === '[data-region="whats-next"]' ? region : null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => makeNode("created"),
  };
  const mapStore = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  };
  const UC = {
    openDb: async () => {},
    isInfraSetupComplete: async () => true,
    getWhatsNextDismissed: async () => false,
    isOnboardingComplete: async () => true,
    isDiscoverySetupComplete: async () => !!flags.discoveryComplete,
    isGoLiveSetupComplete: async () => !!flags.goLiveComplete,
    isDiscoverySetupSkipped: async () => !!flags.discoverySkipped,
  };
  if (!flags.storeWithoutGetter) {
    UC.isGoLiveSetupSkipped = async () => !!flags.goLiveSkipped;
  }
  if (flags.getterThrows) {
    UC.isGoLiveSetupSkipped = async () => {
      throw new Error("IndexedDB blocked");
    };
  }
  const window = {
    JobBoredApp: {
      core: { host: { isSignedIn: () => true, getUserContent: () => UC } },
    },
    sessionStorage: mapStore(),
    localStorage: mapStore(),
    confirm: () => true,
  };
  const ctx = {
    window,
    document,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(bannerJs, ctx, { filename: "whats-next-banner.js" });
  return {
    api: window.JobBoredApp.whatsNextBanner,
    region,
    el: (id) => document.getElementById(id),
    isVisible: () => !region.hasAttribute("hidden"),
  };
}

describe("whats-next banner — the single-device answer quiets it (spec §6)", () => {
  it("hides the go-live CTA once the user says they only use this computer", async () => {
    const env = loadBanner({ discoveryComplete: false, goLiveSkipped: true });
    await env.api.refreshBanner();
    assert.equal(
      env.el("whatsNextOpenSelfHosting").hasAttribute("hidden"),
      true,
      "the row stops asking a question the user answered",
    );
    assert.equal(
      env.el("whatsNextOpenDiscovery").hasAttribute("hidden"),
      false,
      "discovery is still incomplete, so its row keeps nudging",
    );
    assert.equal(env.isVisible(), true, "the bar stays up for the unfinished track");
  });

  it("resolves the whole bar when discovery is done and the user is single-device", async () => {
    const env = loadBanner({ discoveryComplete: true, goLiveSkipped: true });
    await env.api.refreshBanner();
    assert.equal(
      env.isVisible(),
      false,
      "spec §6 — the single-device answer permanently quiets the banner",
    );
  });

  it("keeps nudging when nothing has been answered", async () => {
    const env = loadBanner({ discoveryComplete: true, goLiveSkipped: false });
    await env.api.refreshBanner();
    assert.equal(env.isVisible(), true);
    assert.equal(
      env.el("whatsNextOpenSelfHosting").hasAttribute("hidden"),
      false,
    );
  });

  it("does NOT let the discovery skip resolve its own row — that track is mandatory", async () => {
    // The two skips are different facts. Discovery's stays a nudge on
    // purpose; treating it as completion is the gate this spec deletes.
    const env = loadBanner({
      discoveryComplete: false,
      discoverySkipped: true,
      goLiveComplete: true,
    });
    await env.api.refreshBanner();
    assert.equal(env.isVisible(), true);
    assert.equal(
      env.el("whatsNextOpenDiscovery").hasAttribute("hidden"),
      false,
      "a skipped-but-incomplete discovery keeps its CTA",
    );
  });

  it("degrades to 'not skipped' on a store that has never heard of the flag", async () => {
    const env = loadBanner({
      discoveryComplete: true,
      storeWithoutGetter: true,
    });
    await env.api.refreshBanner();
    assert.equal(env.isVisible(), true, "an older profile is not silently resolved");
  });

  it("degrades to 'not skipped' when the read throws", async () => {
    const env = loadBanner({ discoveryComplete: true, getterThrows: true });
    await env.api.refreshBanner();
    assert.equal(env.isVisible(), true, "a blocked read must not hide the nudge");
  });
});

describe("user-content-store — the goLiveSetupSkipped flag", () => {
  const storeJs = readFileSync(join(repoRoot, "user-content-store.js"), "utf8");

  it("adds exactly the getter and setter, beside its discovery sibling", () => {
    assert.match(storeJs, /async function isGoLiveSetupSkipped\(\)/);
    assert.match(storeJs, /async function setGoLiveSetupSkipped\(\)/);
    assert.match(storeJs, /getSetting\("goLiveSetupSkipped"\)/);
    assert.match(storeJs, /setSetting\("goLiveSetupSkipped", true\)/);
  });

  it("exports both so the banner and the wizard can reach them", () => {
    assert.match(storeJs, /^\s{4}isGoLiveSetupSkipped,$/m);
    assert.match(storeJs, /^\s{4}setGoLiveSetupSkipped,$/m);
  });
});
