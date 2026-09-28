/**
 * MREV D7 · Settings → AI → Judge model (K1).
 *
 * An optional second model grades the writing (MREV-2/3: the user sets an
 * xAI key here). The group must post K1 `judge` or `null`, show a stored key
 * only as "present", read `judge` back from both the GET and the POST
 * (G9), and never touch the writer's pin or key: it re-posts the server's
 * own writer pin without an apiKey, which the server reads as "keep it".
 *
 * settings-modal.js is a classic global; it runs in a vm with a tiny fake
 * DOM (repo convention: no jsdom).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");

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
    this.hidden = false;
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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  walk(fn) { fn(this); for (const c of this.children) c.walk(fn); }
}

function makeDocument() {
  const doc = {
    body: null,
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

function loadSettings(respond) {
  const document = makeDocument();
  const calls = [];
  const toasts = [];
  const window = {
    COMMAND_CENTER_CONFIG: {},
    JobBoredApp: {
      core: {
        host: {
          readStoredConfigOverrides: () => ({}),
          mergeStoredConfigOverridePatch: () => {},
          showToast: (...args) => toasts.push(args),
        },
      },
    },
    JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { gemini: "gemini-flash" } },
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
      const { status = 200, body: answer = {} } = respond(url, method, body) || {};
      return { ok: status < 400, status, json: async () => answer };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  return { settings: window.JobBoredApp.settings, document, calls, toasts };
}

const WRITER = { provider: "gemini", alias: "", model: "gemini-3.8-flash", baseUrl: "", keyPresent: true, updatedAt: "2026-09-28T08:00:00.000Z" };
const JUDGE = { provider: "openai_compatible", model: "grok-judge-1", baseUrl: "https://api.x.ai/v1", keyPresent: true };

const el = (document, id) => document.getElementById(id);
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

function fill(document, { provider, model, baseUrl, apiKey }) {
  if (provider !== undefined) el(document, "settingsJudgeProvider").value = provider;
  if (model !== undefined) el(document, "settingsJudgeModel").value = model;
  if (baseUrl !== undefined) el(document, "settingsJudgeBaseUrl").value = baseUrl;
  if (apiKey !== undefined) el(document, "settingsJudgeApiKey").value = apiKey;
}

describe("MREV D7 · Settings judge model", () => {
  it("should show an optional Judge model group with its helper text, filled from GET", async () => {
    const { settings, document } = loadSettings(() => ({ body: { ...WRITER, judge: JUDGE } }));
    await settings.refreshLlmStatus();
    const group = el(document, "settingsJudgeGroup");
    assert.ok(group, "the group is in the AI pane");
    assert.equal(group.parentNode.id, "settings-panel-ai");
    assert.match(text(group), /Judge model \(optional\)/);
    assert.match(text(group), /A different model grades the writing\. Leave empty to use your writing model\./);
    assert.equal(el(document, "settingsJudgeProvider").value, "openai_compatible");
    assert.equal(el(document, "settingsJudgeModel").value, "grok-judge-1");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "https://api.x.ai/v1");
    assert.equal(settings.judgeFormIsDirty(), false, "a fill from the server is not an edit");
  });

  it("should say a stored key is present and never put a key in the page", async () => {
    const { settings, document } = loadSettings(() => ({ body: { ...WRITER, judge: { ...JUDGE, apiKey: "xai-should-never-show" } } }));
    await settings.refreshLlmStatus();
    const key = el(document, "settingsJudgeApiKey");
    assert.equal(key.type, "password");
    assert.equal(key.value, "");
    assert.match(text(el(document, "settingsJudgeKeyState")), /A key is saved for the judge/);
    let leaked = false;
    document.body.walk((node) => {
      if (String(node.value).includes("xai-should") || node._text.includes("xai-should") || Object.values(node.attributes).some((v) => v.includes("xai-should"))) leaked = true;
    });
    assert.equal(leaked, false);
  });

  it("should leave every field empty when no judge is set", async () => {
    const { settings, document } = loadSettings(() => ({ body: { ...WRITER, judge: null } }));
    await settings.refreshLlmStatus();
    assert.equal(el(document, "settingsJudgeProvider").value, "");
    assert.equal(el(document, "settingsJudgeModel").value, "");
    assert.match(text(el(document, "settingsJudgeKeyState")), /No key saved for the judge/);
  });

  it("should post the server's writer pin untouched plus K1 judge, with the typed key", async () => {
    const { settings, document, calls } = loadSettings((url, method, body) => (method === "POST"
      ? { body: { ...WRITER, judge: { provider: body.judge.provider, model: body.judge.model, baseUrl: body.judge.baseUrl, keyPresent: true } } }
      : { body: { ...WRITER, judge: null } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "openai_compatible", model: "grok-judge-1", baseUrl: "https://api.x.ai/v1", apiKey: "xai-test-key" });
    assert.equal(settings.judgeFormIsDirty(), true);
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.filter((c) => c.method === "POST");
    assert.equal(post.length, 1);
    assert.equal(post[0].url, "http://127.0.0.1:3847/api/llm-config");
    assert.deepEqual(post[0].body, {
      provider: "gemini",
      model: "gemini-3.8-flash",
      baseUrl: "",
      judge: { provider: "openai_compatible", model: "grok-judge-1", baseUrl: "https://api.x.ai/v1", apiKey: "xai-test-key" },
    });
    assert.equal("apiKey" in post[0].body, false, "the writer's key is kept by omission");
    /* G9: the POST answer is read back; the typed key leaves the page. */
    assert.equal(el(document, "settingsJudgeApiKey").value, "");
    assert.match(text(el(document, "settingsJudgeKeyState")), /A key is saved for the judge/);
    assert.equal(settings.judgeFormIsDirty(), false);
  });

  it("should keep the stored judge key when none is typed", async () => {
    const { settings, document, calls } = loadSettings(() => ({ body: { ...WRITER, judge: JUDGE } }));
    await settings.refreshLlmStatus();
    fill(document, { model: "grok-judge-2" });
    await settings.saveJudgeModel();
    const post = calls.find((c) => c.method === "POST");
    assert.deepEqual(post.body.judge, { provider: "openai_compatible", model: "grok-judge-2", baseUrl: "https://api.x.ai/v1" });
  });

  it("should post judge null when the fields are emptied, so drafts use the writing model", async () => {
    const { settings, document, calls } = loadSettings(() => ({ body: { ...WRITER, judge: JUDGE } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "", model: "", baseUrl: "" });
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((c) => c.method === "POST");
    assert.equal(post.body.judge, null);
    assert.equal(post.body.model, "gemini-3.8-flash");
  });

  it("Grok P1 · should clear the judge when the provider is set to None, whatever the other fields still hold", async () => {
    const { settings, document, calls } = loadSettings(() => ({ body: { ...WRITER, judge: JUDGE } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "" }); /* the saved model and base URL are still in their boxes */
    assert.equal(settings.judgeFormIsDirty(), true);
    assert.equal(await settings.saveJudgeModel(), true);
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post, "the clear is posted");
    assert.equal(post.body.judge, null);
  });

  it("Grok P1 · should empty the model, base URL and key when the provider changes to None", async () => {
    const { settings, document } = loadSettings(() => ({ body: { ...WRITER, judge: JUDGE } }));
    await settings.refreshLlmStatus();
    fill(document, { apiKey: "xai-typed" });
    const provider = el(document, "settingsJudgeProvider");
    provider.value = "";
    for (const fn of provider.listeners.change || []) fn({ target: provider });
    assert.equal(el(document, "settingsJudgeModel").value, "");
    assert.equal(el(document, "settingsJudgeBaseUrl").value, "");
    assert.equal(el(document, "settingsJudgeApiKey").value, "");
  });

  it("should re-post an aliased writer pin under its alias, as the mismatch fix does", async () => {
    const local = { provider: "openai_compatible", alias: "local", model: "qwen", baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false };
    const { settings, document, calls } = loadSettings(() => ({ body: { ...local, judge: null } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "openrouter", model: "x-ai/grok-judge" });
    await settings.saveJudgeModel();
    const post = calls.find((c) => c.method === "POST");
    assert.equal(post.body.provider, "local");
    assert.equal(post.body.baseUrl, "http://127.0.0.1:11434/v1");
  });

  it("should refuse a judge without a model or with a bad base URL, and post nothing", async () => {
    const { settings, document, calls } = loadSettings(() => ({ body: { ...WRITER, judge: null } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "openai_compatible", model: "" });
    assert.equal(await settings.saveJudgeModel(), false);
    assert.match(text(el(document, "settingsJudgeError")), /Name the judge model/);
    fill(document, { model: "grok-judge-1", baseUrl: "ftp://api.example.test" });
    assert.equal(await settings.saveJudgeModel(), false);
    assert.match(text(el(document, "settingsJudgeError")), /http/);
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });

  it("should not save a judge when the server has no drafting model yet", async () => {
    const { settings, document, calls } = loadSettings(() => ({ status: 404, body: { error: "No LLM pin configured.", code: "llm_unconfigured" } }));
    await settings.refreshLlmStatus();
    fill(document, { provider: "openai_compatible", model: "grok-judge-1" });
    assert.equal(await settings.saveJudgeModel(), false);
    assert.match(text(el(document, "settingsJudgeError")), /drafting model/);
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  });
});
