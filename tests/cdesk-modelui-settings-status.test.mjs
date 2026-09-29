/**
 * CDESK MODELUI: Settings → AI shows the model the drafter really uses.
 *
 * On 2026-09-27 Settings showed gemini-3.5-flash while the server drafted
 * with gemini-3.8-flash, and the only record of the model a draft used was a
 * console line. These tests pin the status block under the AI receipt:
 * "Drafting with", "Last draft used", the alias wording, the mismatch
 * warning plus its one-click fix, and the quiet API-down line.
 *
 * settings-modal.js is a classic global; it runs here in a vm with a tiny
 * fake DOM (repo convention: no jsdom).
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

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

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
    this._text = "";
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this) + 1] || null;
  }
  get options() {
    return this.children.filter((c) => c.tagName === "OPTION");
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join(" ");
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    child.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ target: this });
  }
  walk(fn) {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }
}

function makeDocument() {
  const doc = {
    body: null,
    createElement: (tag) => new FakeElement(tag, doc),
    getElementById(id) {
      let hit = null;
      doc.body.walk((el) => {
        if (!hit && el.id === id) hit = el;
      });
      return hit;
    },
    querySelector(selector) {
      const m = selector.match(/^\[([\w-]+)="([^"]+)"\]$/);
      if (!m) return null;
      let hit = null;
      doc.body.walk((el) => {
        if (!hit && el.getAttribute(m[1]) === m[2]) hit = el;
      });
      return hit;
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  doc.body = new FakeElement("body", doc);
  const panel = doc.body.appendChild(new FakeElement("div", doc));
  const receipt = panel.appendChild(new FakeElement("div", doc));
  receipt.setAttribute("data-receipt", "ai");
  panel.appendChild(new FakeElement("select", doc)).id = "settingsResumeProvider";
  for (const cap of ["Gemini", "OpenAI", "Anthropic", "OpenRouter", "Local"]) {
    const sel = panel.appendChild(new FakeElement("select", doc));
    sel.id = `settingsResume${cap}Model`;
    const opt = sel.appendChild(new FakeElement("option", doc));
    opt.value = cap === "Gemini" ? "gemini-3.5-flash" : "m";
  }
  return doc;
}

/**
 * @param {{ overrides?: object, apiUrl?: string, hostname?: string, respond?: (url: string) => unknown }} opts
 */
function loadSettings(opts = {}) {
  const document = makeDocument();
  const calls = [];
  const consoleCalls = [];
  const patches = [];
  const toasts = [];
  const window = {
    COMMAND_CENTER_CONFIG: opts.apiUrl ? { jobBoredApiUrl: opts.apiUrl } : {},
    JobBoredApp: {
      core: {
        host: {
          readStoredConfigOverrides: () => opts.overrides || {},
          mergeStoredConfigOverridePatch: (patch) => patches.push(JSON.parse(JSON.stringify(patch))),
          showToast: (...args) => toasts.push(args),
        },
      },
    },
    JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { gemini: "gemini-flash" } },
  };
  const record = (level) => (...args) => consoleCalls.push([level, ...args]);
  const ctx = {
    window,
    document,
    location: { hostname: opts.hostname || "127.0.0.1" },
    console: { log: record("log"), warn: record("warn"), error: record("error") },
    fetch: async (url, init) => {
      const method = (init && init.method) || "GET";
      calls.push({ url, method, body: init && init.body ? JSON.parse(init.body) : undefined });
      const answer = opts.respond ? opts.respond(url, method) : undefined;
      if (answer instanceof Error) throw answer;
      const { status = 200, body = {} } = answer || {};
      return { ok: status < 400, status, json: async () => body };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(judgePickerJs, ctx, { filename: "judge-picker.js" });
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  return { settings: window.JobBoredApp.settings, document, calls, consoleCalls, patches, toasts };
}

const serverPin = (extra = {}) => ({
  provider: "gemini",
  alias: "",
  model: "gemini-3.8-flash",
  baseUrl: "",
  keyPresent: true,
  updatedAt: "2026-09-27T08:00:00.000Z",
  ...extra,
});

const GLOBEX_DRAFT = {
  slug: "globex-data-lead",
  company: "Globex",
  title: "Data Lead",
  feature: "resume",
  provider: "gemini",
  requestedModel: "gemini-3.8-flash",
  resolvedModel: "gemini-3.8-flash",
  finishedAt: "2026-09-27T10:00:00.000Z",
};

function findFixButton(document) {
  let button = null;
  document.body.walk((el) => {
    if (el.getAttribute("data-action") === "settings_llm_match_server") button = el;
  });
  return button;
}

function addInput(document, id, value) {
  const el = document.body.appendChild(document.createElement("input"));
  el.id = id;
  el.value = value;
  return el;
}

const flush = () => new Promise((r) => setImmediate(r));

function statusText(document) {
  const el = document.getElementById("settingsLlmStatus");
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
}

describe("Settings drafting-model status", () => {
  it("should show the server's drafting model and what the last draft used", async () => {
    const { settings, document, calls } = loadSettings({
      overrides: { resumeProvider: "gemini", resumeGeminiModel: "gemini-3.8-flash", resumeGeminiApiKey: "k" },
      respond: () => ({ body: serverPin({ lastDraft: GLOBEX_DRAFT }) }),
    });
    const view = await settings.refreshLlmStatus({ nowMs: NOW });
    assert.equal(calls[0].url, "http://127.0.0.1:3847/api/llm-config");
    assert.equal(view.drafting, "Drafting with: Gemini · gemini-3.8-flash");
    assert.equal(view.lastDraft, "Last draft used gemini-3.8-flash for Data Lead at Globex · 2 hours ago");
    assert.equal(view.mismatch, null);
    assert.equal(view.alias, null, "an exact version needs no alias note");
    const text = statusText(document);
    assert.match(text, /Drafting with: Gemini · gemini-3\.8-flash/);
    assert.match(text, /Last draft used gemini-3\.8-flash for Data Lead at Globex · 2 hours ago/);
    assert.equal(document.getElementById("settingsLlmStatus").getAttribute("data-state"), "ok");
  });

  it("should warn naming both models and offer one fix button", async () => {
    const { settings, document } = loadSettings({
      overrides: { resumeProvider: "gemini", resumeGeminiModel: "gemini-3.5-flash", resumeGeminiApiKey: "k" },
      respond: () => ({ body: serverPin() }),
    });
    const view = await settings.refreshLlmStatus({ nowMs: NOW });
    assert.equal(
      view.mismatch.text,
      "This browser is set to gemini-3.5-flash, but your drafts use gemini-3.8-flash.",
    );
    assert.equal(document.getElementById("settingsLlmStatus").getAttribute("data-state"), "mismatch");
    const button = findFixButton(document);
    assert.ok(button, "the warning offers one fix button");
    assert.equal(button.textContent, "Use gemini-3.8-flash in this browser");
  });

  it("should save only the provider and model and keep the server's key when fixing a mismatch", async () => {
    const { settings, document, calls, patches } = loadSettings({
      overrides: { resumeProvider: "gemini", resumeGeminiModel: "gemini-3.5-flash", resumeGeminiApiKey: "k" },
      respond: () => ({ body: serverPin() }),
    });
    await settings.refreshLlmStatus({ nowMs: NOW });
    // Unrelated, unsaved edits sitting in the form.
    addInput(document, "settingsResumeGeminiApiKey", "");
    addInput(document, "settingsSheetId", "an-unsaved-sheet-edit");
    let fullSaves = 0;
    settings.saveCommandCenterSettingsFromForm = async () => {
      fullSaves += 1;
    };
    calls.length = 0;
    findFixButton(document).click();
    await flush();

    assert.equal(fullSaves, 0, "the fix never runs the whole-form Save");
    assert.deepEqual(patches, [{ resumeProvider: "gemini", resumeGeminiModel: "gemini-3.8-flash" }]);
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post, "the fix re-pins the server");
    assert.equal(post.url, "http://127.0.0.1:3847/api/llm-config");
    assert.deepEqual(post.body, { provider: "gemini", model: "gemini-3.8-flash", baseUrl: "" });
    assert.equal("apiKey" in post.body, false, "a blank key is never sent");
    assert.equal(document.getElementById("settingsResumeProvider").value, "gemini");
    assert.equal(document.getElementById("settingsResumeGeminiModel").value, "gemini-3.8-flash");
  });

  it("should never send the blank local key box when fixing to a local pin", async () => {
    const { settings, document, calls, patches } = loadSettings({
      overrides: {
        resumeProvider: "gemini",
        resumeGeminiModel: "gemini-3.8-flash",
        resumeGeminiApiKey: "k",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
      },
      respond: () => ({
        body: serverPin({
          provider: "openai_compatible",
          alias: "ollama",
          model: "gemma4:e2b",
          baseUrl: "http://127.0.0.1:11434/v1",
        }),
      }),
    });
    await settings.refreshLlmStatus({ nowMs: NOW });
    addInput(document, "settingsResumeLocalApiKey", "");
    addInput(document, "settingsResumeLocalBaseUrl", "http://127.0.0.1:11434/v1");
    settings.saveCommandCenterSettingsFromForm = async () => {
      throw new Error("the fix must not run the whole-form Save");
    };
    calls.length = 0;
    const button = findFixButton(document);
    assert.ok(button, "a saved local base URL is enough to offer the fix");
    button.click();
    await flush();

    assert.deepEqual(patches, [{ resumeProvider: "local", resumeLocalModel: "gemma4:e2b" }]);
    const post = calls.find((c) => c.method === "POST");
    assert.ok(post);
    assert.deepEqual(post.body, {
      provider: "ollama",
      model: "gemma4:e2b",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    assert.equal("apiKey" in post.body, false);
  });

  it("should name providers when they differ and send the user to add a key when none is saved", () => {
    const { settings } = loadSettings();
    const view = settings.buildLlmStatusView({
      reachable: true,
      server: serverPin({ provider: "openai_compatible", alias: "ollama", model: "gemma4:e2b" }),
      browser: { provider: "gemini", model: "gemini-flash", hasCredential: () => false },
      nowMs: NOW,
    });
    assert.equal(view.drafting, "Drafting with: Local · gemma4:e2b");
    assert.equal(
      view.mismatch.text,
      "This browser is set to Gemini · gemini-flash, but your drafts use Local · gemma4:e2b.",
    );
    assert.equal(view.mismatch.canFix, false);
    assert.match(view.mismatch.hint, /Add your Local key below and save/);
  });

  it("should say in plain words that a family alias lets the provider pick the version", () => {
    const { settings } = loadSettings();
    const view = settings.buildLlmStatusView({
      reachable: true,
      server: serverPin({
        model: "gemini-flash",
        lastDraft: { ...GLOBEX_DRAFT, requestedModel: "gemini-flash", resolvedModel: "gemini-flash-latest" },
      }),
      browser: { provider: "gemini", model: "gemini-flash", hasCredential: () => true },
      nowMs: NOW,
    });
    assert.equal(view.drafting, "Drafting with: Gemini · gemini-flash");
    assert.equal(
      view.alias,
      "gemini-flash is a family name, so Google picks the exact version (right now that means gemini-flash-latest). " +
        "To keep drafts on one model, choose an exact version below and save.",
    );
    assert.match(view.lastDraft, /^Last draft used gemini-flash-latest for Data Lead at Globex/);
    assert.equal(view.mismatch, null, "gemini-flash-latest and gemini-flash are the same saved choice");
  });

  it("should not call a gemini-flash-latest pin a family name", () => {
    const { settings } = loadSettings();
    const view = settings.buildLlmStatusView({
      reachable: true,
      server: serverPin({ model: "gemini-flash-latest" }),
      browser: { provider: "gemini", model: "gemini-flash", hasCredential: () => true },
      nowMs: NOW,
    });
    assert.equal(view.drafting, "Drafting with: Gemini · gemini-flash-latest");
    assert.equal(view.alias, null, "only the bare gemini-flash pin gets the family wording");
  });

  it("should say the API is unreachable in one line, hide the comparison, and log nothing", async () => {
    const { settings, document, consoleCalls } = loadSettings({
      overrides: { resumeProvider: "gemini", resumeGeminiModel: "gemini-3.5-flash", resumeGeminiApiKey: "k" },
      respond: () => new TypeError("Failed to fetch"),
    });
    const view = await settings.refreshLlmStatus({ nowMs: NOW });
    assert.equal(view.kind, "unreachable");
    const hostEl = document.getElementById("settingsLlmStatus");
    assert.equal(hostEl.children.length, 1, "one line, no comparison");
    assert.match(statusText(document), /Can’t reach the JobBored server on this computer/);
    assert.equal(hostEl.getAttribute("data-state"), "unreachable");
    assert.deepEqual(consoleCalls, []);
  });

  it("should not call the loopback API from a hosted page with no API URL", async () => {
    const { settings, calls, consoleCalls } = loadSettings({
      hostname: "emilio3435.github.io",
      respond: () => ({ body: serverPin() }),
    });
    const view = await settings.refreshLlmStatus({ nowMs: NOW });
    assert.equal(view.kind, "unreachable");
    assert.deepEqual(calls, []);
    assert.deepEqual(consoleCalls, []);
  });

  it("should treat a 404 as reachable-but-unset and still show the last draft", async () => {
    const { settings } = loadSettings({
      respond: () => ({
        status: 404,
        body: { error: "No LLM pin configured.", code: "llm_unconfigured", lastDraft: GLOBEX_DRAFT },
      }),
    });
    const view = await settings.refreshLlmStatus({ nowMs: NOW });
    assert.equal(view.kind, "ok");
    assert.equal(view.unconfigured, true);
    assert.match(view.drafting, /No drafting model is set on the server yet/);
    assert.match(view.lastDraft, /Last draft used gemini-3\.8-flash/);
  });
});
