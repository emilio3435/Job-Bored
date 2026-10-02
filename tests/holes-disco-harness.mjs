/* HOLES DISCO — shared harness for the discovery run lifecycle tests.

   Loads the real classic-global scripts (tracker, status handoff, run
   orchestration) into one vm context per "tab", with a fake clock, a fake
   document and a BroadcastChannel hub that several tabs can share. Only the
   network (fetch) and the app host bridge are stubbed. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readRepoFile(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** Let promise chains settle (real macrotask, so microtasks drain first). */
export async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createClock(startMs = Date.parse("2026-10-02T12:00:00.000Z")) {
  let now = startMs;
  let seq = 0;
  const timers = new Map();
  function add(fn, ms, every) {
    const id = ++seq;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + delay, fn, every: every ? Math.max(1, delay) : 0 });
    return id;
  }
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  }
  return {
    Date: FakeDate,
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: (id) => timers.delete(id),
    /** Delays (ms from now) of every pending timer, soonest first. */
    pending() {
      return [...timers.values()].map((t) => t.at - now).sort((a, b) => a - b);
    },
    async advance(ms) {
      const target = now + Math.max(0, ms);
      for (;;) {
        let nextId = null;
        let next = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!next || t.at < next.at)) {
            next = t;
            nextId = id;
          }
        }
        if (!next) break;
        now = Math.max(now, next.at);
        if (next.every) next.at = now + next.every;
        else timers.delete(nextId);
        next.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

export function createStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** Same-origin BroadcastChannel stand-in shared by every tab of one test. */
export function createBroadcastHub() {
  const channels = new Set();
  const log = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = String(name);
      this.onmessage = null;
      this._listeners = new Set();
      this._closed = false;
      channels.add(this);
    }
    postMessage(data) {
      if (this._closed) return;
      const message = JSON.parse(JSON.stringify(data));
      log.push({ name: this.name, message });
      for (const ch of channels) {
        if (ch === this || ch._closed || ch.name !== this.name) continue;
        queueMicrotask(() => ch._deliver(message));
      }
    }
    _deliver(message) {
      if (this._closed) return;
      const event = { data: message };
      if (typeof this.onmessage === "function") this.onmessage(event);
      for (const fn of this._listeners) fn(event);
    }
    addEventListener(type, fn) {
      if (type === "message") this._listeners.add(fn);
    }
    removeEventListener(type, fn) {
      if (type === "message") this._listeners.delete(fn);
    }
    close() {
      this._closed = true;
      channels.delete(this);
    }
  }
  return { BroadcastChannel: FakeBroadcastChannel, log };
}

export function createElement(tag = "div", attrs = {}) {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map(Object.entries(attrs));
  const el = {
    tagName: String(tag).toUpperCase(),
    hidden: false,
    disabled: false,
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
    setAttribute: (k, v) => attributes.set(k, String(v)),
    getAttribute: (k) => (attributes.has(k) ? attributes.get(k) : null),
    removeAttribute: (k) => attributes.delete(k),
    hasAttribute: (k) => attributes.has(k),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    async dispatch(type, event = {}) {
      for (const fn of listeners.get(type) || []) {
        await fn({ type, target: el, preventDefault() {}, ...event });
      }
    },
    click() {
      return el.dispatch("click");
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
  };
  return el;
}

export function createDocument() {
  const listeners = new Map();
  const elements = new Map();
  const doc = {
    visibilityState: "visible",
    hidden: false,
    elements,
    events: [],
    body: createElement("body"),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => createElement(tag),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
    dispatchEvent(event) {
      doc.events.push(event);
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    setVisibility(state) {
      doc.visibilityState = state;
      doc.hidden = state === "hidden";
      doc.dispatchEvent({ type: "visibilitychange" });
    },
  };
  return doc;
}

/** A canned fetch Response. */
export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * fetch double whose calls stay pending until the test answers them, so a
 * test can hold one poll in flight while another run starts. Honors
 * AbortSignal like the real fetch.
 */
export function createControlledFetch() {
  const calls = [];
  function fetchImpl(url, init = {}) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call = { url: String(url), init, resolve, reject, settled: false };
    const signal = init && init.signal;
    if (signal) {
      const onAbort = () => {
        if (call.settled) return;
        call.settled = true;
        call.aborted = true;
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    calls.push(call);
    return promise;
  }
  return {
    fetch: fetchImpl,
    calls,
    pendingCalls: () => calls.filter((c) => !c.settled),
    respond(call, status, body) {
      if (call.settled) return;
      call.settled = true;
      call.resolve(jsonResponse(status, body));
    },
    fail(call, message = "Failed to fetch") {
      if (call.settled) return;
      call.settled = true;
      call.reject(new TypeError(message));
    },
  };
}

export const RUN_FILES = [
  "discovery-run-tracker.js",
  "discovery-status-handoff.js",
  "discovery-effective-intent.js",
  "discovery-run-orchestration.js",
];

/**
 * One browser tab: the real tracker + status handoff + orchestration over a
 * fake clock/document/storage/fetch. Tabs built with the same `storage` and
 * `hub` share an origin.
 */
export function loadDiscoveryTab(options = {}) {
  const clock = options.clock || createClock();
  const storage = options.storage || createStorage();
  const hub = options.hub || createBroadcastHub();
  const document = options.document || createDocument();
  // renderDiscoveryRunStatus speaks through #discoveryBtn; every page has one.
  if (!document.elements.has("discoveryBtn")) {
    document.elements.set("discoveryBtn", createElement("button"));
  }
  const toasts = [];
  const loads = [];
  const fetchImpl = options.fetch || (async () => jsonResponse(200, {}));
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    document,
    localStorage: storage,
    sessionStorage: createStorage(),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    Date: clock.Date,
    AbortController,
    URL,
    URLSearchParams,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Error,
    TypeError,
    queueMicrotask,
    crypto: globalThis.crypto,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    BroadcastChannel: options.noBroadcastChannel ? undefined : hub.BroadcastChannel,
    history: { replaceState() {} },
    location: { search: "", pathname: "/", hash: "", hostname: "app.example.com", port: "" },
    fetch: (...args) => fetchImpl(...args),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const file of options.files || RUN_FILES) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  const discovery = ctx.JobBoredDiscovery;
  const webhookUrl = options.webhookUrl || "https://worker.example.com/webhook";
  discovery.status.host = {
    getConfigCore: () => ({ getDiscoveryWebhookSecret: () => "test-secret" }),
    getDiscoveryWebhookUrl: () => webhookUrl,
    normalizeDiscoveryWebhookIdentity: (u) => String(u || "").trim(),
    isLocalDashboardOrigin: () => false,
    isLocalWebhookCandidateUrl: () => false,
    isSignedIn: () => true,
    showToast: (message, tone, sticky, action) => {
      toasts.push({ message: String(message), tone, sticky: !!sticky, action });
    },
    loadAllData: async () => {
      loads.push(clock.now());
      return true;
    },
    ...(options.statusHost || {}),
  };
  return {
    ctx,
    clock,
    storage,
    hub,
    document,
    toasts,
    loads,
    webhookUrl,
    discovery,
    tracker: discovery.runTracker.discoveryRunTracker,
    runTracker: discovery.runTracker,
    status: discovery.status,
    orchestration: discovery.runOrchestration,
  };
}

/** A run-status body the worker would answer GET /runs/:id with. */
export function runStatusBody(runId, overrides = {}) {
  return {
    ok: true,
    runId,
    status: "running",
    terminal: false,
    trigger: "manual",
    message: "Discovery run in progress.",
    startedAt: "2026-10-02T12:00:00.000Z",
    request: { variationKey: "vk-1", requestedAt: "2026-10-02T12:00:00.000Z" },
    lifecycle: {},
    writeResult: {},
    ...overrides,
  };
}
