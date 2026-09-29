/** JUDGEUX FE2 · the optional "Grading model" row in Settings → AI. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");
const judgePickerJs = readFileSync(join(repoRoot, "judge-picker.js"), "utf8");
const settingsPartial = readFileSync(join(repoRoot, "partials/settings-modal.html"), "utf8");

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
    this.style = {};
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
  for (const id of ["settingsPanelOpenRouter", "settingsPanelGemini", "settingsPanelLocal"]) {
    const providerPanel = panel.appendChild(new FakeElement("div", doc));
    providerPanel.id = id;
    providerPanel.className = "settings-provider-panel";
  }
  return doc;
}

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const NO_WRITER = { provider: "", alias: "", model: "", baseUrl: "", keyPresent: false };
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
  return { settings: window.JobBoredApp.settings, window, document, calls, toasts, activeTabs };
}

const el = (document, id) => document.getElementById(id);
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const llmPosts = (calls) => calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));

/** A server that stores whatever judge the page posts, like BE3's judge-only save. */
function storingServer(initial = { ...WRITER, judge: null }, overrides = {}) {
  let pin = initial;
  return (url, method, body) => {
    if (url.endsWith("/judge-models")) return overrides.models ? overrides.models(body) : { body: CATALOG };
    if (url.endsWith("/judge-test")) return { body: { ok: true, structured: true, model: body.model, ms: 900 } };
    if (method === "POST" && url.endsWith("/api/llm-config")) {
      if (overrides.save) { const answer = overrides.save(body); if (answer) return answer; }
      const prev = pin.judge;
      pin = {
        ...pin,
        judge: body.judge
          ? {
            provider: body.judge.provider,
            model: body.judge.model,
            baseUrl: body.judge.baseUrl || "",
            keyPresent: Boolean(body.judge.apiKey) || Boolean(prev && prev.keyPresent),
          }
          : null,
      };
      return { body: pin };
    }
    return { body: pin };
  };
}

async function openEditor(document) {
  await el(document, "settingsJudgeChange").dispatch("click");
}

async function typeKey(document, value = "fictional-xai-key") {
  const key = el(document, "settingsJudgeApiKey");
  key.value = value;
  await key.dispatch("input");
  await key.dispatch("change");
  await settle();
  return key;
}

async function openWriterModal(env, hydration) {
  const { settings, window, document } = env;
  const cfg = { resumeProvider: "openrouter", resumeOpenRouterModel: "fictional-browser-writer", resumeOpenRouterApiKey: "fictional-browser-key", resumeOpenRouterBaseUrl: "https://fictional.example/v1" };
  Object.assign(window.COMMAND_CENTER_CONFIG, cfg);
  const modal = document.body.appendChild(document.createElement("div"));
  modal.id = "settingsModal";
  const panel = el(document, "settings-panel-ai");
  document.body.removeChild(panel);
  modal.appendChild(panel);
  for (const [id, value, tag] of [
    ["settingsResumeOpenRouterModel", cfg.resumeOpenRouterModel, "select"],
    ["settingsResumeOpenRouterApiKey", cfg.resumeOpenRouterApiKey, "input"],
    ["settingsResumeOpenRouterBaseUrl", cfg.resumeOpenRouterBaseUrl, "input"],
    ["settingsResumeOpenAIModel", "fictional-openai-writer", "select"],
    ["settingsResumeOpenAIApiKey", "fictional-openai-key", "input"],
  ]) {
    const field = panel.appendChild(document.createElement(tag));
    field.id = id;
    field.value = value;
  }
  modal.querySelectorAll = () => {
    const fields = [];
    modal.walk((node) => { if (["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName)) fields.push(node); });
    return fields;
  };
  modal.contains = (node) => { for (; node; node = node.parentNode) if (node === modal) return true; return false; };
  const core = window.JobBoredApp.core;
  if (hydration) core.host.populateAppsScriptDeployStateIntoSettingsForm = () => hydration;
  core.host = new Proxy(core.host, { get: (target, key) => key in target ? target[key] : () => false });
  const opening = settings.openCommandCenterSettingsModal();
  if (hydration) return opening;
  await opening;
  await settle();
}

describe("FIX2 P1 · modal Save preserves an untouched server writer", () => {
  it("a grader-only edit sends exactly one POST: the judge-only body", async () => {
    const env = loadSettings(storingServer({ ...WRITER, judge: null }));
    await openWriterModal(env);
    await openEditor(env.document);
    await typeKey(env.document);
    await env.settings.saveCommandCenterSettingsFromForm();
    assert.deepEqual(llmPosts(env.calls).map((call) => call.body), [{ judge: {
      provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key",
    } }]);
  });

  it("an untouched modal sends no writer or grader POST", async () => {
    const env = loadSettings(storingServer());
    await openWriterModal(env);
    await env.settings.saveCommandCenterSettingsFromForm();
    assert.equal(llmPosts(env.calls).length, 0);
  });

  for (const [suffix, value, field] of [
    ["Provider", "openai", "provider"],
    ["OpenRouterModel", "fictional-new-writer", "model"],
    ["OpenRouterApiKey", "fictional-new-key", "apiKey"],
    ["OpenRouterBaseUrl", "https://new-fictional.example/v1", "baseUrl"],
  ]) {
    it(`an explicit ${field} edit still posts the writer once`, async () => {
      const env = loadSettings(storingServer());
      await openWriterModal(env);
      el(env.document, `settingsResume${suffix}`).value = value;
      await env.settings.saveCommandCenterSettingsFromForm();
      const posts = llmPosts(env.calls);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body[field], value);
    });
  }

  it("async modal hydration does not absorb a real writer edit", async () => {
    let release;
    const hydration = new Promise((resolve) => { release = resolve; });
    const env = loadSettings(storingServer());
    const opening = openWriterModal(env, hydration);
    await settle();
    el(env.document, "settingsResumeOpenRouterModel").value = "fictional-edited-during-hydration";
    release();
    await opening;
    await env.settings.saveCommandCenterSettingsFromForm();
    assert.equal(llmPosts(env.calls).length, 1);
    assert.equal(llmPosts(env.calls)[0].body.model, "fictional-edited-during-hydration");
  });
});

describe("J-FE2 · Settings → AI grading model row", () => {
  it("J-FE2a · sits directly under the writer Provider block, above the provider panels", async () => {
    const { settings, document } = loadSettings(storingServer());
    await settings.refreshLlmStatus();
    const panel = el(document, "settings-panel-ai");
    const order = panel.children.map((child) => child.id);
    const row = order.indexOf("settingsJudgeGroup");
    assert.ok(row >= 0, "the row is a direct child of the AI panel");
    assert.equal(order[row - 1], "settingsResumeProvider", "right after the writer Provider select");
    assert.ok(row < order.indexOf("settingsPanelOpenRouter"), "above every provider panel");
    assert.ok(row < order.indexOf("settingsPanelLocal"));
  });

  it("J-FE2b · empty state says it is optional and that the writer grades its own work", async () => {
    const { settings, document } = loadSettings(storingServer());
    await settings.refreshLlmStatus();
    assert.equal(text(el(document, "settingsJudgeTitle")), "Grading model (optional)");
    assert.equal(text(el(document, "settingsJudgeStatus")), "Not set. Your writing model grades its own work.");
    const change = el(document, "settingsJudgeChange");
    assert.equal(change.tagName, "BUTTON");
    assert.equal(text(change), "Change");
    assert.equal(change.getAttribute("aria-expanded"), "false");
    assert.equal(el(document, "settingsJudgeEditor").hidden, true, "the editor waits for Change");
    await openEditor(document);
    assert.equal(el(document, "settingsJudgeEditor").hidden, false);
    assert.equal(change.getAttribute("aria-expanded"), "true");
    assert.equal(el(document, "settingsJudgeProvider").value, "xai", "xAI is the default");
    assert.doesNotMatch(text(el(document, "settingsJudgeGroup")), /judge/i, "user copy says grading model");
  });

  it("J-FE2c · the footnote says where each key lives, and the panel lede no longer claims keys stay in the browser", async () => {
    const { settings, document } = loadSettings(storingServer());
    await settings.refreshLlmStatus();
    assert.equal(
      text(el(document, "settingsJudgeFootnote")),
      "Check connection tests the key in this browser. Drafting and grading use the keys saved on this computer (~/.jobbored).",
    );
    const ids = [];
    el(document, "settingsJudgeGroup").walk((node) => ids.push(node.id));
    assert.ok(ids.includes("settingsJudgeFootnote"), "the footnote belongs to the grading row");
    const aiPanel = settingsPartial.slice(settingsPartial.indexOf('id="settings-panel-ai"'));
    const lede = aiPanel.slice(0, aiPanel.indexOf("</p>"));
    assert.doesNotMatch(lede.replace(/\s+/g, " "), /keys stay in this browser/i);
    assert.doesNotMatch(settingsPartial.replace(/\s+/g, " "), /Drafting keys stay in this browser/);
  });

  it("FIX1 P2-6: the modal lede does not claim all settings stay in the browser", () => {
    const lede = settingsPartial.match(/<p class="modal-lede settings-modal-lede settings-modal__full">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, " ").trim();
    assert.equal(lede, "Fill in what you use — everything else can stay blank.");
  });

  it("FIX1 P2-3: Settings restores a grader from the unconfigured-writer 404 response", async () => {
    const { settings, document } = loadSettings((url) => url.endsWith("/judge-models")
      ? { body: CATALOG }
      : { status: 404, body: { code: "llm_unconfigured", judge: XAI_JUDGE } });
    await settings.refreshLlmStatus({ resetJudge: true });
    await openEditor(document);
    await settle();
    assert.equal(el(document, "settingsJudgeModel").value, XAI_JUDGE.model);
    assert.equal(el(document, "settingsJudgeKeyState").hidden, false);
    assert.match(text(el(document, "settingsJudgeKeyState")), /Key saved/);
  });

  it("J-FE2d · a saved choice survives reopening, key shown only as Key saved", async () => {
    const server = storingServer();
    const { settings, document, calls } = loadSettings(server);
    await settings.refreshLlmStatus({ resetJudge: true });
    await openEditor(document);
    await typeKey(document);
    assert.equal(el(document, "settingsJudgeModel").value, "grok-4.2");
    assert.equal(settings.judgeFormIsDirty(), true);
    assert.equal(await settings.saveJudgeModel(), true);

    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    assert.equal(text(el(document, "settingsJudgeTitle")), "Grading model");
    assert.equal(text(el(document, "settingsJudgeStatus")), "Grok · grok-4.2 · key saved");
    await openEditor(document);
    assert.equal(el(document, "settingsJudgeProvider").value, "xai");
    assert.equal(el(document, "settingsJudgeModel").value, "grok-4.2");
    assert.equal(el(document, "settingsJudgeApiKey").value, "");
    assert.equal(el(document, "settingsJudgeKeyState").hidden, false);
    assert.equal(text(el(document, "settingsJudgeKeyState")), "Key saved");
    assert.equal(settings.judgeFormIsDirty(), false);
    let leaked = false;
    document.body.walk((node) => {
      if (String(node.value).includes("fictional-xai-key") || node._text.includes("fictional-xai-key")
        || Object.values(node.attributes).some((value) => value.includes("fictional-xai-key"))) leaked = true;
    });
    assert.equal(leaked, false, "the stored key is never echoed");
    assert.equal(llmPosts(calls).length, 1);
  });
});

describe("J-FE2 · judge-only save (BE3 contract)", () => {
  it("posts only {judge}, and needs no writer pin", async () => {
    const { settings, document, calls } = loadSettings(storingServer({ ...NO_WRITER, judge: null }));
    await settings.refreshLlmStatus();
    await openEditor(document);
    await typeKey(document);
    assert.equal(await settings.saveJudgeModel(), true);
    assert.deepEqual(llmPosts(calls).at(-1).body, {
      judge: { provider: "openai_compatible", model: "grok-4.2", baseUrl: "https://api.x.ai/v1", apiKey: "fictional-xai-key" },
    });
  });

  it("Remove posts {judge:null} and returns the row to its empty state", async () => {
    const { settings, document, calls } = loadSettings(storingServer({ ...WRITER, judge: XAI_JUDGE }));
    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    await openEditor(document);
    assert.equal(el(document, "settingsJudgeRemove").disabled, false);
    await el(document, "settingsJudgeRemove").dispatch("click");
    await settle();
    assert.deepEqual(llmPosts(calls).at(-1).body, { judge: null });
    assert.equal(text(el(document, "settingsJudgeStatus")), "Not set. Your writing model grades its own work.");
  });

  it("a blank key keeps the saved key: an edited model posts without apiKey", async () => {
    const { settings, document, calls } = loadSettings(storingServer({ ...WRITER, judge: XAI_JUDGE }));
    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    await openEditor(document);
    const model = el(document, "settingsJudgeModel");
    model.value = "grok-4-mini";
    await model.dispatch("change");
    assert.equal(await settings.saveJudgeModel(), true);
    assert.deepEqual(llmPosts(calls).at(-1).body, {
      judge: { provider: "openai_compatible", model: "grok-4-mini", baseUrl: "https://api.x.ai/v1" },
    });
  });

  it("an untouched open saves nothing", async () => {
    const { settings, document, calls } = loadSettings(storingServer({ ...WRITER, judge: XAI_JUDGE }));
    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    await openEditor(document);
    assert.equal(settings.judgeFormIsDirty(), false);
    await settings.saveCommandCenterSettingsFromForm();
    assert.equal(llmPosts(calls).filter((call) => "judge" in call.body).length, 0);
  });

  it("a refused save names the grading model and focuses the invalid field after Settings Save", async () => {
    const respond = storingServer(undefined, {
      save: (body) => body.judge ? { status: 401, body: { error: "That key didn't work: check it on the xAI console." } } : null,
    });
    const { settings, document, activeTabs, toasts } = loadSettings(respond);
    await settings.refreshLlmStatus();
    await openEditor(document);
    await typeKey(document);
    await settings.saveCommandCenterSettingsFromForm();
    assert.deepEqual(activeTabs, ["ai"]);
    assert.match(text(el(document, "settingsJudgeError")), /grading model wasn.t saved/i);
    assert.equal(el(document, "settingsJudgeApiKey").getAttribute("aria-invalid"), "true");
    assert.equal(document.activeElement, el(document, "settingsJudgeApiKey"));
    assert.ok(toasts.some((args) => /grading model isn.t/i.test(String(args[0]))));
    assert.ok(!toasts.some((args) => /judge/i.test(String(args[0]))));
  });

  it("a missing key blocks the save with a named field", async () => {
    const { settings, document, calls } = loadSettings(storingServer());
    await settings.refreshLlmStatus();
    await openEditor(document);
    const provider = el(document, "settingsJudgeProvider");
    provider.value = "openrouter";
    await provider.dispatch("change");
    assert.equal(await settings.saveJudgeModel(), false);
    assert.match(text(el(document, "settingsJudgeError")), /Paste your OpenRouter API key first/);
    assert.equal(llmPosts(calls).length, 0);
  });
});

describe("J-FE2 · saved generic and local judges fill verbatim (P1, P2 kept)", () => {
  it("leaves a saved blank endpoint blank and clean, and saves it untouched", async () => {
    const judge = { provider: "openai", model: "gpt-4o-mini", baseUrl: "", keyPresent: true };
    const { settings, document, calls } = loadSettings(storingServer({ ...WRITER, judge }, {
      models: () => ({ body: { models: [{ id: "gpt-4o-mini" }], recommended: "gpt-4o-mini" } }),
    }));
    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    assert.equal(text(el(document, "settingsJudgeStatus")), "OpenAI · gpt-4o-mini · key saved");
    await openEditor(document);
    assert.equal(el(document, "settingsJudgeProvider").value, "openai");
    assert.equal(settings.judgeFormIsDirty(), false, "an untouched fill is not an edit");
    const model = el(document, "settingsJudgeModel");
    await model.dispatch("change");
    assert.equal(await settings.saveJudgeModel(), true);
    assert.deepEqual(llmPosts(calls).at(-1).body.judge, { provider: "openai", model: "gpt-4o-mini", baseUrl: "" });
  });

  it("round-trips a saved local model and reloads its tags", async () => {
    const judge = { provider: "openai_compatible", alias: "local", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false };
    const { settings, document, calls } = loadSettings(storingServer({ ...WRITER, judge }, {
      models: (body) => {
        assert.equal(body.provider, "local");
        return { body: { models: [{ id: "qwen3:8b", label: "qwen3:8b" }], recommended: "qwen3:8b" } };
      },
    }));
    await settings.refreshLlmStatus({ resetJudge: true });
    await settle();
    assert.equal(text(el(document, "settingsJudgeStatus")), "Local · qwen3:8b");
    assert.equal(el(document, "settingsJudgeProvider").value, "local");
    assert.ok(calls.some((call) => call.url.endsWith("/judge-models")), "the Ollama list loads again");
    assert.equal(el(document, "settingsJudgeModel").value, "qwen3:8b");
    assert.equal(el(document, "settingsJudgeKeyLink").getAttribute("href"), "https://ollama.com");
    assert.equal(settings.judgeFormIsDirty(), false);
  });

  it("an unreachable server says so in grading-model words", async () => {
    const { settings, document } = loadSettings(() => { throw new TypeError("Failed to fetch"); });
    await settings.refreshLlmStatus();
    assert.match(text(el(document, "settingsJudgeError")), /Can.t reach the JobBored server/);
    assert.doesNotMatch(text(el(document, "settingsJudgeGroup")), /judge/i);
  });
});

describe("J-FE4 · the scorecard's grading links open Settings → AI", () => {
  it("a click on [data-action=settings-open-grading] opens the AI tab and focuses Change", async () => {
    const { settings, window, document } = loadSettings(storingServer());
    // Any host call the modal makes on open is a no-op here.
    const core = window.JobBoredApp.core;
    core.host = new Proxy(core.host, { get: (t, k) => (k in t ? t[k] : () => false) });
    const tabs = [];
    window.JobBoredSettingsTabSchema = { DEFAULT_TAB: "sheet" };
    window.JobBoredSettingsTabs.initSettingsTabs = (_modal, options) => tabs.push(options.defaultTab);
    const listeners = [];
    document.addEventListener = (type, fn) => listeners.push({ type, fn });
    const modal = document.body.appendChild(document.createElement("div"));
    modal.id = "settingsModal";
    await settings.refreshLlmStatus();
    settings.initCommandCenterSettings();
    const link = document.createElement("button");
    link.closest = (selector) => (selector === '[data-action="settings-open-grading"]' ? link : null);
    const clicks = listeners.filter((l) => l.type === "click");
    assert.ok(clicks.length > 0, "Settings listens for the scorecard's link");
    let prevented = false;
    for (const l of clicks) l.fn({ target: link, preventDefault() { prevented = true; } });
    await settle();
    assert.equal(prevented, true);
    assert.deepEqual(tabs, ["ai"]);
    assert.equal(document.activeElement, el(document, "settingsJudgeChange"));
  });
});
