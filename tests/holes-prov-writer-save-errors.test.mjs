/**
 * HOLES PROV · P5: Settings Save used to swallow a refused drafting-model
 * POST (/api/llm-config). It showed "Saved" and closed the modal although
 * the server kept its old model. Now the modal stays open, the reason shows
 * inline, and an error toast points at the AI tab. "Use <model> in this
 * browser" reports a refused re-pin the same way. Harness trimmed from
 * settings-judge-model.test.mjs.
 */

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
  querySelector() { return null; }
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
  panel.appendChild(new FakeElement("div", doc)).setAttribute("data-receipt", "ai");
  panel.appendChild(new FakeElement("select", doc)).id = "settingsResumeProvider";
  return doc;
}

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const CATALOG = { models: [{ id: "grok-4.2", label: "Grok 4.2", created: 400 }], recommended: "grok-4.2" };

function loadSettings(respond) {
  const document = makeDocument();
  const calls = [];
  const toasts = [];
  const activeTabs = [];
  const hostCalls = [];
  const window = {
    COMMAND_CENTER_CONFIG: {},
    JobBoredApp: {
      core: {
        host: {
          readStoredConfigOverrides: () => ({}),
          mergeStoredConfigOverridePatch: (patch) => hostCalls.push(["merge", { ...patch }]),
          showToast: (...args) => toasts.push(args),
          parseGoogleSheetId: () => "fictional-sheet-id",
          getSheetId: () => "fictional-sheet-id",
          getOAuthClientId: () => "",
          setSHEET_ID: (id) => hostCalls.push(["setSHEET_ID", id]),
          setDashboardSheetLinks() {},
          syncDiscoveryButtonState: () => hostCalls.push(["syncDiscoveryButtonState"]),
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
  return { settings: window.JobBoredApp.settings, window, document, calls, toasts, activeTabs, hostCalls };
}

const el = (document, id) => document.getElementById(id);
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const llmPosts = (calls) => calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/llm-config"));

/**
 * A server that stores what the page posts. `writer` and `judge` may answer
 * a POST first (return a reply, or throw to fail the request).
 */
function server({ pin = { ...WRITER, judge: null }, writer, judge } = {}) {
  let current = pin;
  return (url, method, body) => {
    if (url.endsWith("/judge-models")) return { body: CATALOG };
    if (method === "POST" && url.endsWith("/api/llm-config")) {
      const isJudge = "judge" in body;
      const answer = isJudge ? judge && judge(body) : writer && writer(body);
      if (answer) return answer;
      current = isJudge
        ? { ...current, judge: body.judge ? { ...body.judge, keyPresent: Boolean(body.judge.apiKey) } : null }
        : { ...current, provider: body.provider, model: body.model, baseUrl: body.baseUrl || "" };
      return { body: current };
    }
    return { body: current };
  };
}

async function openWriterModal(env) {
  const { settings, window, document } = env;
  const cfg = { resumeProvider: "openrouter", resumeOpenRouterModel: "fictional-browser-writer", resumeOpenRouterApiKey: "fictional-browser-key", resumeOpenRouterBaseUrl: "https://fictional.example/v1", resumeOpenAIApiKey: "fictional-openai-browser-key" };
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
  const formError = modal.appendChild(document.createElement("p"));
  formError.id = "settingsFormError";
  formError.style.display = "none";
  modal.querySelectorAll = () => {
    const fields = [];
    modal.walk((node) => { if (["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName)) fields.push(node); });
    return fields;
  };
  modal.contains = (node) => { for (; node; node = node.parentNode) if (node === modal) return true; return false; };
  const core = window.JobBoredApp.core;
  core.host = new Proxy(core.host, { get: (target, key) => key in target ? target[key] : () => false });
  await settings.openCommandCenterSettingsModal();
  await settle();
}

/** Change the drafting model, then press Save. */
async function saveNewWriter(env) {
  env.hostCalls.length = 0;
  el(env.document, "settingsResumeOpenRouterModel").value = "fictional-new-writer";
  await env.settings.saveCommandCenterSettingsFromForm();
}

const INLINE_PREFIX = "Your other settings are saved, but the drafting model isn’t: ";
const ERROR_TOAST = "Your other settings are saved; the drafting model isn’t. See the AI tab.";
const UNREACHABLE = "Can’t reach the JobBored server on this computer.";

function assertKeptOpenWithError(env, inline) {
  const formError = el(env.document, "settingsFormError");
  assert.equal(formError.style.display, "block", "the failure shows inline");
  assert.equal(text(formError), INLINE_PREFIX + inline);
  assert.equal(el(env.document, "settingsModal").style.display, "flex", "the modal stays open");
  assert.ok(!env.toasts.some(([, kind]) => kind === "success"), "no success toast");
  assert.ok(
    env.toasts.some(([message, kind, sticky]) => message === ERROR_TOAST && kind === "error" && sticky === true),
    "an error toast points at the AI tab",
  );
  assert.deepEqual(env.activeTabs, ["ai"]);
}

describe("HOLES PROV P5 · a refused drafting-model save keeps Settings open", () => {
  it("a 500 with a reason shows that reason inline, keeps the modal open, and toasts an error", async () => {
    const env = loadSettings(server({ writer: () => ({ status: 500, body: { error: "Fictional writer save failed." } }) }));
    await openWriterModal(env);
    await saveNewWriter(env);
    assert.equal(llmPosts(env.calls).length, 1);
    assertKeptOpenWithError(env, "Fictional writer save failed.");
    const steps = env.hostCalls.map(([name]) => name);
    assert.ok(steps.includes("merge"), "the browser settings are still saved");
    assert.ok(env.hostCalls.some(([name, id]) => name === "setSHEET_ID" && id === "fictional-sheet-id"), "the sheet id is still applied");
    assert.ok(steps.includes("syncDiscoveryButtonState"), "the discovery button still syncs");
  });

  it("a writer POST that cannot reach the server says so", async () => {
    const env = loadSettings(server({ writer: () => { throw new TypeError("Failed to fetch"); } }));
    await openWriterModal(env);
    await saveNewWriter(env);
    assertKeptOpenWithError(env, UNREACHABLE);
  });

  it("a refusal with no JSON reason names the status", async () => {
    const env = loadSettings(server({ writer: () => ({ status: 502, body: {} }) }));
    await openWriterModal(env);
    await saveNewWriter(env);
    assertKeptOpenWithError(env, "the server answered 502");
  });

  it("the grading model still saves when the drafting model is refused", async () => {
    const env = loadSettings(server({ writer: () => ({ status: 500, body: { error: "Fictional writer save failed." } }) }));
    await openWriterModal(env);
    await el(env.document, "settingsJudgeChange").dispatch("click");
    const key = el(env.document, "settingsJudgeApiKey");
    key.value = "fictional-xai-key";
    await key.dispatch("input");
    await key.dispatch("change");
    await settle();
    await saveNewWriter(env);
    const posts = llmPosts(env.calls).map((call) => call.body);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].model, "fictional-new-writer");
    assert.ok("judge" in posts[1], "the grading model POST still runs");
    assertKeptOpenWithError(env, "Fictional writer save failed.");
  });

  it("a landed writer POST still closes Settings with Saved", async () => {
    const env = loadSettings(server());
    await openWriterModal(env);
    await saveNewWriter(env);
    assert.equal(llmPosts(env.calls).length, 1);
    assert.ok(env.toasts.some(([message, kind]) => message === "Saved" && kind === "success"));
    assert.ok(!env.toasts.some(([, kind]) => kind === "error"));
    assert.equal(el(env.document, "settingsModal").style.display, "none", "the modal closes");
    assert.equal(el(env.document, "settingsFormError").style.display, "none");
  });
});

describe("HOLES PROV P5 · Use <model> in this browser reports a refused re-pin", () => {
  async function adopt(writer) {
    const env = loadSettings(server({ pin: { ...WRITER, provider: "openai", model: "fictional-server-writer", judge: null }, writer }));
    env.window.JobBoredApp.core.host.mergeStoredConfigOverridePatch = (patch) => Object.assign(env.window.COMMAND_CENTER_CONFIG, patch);
    await openWriterModal(env);
    let button;
    env.document.body.walk((node) => { if (node.getAttribute("data-action") === "settings_llm_match_server") button = node; });
    assert.ok(button, "the mismatch offers Use <model> in this browser");
    const before = env.calls.length;
    await button.dispatch("click");
    await settle();
    return { env, after: env.calls.slice(before) };
  }

  it("a refused re-pin shows the server's reason in an error toast, not Saved", async () => {
    const { env, after } = await adopt(() => ({ status: 400, body: { error: "Fictional adopt failed." } }));
    assert.equal(llmPosts(after).length, 1);
    assert.ok(!env.toasts.some(([, kind]) => kind === "success"), "no Saved toast");
    const failure = env.toasts.find(([, kind]) => kind === "error");
    assert.ok(failure, "an error toast");
    assert.match(failure[0], /Fictional adopt failed\./);
    const lastPost = after.findLastIndex((call) => call.method === "POST");
    assert.ok(after.slice(lastPost + 1).some((call) => call.method === "GET"), "the status block still refreshes");
  });

  it("an unreachable server on adopt says so", async () => {
    const { env } = await adopt(() => { throw new TypeError("Failed to fetch"); });
    const failure = env.toasts.find(([, kind]) => kind === "error");
    assert.ok(failure, "an error toast");
    assert.ok(failure[0].includes(UNREACHABLE), failure[0]);
  });

  it("a landed re-pin still says Saved", async () => {
    const { env, after } = await adopt();
    assert.equal(llmPosts(after).length, 1);
    assert.ok(env.toasts.some(([message, kind]) => message === "Saved" && kind === "success"));
    assert.ok(!env.toasts.some(([, kind]) => kind === "error"));
  });
});
