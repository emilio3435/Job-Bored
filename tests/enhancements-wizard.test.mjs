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
