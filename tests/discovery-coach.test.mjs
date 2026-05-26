/**
 * Tests for the discovery drawer first-run coach (`discovery-coach.js`).
 *
 * The coach is a vanilla browser module attached to `window.JobBoredDiscoveryCoach`.
 * These tests run the source through `vm.runInContext` with a minimal DOM stub so
 * we can verify behavior without a headless browser. The headless smoke harness
 * at `scripts/smoke-discovery-drawer.mjs` covers full DOM rendering separately.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const coachJs = readFileSync(join(repoRoot, "discovery-coach.js"), "utf8");

const TARGET_IDS = [
  "dpTargetRoles",
  "dpPresetBrowserPlusAts",
  "settingsProfileScheduleLocalEnable",
  "settingsDiscoveryGuideBtn",
  "discoveryDrawerOpenRunsBtn",
];

function createStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
}

function createNode(tag) {
  const node = {
    tagName: String(tag || "DIV").toUpperCase(),
    style: {},
    hidden: false,
    innerHTML: "",
    textContent: "",
    type: "",
    className: "",
    attrs: {},
    children: [],
    listeners: {},
    isConnected: false,
    parentNode: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    dataset: {},
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(node.attrs, k) ? node.attrs[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(node.attrs, k); },
    removeAttribute(k) { delete node.attrs[k]; },
    addEventListener(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) {
      node.children.push(child);
      child.parentNode = node;
      child.isConnected = true;
      return child;
    },
    getBoundingClientRect() { return { top: 100, bottom: 130, left: 80, right: 200, width: 120, height: 30 }; },
    focus() {},
  };
  return node;
}

function createDom() {
  const idMap = new Map();
  TARGET_IDS.forEach((id) => {
    const el = createNode("div");
    el.attrs.id = id;
    idMap.set(id, el);
  });
  const body = createNode("body");
  const documentLike = {
    body,
    createElement(tag) { return createNode(tag); },
    getElementById(id) { return idMap.get(id) || null; },
  };
  return { document: documentLike, idMap };
}

function loadCoach({ storage, snapshot, toasts }) {
  const dom = createDom();
  const ctx = {
    document: dom.document,
    localStorage: storage,
    innerWidth: 1280,
    innerHeight: 900,
    showToast(message, type) { toasts.push({ message, type }); },
    getDiscoveryReadinessSnapshot() { return snapshot; },
    JobBoredDiscoveryDrawerSubtabs: {
      setActiveSubtab(_id, _opts) {},
      getActiveSubtab() { return "search"; },
      ORDER: ["search", "sources", "automation", "connection", "history"],
    },
    console,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(coachJs, ctx, { filename: "discovery-coach.js" });
  return { ctx, dom };
}

describe("discovery-coach.js — first-run coach", () => {
  let storage;
  let snapshot;
  let toasts;
  let coach;

  beforeEach(() => {
    storage = createStorage();
    snapshot = {};
    toasts = [];
    const loaded = loadCoach({ storage, snapshot, toasts });
    coach = loaded.ctx.JobBoredDiscoveryCoach;
  });

  it("exposes start / next / skip / dismiss on window.JobBoredDiscoveryCoach", () => {
    assert.equal(typeof coach, "object");
    assert.equal(typeof coach.start, "function");
    assert.equal(typeof coach.next, "function");
    assert.equal(typeof coach.skip, "function");
    assert.equal(typeof coach.dismiss, "function");
  });

  it("localStorage flag gates auto-fire on drawer open", () => {
    storage.setItem("command_center_discovery_coach_done", "1");
    const fired = coach.start({ force: false });
    assert.equal(fired, false, "start({ force: false }) must be a no-op when the flag is set");
    assert.equal(coach._isActive(), false);

    const forced = coach.start({ force: true });
    assert.equal(forced, true, "start({ force: true }) must re-fire even when the flag is set");
    assert.equal(coach._isActive(), true);
  });

  it("readiness-aware skip removes Connection when webhookConfigured: true", () => {
    snapshot.webhookConfigured = true;
    const steps = coach._buildSteps();
    assert.equal(steps.length, 4);
    const keys = steps.map((s) => String(s.key)).join(",");
    assert.equal(
      keys,
      "search,sources,automation,history",
      "Connection must be filtered out when the snapshot reports the webhook is configured",
    );
    assert.equal(steps.some((s) => String(s.key) === "connection"), false);
  });

  it("stays silent on subsequent drawer opens once the flag is set via dismiss", () => {
    const firstOpen = coach.start({ force: false });
    assert.equal(firstOpen, true, "first auto-open must fire when no flag is present");
    assert.equal(coach._isDone(), false, "the flag should not be set until dismiss runs");

    coach.dismiss();
    assert.equal(coach._isDone(), true, "dismiss must persist the done flag");
    assert.equal(toasts.length, 1, "dismiss should fire exactly one toast");
    assert.equal(toasts[0].message, "You're set");
    assert.equal(toasts[0].type, "success");

    const secondOpen = coach.start({ force: false });
    assert.equal(secondOpen, false, "subsequent drawer opens must not re-fire the coach");
    assert.equal(coach._isActive(), false);
  });
});
