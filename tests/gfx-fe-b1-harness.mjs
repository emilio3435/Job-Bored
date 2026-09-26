/* ============================================================
   Sandbox for the GFX FE-B1 probes (the D2 pre-flow gate and the
   route-to-local screen).

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite. It reuses L0's DOM/IndexedDB fakes and loads the flow in
   index.html's order, plus oneflow-route-local.js, with three things
   a probe controls:

     · `location` — the page address the gate reads;
     · `fetch`    — every ping is recorded, so "no ping before a click"
                    is asserted on the wire;
     · window/document listeners — blur, focus and visibilitychange can
                    be fired, and a probe can see they were removed.
   ============================================================ */
import vm from "node:vm";
import {
  FakeCustomEvent,
  FakeNode,
  makeFakeDocument,
  makeFakeIndexedDb,
  readRepoFile,
} from "./oneflow-l0-harness.mjs";

function listenerTarget(target) {
  const listeners = new Map();
  target.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  target.removeEventListener = (type, fn) => {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  };
  target.fire = (type) => {
    for (const fn of [...(listeners.get(type) || [])]) fn({ type });
  };
  target.listenerCount = (type) => (listeners.get(type) || new Set()).size;
  return target;
}

/**
 * @param {{
 *   location?: Record<string, string>,
 *   ping?: (call: {url: string, init: object}) => unknown,
 *   platform?: string,
 * }} [options] `ping` answers each fetch: an object becomes a JSON
 *   Response, an Error is thrown (a refused connection or a denied LNA
 *   prompt), and a Promise is awaited.
 */
export function loadRouteLocal(options = {}) {
  const doc = listenerTarget(makeFakeDocument());
  doc.register("oneFlowMount");
  doc.register("discoverySetupWizardMount");
  doc.visibilityState = "visible";
  const win = listenerTarget({});
  const fetchCalls = [];
  async function fetchImpl(url, init = {}) {
    fetchCalls.push({ url: String(url), init });
    const answer = options.ping
      ? await options.ping({ url: String(url), init })
      : new TypeError("Failed to fetch");
    if (answer instanceof Error) throw answer;
    const body = answer && typeof answer === "object" ? answer : {};
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => body,
    };
  }
  const clipboardWrites = [];
  const navigator = {
    platform: options.platform || "MacIntel",
    clipboard: {
      writeText: async (text) => {
        clipboardWrites.push(text);
      },
    },
  };
  const ctx = {
    window: win,
    document: doc,
    navigator,
    fetch: fetchImpl,
    console: { warn() {}, error() {}, info() {}, log() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: () => {},
    AbortController,
    URL,
    Object,
    Set,
    Map,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Promise,
    Math,
    Error,
    Symbol,
    RegExp,
    Node: FakeNode,
    indexedDB: makeFakeIndexedDb(),
    crypto: { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` },
    CustomEvent: FakeCustomEvent,
  };
  win.CustomEvent = FakeCustomEvent;
  win.navigator = navigator;
  win.fetch = fetchImpl;
  win.location = {
    protocol: "https:",
    hostname: "jobbored.elioai.app",
    origin: "https://jobbored.elioai.app",
    href: "https://jobbored.elioai.app/",
    search: "",
    pathname: "/",
    hash: "",
    ...(options.location || {}),
  };
  ctx.location = win.location;
  vm.createContext(ctx);
  const files = [
    "user-content-store.js",
    "onboarding-telemetry.js",
    "discovery-wizard-shell.js",
    "onboarding-flow.js",
    "local-server.js",
    "oneflow-route-local.js",
    "oneflow-beat-google.js",
  ];
  for (const file of files) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  return {
    window: win,
    document: doc,
    fetchCalls,
    clipboardWrites,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    routeLocal: win.JobBoredOneFlowRouteLocal,
    events: doc._events,
    mount: () => doc.getElementById("oneFlowMount"),
  };
}

/** The shell's rendered footer action, by its action id. */
export function action(mount, actionId) {
  return mount.querySelector(`[data-action-id="${actionId}"]`);
}

export function text(mount) {
  return mount ? mount.textContent : "";
}

/** Resolve once `predicate()` holds, or fail after `ms`. */
export async function until(predicate, ms = 1000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until: condition never held");
    await new Promise((r) => setTimeout(r, 2));
  }
}
