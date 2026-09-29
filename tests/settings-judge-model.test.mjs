/** MREV JUDGEUX · public behavior of the independent grading-model setup. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");
const judgePickerJs = readFileSync(join(repoRoot, "judge-picker.js"), "utf8");

class FakeElement {
  constructor(tagName, doc) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.id = "";
    this.value = "";
    this.type = "";
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this._text = "";
  }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this) + 1] || null;
  }
  get options() { return this.children.filter((c) => c.tagName === "OPTION"); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(" "); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    child.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector(selector) {
    if (selector !== '[aria-invalid="true"]') return null;
    let hit = null;
    for (const child of this.children) {
      child.walk((el) => { if (!hit && el.getAttribute("aria-invalid") === "true") hit = el; });
      if (hit) break;
    }
    return hit;
  }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async dispatch(type) {
    await Promise.all((this.listeners[type] || []).map((fn) => fn({ target: this, currentTarget: this })));
  }
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
}

function makeDocument() {
  const doc = {
    body: null,
    activeElement: null,
    createElement: (tag) => new FakeElement(tag, doc),
    getElementById(id) {
      let hit = null;
      doc.body.walk((el) => { if (!hit && el.id === id) hit = el; });
      return hit;
    },
    querySelector(selector) {
      const m = selector.match(/^\[([\w-]+)="([^"]+)"\]$/);
      if (!m) return null;
      let hit = null;
      doc.body.walk((el) => { if (!hit && el.getAttribute(m[1]) === m[2]) hit = el; });
      return hit;
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  doc.body = new FakeElement("body", doc);
  const panel = doc.body.appendChild(new FakeElement("div", doc));
  panel.id = "settings-panel-ai";
  const receipt = panel.appendChild(new FakeElement("div", doc));
  receipt.setAttribute("data-receipt", "ai");
  panel.appendChild(new FakeElement("select", doc)).id = "settingsResumeProvider";
  return doc;
}

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const XAI_JUDGE = { provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", keyPresent: true };
const CATALOG = {
  models: [
    { id: "grok-4.2", label: "Grok 4.2", created: 400 },
    { id: "grok-4-mini", label: "Grok 4 mini", created: 500 },
    { id: "grok-4.1", label: "Grok 4.1", created: 300 },
  ],
  recommended: "grok-4.2",
};

function loadSettings(respond) {
  const document = makeDocument();
  const calls = [];
  const toasts = [];
  const activeTabs = [];
  const window = {
    COMMAND_CENTER_CONFIG: {},
    JobBoredApp: {
      core: {
        host: {
          readStoredConfigOverrides: () => ({}),
          mergeStoredConfigOverridePatch: () => {},
          showToast: (...args) => toasts.push(args),
          parseGoogleSheetId: () => "fictional-sheet-id",
          getSheetId: () => "fictional-sheet-id",
          getOAuthClientId: () => "",
          setSHEET_ID() {},
          setDashboardSheetLinks() {},
          syncDiscoveryButtonState() {},
        },
      },
    },
    JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { gemini: "gemini-flash" } },
  };
  window.JobBoredSettingsTabs = {
    activateTabForField() {},
    setActiveSettingsTab(tabId) { activeTabs.push(tabId); },
  };
  const ctx = {
    window,
    document,
    location: { hostname: "127.0.0.1" },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      const method = (init && init.method) || "GET";
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const { status = 200, body: answer = {} } = await respond(url, method, body) || {};
      return { ok: status < 400, status, json: async () => answer };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(judgePickerJs, ctx, { filename: "judge-picker.js" });
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  return { settings: window.JobBoredApp.settings, document, calls, toasts, activeTabs };
}

const el = (document, id) => document.getElementById(id);
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

function defaultRespond(url, method, body) {
  if (url.endsWith("/api/llm-config/judge-models")) return { body: CATALOG };
  if (method === "POST") {
    return { body: { ...WRITER, judge: body.judge ? {
      provider: body.judge.provider,
      model: body.judge.model,
      baseUrl: body.judge.baseUrl,
      keyPresent: Boolean(body.judge.apiKey) || true,
    } : null } };
  }
  return { body: { ...WRITER, judge: null } };
}

async function fetchCatalog(document) {
  const key = el(document, "settingsJudgeApiKey");
  key.value = "fictional-xai-key";
  await key.dispatch("input");
  await key.dispatch("change");
}

describe("MREV JUDGEUX · xAI grading model setup", () => {
  it("U1 · recommends xAI with the key link, password input, and model dropdown", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    const group = el(document, "settingsJudgeGroup");
    assert.ok(group, "the card is in the AI settings pane");
    assert.match(text(group), /A different company's model grades your writing more honestly\./);
    assert.match(text(group), /Sign in → API Keys → Create/);
    const link = el(document, "settingsJudgeKeyLink");
    assert.equal(link.textContent, "Create an xAI API key");
    assert.equal(link.getAttribute("href"), "https://console.x.ai/");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.match(link.getAttribute("rel"), /noopener/);
    assert.equal(el(document, "settingsJudgeApiKey").type, "password");
    assert.equal(el(document, "settingsJudgeXaiModel").tagName, "SELECT");
    assert.equal(el(document, "settingsJudgeXaiModel").disabled, true, "models wait for an xAI key");
    assert.equal(el(document, "settingsJudgeOtherProviders").open, false);
    assert.equal(settings.judgeFormIsDirty(), false);
  });

  it("U2 · sends the typed key to the local model-list route and selects its recommendation", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);
    const request = calls.find((call) => call.url.endsWith("/api/llm-config/judge-models"));
    assert.deepEqual(request.body, { provider: "xai", apiKey: "fictional-xai-key" });
    const model = el(document, "settingsJudgeXaiModel");
    assert.deepEqual(model.options.map((option) => option.value), ["grok-4.2", "grok-4-mini", "grok-4.1"]);
    assert.equal(model.value, "grok-4.2");
    assert.equal(model.disabled, false);
  });

  it("U1 · shows a saved xAI key only as Key saved and never echoes the stored value", async () => {
    const secret = "fictional-stored-xai-key";
    const { settings, document } = loadSettings((url, _method) => url.endsWith("/judge-models")
      ? { body: CATALOG }
      : { body: { ...WRITER, judge: { ...XAI_JUDGE, apiKey: secret } } });
    await settings.refreshLlmStatus();
    assert.equal(el(document, "settingsJudgeApiKey").value, "");
    assert.equal(text(el(document, "settingsJudgeKeyState")), "Key saved");
    let leaked = false;
    document.body.walk((node) => {
      if (String(node.value).includes(secret) || node._text.includes(secret)
        || Object.values(node.attributes).some((value) => value.includes(secret))) leaked = true;
    });
    assert.equal(leaked, false);
  });

  it("U1 · saves xAI through K1 with the fixed endpoint and removes it with judge null", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);
    assert.equal(await settings.saveJudgeModel(), true);
    const saved = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(saved.body, {
      provider: "gemini", model: "gemini-3.8-flash", baseUrl: "",
      judge: { provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key" },
    });
    assert.equal(el(document, "settingsJudgeApiKey").value, "");
    assert.match(text(el(document, "settingsJudgeKeyState")), /Key saved/);
    assert.equal(text(el(document, "settingsJudgeStatus")), "Grading with Grok (grok-4.2)");
    await el(document, "settingsJudgeRemove").dispatch("click");
    const posts = calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.equal(posts.at(-1).body.judge, null);
    assert.equal(text(el(document, "settingsJudgeStatus")), "Grading with your writing model: less independent");
  });

  it("U1 · returns to xAI mode when the alternate-provider disclosure closes", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);

    const other = el(document, "settingsJudgeOtherProviders");
    other.open = true;
    await other.dispatch("toggle");
    other.open = false;
    await other.dispatch("toggle");

    assert.equal(settings.judgeFormIsDirty(), true);
    assert.equal(await settings.saveJudgeModel(), true);
    const saved = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(saved.body.judge, {
      provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key",
    });
  });

  it("U1 · closing the disclosure selects xAI even after a generic provider was chosen", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);

    const other = el(document, "settingsJudgeOtherProviders");
    const provider = el(document, "settingsJudgeProvider");
    other.open = true;
    await other.dispatch("toggle");
    provider.value = "openrouter";
    await provider.dispatch("change");
    el(document, "settingsJudgeModel").value = "fictional/generic-model";
    other.open = false;
    await other.dispatch("toggle");

    assert.equal(await settings.saveJudgeModel(), true);
    const saved = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(saved.body.judge, {
      provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key",
    });
  });

  it("U2 · attaches a key error to the password field and never echoes the key", async () => {
    const respond = (url, method) => url.endsWith("/judge-models")
      ? { status: 401, body: { error: "That key didn't work: check it on the xAI console." } }
      : defaultRespond(url, method, undefined);
    const { settings, document, calls } = loadSettings(respond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);
    const key = el(document, "settingsJudgeApiKey");
    assert.equal(text(el(document, "settingsJudgeError")), "That key didn't work: check it on the xAI console.");
    assert.match(key.getAttribute("aria-describedby"), /settingsJudgeError/);
    assert.equal(key.getAttribute("aria-invalid"), "true");
    assert.equal(key.value, "fictional-xai-key");
    assert.equal(el(document, "settingsJudgeXaiModel").disabled, false, "the model control remains reachable in tab order");
    assert.equal(await settings.saveJudgeModel(), false, "a failed key check cannot be saved");
    assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/llm-config")).length, 0);
    assert.equal(text(el(document, "settingsJudgeStatus")), "Grading with your writing model: less independent");
  });

  it("P3 · focuses the first invalid judge field after a failed Settings Save", async () => {
    const respond = (url, method, body) => {
      if (url.endsWith("/judge-models")) return { body: CATALOG };
      if (method === "POST" && url.endsWith("/api/llm-config") && body && body.judge) {
        return { status: 401, body: { error: "That key didn't work: check it on the xAI console." } };
      }
      return defaultRespond(url, method, body);
    };
    const { settings, document, activeTabs } = loadSettings(respond);
    await settings.refreshLlmStatus();
    await fetchCatalog(document);

    await settings.saveCommandCenterSettingsFromForm();

    assert.deepEqual(activeTabs, ["ai"]);
    assert.equal(el(document, "settingsJudgeApiKey").getAttribute("aria-invalid"), "true");
    assert.equal(document.activeElement, el(document, "settingsJudgeApiKey"));
  });

  it("U3 · keeps the generic provider, model, URL, and key controls behind a disclosure", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    const other = el(document, "settingsJudgeOtherProviders");
    assert.equal(other.tagName, "DETAILS");
    assert.equal(other.open, false);
    assert.equal(el(document, "settingsJudgeProvider").tagName, "SELECT");
    assert.equal(el(document, "settingsJudgeModel").tagName, "INPUT");
    assert.equal(el(document, "settingsJudgeBaseUrl").type, "url");
    assert.equal(el(document, "settingsJudgeOtherApiKey").type, "password");
    other.open = true;
    await other.dispatch("toggle");
    el(document, "settingsJudgeProvider").value = "openrouter";
    await el(document, "settingsJudgeProvider").dispatch("change");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "https://openrouter.ai/api/v1");
    el(document, "settingsJudgeModel").value = "fictional/grok-reviewer";
    el(document, "settingsJudgeOtherApiKey").value = "fictional-provider-key";
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(post.body.judge, {
      provider: "openrouter", model: "fictional/grok-reviewer", baseUrl: "https://openrouter.ai/api/v1", apiKey: "fictional-provider-key",
    });
  });

  it("U4 · says when grading uses the writing model and when Grok is saved", async () => {
    const empty = loadSettings(defaultRespond);
    await empty.settings.refreshLlmStatus();
    assert.equal(text(el(empty.document, "settingsJudgeStatus")), "Grading with your writing model: less independent");

    const saved = loadSettings((url, method, body) => {
      if (url.endsWith("/judge-models")) return { body: CATALOG };
      return { body: { ...WRITER, judge: method === "POST" ? body.judge : XAI_JUDGE } };
    });
    await saved.settings.refreshLlmStatus();
    assert.equal(text(el(saved.document, "settingsJudgeStatus")), "Grading with Grok (grok-4.2)");
  });

  it("U5 · exposes ordered labels, a visible error, and keyboard-focusable actions", async () => {
    const { settings, document } = loadSettings((url, method) => url.endsWith("/judge-models")
      ? { status: 500, body: { error: "Couldn't reach xAI: try again." } }
      : defaultRespond(url, method));
    await settings.refreshLlmStatus();
    const key = el(document, "settingsJudgeApiKey");
    const model = el(document, "settingsJudgeXaiModel");
    assert.equal(key.getAttribute("autocomplete"), "new-password");
    assert.ok(key.getAttribute("aria-describedby"));
    assert.equal(el(document, "settingsJudgeKeyLink").getAttribute("rel"), "noopener");
    assert.equal(el(document, "settingsJudgeRemove").tagName, "BUTTON");
    assert.match(text(el(document, "settingsJudgeStatus")), /Grading with your writing model/);
    const labels = [];
    const order = [];
    document.body.walk((node) => {
      order.push(node.id);
      if (node.tagName === "LABEL") labels.push(node.getAttribute("for"));
    });
    assert.ok(labels.includes("settingsJudgeApiKey"));
    assert.ok(labels.includes("settingsJudgeXaiModel"));
    assert.ok(order.indexOf("settingsJudgeKeyLink") < order.indexOf("settingsJudgeApiKey"));
    assert.ok(order.indexOf("settingsJudgeApiKey") < order.indexOf("settingsJudgeXaiModel"));
    assert.ok(order.indexOf("settingsJudgeXaiModel") < order.indexOf("settingsJudgeRemove"));
    key.value = "fictional-network-key";
    await key.dispatch("change");
    assert.equal(text(el(document, "settingsJudgeError")), "Couldn't reach xAI: try again.");
    assert.match(model.getAttribute("aria-describedby"), /settingsJudgeError/);
    assert.equal(el(document, "settingsJudgeError").getAttribute("role"), "alert");
  });
});

describe("MREV JUDGEUX · generic live model list (shared with onboarding)", () => {
  const OPENROUTER_ROWS = {
    models: [
      { id: "openai/gpt-4o-mini", label: "OpenAI: GPT 4o Mini" },
      { id: "x-ai/grok-4", label: "xAI: Grok 4" },
    ],
    recommended: "openai/gpt-4o-mini",
  };

  async function openGeneric(document, provider) {
    const other = el(document, "settingsJudgeOtherProviders");
    other.open = true;
    await other.dispatch("toggle");
    el(document, "settingsJudgeProvider").value = provider;
    await el(document, "settingsJudgeProvider").dispatch("change");
  }

  it("fills each provider's fixed endpoint and locks it, except local and custom", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();

    await openGeneric(document, "openrouter");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "https://openrouter.ai/api/v1");
    assert.equal(el(document, "settingsJudgeBaseUrl").disabled, true);

    el(document, "settingsJudgeProvider").value = "anthropic";
    await el(document, "settingsJudgeProvider").dispatch("change");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "");
    assert.equal(el(document, "settingsJudgeBaseUrl").disabled, true);

    el(document, "settingsJudgeProvider").value = "local";
    await el(document, "settingsJudgeProvider").dispatch("change");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "http://127.0.0.1:11434/v1");
    assert.equal(el(document, "settingsJudgeBaseUrl").disabled, false);

    el(document, "settingsJudgeProvider").value = "openai_compatible";
    await el(document, "settingsJudgeProvider").dispatch("change");
    assert.equal(el(document, "settingsJudgeBaseUrl").disabled, false);
  });

  it("offers the provider's live models in the model field and prefills its pick", async () => {
    const { settings, document, calls } = loadSettings((url, method, body) => url.endsWith("/judge-models")
      ? { body: OPENROUTER_ROWS }
      : defaultRespond(url, method, body));
    await settings.refreshLlmStatus();
    await openGeneric(document, "openrouter");

    const request = calls.find((call) => call.url.endsWith("/api/llm-config/judge-models"));
    assert.deepEqual(request.body, { provider: "openrouter" });
    const list = el(document, "settingsJudgeModelList");
    assert.equal(list.tagName, "DATALIST");
    assert.deepEqual(list.options.map((option) => option.value), ["openai/gpt-4o-mini", "x-ai/grok-4"]);
    assert.equal(el(document, "settingsJudgeModel").value, "openai/gpt-4o-mini");
    assert.match(text(el(document, "settingsJudgeGenericModelsHint")), /Loaded 2 models from OpenRouter/);
  });

  it("loads a keyed provider's list once its key is entered", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await openGeneric(document, "anthropic");
    assert.equal(calls.filter((call) => call.url.endsWith("/judge-models")).length, 0);

    const otherKey = el(document, "settingsJudgeOtherApiKey");
    otherKey.value = "fictional-anthropic-key";
    await otherKey.dispatch("change");
    const request = calls.find((call) => call.url.endsWith("/api/llm-config/judge-models"));
    assert.deepEqual(request.body, { provider: "anthropic", apiKey: "fictional-anthropic-key" });
    assert.ok(el(document, "settingsJudgeModelList").options.length > 0);
  });

  it("keeps a typed model and editable URL for a self-hosted compatible endpoint", async () => {
    const { settings, document, calls } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await openGeneric(document, "openai_compatible");
    el(document, "settingsJudgeModel").value = "fictional/self-hosted";
    el(document, "settingsJudgeBaseUrl").value = "https://self-hosted.example/v1";
    el(document, "settingsJudgeOtherApiKey").value = "fictional-self-key";
    await el(document, "settingsJudgeOtherApiKey").dispatch("change");

    assert.equal(calls.filter((call) => call.url.endsWith("/judge-models")).length, 0);
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(post.body.judge, {
      provider: "openai_compatible",
      model: "fictional/self-hosted",
      baseUrl: "https://self-hosted.example/v1",
      apiKey: "fictional-self-key",
    });
  });

  it("names a failed generic list in the hint without blocking a typed save", async () => {
    const { settings, document, calls } = loadSettings((url, method, body) => url.endsWith("/judge-models")
      ? { status: 401, body: { error: "That key didn't work: check it on OpenAI." } }
      : defaultRespond(url, method, body));
    await settings.refreshLlmStatus();
    await openGeneric(document, "openai");
    const otherKey = el(document, "settingsJudgeOtherApiKey");
    otherKey.value = "fictional-rejected-key";
    await otherKey.dispatch("change");

    assert.equal(text(el(document, "settingsJudgeGenericModelsHint")), "That key didn't work: check it on OpenAI.");
    el(document, "settingsJudgeModel").value = "gpt-4o-mini";
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.equal(post.body.judge.model, "gpt-4o-mini");
  });
});

describe("MREV JUDGEUX · saved generic judges fill verbatim (P1: no fabricated edits)", () => {
  const BLANK_OPENAI_JUDGE = { provider: "openai", model: "gpt-4o-mini", baseUrl: "", keyPresent: true };

  function savedGenericRespond(url, method, body) {
    if (url.endsWith("/judge-models")) return { body: CATALOG };
    if (method === "POST") {
      return { body: { ...WRITER, judge: body.judge ? { ...body.judge, keyPresent: true } : null } };
    }
    return { body: { ...WRITER, judge: BLANK_OPENAI_JUDGE } };
  }

  it("leaves a saved blank endpoint blank, locked, and clean", async () => {
    const { settings, document } = loadSettings(savedGenericRespond);
    await settings.refreshLlmStatus();
    assert.equal(el(document, "settingsJudgeProvider").value, "openai");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "", "fill never writes the fixed URL over a blank");
    assert.equal(el(document, "settingsJudgeBaseUrl").disabled, true);
    assert.equal(settings.judgeFormIsDirty(), false, "an untouched fill is not an edit");
  });

  it("saves the untouched fill without moving the endpoint or the key", async () => {
    const { settings, calls } = loadSettings(savedGenericRespond);
    await settings.refreshLlmStatus();
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));
    assert.deepEqual(post.body.judge, { provider: "openai", model: "gpt-4o-mini", baseUrl: "" });
  });
});

describe("MREV JUDGEUX · saved local judge round-trips (P2)", () => {
  const LOCAL_JUDGE = {
    provider: "openai_compatible", alias: "local", model: "qwen3:8b",
    baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false,
  };
  const TAGS = { models: [{ id: "qwen3:8b", label: "qwen3:8b" }], recommended: "qwen3:8b" };

  function localRespond(url, method, body) {
    if (url.endsWith("/judge-models")) {
      assert.equal(body.provider, "local");
      return { body: TAGS };
    }
    if (method === "POST") {
      return { body: { ...WRITER, judge: body.judge ? { ...body.judge, keyPresent: false } : null } };
    }
    return { body: { ...WRITER, judge: LOCAL_JUDGE } };
  }

  it("fills local with its Ollama guide and reloads its tags", async () => {
    const { settings, document, calls } = loadSettings(localRespond);
    await settings.refreshLlmStatus();
    // The saved-judge auto-load is fire-and-forget, like the xAI card's: let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(el(document, "settingsJudgeProvider").value, "local");
    assert.equal(el(document, "settingsJudgeKeyGuideLink").getAttribute("href"), "https://ollama.com");
    assert.match(text(el(document, "settingsJudgeKeyGuideNote")), /usually need no key/);
    assert.equal(el(document, "settingsJudgeStatus").textContent, "Grading with your local model (qwen3:8b)");
    assert.ok(calls.some((call) => call.url.endsWith("/api/llm-config/judge-models")), "the Ollama list loads again");
    assert.deepEqual(
      el(document, "settingsJudgeModelList").options.map((option) => option.value),
      ["qwen3:8b"],
    );
    assert.equal(settings.judgeFormIsDirty(), false);
  });
});

describe("MREV JUDGEUX · generic key guide (shared with onboarding)", () => {
  async function openGeneric(document, provider) {
    const other = el(document, "settingsJudgeOtherProviders");
    other.open = true;
    await other.dispatch("toggle");
    el(document, "settingsJudgeProvider").value = provider;
    await el(document, "settingsJudgeProvider").dispatch("change");
  }

  it("shows the selected provider's key link and cost note", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await openGeneric(document, "openrouter");
    const link = el(document, "settingsJudgeKeyGuideLink");
    assert.equal(link.getAttribute("href"), "https://openrouter.ai/keys");
    assert.match(text(link), /Create an OpenRouter key/);
    assert.match(text(el(document, "settingsJudgeKeyGuideNote")), /Pay-as-you-go/);
  });

  it("updates the guide when the provider changes", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await openGeneric(document, "openrouter");
    el(document, "settingsJudgeProvider").value = "gemini";
    await el(document, "settingsJudgeProvider").dispatch("change");
    assert.equal(
      el(document, "settingsJudgeKeyGuideLink").getAttribute("href"),
      "https://aistudio.google.com/app/apikey",
    );
    assert.match(text(el(document, "settingsJudgeKeyGuideNote")), /Free tier/);
  });

  it("tells local users no key is needed, with an Ollama link", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    await openGeneric(document, "local");
    assert.equal(el(document, "settingsJudgeKeyGuideLink").getAttribute("href"), "https://ollama.com");
    assert.match(text(el(document, "settingsJudgeKeyGuideNote")), /usually need no key/);
  });

  it("lives inside the Other disclosure, so it hides with it", async () => {
    const { settings, document } = loadSettings(defaultRespond);
    await settings.refreshLlmStatus();
    const other = el(document, "settingsJudgeOtherProviders");
    const ids = [];
    other.walk((node) => ids.push(node.id));
    assert.ok(ids.includes("settingsJudgeKeyGuideLink"));
    assert.ok(ids.includes("settingsJudgeKeyGuideNote"));
  });
});
