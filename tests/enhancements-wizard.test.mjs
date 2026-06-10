import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

// ============================================================
// T1 — user-content-store dismiss flag trios + gate read
// ============================================================

describe("enhancements wizard — store: dismiss flag trios + gate read", () => {
  function makeInMemoryDb() {
    const stores = {};
    function getStore(name) {
      if (!stores[name]) stores[name] = new Map();
      return stores[name];
    }
    function makeRequest(value) {
      const req = { result: value, onsuccess: null, onerror: null };
      Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess(); });
      return req;
    }
    function makeWriteRequest() {
      const req = { onsuccess: null, onerror: null };
      Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess(); });
      return req;
    }
    return {
      transaction(storeName) {
        const store = getStore(storeName);
        return {
          objectStore() {
            return {
              get(key) { return makeRequest(store.has(key) ? { key, value: store.get(key) } : undefined); },
              put(record) {
                store.set(record.key, record.value);
                return makeWriteRequest();
              },
            };
          },
        };
      },
    };
  }

  function loadStore() {
    const storeJs = readRepo("user-content-store.js");
    const fakeDb = makeInMemoryDb();
    const ctx = {
      window: {},
      indexedDB: {
        open() {
          const req = {
            onupgradeneeded: null, onsuccess: null, onerror: null,
            result: fakeDb,
          };
          Promise.resolve().then(() => { if (typeof req.onsuccess === "function") req.onsuccess({ target: req }); });
          return req;
        },
      },
      console,
      setTimeout,
      clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(storeJs, ctx, { filename: "user-content-store.js" });
    return ctx.window.CommandCenterUserContent;
  }

  it("exports getSerpApiEnhancementDismissed and setSerpApiEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getSerpApiEnhancementDismissed, "function");
    assert.equal(typeof UC.setSerpApiEnhancementDismissed, "function");
    assert.equal(await UC.getSerpApiEnhancementDismissed(), false, "defaults to false");
    await UC.setSerpApiEnhancementDismissed(true);
    assert.equal(await UC.getSerpApiEnhancementDismissed(), true);
  });

  it("exports getGeminiEnhancementDismissed and setGeminiEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getGeminiEnhancementDismissed, "function");
    assert.equal(typeof UC.setGeminiEnhancementDismissed, "function");
    assert.equal(await UC.getGeminiEnhancementDismissed(), false, "defaults to false");
    await UC.setGeminiEnhancementDismissed(true);
    assert.equal(await UC.getGeminiEnhancementDismissed(), true);
  });

  it("exports getAiProviderEnhancementDismissed and setAiProviderEnhancementDismissed", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.getAiProviderEnhancementDismissed, "function");
    assert.equal(typeof UC.setAiProviderEnhancementDismissed, "function");
    assert.equal(await UC.getAiProviderEnhancementDismissed(), false, "defaults to false");
    await UC.setAiProviderEnhancementDismissed(true);
    assert.equal(await UC.getAiProviderEnhancementDismissed(), true);
  });

  it("exports isAllMandatorySetupComplete returning true only when infra+onboarding+discovery+goLive all set", async () => {
    const UC = loadStore();
    assert.equal(typeof UC.isAllMandatorySetupComplete, "function");
    assert.equal(await UC.isAllMandatorySetupComplete(), false, "false when nothing set");
    await UC.completeInfraSetup();
    await UC.completeOnboarding();
    await UC.completeDiscoverySetup();
    assert.equal(await UC.isAllMandatorySetupComplete(), false, "false until goLive also set");
    await UC.completeGoLiveSetup();
    assert.equal(await UC.isAllMandatorySetupComplete(), true);
  });
});

// ============================================================
// T2 — skeleton: IIFE, runtime, shell render, open/request
// ============================================================

const enhancementsJs = readRepo("enhancements-wizard-ui.js");

function makeFakeDom() {
  function makeEl(tagName) {
    const children = [];
    const attrs = new Map();
    const listeners = new Map();
    const classes = new Set();
    return {
      tagName: String(tagName || "div").toLowerCase(),
      children, attrs, listeners, dataset: {}, style: {},
      textContent: "",
      _value: "",
      get value() { return this._value; },
      set value(v) { this._value = String(v == null ? "" : v); },
      get className() { return [...classes].join(" "); },
      set className(v) {
        classes.clear();
        String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
        toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
      },
      appendChild(child) { children.push(child); return child; },
      append(...args) { args.forEach((a) => children.push(a)); },
      setAttribute(name, value) {
        attrs.set(name, String(value));
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      focus() {},
      _find(pred) {
        if (pred(this)) return this;
        for (const c of children) { if (c && typeof c._find === "function") { const hit = c._find(pred); if (hit) return hit; } }
        return null;
      },
      _findAll(pred) {
        const out = [];
        if (pred(this)) out.push(this);
        for (const c of children) { if (c && typeof c._findAll === "function") out.push(...c._findAll(pred)); }
        return out;
      },
    };
  }
  const document = {
    readyState: "complete",
    body: makeEl("body"),
    getElementById() { return makeEl("div"); },
    createElement(tag) { return makeEl(tag); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return { document, makeEl };
}

function loadEnhancements({ fetchImpl, uc, host, shellApi, wizardDomOverride } = {}) {
  const { document, makeEl } = makeFakeDom();
  const renderCalls = [];
  const closeCalls = [];
  const defaultShell = {
    renderWizardShell(input) {
      renderCalls.push(input);
      const bodies = {};
      for (const step of input.steps || []) {
        if (typeof step.body === "function") {
          try { bodies[step.id] = step.body(); } catch (err) { bodies[step.id] = { _bodyError: err }; }
        }
      }
      const lastRender = { input, bodies };
      defaultShell.lastRender = lastRender;
      return lastRender;
    },
    closeWizardShell(reason) { closeCalls.push(reason); },
    lastRender: null,
  };
  const shell = shellApi || defaultShell;
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
      (items || []).filter(Boolean).forEach((item) => { const li = makeEl("li"); li.textContent = String(item); ul.appendChild(li); });
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
      btn.textContent = copyLabel || "Copy";
      row.appendChild(code); row.appendChild(btn);
      parent.appendChild(row);
      return row;
    },
    appendWizardInput(parent, opts) {
      const wrap = makeEl("div");
      const input = makeEl("input");
      if (opts.id) input.id = opts.id;
      input.value = opts.value || "";
      input._onInput = opts.onInput;
      wrap.appendChild(input); parent.appendChild(wrap);
      return wrap;
    },
  };
  const window = {
    JobBoredApp: { core: { host: {} } },
    JobBoredDiscoveryWizard: { shell },
    JobBoredWizardDom: dom,
    JobBoredEnhancements: {},
    CommandCenterUserContent: uc || null,
    AbortController: typeof AbortController !== "undefined" ? AbortController : null,
  };
  window.JobBoredEnhancements.host = host || null;
  const fetchSpy = fetchImpl || (async () => ({ ok: false }));
  const ctx = {
    window, document, console, setTimeout, clearTimeout,
    AbortController: typeof AbortController !== "undefined" ? AbortController : undefined,
    URL,
    fetch: fetchSpy,
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(enhancementsJs, ctx, { filename: "enhancements-wizard-ui.js" });
  return { api: window.JobBoredEnhancements, window, document, shell: defaultShell, renderCalls, closeCalls };
}

describe("enhancements wizard — skeleton: IIFE + runtime + shell render", () => {
  it("openEnhancementsWizard renders via the shared shell with variant:generic and the enhancements mount", async () => {
    const { api, renderCalls } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    assert.equal(renderCalls.length, 1, "renderWizardShell should be called once");
    const input = renderCalls[0];
    assert.equal(input.mountId, "enhancementsWizardMount");
    assert.equal(input.variant, "generic");
    assert.ok(typeof input.headerTitle === "string" && input.headerTitle.length > 0);
    assert.equal(input.activeStepId, "serp_api");
    const ids = (input.steps || []).map((s) => s.id);
    assert.equal(ids.join(","), "serp_api,gemini,ai_provider,more_optional,done");
  });

  it("requestEnhancementsSetup defers when onboarding wizard is visible and allowWhileOnboarding is not set", async () => {
    const host = {
      isOnboardingWizardVisible: () => true,
      isFirstRunWizardVisible: () => false,
    };
    const { api } = loadEnhancements({ host });
    const result = await api.requestEnhancementsSetup({});
    assert.equal(result.deferred, true, "must defer when onboarding is up");
  });

  it("requestEnhancementsSetup opens when allowWhileOnboarding:true even if onboarding visible", async () => {
    const host = {
      isOnboardingWizardVisible: () => true,
      isFirstRunWizardVisible: () => false,
    };
    const { api, renderCalls } = loadEnhancements({ host });
    const result = await api.requestEnhancementsSetup({ allowWhileOnboarding: true });
    assert.equal(result.deferred, false);
    assert.equal(renderCalls.length, 1);
  });

  it("clearRuntime resets to defaultRuntime; updateRuntime patches in place", () => {
    const { api } = loadEnhancements({});
    api._internal.clearRuntime();
    assert.equal(api._internal.getRuntime().activeStepId, "serp_api");
    api._internal.updateRuntime({ activeStepId: "gemini" });
    assert.equal(api._internal.getRuntime().activeStepId, "gemini");
    api._internal.clearRuntime();
    assert.equal(api._internal.getRuntime().activeStepId, "serp_api");
  });

  it("enhancements-wizard-ui.js is on the typecheck:repo chain", () => {
    const pkg = JSON.parse(readRepo("package.json"));
    const chain = String(pkg.scripts && pkg.scripts["typecheck:repo"]);
    assert.match(chain, /node --check enhancements-wizard-ui\.js/, "typecheck:repo must syntax-check enhancements-wizard-ui.js");
  });
});

describe("enhancements wizard — step navigation and skip flow", () => {
  it("serp_api step body renders benefit copy and a worker status callout", async () => {
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    const body = shell.lastRender.bodies.serp_api;
    assert.ok(body, "serp_api body must render");
    // Benefit copy must be present
    const copy = body._findAll((n) => n.tagName === "p" && /SerpApi/i.test(n.textContent));
    assert.ok(copy.length > 0, "must render benefit copy mentioning SerpApi");
    // Status callout must be present
    const callouts = body._findAll((n) => n.className && String(n.className).includes("discovery-setup-wizard__callout"));
    assert.ok(callouts.length > 0, "must render a status callout");
  });

  it("enhancements_serp_api_skip advances to gemini step and writes serpApiEnhancementDismissed", async () => {
    const ucCalls = [];
    const uc = {
      setSerpApiEnhancementDismissed: async (v) => { ucCalls.push({ key: "serpApi", v }); },
    };
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
      uc,
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    assert.equal(shell.lastRender.input.activeStepId, "gemini", "skip must advance to gemini");
    assert.ok(ucCalls.some((c) => c.key === "serpApi" && c.v === true), "skip must write the dismiss flag");
  });

  it("enhancements_gemini_skip advances to ai_provider and writes geminiEnhancementDismissed", async () => {
    const ucCalls = [];
    const uc = {
      setSerpApiEnhancementDismissed: async () => {},
      setGeminiEnhancementDismissed: async (v) => { ucCalls.push({ key: "gemini", v }); },
    };
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
      uc,
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_skip");
    assert.equal(shell.lastRender.input.activeStepId, "ai_provider");
    assert.ok(ucCalls.some((c) => c.key === "gemini" && c.v === true));
  });

  it("enhancements_ai_provider_skip advances to more_optional and writes aiProviderEnhancementDismissed", async () => {
    const ucCalls = [];
    const uc = {
      setSerpApiEnhancementDismissed: async () => {},
      setGeminiEnhancementDismissed: async () => {},
      setAiProviderEnhancementDismissed: async (v) => { ucCalls.push({ key: "aiProvider", v }); },
    };
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
      uc,
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_skip");
    await api.handleAction("enhancements_ai_provider_skip");
    assert.equal(shell.lastRender.input.activeStepId, "more_optional");
    assert.ok(ucCalls.some((c) => c.key === "aiProvider" && c.v === true));
  });

  it("enhancements_more_next advances to done step", async () => {
    const uc = {
      setSerpApiEnhancementDismissed: async () => {},
      setGeminiEnhancementDismissed: async () => {},
      setAiProviderEnhancementDismissed: async () => {},
    };
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
      uc,
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_skip");
    await api.handleAction("enhancements_ai_provider_skip");
    await api.handleAction("enhancements_more_next");
    assert.equal(shell.lastRender.input.activeStepId, "done");
  });

  it("done step body lists each step's status (all skipped → all show skip text)", async () => {
    const uc = {
      setSerpApiEnhancementDismissed: async () => {},
      setGeminiEnhancementDismissed: async () => {},
      setAiProviderEnhancementDismissed: async () => {},
    };
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
      uc,
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_skip");
    await api.handleAction("enhancements_ai_provider_skip");
    await api.handleAction("enhancements_more_next");
    const doneBody = shell.lastRender.bodies.done;
    assert.ok(doneBody, "done body must render");
    // All three skipped — done body must list all three items
    const items = doneBody._findAll((n) => n.tagName === "li");
    assert.equal(items.length, 3, "done summary must list all three step statuses");
  });

  it("enhancements_finish closes the wizard", async () => {
    const { api, closeCalls } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_finish");
    assert.ok(closeCalls.length >= 1, "finish must close the wizard shell");
  });

  it("enhancements_serp_api_done re-checks and STAYS (advancing belongs to Continue/Skip)", async () => {
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_done");
    assert.equal(shell.lastRender.input.activeStepId, "serp_api");
  });
});

describe("enhancements wizard — /health status badge wiring", () => {
  function makeHealthFetch(overrides) {
    const defaults = {
      serpApiGoogleJobs: { configured: false },
      googleTools: { configured: false },
    };
    const readiness = { ...defaults, ...overrides };
    return async (url) => {
      if (String(url).endsWith("/health")) {
        return { ok: true, json: async () => ({ readiness }) };
      }
      return { ok: false };
    };
  }

  it("opening the wizard polls /health and sets serpApiStatus + geminiStatus from readiness flags", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://localhost:8644/webhook" }),
    };
    const fetchImpl = makeHealthFetch({
      serpApiGoogleJobs: { configured: true },
      googleTools: { configured: false },
    });
    const { api } = loadEnhancements({ host, fetchImpl });
    await api.openEnhancementsWizard();
    const rt = api._internal.getRuntime();
    assert.equal(rt.serpApiStatus, "yes", "serpApiStatus must be 'yes' when configured:true");
    assert.equal(rt.geminiStatus, "no", "geminiStatus must be 'no' when configured:false");
  });

  it("serp_api step body callout reads 'Configured' when serpApiStatus is 'yes'", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://localhost:8644/webhook" }),
    };
    const fetchImpl = makeHealthFetch({ serpApiGoogleJobs: { configured: true }, googleTools: { configured: false } });
    const { api, shell } = loadEnhancements({ host, fetchImpl });
    await api.openEnhancementsWizard();
    const callouts = shell.lastRender.bodies.serp_api._findAll(
      (n) => n.className && String(n.className).includes("discovery-setup-wizard__callout")
    );
    assert.ok(
      callouts.some((c) => /connected/i.test(c.textContent)),
      "the configured state must celebrate the connection (✓ … connected)",
    );
  });

  it("when /health is unreachable, status degrades to 'unknown' without throwing", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://localhost:8644/webhook" }),
    };
    const fetchImpl = async () => { throw new Error("network error"); };
    const { api } = loadEnhancements({ host, fetchImpl });
    await api.openEnhancementsWizard();
    const rt = api._internal.getRuntime();
    assert.equal(rt.serpApiStatus, "unknown");
    assert.equal(rt.geminiStatus, "unknown");
  });

  it("Re-check (enhancements_serp_api_done) re-polls /health and STAYS — it must never advance", async () => {
    let pollCount = 0;
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://localhost:8644/webhook" }),
    };
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/health") || String(url).includes("discovery-health")) {
        pollCount++;
        return { ok: true, json: async () => ({ readiness: { serpApiGoogleJobs: { configured: true }, googleTools: { configured: false } } }) };
      }
      return { ok: false };
    };
    const { api, shell } = loadEnhancements({ host, fetchImpl });
    await api.openEnhancementsWizard();     // poll 1
    await api.handleAction("enhancements_serp_api_done"); // poll 2 — re-check
    assert.ok(pollCount >= 2, "must re-poll health on Re-check");
    assert.equal(
      shell.lastRender.input.activeStepId,
      "serp_api",
      "Re-check must stay on the step so the user sees the updated badge — advancing is Continue/Skip's job",
    );
  });

  it("Continue (enhancements_serp_api_next / gemini_next) is what advances", async () => {
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_next");
    assert.equal(shell.lastRender.input.activeStepId, "gemini");
    await api.handleAction("enhancements_gemini_next");
    assert.equal(shell.lastRender.input.activeStepId, "ai_provider");
  });

  it("step actions are status-aware: configured → Continue primary; not configured → Save key primary + Skip", async () => {
    // Stateful probe: the worker starts unconfigured; the key "gets set"
    // between the open and the Re-check, exactly like a real save.
    let configured = false;
    const fetchImpl = async (url) => {
      if (String(url).includes("/__proxy/discovery-health")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            readiness: { serpApiGoogleJobs: { configured }, googleTools: { configured: false } },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    const { api, shell } = loadEnhancements({
      fetchImpl,
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    // Not configured: Save key leads, Skip available, no Continue.
    let serpStep = shell.lastRender.input.steps.find((s) => s.id === "serp_api");
    let ids = serpStep.actions.map((a) => a.id);
    assert.ok(ids.includes("enhancements_serp_save_key"));
    assert.ok(ids.includes("enhancements_serp_api_skip"));
    assert.ok(!ids.includes("enhancements_serp_api_next"), "no Continue until configured");
    // Key lands → Re-check flips the badge AND the actions.
    configured = true;
    await api.handleAction("enhancements_serp_api_done");
    serpStep = shell.lastRender.input.steps.find((s) => s.id === "serp_api");
    ids = serpStep.actions.map((a) => a.id);
    const primary = serpStep.actions.find((a) => a.variant === "primary");
    assert.equal(primary && primary.id, "enhancements_serp_api_next", "configured → Continue is the primary");
    assert.ok(!ids.includes("enhancements_serp_api_skip"), "nothing to skip once configured");
  });

  it("probeHealthStatus prefers the local dev-server proxy (no CORS) and works WITHOUT a saved webhook URL", async () => {
    // Evidence-grounded: the direct browser fetch to the worker /health dies
    // on CORS ("Failed to fetch"), so the badge read "unknown" while the
    // worker was demonstrably configured — the proxy probe is same-origin.
    const fetched = [];
    const fetchImpl = async (url) => {
      fetched.push(String(url));
      if (String(url).includes("/__proxy/discovery-health")) {
        return { ok: true, json: async () => ({ ok: true, readiness: { serpApiGoogleJobs: { configured: true }, googleTools: { configured: true } } }) };
      }
      return { ok: false, json: async () => ({}) };
    };
    const { api } = loadEnhancements({
      fetchImpl,
      host: {
        isOnboardingWizardVisible: () => false,
        isFirstRunWizardVisible: () => false,
        getDiscoveryReadinessSnapshot: () => null, // no saved URL at all
      },
    });
    await api.openEnhancementsWizard();
    const rt = api._internal.getRuntime();
    assert.equal(rt.serpApiStatus, "yes", "proxy probe must set the badge without any saved URL");
    assert.equal(rt.geminiStatus, "yes");
    assert.ok(fetched.some((u) => u.includes("/__proxy/discovery-health")));
  });

  it("the key steps link straight to the key pages (clickable, not 'go find it')", () => {
    assert.match(enhancementsJs, /serpapi\.com\/manage-api-key/);
    assert.match(enhancementsJs, /aistudio\.google\.com\/apikey/);
    assert.match(enhancementsJs, /target = "_blank"|target="_blank"|\.target = "_blank"/);
  });
});

describe("enhancements wizard — deep-link actions + AI-provider status", () => {
  it("enhancements_serp_api_open_drawer calls host().openDrawerToSubtab('sources', null)", async () => {
    const drawerCalls = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      openDrawerToSubtab: (subtab, fieldId) => { drawerCalls.push({ subtab, fieldId }); },
    };
    const { api } = loadEnhancements({ host });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_open_drawer");
    assert.ok(drawerCalls.some((c) => c.subtab === "sources"), "must open drawer to 'sources' subtab");
  });

  it("enhancements_gemini_open_drawer calls host().openDrawerToSubtab('sources', null)", async () => {
    const drawerCalls = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      openDrawerToSubtab: (subtab, fieldId) => { drawerCalls.push({ subtab, fieldId }); },
    };
    const { api } = loadEnhancements({ host });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_open_drawer");
    assert.ok(drawerCalls.some((c) => c.subtab === "sources"));
  });

  it("enhancements_ai_provider_open_settings calls host().setActiveSettingsTab('ai_providers', {focusField:'settingsResumeProvider'}) then advances to more_optional", async () => {
    const tabCalls = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      setActiveSettingsTab: (tabId, opts) => { tabCalls.push({ tabId, opts }); },
      openCommandCenterSettingsModal: () => {},
    };
    const { api, shell } = loadEnhancements({ host });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_skip");
    await api.handleAction("enhancements_gemini_skip");
    await api.handleAction("enhancements_ai_provider_open_settings");
    assert.ok(tabCalls.some((c) => c.tabId === "ai_providers"), "must activate ai_providers tab");
    assert.equal(shell.lastRender.input.activeStepId, "more_optional", "must advance to more_optional after opening settings");
  });

  it("probeAiProviderStatus sets aiProviderConfigured:true when config has resumeProvider + a non-empty key", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      getConfig: () => ({ resumeProvider: "openrouter", resumeOpenRouterApiKey: "sk-test-123" }),
    };
    const { api } = loadEnhancements({ host });
    await api.openEnhancementsWizard();
    const rt = api._internal.getRuntime();
    assert.equal(rt.aiProviderConfigured, true, "must be true when provider + key are set");
  });

  it("probeAiProviderStatus sets aiProviderConfigured:false when no keys present", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      getConfig: () => ({ resumeProvider: "gemini", resumeGeminiApiKey: "" }),
    };
    const { api } = loadEnhancements({ host });
    await api.openEnhancementsWizard();
    const rt = api._internal.getRuntime();
    assert.equal(rt.aiProviderConfigured, false);
  });
});

describe("enhancements wizard — mandatory-gate defer", () => {
  it("requestEnhancementsSetup defers when isFirstRunWizardVisible is true", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => true,
    };
    const { api } = loadEnhancements({ host });
    const result = await api.requestEnhancementsSetup({});
    assert.equal(result.deferred, true);
  });

  it("requestEnhancementsSetup opens normally when both wizard gates are false", async () => {
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
    };
    const { api, renderCalls } = loadEnhancements({ host });
    const result = await api.requestEnhancementsSetup({});
    assert.equal(result.deferred, false);
    assert.equal(renderCalls.length, 1);
  });
});

describe("enhancements wizard — bridge-registry wiring", () => {
  it("bridge-registry.js assigns enhancements.host after registerAllBridges", () => {
    const registryJs = readRepo("bridge-registry.js");
    assert.match(registryJs, /enhancements\.host\s*=/, "bridge-registry must assign enhancements.host");
  });

  it("enhancements.host includes getUserContent, showToast, getDiscoveryReadinessSnapshot, openDrawerToSubtab, setActiveSettingsTab, requestEnhancementsSetup", () => {
    const registryJs = readRepo("bridge-registry.js");
    for (const field of [
      "getUserContent",
      "showToast",
      "getDiscoveryReadinessSnapshot",
      "openDrawerToSubtab",
      "setActiveSettingsTab",
      "openCommandCenterSettingsModal",
      "isOnboardingWizardVisible",
      "isFirstRunWizardVisible",
      "hideOnboardingWizard",
      "showOnboardingWizard",
      "requestEnhancementsSetup",
      "getConfig",
    ]) {
      assert.match(registryJs, new RegExp(`${field}\\s*:`), `enhancements.host must include ${field}`);
    }
  });
});

describe("enhancements wizard — in-wizard key entry + working deep-link", () => {
  // The drawer deep-link was a dead button (openDrawerToSubtab never exported
  // on the adapters namespace, and the z-9 drawer opened BEHIND the z-3200
  // wizard shell). The primary path is now in-wizard: paste the key, we write
  // it into the worker env server-side, reboot the worker (tunnel-free), and
  // re-poll /health so the badge flips. The deep-link stays as the secondary
  // escape hatch and must close the wizard shell first so the drawer is
  // actually visible.
  const adaptersJs = readFileSync(
    join(repoRoot, "settings-discovery-adapters.js"),
    "utf8",
  );

  it("settings-discovery-adapters EXPORTS openDrawerToSubtab (the compat shim reads it)", () => {
    const exportIdx = adaptersJs.indexOf("window.JobBoredSettingsDiscoveryAdapters = {");
    assert.ok(exportIdx !== -1);
    const block = adaptersJs.slice(exportIdx, adaptersJs.indexOf("};", exportIdx));
    assert.match(
      block,
      /openDrawerToSubtab/,
      "app-compat reads adapters.openDrawerToSubtab — a missing export silently no-ops every deep-link",
    );
  });

  it("the drawer deep-link closes the wizard shell FIRST (the drawer renders below it)", async () => {
    const order = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      openDrawerToSubtab: (subtab) => order.push(`drawer:${subtab}`),
    };
    const shellApi = {
      renderWizardShell: () => ({}),
      closeWizardShell: (reason) => order.push(`close:${reason}`),
    };
    const { api } = loadEnhancements({ host, shellApi });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_open_drawer");
    assert.deepEqual(
      order,
      ["close:deep_link", "drawer:sources"],
      "the z-9 drawer is invisible under the z-3200 shell — close first, then open",
    );
  });

  function makeSaveFetch({ envKeyOk = true } = {}) {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
      if (String(url).includes("discovery-env-key")) {
        return { ok: envKeyOk, json: async () => ({ ok: envKeyOk }) };
      }
      if (String(url).includes("full-boot")) {
        return { ok: true, json: async () => ({ ok: true, phases: [] }) };
      }
      if (String(url).includes("/health")) {
        return {
          ok: true,
          json: async () => ({
            readiness: {
              serpApiGoogleJobs: { configured: true },
              googleTools: { configured: true },
            },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    return { calls, fetchImpl };
  }

  const saveHost = {
    isOnboardingWizardVisible: () => false,
    isFirstRunWizardVisible: () => false,
    getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://127.0.0.1:8644/webhook" }),
  };

  it("saving the SerpApi key writes it server-side, reboots the worker tunnel-free, and re-polls status", async () => {
    const { calls, fetchImpl } = makeSaveFetch();
    const { api } = loadEnhancements({ fetchImpl, host: saveHost });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ serpApiKeyDraft: "serp-key-123" });
    await api.handleAction("enhancements_serp_save_key");
    const envCall = calls.find((c) => c.url.includes("discovery-env-key"));
    assert.ok(envCall, "must POST the key to the env endpoint");
    assert.equal(envCall.method, "POST");
    assert.match(envCall.body, /SERPAPI_API_KEY/);
    assert.match(envCall.body, /serp-key-123/);
    const bootIdx = calls.findIndex((c) => c.url.includes("full-boot"));
    assert.ok(bootIdx !== -1, "must reboot the worker so it loads the key");
    assert.match(calls[bootIdx].url, /skip_tunnel=1/);
    assert.ok(
      calls.some((c) => c.url.includes("/health")),
      "must re-poll /health so the badge flips to configured",
    );
    assert.equal(
      api._internal.getRuntime().serpApiKeyDraft,
      "",
      "the pasted key must not linger in the runtime",
    );
    assert.equal(api._internal.getRuntime().serpApiStatus, "yes");
  });

  it("saving the Gemini key targets the worker's Gemini env var", async () => {
    const { calls, fetchImpl } = makeSaveFetch();
    const { api } = loadEnhancements({ fetchImpl, host: saveHost });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ geminiKeyDraft: "gem-key-456" });
    await api.handleAction("enhancements_gemini_save_key");
    const envCall = calls.find((c) => c.url.includes("discovery-env-key"));
    assert.ok(envCall);
    assert.match(envCall.body, /BROWSER_USE_DISCOVERY_GEMINI_API_KEY/);
    assert.match(envCall.body, /gem-key-456/);
  });

  it("an empty key draft does nothing (no env write, no reboot)", async () => {
    const { calls, fetchImpl } = makeSaveFetch();
    const { api } = loadEnhancements({ fetchImpl, host: saveHost });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_save_key");
    assert.ok(!calls.some((c) => c.url.includes("discovery-env-key")));
    assert.ok(!calls.some((c) => c.url.includes("full-boot")));
  });

  it("a failed env write stops the chain (no reboot) and keeps the draft for retry", async () => {
    const { calls, fetchImpl } = makeSaveFetch({ envKeyOk: false });
    const { api } = loadEnhancements({ fetchImpl, host: saveHost });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ serpApiKeyDraft: "serp-key-123" });
    await api.handleAction("enhancements_serp_save_key");
    assert.ok(!calls.some((c) => c.url.includes("full-boot")), "no reboot on a failed write");
    assert.equal(api._internal.getRuntime().serpApiKeyDraft, "serp-key-123", "draft kept for retry");
  });
});

describe("enhancements wizard — saving a key actually restarts the worker", () => {
  it("saveWorkerEnvKey reboots with force_restart=1 (a spared healthy worker never loads the new key)", () => {
    assert.match(
      enhancementsJs,
      /full-boot\?port=8644&skip_tunnel=1&force_restart=1/,
      "the save chain must force the worker restart or the badge never flips",
    );
  });
  it("the key steps give greenfield users granular deep-linked instructions", () => {
    assert.match(enhancementsJs, /serpapi\.com\/users\/sign_up/, "step 1: create the account (deep link)");
    assert.match(enhancementsJs, /serpapi\.com\/manage-api-key/, "step 2: copy the key (deep link)");
    assert.match(enhancementsJs, /aistudio\.google\.com\/apikey/, "gemini: the key page (deep link)");
  });
});

describe("enhancements wizard — Gemini key passes through to AI Providers settings", () => {
  function passthroughEnv({ existingResumeKey = "" } = {}) {
    const merges = [];
    const { calls, fetchImpl } = (() => {
      const calls = [];
      return {
        calls,
        fetchImpl: async (url, opts = {}) => {
          calls.push({ url: String(url), method: opts.method || "GET", body: opts.body || null });
          if (String(url).includes("discovery-env-key")) return { ok: true, json: async () => ({ ok: true }) };
          if (String(url).includes("full-boot")) return { ok: true, json: async () => ({ ok: true }) };
          if (String(url).includes("discovery-health")) return { ok: true, json: async () => ({ ok: true, readiness: { serpApiGoogleJobs: { configured: false }, googleTools: { configured: true } } }) };
          return { ok: false, json: async () => ({}) };
        },
      };
    })();
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => null,
      getConfig: () => ({ resumeProvider: "openrouter", resumeGeminiApiKey: existingResumeKey }),
      mergeStoredConfigOverridePatch: (patch) => merges.push(patch),
    };
    return { merges, calls, host, fetchImpl };
  }

  it("saving the worker Gemini key persists it into resumeGeminiApiKey (AI Providers) when none is saved", async () => {
    const env = passthroughEnv();
    const { api } = loadEnhancements({ fetchImpl: env.fetchImpl, host: env.host });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ geminiKeyDraft: "gem-key-456" });
    await api.handleAction("enhancements_gemini_save_key");
    assert.equal(env.merges.length, 1, "must pass the key through to the dashboard settings");
    assert.equal(env.merges[0].resumeGeminiApiKey, "gem-key-456");
  });

  it("never clobbers an existing AI Providers Gemini key", async () => {
    const env = passthroughEnv({ existingResumeKey: "already-set" });
    const { api } = loadEnhancements({ fetchImpl: env.fetchImpl, host: env.host });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ geminiKeyDraft: "gem-key-456" });
    await api.handleAction("enhancements_gemini_save_key");
    assert.equal(env.merges.length, 0, "an existing dashboard key must win");
  });

  it("the SerpApi save never touches the AI Providers settings", async () => {
    const env = passthroughEnv();
    const { api } = loadEnhancements({ fetchImpl: env.fetchImpl, host: env.host });
    await api.openEnhancementsWizard();
    api._internal.updateRuntime({ serpApiKeyDraft: "serp-key" });
    await api.handleAction("enhancements_serp_save_key");
    assert.equal(env.merges.length, 0);
  });
});
