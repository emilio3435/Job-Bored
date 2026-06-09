# Optional Enhancements Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the mandatory two-track onboarding is complete, surface a guided, fully skippable walk-through wizard that helps users unlock the three highest-value optional upgrades (SerpApi Google Jobs, Gemini for discovery, AI provider for drafts), with live readiness badges sourced from `/health` and deep-links into the correct settings surfaces. The wizard is offered only once all three mandatory completion flags are set, is re-enterable at any time, and never blocks anything.

**Architecture:** A new classic-global IIFE module `enhancements-wizard-ui.js` (`window.JobBoredEnhancements`) rendered through the shared `discovery-wizard-shell.js` `renderWizardShell` (variant `"generic"`, mountId `"enhancementsWizardMount"`) — the exact same shell pattern as `go-live-wizard-ui.js`. New per-item dismiss flags in `user-content-store.js` follow the existing `getAgentSetupDismissed`/`setAgentSetupDismissed` pattern. The go-live wizard done step gains a "Maximize your results (optional)" CTA that calls `host().requestEnhancementsSetup()`. A host bridge object (`window.JobBoredEnhancements.host`) registered in `bridge-registry.js` (matching the `goLive.host` block pattern). A small re-entry affordance `#enhancementsReEntryBtn` in `index.html`.

**Tech Stack:** Vanilla JS (classic-global IIFEs on `window`), `node --test` (run via `npm test` which includes `tests/integration/`), IndexedDB-backed `user-content-store.js`, `/health` endpoint fetch pattern from `apps-script-deploy.js:refreshSerpApiCalloutStatus`.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `user-content-store.js` | Dismiss flags + all-mandatory gate read | Add `serpApiEnhancementDismissed`, `geminiEnhancementDismissed`, `aiProviderEnhancementDismissed` flag trios + `isAllMandatorySetupComplete` helper; export all five |
| `enhancements-wizard-ui.js` (NEW) | Shell-rendered optional wizard: IIFE, runtime, 4 steps, /health badge polling, deep-link actions, done summary, open/request, `_internal` seam | Create from scratch, mirrors `go-live-wizard-ui.js` exactly |
| `index.html` | Mount node + script tag + re-entry affordance | Add `#enhancementsWizardMount` div (after `#goLiveSetupWizardMount`), `<script src="enhancements-wizard-ui.js"></script>` (after go-live), `#enhancementsReEntryBtn` button |
| `bridge-registry.js` | Host object wiring for new wizard | Add `enhancements.host = { ... }` block after `goLive.host` block (~line 433); expose `getUserContent`, `showToast`, `getDiscoveryReadinessSnapshot`, `openDrawerToSubtab`, `setActiveSettingsTab`, `openCommandCenterSettingsModal`, `isOnboardingWizardVisible`, `isFirstRunWizardVisible`, `hideOnboardingWizard`, `showOnboardingWizard`, `requestEnhancementsSetup` |
| `go-live-wizard-ui.js` | Done step gains "Maximize your results" CTA | Modify `buildDoneActions` (~line 787) and `handleGoLiveWizardAction` (~line 925) to add `go_live_open_enhancements` action that calls `host().requestEnhancementsSetup()` when all mandatory flags complete |
| `package.json` | `typecheck:repo` chain | Append `&& node --check enhancements-wizard-ui.js` |
| `tests/enhancements-wizard.test.mjs` (NEW) | Full behavioral test suite with VM-context shell harness | Create, mirrors `tests/go-live-wizard.test.mjs` exactly |

---

## Task 1: Dismiss-flag trios + gate read in `user-content-store.js`

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/user-content-store.js` (after `setWhatsNextDismissed` at ~line 622; export block at ~line 1125)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (new file, first describe block)

- [ ] **Step 1: Write the failing test.** Create `tests/enhancements-wizard.test.mjs` with only the store contract describe block:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="store: dismiss flag trios" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `getSerpApiEnhancementDismissed` is not a function.

- [ ] **Step 3: Implement in `user-content-store.js`.** Insert after `setWhatsNextDismissed` (after line 622), before `getSetting`:

```javascript
  async function getSerpApiEnhancementDismissed() {
    return !!(await getSetting("serpApiEnhancementDismissed"));
  }

  async function setSerpApiEnhancementDismissed(v) {
    await setSetting("serpApiEnhancementDismissed", !!v);
  }

  async function getGeminiEnhancementDismissed() {
    return !!(await getSetting("geminiEnhancementDismissed"));
  }

  async function setGeminiEnhancementDismissed(v) {
    await setSetting("geminiEnhancementDismissed", !!v);
  }

  async function getAiProviderEnhancementDismissed() {
    return !!(await getSetting("aiProviderEnhancementDismissed"));
  }

  async function setAiProviderEnhancementDismissed(v) {
    await setSetting("aiProviderEnhancementDismissed", !!v);
  }

  async function isAllMandatorySetupComplete() {
    const [infra, onboarding, discovery, goLive] = await Promise.all([
      isInfraSetupComplete(),
      isOnboardingComplete(),
      isDiscoverySetupComplete(),
      isGoLiveSetupComplete(),
    ]);
    return !!(infra && onboarding && discovery && goLive);
  }
```

Then in the `window.CommandCenterUserContent = { ... }` export block (~line 1125), add after `setWhatsNextDismissed,`:

```javascript
    getSerpApiEnhancementDismissed,
    setSerpApiEnhancementDismissed,
    getGeminiEnhancementDismissed,
    setGeminiEnhancementDismissed,
    getAiProviderEnhancementDismissed,
    setAiProviderEnhancementDismissed,
    isAllMandatorySetupComplete,
```

- [ ] **Step 4: Run the test, expect PASS**

```
node --test --test-name-pattern="store: dismiss flag trios" tests/enhancements-wizard.test.mjs
```

Expected: PASS (4/4). Then `node --check user-content-store.js`.

- [ ] **Step 5: Commit**

```bash
git add user-content-store.js tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): add dismiss-flag trios + isAllMandatorySetupComplete to UC store"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 2: New `enhancements-wizard-ui.js` skeleton + `index.html` mount + `package.json` typecheck entry

**Files:**
- Create: `/Users/emilionunezgarcia/Job-Bored/enhancements-wizard-ui.js`
- Modify: `/Users/emilionunezgarcia/Job-Bored/index.html` (after line 1498 for mount div; after line 1520 for script tag; within the what's-next-banner region for re-entry button)
- Modify: `/Users/emilionunezgarcia/Job-Bored/package.json` (`typecheck:repo` chain)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (add `loadEnhancements` harness + skeleton describe)

- [ ] **Step 1: Write the failing test.** Add the VM-context harness and skeleton describe block to `tests/enhancements-wizard.test.mjs` after the T1 describe block:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="skeleton: IIFE" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `enhancements-wizard-ui.js` does not exist.

- [ ] **Step 3: Create `enhancements-wizard-ui.js`.** The complete skeleton (steps left as stubs for Task 3):

```javascript
/* ============================================
   Optional Enhancements Wizard
   Guided, fully skippable walk-through for the three highest-value
   optional upgrades: SerpApi Google Jobs, Gemini for discovery, AI
   provider for drafts — plus a deferred "more" tier linking into Settings.

   Classic-global IIFE under window.JobBoredEnhancements — NOT an ES module.
   Loaded BEFORE app.js; host bridge read lazily via window.JobBoredEnhancements.host.
   ============================================ */
(() => {
  const root = window.JobBoredEnhancements || (window.JobBoredEnhancements = {});

  function host() {
    return root.host;
  }
  function dom() {
    return (typeof window !== "undefined" && window.JobBoredWizardDom) || null;
  }
  function shellApi() {
    const w = typeof window !== "undefined" && window.JobBoredDiscoveryWizard;
    return (w && w.shell) || null;
  }
  function uc() {
    return (typeof window !== "undefined" && window.CommandCenterUserContent) || null;
  }

  function emitOnboardingEvent(step, detail) {
    try {
      const t = typeof window !== "undefined" && window.JobBoredOnboardingTelemetry;
      if (t && typeof t.emit === "function") t.emit(step, detail);
    } catch (_) { /* telemetry is non-critical */ }
  }

  const MOUNT_ID = "enhancementsWizardMount";
  const HEADER_TITLE = "Maximize your results";
  const TITLE = "Maximize your results (optional)";
  const LEDE =
    "These optional upgrades materially improve job discovery and AI quality. Skip any step — you can always come back.";
  const FETCH_TIMEOUT_MS = 6000;

  // ----------------------------------------------------------------------
  // Runtime
  // ----------------------------------------------------------------------
  function defaultRuntime() {
    return {
      activeStepId: "serp_api",
      state: { currentStep: "serp_api", completedSteps: [] },
      entryPoint: "manual",
      serpApiStatus: null,   // null | "yes" | "no" | "unknown"
      geminiStatus: null,    // null | "yes" | "no" | "unknown"
      aiProviderConfigured: null, // null | true | false
      message: "",
      messageTone: "info",
      _onboardingHidden: false,
    };
  }

  let runtime = null;
  function getRuntime() { return runtime || (runtime = defaultRuntime()); }
  function setRuntime(next) { runtime = next || defaultRuntime(); return runtime; }
  function updateRuntime(patch) { runtime = { ...getRuntime(), ...(patch || {}) }; return runtime; }
  function clearRuntime() { runtime = null; }

  // ----------------------------------------------------------------------
  // DOM helpers — match go-live-wizard-ui.js exactly
  // ----------------------------------------------------------------------
  function safeCreate(tag, className, text) {
    const D = dom();
    if (D && typeof D.createWizardNode === "function") return D.createWizardNode(tag, className, text);
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function safeParagraph(parent, text, className) {
    if (!text) return null;
    const D = dom();
    if (D && typeof D.appendWizardParagraph === "function") return D.appendWizardParagraph(parent, text, className || "discovery-setup-wizard__copy");
    const p = safeCreate("p", className || "discovery-setup-wizard__copy", text);
    parent.appendChild(p);
    return p;
  }

  function safeList(parent, items) {
    const D = dom();
    if (D && typeof D.appendWizardList === "function") return D.appendWizardList(parent, items);
    const ul = safeCreate("ul", "discovery-setup-wizard__list");
    (items || []).filter(Boolean).forEach((item) => { const li = safeCreate("li", "", String(item)); ul.appendChild(li); });
    parent.appendChild(ul);
    return ul;
  }

  function safeCallout(parent, text, tone) {
    if (!text) return null;
    const card = safeCreate("div", `discovery-setup-wizard__callout${tone ? ` discovery-setup-wizard__callout--${tone}` : ""}`);
    safeParagraph(card, text, "discovery-setup-wizard__callout-text");
    parent.appendChild(card);
    return card;
  }

  // ----------------------------------------------------------------------
  // Step body builders — stubs filled out in Task 3
  // ----------------------------------------------------------------------
  function buildSerpApiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "SerpApi Google Jobs gives you the highest recall — Google's full job index across 100+ ATS platforms.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "1. Sign up at serpapi.com and get your API key.");
    safeParagraph(container, "2. Add SERP_API_KEY=<your-key> to your worker .env file.");
    safeParagraph(container, "3. Restart the discovery worker (Ctrl-C then npm start).");
    const statusText =
      rt.serpApiStatus === "yes" ? "✓ Configured" :
      rt.serpApiStatus === "no" ? "Not configured" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, rt.serpApiStatus === "yes" ? "success" : "info");
    return container;
  }

  function buildGeminiBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "A Gemini API key powers grounded web-search and the 'Add job from URL' feature inside discovery.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "1. Get a free key at aistudio.google.com.");
    safeParagraph(container, "2. Add GOOGLE_API_KEY=<your-key> to your worker .env file.");
    safeParagraph(container, "3. Restart the discovery worker.");
    const statusText =
      rt.geminiStatus === "yes" ? "✓ Configured" :
      rt.geminiStatus === "no" ? "Not configured" :
      "Status unknown — worker may be offline";
    safeCallout(container, `Worker status: ${statusText}`, rt.geminiStatus === "yes" ? "success" : "info");
    return container;
  }

  function buildAiProviderBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "A configured AI provider powers your resume tailoring and cover letter generation.", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    safeParagraph(container, "OpenRouter (free) is shipped as the default. You can also use Gemini, OpenAI, Anthropic, a local model (Ollama), or a custom webhook.");
    const statusText =
      rt.aiProviderConfigured === true ? "✓ Provider configured" :
      rt.aiProviderConfigured === false ? "No active API key detected" :
      "Not checked";
    safeCallout(container, `Status: ${statusText}`, rt.aiProviderConfigured === true ? "success" : "info");
    return container;
  }

  function buildMoreOptionalBody() {
    const container = safeCreate("div", "enhancements-wizard__step");
    safeParagraph(container, "These niche power-ups are optional and can be configured any time in Settings.", "discovery-setup-wizard__copy");
    safeList(container, [
      "ATS scoring endpoint — Settings → Job Discovery for the URL",
      "Company logos (Logo.dev token) — Settings → General",
      "Browser Use Cloud fallback — Settings → Job Discovery",
    ]);
    return container;
  }

  function buildDoneBody(rt) {
    const container = safeCreate("div", "enhancements-wizard__done");
    safeParagraph(container, "Setup complete. Here is what you configured:", "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold");
    const lines = [];
    if (rt.serpApiStatus === "yes") lines.push("✓ SerpApi Google Jobs — active");
    else lines.push("○ SerpApi Google Jobs — not configured (skip)");
    if (rt.geminiStatus === "yes") lines.push("✓ Gemini for discovery — active");
    else lines.push("○ Gemini for discovery — not configured (skip)");
    if (rt.aiProviderConfigured === true) lines.push("✓ AI provider — configured");
    else lines.push("○ AI provider — not configured (skip)");
    safeList(container, lines);
    return container;
  }

  // ----------------------------------------------------------------------
  // Actions for each step
  // ----------------------------------------------------------------------
  function buildStepActions(stepId, rt) {
    const void_ = void rt;
    void void_;
    if (stepId === "serp_api") {
      return [
        { id: "enhancements_serp_api_done", label: "I did it", variant: "primary" },
        { id: "enhancements_serp_api_open_drawer", label: "Open Discovery → Sources", variant: "secondary" },
        { id: "enhancements_serp_api_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "gemini") {
      return [
        { id: "enhancements_gemini_done", label: "I did it", variant: "primary" },
        { id: "enhancements_gemini_open_drawer", label: "Open Discovery → Sources", variant: "secondary" },
        { id: "enhancements_gemini_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "ai_provider") {
      return [
        { id: "enhancements_ai_provider_open_settings", label: "Open AI Providers settings", variant: "primary" },
        { id: "enhancements_ai_provider_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "more_optional") {
      return [
        { id: "enhancements_more_next", label: "Next", variant: "primary" },
        { id: "enhancements_more_skip", label: "Skip", variant: "ghost" },
      ];
    }
    if (stepId === "done") {
      return [
        { id: "enhancements_finish", label: "Done", variant: "primary" },
      ];
    }
    return [];
  }

  function buildSteps(rt) {
    const r = rt || getRuntime();
    return [
      {
        id: "serp_api",
        label: "SerpApi",
        title: "SerpApi Google Jobs",
        description: "Highest-recall source — Google's job index across 100+ ATS platforms.",
        body: () => buildSerpApiBody(r),
        actions: buildStepActions("serp_api", r),
        secondaryActions: [],
      },
      {
        id: "gemini",
        label: "Gemini",
        title: "Gemini for discovery",
        description: "Powers grounded web-search + 'Add job from URL' in discovery.",
        body: () => buildGeminiBody(r),
        actions: buildStepActions("gemini", r),
        secondaryActions: [],
      },
      {
        id: "ai_provider",
        label: "AI provider",
        title: "AI provider for drafts",
        description: "Powers resume tailoring and cover letter generation.",
        body: () => buildAiProviderBody(r),
        actions: buildStepActions("ai_provider", r),
        secondaryActions: [],
      },
      {
        id: "more_optional",
        label: "More",
        title: "More optional integrations",
        description: "ATS scoring, company logos, Browser Use Cloud — configure later in Settings.",
        body: () => buildMoreOptionalBody(),
        actions: buildStepActions("more_optional", r),
        secondaryActions: [],
      },
      {
        id: "done",
        label: "Done",
        title: "All set.",
        description: "You can always re-open this wizard from the dashboard.",
        body: () => buildDoneBody(r),
        actions: buildStepActions("done", r),
        secondaryActions: [],
      },
    ];
  }

  // ----------------------------------------------------------------------
  // Render + navigate
  // ----------------------------------------------------------------------
  function renderEnhancementsWizard() {
    const api = shellApi();
    if (!api || typeof api.renderWizardShell !== "function") return null;
    const rt = getRuntime();
    return api.renderWizardShell({
      mountId: MOUNT_ID,
      variant: "generic",
      headerTitle: HEADER_TITLE,
      title: TITLE,
      lede: LEDE,
      steps: buildSteps(rt),
      activeStepId: rt.activeStepId,
      state: rt.state,
      onAction: (actionId) => {
        void handleAction(actionId).catch((err) => {
          if (typeof console !== "undefined") console.error("[JobBored] enhancements wizard action:", actionId, err);
        });
      },
      onNavigate: (stepId) => {
        updateRuntime({ activeStepId: stepId, state: { ...rt.state, currentStep: stepId } });
      },
      onClose: () => {
        const r = getRuntime();
        const shouldRestoreOnboarding = !!(r && r._onboardingHidden);
        clearRuntime();
        if (shouldRestoreOnboarding) {
          const h = host();
          if (h && typeof h.showOnboardingWizard === "function") h.showOnboardingWizard();
        }
      },
    });
  }

  function moveToStep(stepId, patch) {
    updateRuntime({ activeStepId: stepId, state: { ...getRuntime().state, currentStep: stepId }, ...(patch || {}) });
    return renderEnhancementsWizard();
  }

  // ----------------------------------------------------------------------
  // Action dispatcher — stub; filled out in Task 3 onwards
  // ----------------------------------------------------------------------
  async function handleAction(actionId) {
    const id = String(actionId || "");

    if (id === "enhancements_finish") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") api.closeWizardShell("finish");
      emitOnboardingEvent("enhancements_finished");
      return null;
    }

    return null;
  }

  // ----------------------------------------------------------------------
  // Entry points
  // ----------------------------------------------------------------------
  async function openEnhancementsWizard(options) {
    const opts = options || {};
    emitOnboardingEvent("enhancements_opened", { entryPoint: opts.entryPoint || "manual" });
    const h = host();
    const onboardingWasVisible =
      h && typeof h.isOnboardingWizardVisible === "function" ? !!h.isOnboardingWizardVisible() : false;
    if (onboardingWasVisible && h && typeof h.hideOnboardingWizard === "function") h.hideOnboardingWizard();
    setRuntime({ ...defaultRuntime(), entryPoint: opts.entryPoint || "manual", _onboardingHidden: onboardingWasVisible });
    return renderEnhancementsWizard();
  }

  async function requestEnhancementsSetup(options) {
    const opts = options || {};
    const { allowWhileOnboarding = false, ...wizardOptions } = opts;
    const h = host();
    if (h && !allowWhileOnboarding) {
      const onboardingUp = typeof h.isOnboardingWizardVisible === "function" && h.isOnboardingWizardVisible();
      const firstRunUp = typeof h.isFirstRunWizardVisible === "function" && h.isFirstRunWizardVisible();
      if (onboardingUp || firstRunUp) return { deferred: true };
    }
    await openEnhancementsWizard(wizardOptions);
    return { deferred: false };
  }

  // ----------------------------------------------------------------------
  // Public surface
  // ----------------------------------------------------------------------
  Object.assign(root, {
    openEnhancementsWizard,
    requestEnhancementsSetup,
    renderEnhancementsWizard,
    handleAction,
    buildSteps,
    MOUNT_ID,
    HEADER_TITLE,
  });
  root._internal = {
    getRuntime,
    setRuntime,
    updateRuntime,
    clearRuntime,
    buildSerpApiBody,
    buildGeminiBody,
    buildAiProviderBody,
    buildMoreOptionalBody,
    buildDoneBody,
    buildStepActions,
  };
})();
```

- [ ] **Step 4: Add mount div to `index.html`** after the `#goLiveSetupWizardMount` div (~line 1498):

```html
    <div
      class="discovery-setup-wizard-root"
      id="enhancementsWizardMount"
      hidden
      aria-hidden="true"
    ></div>
```

- [ ] **Step 5: Add script tag to `index.html`** after `<script src="go-live-wizard-ui.js"></script>` (~line 1520):

```html
    <script src="enhancements-wizard-ui.js"></script>
```

- [ ] **Step 6: Add re-entry affordance to `index.html`.** Find the `#whatsNextDismiss` / what's-next region. Add immediately after the `#whatsNextLater` button (or adjacent to the banner's action row):

```html
<button id="enhancementsReEntryBtn" class="whats-next-banner__later" type="button" hidden>Maximize results</button>
```

- [ ] **Step 7: Add to `typecheck:repo` chain in `package.json`** — append `&& node --check enhancements-wizard-ui.js` to the end of the existing `typecheck:repo` value string.

- [ ] **Step 8: Run the test, expect PASS**

```
node --test --test-name-pattern="skeleton: IIFE" tests/enhancements-wizard.test.mjs
```

Expected: PASS (5/5). Then `node --check enhancements-wizard-ui.js`.

- [ ] **Step 9: Commit**

```bash
git add enhancements-wizard-ui.js index.html package.json tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): skeleton IIFE + mount + script tag + typecheck chain"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 3: Build the 4 steps — step bodies, skip actions, done summary

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/enhancements-wizard-ui.js` (`handleAction` + step bodies are already written in Task 2; this task wires all the step-advance and skip logic)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (new describe block for step navigation + skip flow)

- [ ] **Step 1: Write the failing test.** Add to `tests/enhancements-wizard.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="step navigation and skip flow" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `handleAction` skip cases return null without advancing.

- [ ] **Step 3: Implement the full `handleAction` dispatcher in `enhancements-wizard-ui.js`.** Replace the stub `handleAction` body with:

```javascript
  async function handleAction(actionId) {
    const id = String(actionId || "");

    if (id === "enhancements_finish") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") api.closeWizardShell("finish");
      emitOnboardingEvent("enhancements_finished");
      return null;
    }

    if (id === "enhancements_serp_api_skip") {
      try {
        const u = uc();
        if (u && typeof u.setSerpApiEnhancementDismissed === "function") {
          await u.setSerpApiEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip serpApi:", e); }
      return moveToStep("gemini");
    }

    if (id === "enhancements_serp_api_done") {
      return moveToStep("gemini");
    }

    if (id === "enhancements_gemini_skip") {
      try {
        const u = uc();
        if (u && typeof u.setGeminiEnhancementDismissed === "function") {
          await u.setGeminiEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip gemini:", e); }
      return moveToStep("ai_provider");
    }

    if (id === "enhancements_gemini_done") {
      return moveToStep("ai_provider");
    }

    if (id === "enhancements_ai_provider_skip") {
      try {
        const u = uc();
        if (u && typeof u.setAiProviderEnhancementDismissed === "function") {
          await u.setAiProviderEnhancementDismissed(true);
        }
      } catch (e) { console.warn("[JobBored] enhancements skip aiProvider:", e); }
      return moveToStep("more_optional");
    }

    if (id === "enhancements_ai_provider_open_settings") {
      return moveToStep("more_optional");
    }

    if (id === "enhancements_more_next" || id === "enhancements_more_skip") {
      return moveToStep("done");
    }

    if (id === "enhancements_serp_api_open_drawer" || id === "enhancements_gemini_open_drawer") {
      const h = host();
      if (h && typeof h.openDrawerToSubtab === "function") {
        try { h.openDrawerToSubtab("sources", null); } catch (e) { console.warn("[JobBored] enhancements open drawer:", e); }
      }
      return null;
    }

    return null;
  }
```

- [ ] **Step 4: Run the test, expect PASS**

```
node --test --test-name-pattern="step navigation and skip flow" tests/enhancements-wizard.test.mjs
```

Expected: PASS (8/8). Then `node --check enhancements-wizard-ui.js`.

- [ ] **Step 5: Commit**

```bash
git add enhancements-wizard-ui.js tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): step bodies, skip/done actions, done summary"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 4: Live `/health` status badge wiring

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/enhancements-wizard-ui.js` (add `probeHealthStatus`, wire into `handleAction` for `_done` actions + a re-poll on open, and plumb `serpApiStatus`/`geminiStatus` through `buildSerpApiBody`/`buildGeminiBody` — those already read from `rt`)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (new describe block for health polling)

The pattern to replicate from `apps-script-deploy.js:refreshSerpApiCalloutStatus` (~line 694):
1. Read `host().getDiscoveryReadinessSnapshot()` to get `savedWebhookUrl`.
2. Derive `healthUrl` by swapping the path to `/health`.
3. `fetch(healthUrl, { method: "GET", mode: "cors" })` → parse JSON → read `payload.readiness.serpApiGoogleJobs.configured` and `payload.readiness.googleTools.configured`.
4. Map to `"yes"` / `"no"` / `"unknown"`.

- [ ] **Step 1: Write the failing test.** Add to `tests/enhancements-wizard.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="health status badge wiring" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `serpApiStatus` is null; no fetch to `/health`.

- [ ] **Step 3: Implement `probeHealthStatus` in `enhancements-wizard-ui.js`.** Add after the `FETCH_TIMEOUT_MS` constant and before `defaultRuntime`:

```javascript
  function fetchWithTimeout(url, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof AbortController === "undefined") return fetch(url, opts);
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function probeHealthStatus() {
    try {
      const h = host();
      const snapshot = h && typeof h.getDiscoveryReadinessSnapshot === "function"
        ? h.getDiscoveryReadinessSnapshot() : null;
      const webhookUrl = (snapshot && snapshot.savedWebhookUrl) || "";
      if (!webhookUrl) {
        updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
        return;
      }
      let healthUrl = "";
      try {
        const u = new URL(webhookUrl);
        u.pathname = "/health"; u.search = ""; u.hash = "";
        healthUrl = u.toString();
      } catch (_) {}
      if (!healthUrl) {
        updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
        return;
      }
      const r = await fetchWithTimeout(healthUrl, { method: "GET", mode: "cors" });
      const payload = r && r.ok ? await r.json().catch(() => null) : null;
      const serpFlag = payload && payload.readiness && payload.readiness.serpApiGoogleJobs;
      const geminiFlag = payload && payload.readiness && payload.readiness.googleTools;
      updateRuntime({
        serpApiStatus: serpFlag ? (serpFlag.configured ? "yes" : "no") : "unknown",
        geminiStatus: geminiFlag ? (geminiFlag.configured ? "yes" : "no") : "unknown",
      });
    } catch (e) {
      console.warn("[JobBored] enhancements health probe:", e);
      updateRuntime({ serpApiStatus: "unknown", geminiStatus: "unknown" });
    }
  }
```

In `openEnhancementsWizard`, after `setRuntime(...)` and before `return renderEnhancementsWizard()`:

```javascript
    await probeHealthStatus();
```

In `handleAction`, replace the stub `enhancements_serp_api_done` case with:

```javascript
    if (id === "enhancements_serp_api_done") {
      await probeHealthStatus();
      return moveToStep("gemini");
    }

    if (id === "enhancements_gemini_done") {
      await probeHealthStatus();
      return moveToStep("ai_provider");
    }
```

Expose `probeHealthStatus` in `root._internal` for test access:

```javascript
  root._internal = {
    getRuntime, setRuntime, updateRuntime, clearRuntime,
    buildSerpApiBody, buildGeminiBody, buildAiProviderBody,
    buildMoreOptionalBody, buildDoneBody, buildStepActions,
    probeHealthStatus,
  };
```

- [ ] **Step 4: Run the test, expect PASS**

```
node --test --test-name-pattern="health status badge wiring" tests/enhancements-wizard.test.mjs
```

Expected: PASS (4/4). Then `node --check enhancements-wizard-ui.js`.

- [ ] **Step 5: Commit**

```bash
git add enhancements-wizard-ui.js tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): /health status badge wiring for SerpApi + Gemini"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 5: Deep-link actions + AI-provider status + re-poll on return

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/enhancements-wizard-ui.js` (`handleAction` for the open-drawer and open-settings actions; add `probeAiProviderStatus`)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (deep-link describe block)

The AI-provider status is read from config (not `/health`): `window.COMMAND_CENTER_CONFIG.resumeProvider` plus any non-empty key field. Since the wizard runs in the browser, the simplest gate is: configured = `resumeProvider` is set in config and is not the empty default. The cleanest approach — expose a `getConfig` call via the host bridge — maps to `host().getConfig()`, which is already bridged in `app.core.host`. The wizard reads `config.resumeProvider` and `config.resumeOpenRouterApiKey || config.resumeGeminiApiKey || ...` to decide `aiProviderConfigured`.

`openDrawerToSubtab` is a window global (set by `settings-discovery-adapters.js`). `setActiveSettingsTab` is on `window.JobBoredSettingsTabs`. Since these are window globals, the wizard must call them through the host bridge — which means the bridge needs `openDrawerToSubtab` and `setActiveSettingsTab` forwarded. Both are added in Task 7 (bridge-registry). Here, the wizard calls them through the host object; the test stubs them directly.

- [ ] **Step 1: Write the failing test.** Add to `tests/enhancements-wizard.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="deep-link actions" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — drawer calls not made; `aiProviderConfigured` still null.

- [ ] **Step 3: Implement `probeAiProviderStatus` and wire the AI provider + deep-link actions.** Add `probeAiProviderStatus` near `probeHealthStatus` in `enhancements-wizard-ui.js`:

```javascript
  function probeAiProviderStatus() {
    try {
      const h = host();
      const config = h && typeof h.getConfig === "function" ? h.getConfig() : null;
      if (!config) { updateRuntime({ aiProviderConfigured: null }); return; }
      const provider = String(config.resumeProvider || "").toLowerCase();
      const hasKey =
        (provider === "gemini" && !!String(config.resumeGeminiApiKey || "").trim()) ||
        (provider === "openai" && !!String(config.resumeOpenAIApiKey || "").trim()) ||
        (provider === "anthropic" && !!String(config.resumeAnthropicApiKey || "").trim()) ||
        (provider === "openrouter" && !!String(config.resumeOpenRouterApiKey || "").trim()) ||
        (provider === "local" && !!String(config.resumeLocalBaseUrl || "").trim()) ||
        (provider === "webhook" && !!String(config.resumeGenerationWebhookUrl || "").trim());
      updateRuntime({ aiProviderConfigured: hasKey });
    } catch (e) {
      console.warn("[JobBored] enhancements AI provider check:", e);
      updateRuntime({ aiProviderConfigured: null });
    }
  }
```

In `openEnhancementsWizard`, after `await probeHealthStatus()`, add:

```javascript
    probeAiProviderStatus();
```

Update the deep-link actions in `handleAction`. Replace `enhancements_serp_api_open_drawer` / `enhancements_gemini_open_drawer` block and the `enhancements_ai_provider_open_settings` case:

```javascript
    if (id === "enhancements_serp_api_open_drawer" || id === "enhancements_gemini_open_drawer") {
      const h = host();
      if (h && typeof h.openDrawerToSubtab === "function") {
        try { h.openDrawerToSubtab("sources", null); } catch (e) { console.warn("[JobBored] enhancements open drawer:", e); }
      }
      return null;
    }

    if (id === "enhancements_ai_provider_open_settings") {
      const h = host();
      try {
        if (h && typeof h.openCommandCenterSettingsModal === "function") h.openCommandCenterSettingsModal();
        if (h && typeof h.setActiveSettingsTab === "function") {
          h.setActiveSettingsTab("ai_providers", { focusField: "settingsResumeProvider" });
        }
      } catch (e) { console.warn("[JobBored] enhancements open AI settings:", e); }
      return moveToStep("more_optional");
    }
```

Expose `probeAiProviderStatus` in `root._internal`.

- [ ] **Step 4: Run the test, expect PASS**

```
node --test --test-name-pattern="deep-link actions" tests/enhancements-wizard.test.mjs
```

Expected: PASS (5/5). Then `node --check enhancements-wizard-ui.js`.

- [ ] **Step 5: Commit**

```bash
git add enhancements-wizard-ui.js tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): deep-link actions + AI-provider status probe"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 6: Go-live done step CTA + mandatory-gate defer

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/go-live-wizard-ui.js` (`buildDoneBody`, `buildDoneActions`, `handleGoLiveWizardAction`)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/go-live-wizard.test.mjs` (new describe block)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (gate defer describe block)

The go-live done step already has a "Turn on job discovery" CTA when discovery is incomplete. We add a parallel "Maximize your results (optional)" CTA that fires when `isAllMandatorySetupComplete` returns true (i.e., go-live completion just made all three flags true). The logic: when `showCta` is false (discovery already done) AND `isAllMandatorySetupComplete()` returns true after completing go-live, show the enhancements CTA.

- [ ] **Step 1: Write the failing test in `tests/go-live-wizard.test.mjs`.** Add after the existing done-step describe:

```javascript
describe("go-live wizard — enhancements CTA on done step", () => {
  it("done step shows 'Maximize your results' CTA when all mandatory flags are complete after go-live finishes", async () => {
    const uc = {
      completeGoLiveSetup: async () => {},
      isDiscoverySetupComplete: async () => true,    // discovery already done
      isAllMandatorySetupComplete: async () => true, // all three now done
    };
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") {
        return { ok: true, json: async () => ({ installed: true, loggedIn: true, dnsName: "mac.tailnet.ts.net", dashboardUrl: "https://mac.tailnet.ts.net", serving: { 8080: true }, recommendation: "ready" }) };
      }
      if (url === "/__proxy/install-doctor") return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl, uc });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("go_live_complete_tailscale");
    const doneStep = shell.lastRender.input.steps.find((s) => s.id === "done");
    const actionIds = (doneStep.actions || []).map((a) => a.id);
    assert.ok(actionIds.includes("go_live_open_enhancements"), "must include 'go_live_open_enhancements' CTA when all mandatory complete");
  });

  it("done step does NOT show enhancements CTA when discovery is still incomplete (two-track not done)", async () => {
    const uc = {
      completeGoLiveSetup: async () => {},
      isDiscoverySetupComplete: async () => false,
      isAllMandatorySetupComplete: async () => false,
    };
    const fetchImpl = async (url) => {
      if (url === "/__proxy/tailscale-state") return { ok: true, json: async () => ({ installed: true, loggedIn: true, dnsName: "mac.tailnet.ts.net", dashboardUrl: "https://mac.tailnet.ts.net", serving: { 8080: true }, recommendation: "ready" }) };
      if (url === "/__proxy/install-doctor") return { ok: true, json: async () => ({ ok: true, tools: {} }) };
      return { ok: false };
    };
    const { api, shell } = loadGoLive({ fetchImpl, uc });
    await api.openGoLiveSetupWizard();
    await api.handleAction("wizard_choose_path_tailscale");
    await api.handleAction("go_live_complete_tailscale");
    const doneStep = shell.lastRender.input.steps.find((s) => s.id === "done");
    const actionIds = (doneStep.actions || []).map((a) => a.id);
    assert.ok(!actionIds.includes("go_live_open_enhancements"), "must NOT show enhancements CTA when mandatory setup is still incomplete");
  });

  it("go_live_open_enhancements calls host().requestEnhancementsSetup and closes the wizard", async () => {
    const enhancementsCalls = [];
    const host = {
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
      requestEnhancementsSetup: (opts) => { enhancementsCalls.push(opts); return Promise.resolve({ deferred: false }); },
    };
    const { api, closeCalls } = loadGoLive({ host });
    await api.openGoLiveSetupWizard();
    await api.handleAction("go_live_open_enhancements");
    assert.equal(enhancementsCalls.length, 1, "must call requestEnhancementsSetup");
    assert.ok(closeCalls.length >= 1, "must close the go-live wizard before launching enhancements");
  });
});
```

- [ ] **Step 2: Write the failing gate-defer test in `tests/enhancements-wizard.test.mjs`.** Add a new describe block:

```javascript
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
```

- [ ] **Step 3: Run the tests, expect FAIL**

```
node --test --test-name-pattern="enhancements CTA on done step" tests/go-live-wizard.test.mjs
node --test --test-name-pattern="mandatory-gate defer" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `go_live_open_enhancements` action id does not exist; `isAllMandatorySetupComplete` not called.

- [ ] **Step 4: Implement in `go-live-wizard-ui.js`.**

In `buildDoneActions` (~line 787), the function already receives `rt` and uses `rt._discoveryCtaVisible` and now also needs `rt._enhancementsCtaVisible`. Add the new action:

```javascript
  function buildDoneActions(rt) {
    const showDiscoveryCta = rt._discoveryCtaVisible !== false;
    const showEnhancementsCta = !showDiscoveryCta && rt._enhancementsCtaVisible === true;
    const actions = [];
    if (showDiscoveryCta) {
      actions.push({ id: "go_live_open_discovery", label: "Turn on job discovery", variant: "primary" });
    }
    if (showEnhancementsCta) {
      actions.push({ id: "go_live_open_enhancements", label: "Maximize your results (optional)", variant: "primary" });
    }
    actions.push({
      id: "go_live_finish",
      label: "Close",
      variant: (showDiscoveryCta || showEnhancementsCta) ? "secondary" : "primary",
    });
    return actions;
  }
```

In `handleGoLiveWizardAction`, in the `go_live_complete_tailscale || go_live_complete_cloud` block (~line 1015), after computing `showCta`, add the enhancements gate check:

```javascript
      let showEnhancementsCta = false;
      if (!showCta) {
        const U = uc();
        if (U && typeof U.isAllMandatorySetupComplete === "function") {
          try { showEnhancementsCta = !!(await U.isAllMandatorySetupComplete()); } catch (_) { showEnhancementsCta = false; }
        }
      }
```

And pass it through:

```javascript
      return moveToStep("done", { _discoveryCtaVisible: showCta, _enhancementsCtaVisible: showEnhancementsCta });
```

Add the new `go_live_open_enhancements` action handler after `go_live_open_discovery`:

```javascript
    if (id === "go_live_open_enhancements") {
      const api = shellApi();
      if (api && typeof api.closeWizardShell === "function") api.closeWizardShell("enhancements_cross_rec");
      const h = host();
      if (h && typeof h.requestEnhancementsSetup === "function") {
        return h.requestEnhancementsSetup({ entryPoint: "go_live_cross_rec", allowWhileOnboarding: false });
      }
      return null;
    }
```

Also expose `isAllMandatorySetupComplete` reading in the `uc()` call — `uc()` already returns `window.CommandCenterUserContent` which will have the new method from Task 1.

- [ ] **Step 5: Run the tests, expect PASS**

```
node --test --test-name-pattern="enhancements CTA on done step" tests/go-live-wizard.test.mjs
node --test --test-name-pattern="mandatory-gate defer" tests/enhancements-wizard.test.mjs
```

Expected: all PASS. Then `node --check go-live-wizard-ui.js` and `node --check enhancements-wizard-ui.js`.

- [ ] **Step 6: Commit**

```bash
git add go-live-wizard-ui.js tests/go-live-wizard.test.mjs tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): go-live done CTA + mandatory-gate defer in requestEnhancementsSetup"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 7: `bridge-registry.js` host wiring

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/bridge-registry.js` (add `enhancements` host block after `goLive.host` block at line ~433)
- Modify: `/Users/emilionunezgarcia/Job-Bored/app.js` (add `requestEnhancementsSetup` to the host export list; it must be a function defined in app.js that delegates to `window.JobBoredEnhancements.requestEnhancementsSetup`)
- Test: `/Users/emilionunezgarcia/Job-Bored/tests/enhancements-wizard.test.mjs` (bridge wiring describe block)

> **Integration note:** `openDrawerToSubtab` is a window global (`window.openDiscoveryDrawer` + `window.JobBoredDiscoveryDrawerSubtabs.setActiveSubtab`), not directly on the `host` object. The cleanest approach: define `openDrawerToSubtab` as a thin host function in `app.js` that calls `window.JobBoredSettingsDiscoveryAdapters.openDrawerToSubtab || function(){}`, then pass it through the bridge. Similarly `setActiveSettingsTab` delegates to `window.JobBoredSettingsTabs.setActiveSettingsTab`. Both are safe because those globals are set up before `app.js` runs (they are loaded earlier in the script order).

- [ ] **Step 1: Write the failing test.** Add to `tests/enhancements-wizard.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test, expect FAIL**

```
node --test --test-name-pattern="bridge-registry wiring" tests/enhancements-wizard.test.mjs
```

Expected: FAIL — `enhancements.host` does not exist.

- [ ] **Step 3: Add `requestEnhancementsSetup` and the two deep-link helpers to `app.js`.** Find the host exports list in `app.js` (the alphabetical listing near line 478). Add `requestEnhancementsSetup` in sorted order, and define the function in the app.js body (place it near `requestGoLiveSetup`):

```javascript
function requestEnhancementsSetup(options) {
  const mod = typeof window !== "undefined" && window.JobBoredEnhancements;
  if (mod && typeof mod.requestEnhancementsSetup === "function") {
    return mod.requestEnhancementsSetup(options);
  }
  return Promise.resolve({ deferred: true });
}

function openDrawerToSubtab(subtab, focusFieldId) {
  const adapters =
    typeof window !== "undefined" && window.JobBoredSettingsDiscoveryAdapters;
  if (adapters && typeof adapters.openDrawerToSubtab === "function") {
    return adapters.openDrawerToSubtab(subtab, focusFieldId);
  }
  // Fallback: call the global directly
  const fn = typeof window !== "undefined" && window.openDiscoveryDrawer;
  if (typeof fn === "function") fn();
}

function setActiveSettingsTab(tabId, opts) {
  const tabs = typeof window !== "undefined" && window.JobBoredSettingsTabs;
  if (tabs && typeof tabs.setActiveSettingsTab === "function") {
    return tabs.setActiveSettingsTab(tabId, opts);
  }
}
```

Verify `openDrawerToSubtab` and `setActiveSettingsTab` are not already defined in `app.js` before adding. If they are already exported as bridge helpers elsewhere, reuse those names instead.

Add all three to the host exports near line 478:

```javascript
    openDrawerToSubtab,
    requestEnhancementsSetup,
    setActiveSettingsTab,
```

- [ ] **Step 4: Add `enhancements.host` block in `bridge-registry.js`.** After `goLive.host = { ... };` (line ~433), add:

```javascript
    const enhancements = (window.JobBoredEnhancements =
      window.JobBoredEnhancements || {});

    enhancements.host = {
      showToast: host.showToast,
      getUserContent: host.getUserContent,
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      getConfig: host.getConfig,
      openDrawerToSubtab: host.openDrawerToSubtab,
      setActiveSettingsTab: host.setActiveSettingsTab,
      openCommandCenterSettingsModal: host.openCommandCenterSettingsModal,
      isOnboardingWizardVisible: host.isOnboardingWizardVisible,
      isFirstRunWizardVisible: host.isFirstRunWizardVisible,
      hideOnboardingWizard: host.hideOnboardingWizard,
      showOnboardingWizard: host.showOnboardingWizard,
      requestEnhancementsSetup: host.requestEnhancementsSetup,
    };
```

- [ ] **Step 5: Run the test, expect PASS**

```
node --test --test-name-pattern="bridge-registry wiring" tests/enhancements-wizard.test.mjs
```

Expected: PASS (2/2). Then `node --check bridge-registry.js` and `node --check app.js`.

- [ ] **Step 6: Commit**

```bash
git add bridge-registry.js app.js tests/enhancements-wizard.test.mjs
git commit -m "feat(enhancements-wizard): bridge-registry host wiring + app.js requestEnhancementsSetup"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Task 8: Full-gate verification

- [ ] **Step 1: Run the full CI gate**

```
npm test
```

Expected: all pass, 0 fail, 0 skip. (This runs `scripts/run-tests.mjs` which includes `tests/integration/`.)

- [ ] **Step 2: Run the typecheck chain**

```
npm run typecheck:repo
```

Expected: exit 0. (This now includes `node --check enhancements-wizard-ui.js`.)

- [ ] **Step 3: Check for whitespace/conflict markers**

```
git diff --check
```

Expected: clean (no trailing whitespace, no conflict markers).

- [ ] **Step 4: Manual smoke** (optional but recommended): Fresh state (`rm -rf ~/.jobbored`), `PORT=8080 npm run web-only`, complete all mandatory setup, confirm the go-live done step shows "Maximize your results (optional)" once all three flags are complete, open the enhancements wizard, verify the SerpApi step renders a status callout, skip all steps, confirm the done summary lists all three items, close — confirm the wizard is re-openable via `#enhancementsReEntryBtn`.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/optional-enhancements-wizard
gh pr create --base main --title "feat(enhancements-wizard): optional guided walk-through for SerpApi, Gemini, AI provider" --body "Spec: docs/superpowers/specs/2026-06-09-optional-enhancements-wizard-design.md. Offers after all mandatory flags complete; fully skippable; live /health badges; deep-links into Discovery drawer and Settings."
```

Then `gh pr merge <n> --rebase` once CI is green and approved.

---

## Self-review notes

| Spec requirement | Covered in task |
|-----------------|----------------|
| Shell-based wizard (`renderWizardShell`, variant `"generic"`, own mount id) | T2 |
| Launched only after `infraSetupComplete && discoverySetupComplete && goLiveSetupComplete` | T6 (`isAllMandatorySetupComplete` gate in go-live CTA logic) |
| Per-step dismiss flags (`serpApiEnhancementDismissed`, `geminiEnhancementDismissed`, `aiProviderEnhancementDismissed`) | T1 (store), T3 (skip actions write them) |
| Step 1: SerpApi — instructions + live `/health` `readiness.serpApiGoogleJobs.configured` badge + deep-link to Discovery drawer Sources | T3 (body), T4 (health badge), T5 (deep-link) |
| Step 2: Gemini — instructions + live `/health` `readiness.googleTools.configured` badge + deep-link to Discovery drawer Sources | T3 (body), T4 (health badge), T5 (deep-link) |
| Step 3: AI provider — status from config (`resumeProvider` + active key) + deep-link to Settings → AI Providers | T3 (body), T5 (probeAiProviderStatus + setActiveSettingsTab action) |
| Step 4: More (optional) — links to Settings; deferred build-out | T3 (body renders list of links; actions advance to done) |
| Done step summarizes configured vs. skipped | T3 (`buildDoneBody` reads runtime status fields) |
| Go-live done step gains "Maximize your results" CTA → `requestEnhancementsSetup` | T6 |
| Re-entry affordance (`#enhancementsReEntryBtn`) | T2 (index.html) |
| Defer gate: `isOnboardingWizardVisible || isFirstRunWizardVisible` → `{ deferred: true }` | T6 (tested), T2 (implemented in `requestEnhancementsSetup`) |
| IIFE namespace (`window.JobBoredEnhancements`), lazy `host()`, `_internal` test seam | T2 |
| `typecheck:repo` chain includes new module | T2 (package.json), T2 (test assertion) |
| Bridge-registry host object with all required methods | T7 |
| No `.skip` on any test | Enforced throughout — every failing test is run then made to pass |
| Full `npm test` gate passes | T8 |
agentId: ac3b6aa52c46729a6 (use SendMessage with to: 'ac3b6aa52c46729a6' to continue this agent)
<usage>subagent_tokens: 95274
tool_uses: 63
duration_ms: 486114</usage>
