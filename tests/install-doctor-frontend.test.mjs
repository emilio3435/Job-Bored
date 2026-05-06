import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJsSource = readFileSync(join(__dirname, "..", "app.js"), "utf8");

/**
 * The frontend helpers (installDoctor, installKeepAliveOnce,
 * refreshKeepAlivePill) live at module scope inside app.js. We extract that
 * slice and evaluate it in a fresh sandbox so we can fetch-mock the proxy
 * endpoints and assert behavior, without instantiating the rest of the app.
 */
function extractHelpers() {
  const start = appJsSource.indexOf("async function installDoctor()");
  const end = appJsSource.indexOf("function setAuthAvatarDisplay");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate frontend install helpers in app.js");
  }
  return appJsSource.slice(start, end);
}

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  };
}

function makeFakePill() {
  const classes = new Set();
  return {
    hidden: true,
    textContent: "",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    _classes: classes,
  };
}

function loadHelpers(env = {}) {
  const helpers = extractHelpers();
  const dispatched = [];
  const pill = env.pill || null;
  const win = Object.assign(
    {
      installDoctorState: null,
      keepAliveStatusState: null,
      dispatchEvent: (ev) => {
        dispatched.push(ev);
        return true;
      },
    },
    env.windowExtras || {},
  );
  const document = {
    getElementById: (id) => (id === "keepAlivePill" ? pill : null),
  };
  const localStorage = env.localStorage || makeFakeLocalStorage();
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }
  const fakeFetch = env.fetch;
  const wrapper = new Function(
    "window",
    "fetch",
    "localStorage",
    "document",
    "CustomEvent",
    helpers +
      "\nreturn { installDoctor, installKeepAliveOnce, refreshKeepAlivePill };",
  );
  const api = wrapper(win, fakeFetch, localStorage, document, CustomEvent);
  return { api, win, dispatched, localStorage, pill };
}

describe("installDoctor() helper", () => {
  it("POSTs to /__proxy/install-doctor and dispatches a CustomEvent", async () => {
    const calls = [];
    const responseBody = {
      ok: true,
      tools: {
        gcloud: { installed: true, loggedIn: true, version: "1.0" },
        wrangler: { installed: true, loggedIn: true },
        ngrok: { installed: true, hasAuthToken: true },
        node: { version: "v20.0.0", ok: true },
      },
      missing: [],
    };
    const { api, win, dispatched } = loadHelpers({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return responseBody;
          },
        };
      },
    });
    const result = await api.installDoctor();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/__proxy/install-doctor");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(result, responseBody);
    assert.deepEqual(win.installDoctorState, responseBody);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, "jobbored:install-doctor:update");
    assert.deepEqual(dispatched[0].detail, responseBody);
  });

  it("returns { notImplemented: true } when endpoint returns 501", async () => {
    const { api, dispatched } = loadHelpers({
      fetch: async () => ({
        ok: false,
        status: 501,
        async json() {
          return { ok: false, reason: "not_implemented" };
        },
      }),
    });
    const result = await api.installDoctor();
    assert.deepEqual(result, { ok: false, notImplemented: true });
    // Don't dispatch the event for 501 — there's no usable payload.
    assert.equal(dispatched.length, 0);
  });

  it("returns { ok:false } and never throws on network errors", async () => {
    const { api } = loadHelpers({
      fetch: async () => {
        throw new Error("boom");
      },
    });
    const result = await api.installDoctor();
    assert.equal(result.ok, false);
    assert.match(String(result.error), /boom/);
  });
});

describe("installKeepAliveOnce()", () => {
  it("POSTs to /__proxy/install-keep-alive when not yet installed", async () => {
    const calls = [];
    const ls = makeFakeLocalStorage();
    const { api, win } = loadHelpers({
      localStorage: ls,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              installedAt: "2026-05-06T12:00:00Z",
              jobLabel: "ai.jobbored.keep-alive",
              logPath: "/tmp/k.log",
            };
          },
        };
      },
    });
    await api.installKeepAliveOnce();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/__proxy/install-keep-alive");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(
      ls.getItem("jb:install-keep-alive:installedAt"),
      "2026-05-06T12:00:00Z",
    );
    assert.equal(win.keepAliveStatusState.installed, true);
    assert.equal(win.keepAliveStatusState.lastRunAt, "2026-05-06T12:00:00Z");
  });

  it("does nothing when localStorage already records install", async () => {
    let called = false;
    const ls = makeFakeLocalStorage();
    ls.setItem("jb:install-keep-alive:installedAt", "2026-01-01T00:00:00Z");
    const { api } = loadHelpers({
      localStorage: ls,
      fetch: async () => {
        called = true;
        return { ok: true, status: 200, async json() { return {}; } };
      },
    });
    await api.installKeepAliveOnce();
    assert.equal(called, false);
  });

  it("silently degrades when endpoint returns 501", async () => {
    const ls = makeFakeLocalStorage();
    const { api, win } = loadHelpers({
      localStorage: ls,
      fetch: async () => ({
        ok: false,
        status: 501,
        async json() {
          return { ok: false, reason: "not_implemented" };
        },
      }),
    });
    await api.installKeepAliveOnce();
    assert.equal(ls.getItem("jb:install-keep-alive:installedAt"), null);
    assert.equal(win.keepAliveStatusState, null);
  });

  it("never throws on network failure", async () => {
    const { api } = loadHelpers({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await assert.doesNotReject(() => api.installKeepAliveOnce());
  });
});

describe("refreshKeepAlivePill()", () => {
  it("renders the on state when status reports installed", async () => {
    const pill = makeFakePill();
    const { api, win } = loadHelpers({
      pill,
      fetch: async (url) => {
        assert.equal(url, "/__proxy/install-keep-alive/status");
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              installed: true,
              lastRunAt: "2026-05-06T12:00:00Z",
              jobLabel: "ai.jobbored.keep-alive",
            };
          },
        };
      },
    });
    await api.refreshKeepAlivePill();
    assert.equal(pill.hidden, false);
    assert.equal(pill.textContent, "Auto-healing on");
    assert.ok(pill.classList.contains("doctor-keep-alive-pill--on"));
    assert.equal(pill.classList.contains("doctor-keep-alive-pill--off"), false);
    assert.equal(win.keepAliveStatusState.installed, true);
  });

  it("renders the off state when status reports not installed", async () => {
    const pill = makeFakePill();
    const { api } = loadHelpers({
      pill,
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { installed: false };
        },
      }),
    });
    await api.refreshKeepAlivePill();
    assert.equal(pill.hidden, false);
    assert.equal(pill.textContent, "Not installed — install");
    assert.ok(pill.classList.contains("doctor-keep-alive-pill--off"));
    assert.equal(pill.classList.contains("doctor-keep-alive-pill--on"), false);
  });

  it("hides the pill when endpoint returns 501", async () => {
    const pill = makeFakePill();
    pill.hidden = false;
    const { api } = loadHelpers({
      pill,
      fetch: async () => ({
        ok: false,
        status: 501,
        async json() {
          return { ok: false };
        },
      }),
    });
    await api.refreshKeepAlivePill();
    assert.equal(pill.hidden, true);
  });
});
