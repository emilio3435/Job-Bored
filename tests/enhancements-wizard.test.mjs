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

  it("enhancements_serp_api_done advances to gemini (status is re-polled in Task 4; here skip is treated as done)", async () => {
    const { api, shell } = loadEnhancements({
      host: { isOnboardingWizardVisible: () => false, isFirstRunWizardVisible: () => false },
    });
    await api.openEnhancementsWizard();
    await api.handleAction("enhancements_serp_api_done");
    assert.equal(shell.lastRender.input.activeStepId, "gemini");
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
    assert.ok(callouts.some((c) => /Configured/i.test(c.textContent)), "callout must say Configured");
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

  it("enhancements_serp_api_done re-polls /health before advancing to gemini", async () => {
    let pollCount = 0;
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      getDiscoveryReadinessSnapshot: () => ({ savedWebhookUrl: "http://localhost:8644/webhook" }),
    };
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/health")) {
        pollCount++;
        return { ok: true, json: async () => ({ readiness: { serpApiGoogleJobs: { configured: true }, googleTools: { configured: false } } }) };
      }
      return { ok: false };
    };
    const { api, shell } = loadEnhancements({ host, fetchImpl });
    await api.openEnhancementsWizard();     // poll 1
    await api.handleAction("enhancements_serp_api_done"); // poll 2
    assert.ok(pollCount >= 2, "must re-poll health when user says 'I did it'");
    assert.equal(shell.lastRender.input.activeStepId, "gemini");
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
