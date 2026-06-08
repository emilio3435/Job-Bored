import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const goLiveJs = readFileSync(
  join(repoRoot, "go-live-wizard-ui.js"),
  "utf8",
);

// ============================================================
// FE-2: "Use JobBored on other devices" wizard. Two paths
// (Tailscale mesh vs. cloud deploy), shared shell, host bridge.
// ============================================================

// --- DOM + bridge harness ------------------------------------------------

function makeFakeDom() {
  // Minimal but useful: createElement returns a node with children, attrs,
  // dataset, classList, and an event-listener map; appendChild pushes;
  // setAttribute writes through to the attrs map. Body builders that use
  // these helpers produce inspectable trees.
  function makeEl(tagName) {
    const children = [];
    const attrs = new Map();
    const listeners = new Map();
    const classes = new Set();
    return {
      tagName: String(tagName || "div").toLowerCase(),
      children,
      attrs,
      listeners,
      dataset: {},
      style: {},
      textContent: "",
      _value: "",
      get value() {
        return this._value;
      },
      set value(v) {
        this._value = String(v == null ? "" : v);
      },
      get className() {
        return [...classes].join(" ");
      },
      set className(v) {
        classes.clear();
        String(v || "")
          .split(/\s+/)
          .filter(Boolean)
          .forEach((c) => classes.add(c));
      },
      classList: {
        add(c) {
          classes.add(c);
        },
        remove(c) {
          classes.delete(c);
        },
        contains(c) {
          return classes.has(c);
        },
        toggle(c) {
          classes.has(c) ? classes.delete(c) : classes.add(c);
        },
      },
      appendChild(child) {
        children.push(child);
        return child;
      },
      append(...args) {
        args.forEach((a) => children.push(a));
      },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name.startsWith("data-")) {
          const key = name
            .slice(5)
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      removeAttribute(name) {
        attrs.delete(name);
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      focus() {},
      // Recursive helper for tests to find descendants by predicate.
      _find(pred) {
        if (pred(this)) return this;
        for (const c of children) {
          if (c && typeof c._find === "function") {
            const hit = c._find(pred);
            if (hit) return hit;
          }
        }
        return null;
      },
      _findAll(pred) {
        const out = [];
        if (pred(this)) out.push(this);
        for (const c of children) {
          if (c && typeof c._findAll === "function") {
            out.push(...c._findAll(pred));
          }
        }
        return out;
      },
    };
  }

  const document = {
    readyState: "complete",
    body: makeEl("body"),
    getElementById() {
      return makeEl("div");
    },
    createElement(tag) {
      return makeEl(tag);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  return { document, makeEl };
}

function loadGoLive({
  fetchImpl,
  uc,
  host,
  shellApi,
  wizardDomOverride,
} = {}) {
  const { document, makeEl } = makeFakeDom();

  // Spy on calls into the shell.renderWizardShell + closeWizardShell.
  const renderCalls = [];
  const closeCalls = [];
  const defaultShell = {
    renderWizardShell(input) {
      renderCalls.push(input);
      // Eagerly run each step's body() in the captured input so tests can
      // inspect the rendered DOM tree by reading shell.lastRender.bodies.
      const bodies = {};
      for (const step of input.steps || []) {
        if (typeof step.body === "function") {
          try {
            bodies[step.id] = step.body();
          } catch (err) {
            bodies[step.id] = { _bodyError: err };
          }
        }
      }
      const lastRender = { input, bodies };
      defaultShell.lastRender = lastRender;
      return lastRender;
    },
    closeWizardShell(reason) {
      closeCalls.push(reason);
    },
    lastRender: null,
  };

  const shell = shellApi || defaultShell;

  // Minimal JobBoredWizardDom helpers — match FE-1's spec by signature.
  // Each helper appends to parent and returns the created node so the
  // tree is inspectable.
  const dom = wizardDomOverride || {
    createWizardNode(tag, className, text) {
      const el = makeEl(tag);
      if (className) el.className = className;
      if (text != null) el.textContent = String(text);
      return el;
    },
    appendWizardParagraph(parent, text, className) {
      const p = makeEl("p");
      p.className = className || "discovery-setup-wizard__copy";
      p.textContent = text;
      parent.appendChild(p);
      return p;
    },
    appendWizardList(parent, items) {
      const ul = makeEl("ul");
      ul.className = "discovery-setup-wizard__list";
      (items || []).filter(Boolean).forEach((item) => {
        const li = makeEl("li");
        li.textContent = String(item);
        ul.appendChild(li);
      });
      parent.appendChild(ul);
      return ul;
    },
    appendWizardCodeBlock(parent, text, copyLabel) {
      const row = makeEl("div");
      row.className = "scraper-setup-copyrow";
      const code = makeEl("pre");
      code.className = "scraper-setup-code";
      code.textContent = text;
      const btn = makeEl("button");
      btn.className = "btn-copy-scraper";
      btn.textContent = copyLabel || "Copy";
      row.appendChild(code);
      row.appendChild(btn);
      parent.appendChild(row);
      return row;
    },
    appendWizardInput(parent, opts) {
      const wrap = makeEl("div");
      wrap.className = "discovery-setup-wizard__inputrow";
      const input = makeEl("input");
      if (opts.id) input.id = opts.id;
      input.value = opts.value || "";
      input._onInput = opts.onInput;
      wrap.appendChild(input);
      parent.appendChild(wrap);
      return wrap;
    },
    appendWizardResultCard(parent, result, title) {
      const card = makeEl("div");
      card.className = `discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--${result && result.ok ? "ok" : "warn"}`;
      card.dataset.ok = result && result.ok ? "1" : "0";
      if (title) {
        const h = makeEl("h4");
        h.textContent = title;
        card.appendChild(h);
      }
      if (result && result.message) {
        const p = makeEl("p");
        p.textContent = result.message;
        card.appendChild(p);
      }
      parent.appendChild(card);
      return card;
    },
  };

  const window = {
    JobBoredApp: { core: { host: {} } },
    JobBoredDiscoveryWizard: { shell },
    JobBoredWizardDom: dom,
    JobBoredGoLive: {},
    CommandCenterUserContent: uc || null,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : null,
  };
  // The module reads host via window.JobBoredGoLive.host — populate it
  // before running.
  window.JobBoredGoLive.host = host || null;

  const fetchSpy = fetchImpl || (async () => ({ ok: false }));
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : undefined,
    fetch: fetchSpy,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(goLiveJs, ctx, { filename: "go-live-wizard-ui.js" });
  return {
    api: window.JobBoredGoLive,
    window,
    document,
    shell: defaultShell,
    renderCalls,
    closeCalls,
  };
}

// --- Tests ---------------------------------------------------------------

describe("go-live wizard — path select", () => {
  it("openGoLiveSetupWizard renders via the shared shell with the generic variant and the goLive mount", async () => {
    const { api, renderCalls } = loadGoLive({
      host: { isOnboardingWizardVisible: () => false },
    });
    await api.openGoLiveSetupWizard();
    assert.equal(renderCalls.length, 1, "renderWizardShell should be called once");
    const input = renderCalls[0];
    assert.equal(
      input.mountId,
      "goLiveSetupWizardMount",
      "mountId must target the new go-live mount, not the discovery mount",
    );
    assert.equal(
      input.variant,
      "generic",
      "variant must be 'generic' so the shell skips discovery snapshot/state normalization",
    );
    assert.equal(input.headerTitle, "Use JobBored on other devices");
    assert.equal(input.activeStepId, "path_select", "first render lands on path_select");
    // The four steps the spec calls out exist with the right ids. Compare
    // joined strings so the assertion isn't tripped by vm-realm Array
    // prototype mismatch (steps are constructed inside the vm context).
    const ids = (input.steps || []).map((s) => s.id);
    assert.equal(
      ids.join(","),
      "path_select,tailscale,cloud,done",
      "the wizard exposes the four spec'd steps in order",
    );
  });

  it("path_select renders a Tailscale card and a Cloud card with the correct dispatch action ids", async () => {
    const { api, shell } = loadGoLive({});
    await api.openGoLiveSetupWizard();
    const body = shell.lastRender.bodies.path_select;
    assert.ok(body, "path_select body must render");
    const cards = body._findAll(
      (n) =>
        n.tagName === "button" &&
        n.getAttribute("data-action-id") &&
        n.getAttribute("data-wizard-action") === "action",
    );
    const actionIds = cards.map((c) => c.getAttribute("data-action-id"));
    assert.ok(
      actionIds.includes("wizard_choose_path_tailscale"),
      "must have a Tailscale path card with action id wizard_choose_path_tailscale",
    );
    assert.ok(
      actionIds.includes("wizard_choose_path_cloud"),
      "must have a Cloud path card with action id wizard_choose_path_cloud",
    );
  });
});

describe("go-live wizard — Tailscale path automation", () => {
  it("choosing the Tailscale card probes /__proxy/tailscale-state + /__proxy/install-doctor and navigates to the tailscale step", async () => {
    const fetched = [];
    const fetchImpl = async (url) => {
      fetched.push(url);
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            version: "1.66.0",
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: true },
            recommendation: "ready",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            tools: {
              tailscale: { installed: true, loggedIn: true, version: "1.66.0" },
            },
          }),
        };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    assert.ok(
      fetched.includes("/__proxy/tailscale-state"),
      "must probe tailscale-state",
    );
    assert.ok(
      fetched.includes("/__proxy/install-doctor"),
      "must probe install-doctor",
    );
    assert.equal(shell.lastRender.input.activeStepId, "tailscale");
  });

  it("when recommendation === 'ready' the body shows the derived ts.net URL", async () => {
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            version: "1.66.0",
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: true },
            recommendation: "ready",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    const body = shell.lastRender.bodies.tailscale;
    const codeBlock = body._find(
      (n) =>
        n.tagName === "pre" &&
        String(n.textContent || "").includes("https://mac.tailnet.ts.net"),
    );
    assert.ok(
      codeBlock,
      "ready-state tailscale body must render the derived https://<dnsName> URL",
    );
  });

  it("wizard_tailscale_serve POSTs to /__proxy/tailscale-serve with { port: 8080 }", async () => {
    const fetched = [];
    const fetchImpl = async (url, init) => {
      fetched.push({ url, init });
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            version: "1.66.0",
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: false },
            recommendation: "needs_serve",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      }
      if (url === "/__proxy/tailscale-serve") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            alreadyServing: false,
            url: "https://mac.tailnet.ts.net",
          }),
        };
      }
      return { ok: false };
    };
    const { api } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("wizard_tailscale_serve");
    const serveCall = fetched.find(
      (c) => c.url === "/__proxy/tailscale-serve",
    );
    assert.ok(serveCall, "must POST to /__proxy/tailscale-serve");
    assert.equal(serveCall.init && serveCall.init.method, "POST");
    const body = JSON.parse(serveCall.init.body);
    assert.equal(body.port, 8080, "must request the dashboard port (8080)");
  });

  it("wizard_tailscale_verify fetch-probes the derived URL and records the result", async () => {
    const probed = [];
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: true },
            recommendation: "ready",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      }
      probed.push(url);
      return { ok: true };
    };
    const { api, shell } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("wizard_tailscale_verify");
    assert.ok(
      probed.includes("https://mac.tailnet.ts.net"),
      "verify action must fetch-probe the derived URL",
    );
    // The verify result card is now in the rendered body.
    const body = shell.lastRender.bodies.tailscale;
    const card = body._find(
      (n) =>
        n.dataset &&
        n.dataset.ok === "1" &&
        String(n.className || "").includes("summary-card--ok"),
    );
    assert.ok(card, "verify success must render an OK reachability card");
  });

  it("when /__proxy is unreachable the body shows guidance with the SELF-HOSTING link, not a fake progress state", async () => {
    const { api, shell } = loadGoLive({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    const body = shell.lastRender.bodies.tailscale;
    const link = body._find(
      (n) =>
        n.tagName === "a" &&
        String(n.getAttribute("href") || "").includes("SELF-HOSTING.md"),
    );
    assert.ok(link, "must link the SELF-HOSTING.md reference");
  });
});

describe("go-live wizard — Cloud path guidance", () => {
  it("when vercel CLI is installed the body shows the `vercel` command", async () => {
    const fetchImpl = async (url) => {
      if (url === "/__proxy/install-doctor") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            tools: {
              vercel: { installed: true, loggedIn: true, version: "32.0.0" },
              netlify: { installed: false },
              gh: { installed: false },
            },
          }),
        };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_cloud");
    const body = shell.lastRender.bodies.cloud;
    const code = body._find(
      (n) =>
        n.tagName === "pre" &&
        String(n.textContent || "").trim() === "vercel",
    );
    assert.ok(code, "vercel-installed body must show the exact `vercel` command");
  });

  it("when no CLI is installed the body offers one-click Deploy buttons (anchors)", async () => {
    const fetchImpl = async (url) => {
      if (url === "/__proxy/install-doctor") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            tools: {
              vercel: { installed: false },
              netlify: { installed: false },
              gh: { installed: false },
            },
          }),
        };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_cloud");
    const body = shell.lastRender.bodies.cloud;
    const anchors = body._findAll(
      (n) =>
        n.tagName === "a" &&
        String(n.getAttribute("href") || "").startsWith("https://"),
    );
    const labels = anchors.map((a) => String(a.textContent || ""));
    assert.ok(
      labels.some((l) => /vercel/i.test(l)),
      "must offer Vercel deploy button",
    );
    assert.ok(
      labels.some((l) => /netlify/i.test(l)),
      "must offer Netlify deploy button",
    );
  });

  it("wizard_cloud_verify fetch-probes the pasted URL", async () => {
    const probed = [];
    const fetchImpl = async (url) => {
      if (url === "/__proxy/install-doctor") {
        return {
          ok: true,
          json: async () => ({ ok: true, tools: {} }),
        };
      }
      probed.push(url);
      return { ok: true };
    };
    const { api } = loadGoLive({ fetchImpl });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_cloud");
    // Simulate the user typing a URL — the input.onInput hook updates runtime.
    api._internal.updateRuntime({ cloudUrl: "https://my-dash.vercel.app" });
    await api.handleAction("wizard_cloud_verify");
    assert.ok(
      probed.includes("https://my-dash.vercel.app"),
      "verify action must fetch-probe the pasted URL",
    );
  });
});

describe("go-live wizard — done step + discovery cross-rec gating", () => {
  it("go_live_complete_tailscale calls UC.completeGoLiveSetup and gates the discovery CTA on isDiscoverySetupComplete", async () => {
    const calls = { completeGoLive: 0, isDiscoveryComplete: 0 };
    const uc = {
      completeGoLiveSetup: async () => {
        calls.completeGoLive++;
      },
      isDiscoverySetupComplete: async () => {
        calls.isDiscoveryComplete++;
        return false;
      },
    };
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: true },
            recommendation: "ready",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl, uc });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("go_live_complete_tailscale");
    assert.equal(calls.completeGoLive, 1, "must mark go-live complete");
    assert.equal(
      calls.isDiscoveryComplete,
      1,
      "must check discovery completion to decide whether to cross-rec",
    );
    assert.equal(shell.lastRender.input.activeStepId, "done");
    // Done body recommends discovery + action is wired.
    const doneStep = shell.lastRender.input.steps.find((s) => s.id === "done");
    const actionIds = (doneStep.actions || []).map((a) => a.id);
    assert.ok(
      actionIds.includes("go_live_open_discovery"),
      "done step must offer 'Turn on job discovery' when discovery is incomplete",
    );
  });

  it("done step omits the discovery CTA when isDiscoverySetupComplete already returns true", async () => {
    const uc = {
      completeGoLiveSetup: async () => {},
      isDiscoverySetupComplete: async () => true,
    };
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") {
        return {
          ok: true,
          json: async () => ({
            installed: true,
            loggedIn: true,
            dnsName: "mac.tailnet.ts.net",
            dashboardUrl: "https://mac.tailnet.ts.net",
            serving: { 8080: true },
            recommendation: "ready",
          }),
        };
      }
      if (url === "/__proxy/install-doctor") {
        return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      }
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl, uc });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("go_live_complete_tailscale");
    const doneStep = shell.lastRender.input.steps.find((s) => s.id === "done");
    const actionIds = (doneStep.actions || []).map((a) => a.id);
    assert.ok(
      !actionIds.includes("go_live_open_discovery"),
      "discovery CTA must NOT appear once discovery is already complete",
    );
  });

  it("go_live_open_discovery closes the wizard and routes to host.requestDiscoverySetup with the cross-rec entry point", async () => {
    const discoveryCalls = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      requestDiscoverySetup: (opts) => {
        discoveryCalls.push(opts);
        return Promise.resolve({ deferred: false });
      },
    };
    const { api, closeCalls } = loadGoLive({ host });
    await api.openGoLiveSetupWizard();
    await api.handleAction("go_live_open_discovery");
    assert.equal(discoveryCalls.length, 1, "must dispatch to requestDiscoverySetup");
    assert.equal(discoveryCalls[0].entryPoint, "go_live_cross_rec");
    assert.equal(
      discoveryCalls[0].allowWhileOnboarding,
      true,
      "cross-rec must still allow while onboarding (per discovery's own CTA pattern)",
    );
    assert.ok(
      closeCalls.length >= 1,
      "go_live_open_discovery must close the go-live wizard before dispatching the cross-rec",
    );
  });
});

describe("go-live wizard — onboarding-defer gate (mirrors requestDiscoverySetup)", () => {
  it("requestGoLiveSetup defers when the onboarding or first-run wizard is up", async () => {
    const host = {
      isOnboardingWizardVisible: () => true,
      isFirstRunWizardVisible: () => false,
    };
    const { api, renderCalls } = loadGoLive({ host });
    const result = await api.requestGoLiveSetup();
    assert.equal(result.deferred, true, "must return deferred:true");
    assert.equal(
      renderCalls.length,
      0,
      "must NOT render the wizard while onboarding is up",
    );
  });

  it("requestGoLiveSetup runs through allowWhileOnboarding:true even when onboarding is visible", async () => {
    const host = {
      isOnboardingWizardVisible: () => true,
      isFirstRunWizardVisible: () => false,
      hideOnboardingWizard: () => {},
    };
    const { api, renderCalls } = loadGoLive({ host });
    const result = await api.requestGoLiveSetup({ allowWhileOnboarding: true });
    assert.equal(result.deferred, false);
    assert.equal(renderCalls.length, 1, "wizard must render");
  });

  it("requestGoLiveSetup runs immediately when no wizard is up", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
    };
    const { api, renderCalls } = loadGoLive({ host });
    const result = await api.requestGoLiveSetup();
    assert.equal(result.deferred, false);
    assert.equal(renderCalls.length, 1);
  });
});

describe("go-live wizard — module + bridge surface", () => {
  it("publishes openGoLiveSetupWizard and requestGoLiveSetup on window.JobBoredGoLive", () => {
    const { api } = loadGoLive({});
    assert.equal(typeof api.openGoLiveSetupWizard, "function");
    assert.equal(typeof api.requestGoLiveSetup, "function");
    assert.equal(api.MOUNT_ID, "goLiveSetupWizardMount");
  });

  it("the host bridge wires openGoLiveSetupWizard + requestGoLiveSetup into app.core.host and discovery.status.host", () => {
    const bridgeRegistryJs = readFileSync(
      join(repoRoot, "bridge-registry.js"),
      "utf8",
    );
    // core.host must carry both for first-run-wizard / whats-next-banner.
    const coreHostStart = bridgeRegistryJs.indexOf("app.core.host = {");
    assert.ok(coreHostStart !== -1);
    const coreHostEnd = bridgeRegistryJs.indexOf("};", coreHostStart);
    const coreHostBlock = bridgeRegistryJs.slice(coreHostStart, coreHostEnd);
    assert.match(
      coreHostBlock,
      /requestGoLiveSetup: host\.requestGoLiveSetup/,
      "app.core.host must carry requestGoLiveSetup (FE-3 reads it from here)",
    );
    assert.match(
      coreHostBlock,
      /openGoLiveSetupWizard: host\.openGoLiveSetupWizard/,
      "app.core.host must carry openGoLiveSetupWizard",
    );
    // discovery.status.host must carry openGoLiveSetupWizard so the
    // discovery-status-handoff module can route to it.
    const statusStart = bridgeRegistryJs.indexOf("discovery.status.host = {");
    const statusEnd = bridgeRegistryJs.indexOf("};", statusStart);
    const statusBlock = bridgeRegistryJs.slice(statusStart, statusEnd);
    assert.match(
      statusBlock,
      /openGoLiveSetupWizard: host\.openGoLiveSetupWizard/,
      "discovery.status.host must carry openGoLiveSetupWizard",
    );
  });

  it("the bare-name forwarders are wired in app-compat.js + app.js exports the names to the bridge host", () => {
    const appCompat = readFileSync(
      join(repoRoot, "app-compat.js"),
      "utf8",
    );
    assert.match(
      appCompat,
      /async function openGoLiveSetupWizard\(options = \{\}\) \{\s*return window\.JobBoredGoLive\.openGoLiveSetupWizard\(options\);/,
      "openGoLiveSetupWizard must forward to window.JobBoredGoLive",
    );
    assert.match(
      appCompat,
      /async function requestGoLiveSetup\(options = \{\}\) \{\s*return window\.JobBoredGoLive\.requestGoLiveSetup\(options\);/,
      "requestGoLiveSetup must forward to window.JobBoredGoLive",
    );
    const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
    // Both names must be passed to registerBridgeHosts via the host arg.
    // Trailing `,` is a non-word char; \b before the identifier is enough.
    assert.match(appJs, /\bopenGoLiveSetupWizard,/);
    assert.match(appJs, /\brequestGoLiveSetup,/);
  });
});
