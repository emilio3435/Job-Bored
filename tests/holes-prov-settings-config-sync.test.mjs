/**
 * HOLES PROV · Settings and another tab's save. AUTH re-reads the shared
 * override store when another tab saves and announces it as
 * jb:config:changed. An open Settings form must take the saved values into
 * every field the user has not touched, so its Save cannot write a stale
 * copy over the other tab's save, while a field the user is editing keeps
 * the edit.
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
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector() { return null; }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
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
    removeEventListener() {},
  };
  doc.body = new FakeElement("body", doc);
  return doc;
}

const BROWSER_CONFIG = {
  resumeProvider: "openrouter",
  resumeOpenRouterModel: "fictional-browser-writer",
  resumeOpenRouterApiKey: "fictional-browser-key",
  resumeOpenRouterBaseUrl: "https://fictional.example/v1",
  resumeOpenAIApiKey: "fictional-openai-browser-key",
  title: "Fictional Board",
  jobPostingScrapeUrl: "https://scrape.example/first",
};
const SERVER_WRITER = {
  provider: "openrouter", alias: "", model: "fictional-browser-writer",
  baseUrl: "https://fictional.example/v1", keyPresent: true, judge: null,
};

/**
 * Settings in a vm with a fake DOM, a window that dispatches events, and a
 * shared override store the "other tab" can write to.
 */
async function openSettings() {
  const document = makeDocument();
  const calls = [];
  const patches = [];
  const toasts = [];
  const store = { overrides: {} };
  const windowListeners = {};
  const window = {
    COMMAND_CENTER_CONFIG: { ...BROWSER_CONFIG },
    JobBoredApp: {
      core: {
        host: {
          readStoredConfigOverrides: () => ({ ...store.overrides }),
          mergeStoredConfigOverridePatch: (patch) => patches.push(JSON.parse(JSON.stringify(patch))),
          showToast: (...args) => toasts.push(args),
          parseGoogleSheetId: () => "fictional-sheet-id",
          getSheetId: () => "fictional-sheet-id",
          getOAuthClientId: () => "",
          normalizeDashboardTitle: (title) => String(title || ""),
          setSHEET_ID() {},
          setDashboardSheetLinks() {},
          syncDiscoveryButtonState() {},
        },
      },
    },
    JobBoredModelCatalog: { DEFAULT_MODEL_BY_PROVIDER: { openrouter: "fictional-default" } },
    JobBoredSettingsTabs: { activateTabForField() {}, setActiveSettingsTab() {} },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    dispatchEvent(event) {
      for (const fn of windowListeners[event.type] || []) fn(event);
      return true;
    },
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
      return { ok: true, status: 200, json: async () => (method === "POST" ? { ...SERVER_WRITER, ...body } : SERVER_WRITER) };
    },
    AbortController,
    CustomEvent,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(judgePickerJs, ctx, { filename: "judge-picker.js" });
  vm.runInContext(settingsModalJs, ctx, { filename: "settings-modal.js" });
  const settings = window.JobBoredApp.settings;

  const modal = document.body.appendChild(document.createElement("div"));
  modal.id = "settingsModal";
  const panel = modal.appendChild(document.createElement("div"));
  panel.id = "settings-panel-ai";
  const receipt = panel.appendChild(document.createElement("div"));
  receipt.setAttribute("data-receipt", "ai");
  const field = (tag, id) => {
    const el = panel.appendChild(document.createElement(tag));
    el.id = id;
    return el;
  };
  field("select", "settingsResumeProvider");
  field("select", "settingsResumeOpenRouterModel").value = BROWSER_CONFIG.resumeOpenRouterModel;
  field("input", "settingsResumeOpenRouterApiKey");
  field("input", "settingsResumeOpenRouterBaseUrl").value = BROWSER_CONFIG.resumeOpenRouterBaseUrl;
  field("input", "settingsResumeOpenAIApiKey");
  field("input", "settingsTitle");
  field("input", "settingsJobPostingScrapeUrl");
  field("input", "settingsSheetId");
  const error = field("div", "settingsFormError");
  error.style.display = "none";
  modal.querySelectorAll = () => {
    const fields = [];
    modal.walk((node) => { if (["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName)) fields.push(node); });
    return fields;
  };
  modal.contains = (node) => { for (; node; node = node.parentNode) if (node === modal) return true; return false; };
  const core = window.JobBoredApp.core;
  core.host = new Proxy(core.host, { get: (target, key) => (key in target ? target[key] : () => false) });

  settings.initCommandCenterSettings();
  await settings.openCommandCenterSettingsModal();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  /** Another tab saves: the shared store and this tab's live config change. */
  const otherTabSaves = (patch) => {
    store.overrides = { ...store.overrides, ...patch };
    Object.assign(window.COMMAND_CENTER_CONFIG, patch);
    window.dispatchEvent(new CustomEvent("jb:config:changed", { detail: { source: "other-tab" } }));
  };
  const el = (id) => document.getElementById(id);
  const llmPosts = () => calls.filter((call) => call.method === "POST" && String(call.url).endsWith("/api/llm-config"));
  return { settings, window, document, el, patches, toasts, calls, llmPosts, otherTabSaves };
}

describe("Settings follows another tab's save (jb:config:changed)", () => {
  it("an untouched field takes the saved value, and an edited one keeps the user's edit", async () => {
    const s = await openSettings();
    assert.equal(s.el("settingsResumeOpenRouterApiKey").value, "fictional-browser-key");
    s.el("settingsTitle").value = "My edited title";

    s.otherTabSaves({
      resumeOpenRouterApiKey: "fictional-other-tab-key",
      jobPostingScrapeUrl: "https://scrape.example/other-tab",
      title: "Other Tab Title",
    });

    assert.equal(s.el("settingsResumeOpenRouterApiKey").value, "fictional-other-tab-key");
    assert.equal(s.el("settingsJobPostingScrapeUrl").value, "https://scrape.example/other-tab");
    assert.equal(s.el("settingsTitle").value, "My edited title", "the user's edit wins over the other tab");
  });

  it("Save after the refresh writes no stale copy over the other tab's save", async () => {
    const s = await openSettings();
    s.el("settingsTitle").value = "My edited title";
    s.otherTabSaves({
      resumeOpenRouterApiKey: "fictional-other-tab-key",
      jobPostingScrapeUrl: "https://scrape.example/other-tab",
    });

    await s.settings.saveCommandCenterSettingsFromForm();

    const saved = s.patches.at(-1);
    assert.equal(saved.resumeOpenRouterApiKey, "fictional-other-tab-key");
    assert.equal(saved.jobPostingScrapeUrl, "https://scrape.example/other-tab");
    assert.equal(saved.title, "My edited title");
    assert.equal(s.llmPosts().length, 0, "the other tab's writer is not re-posted from a form nobody edited");
  });

  it("a writer edit still posts once, carrying the other tab's untouched key", async () => {
    const s = await openSettings();
    s.el("settingsResumeOpenRouterModel").value = "fictional-user-writer";
    s.otherTabSaves({ resumeOpenRouterApiKey: "fictional-other-tab-key" });

    await s.settings.saveCommandCenterSettingsFromForm();

    const posts = s.llmPosts();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.model, "fictional-user-writer");
    assert.equal(posts[0].body.apiKey, "fictional-other-tab-key");
  });

  it("the refresh is not an unsaved change, but the user's edit still is", async () => {
    const s = await openSettings();
    s.otherTabSaves({ jobPostingScrapeUrl: "https://scrape.example/other-tab" });
    assert.equal(s.settings.settingsFormIsDirty(), false, "closing does not ask to discard the other tab's values");

    s.el("settingsTitle").value = "My edited title";
    s.otherTabSaves({ resumeOpenRouterApiKey: "fictional-other-tab-key" });
    assert.equal(s.settings.settingsFormIsDirty(), true);
  });

  it("keeps a save error on screen", async () => {
    const s = await openSettings();
    const error = s.el("settingsFormError");
    error.textContent = "Your other settings are saved, but the drafting model isn’t: fictional reason";
    error.style.display = "block";
    s.otherTabSaves({ jobPostingScrapeUrl: "https://scrape.example/other-tab" });
    assert.match(error.textContent, /fictional reason/);
    assert.equal(error.style.display, "block");
  });

  it("a closed Settings form is left alone", async () => {
    const s = await openSettings();
    s.settings.closeCommandCenterSettingsModal();
    s.otherTabSaves({ resumeOpenRouterApiKey: "fictional-other-tab-key" });
    assert.equal(s.el("settingsResumeOpenRouterApiKey").value, "fictional-browser-key");
  });
});
