import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authSessionSource = readFileSync(
  join(__dirname, "..", "auth-session.js"),
  "utf8",
);

/**
 * WHY these tests exist: the /__proxy/* endpoints only exist on the local
 * dev server. A deployed static host answers them with 404 HTML, and the
 * old `resp.status === 501` + `resp.json().catch(() => ({}))` pattern
 * silently turned that into a false "available" result — "All install
 * tools look healthy." on a host with no install tooling at all, plus dead
 * keep-alive/autostart affordances. These tests pin the honest behavior:
 * any !resp.ok or shape-invalid body reads as "not available", and a
 * non-local origin short-circuits without fetching.
 */
function extractHelpers() {
  const start = authSessionSource.indexOf("async function installDoctor()");
  const end = authSessionSource.indexOf("function setAuthAvatarDisplay");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "Could not locate frontend install helpers in auth-session.js",
    );
  }
  return authSessionSource.slice(start, end);
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

function notFoundHtmlResponse() {
  return {
    ok: false,
    status: 404,
    async json() {
      throw new Error("Unexpected token '<'");
    },
  };
}

function loadHelpers(env = {}) {
  const helpers = extractHelpers();
  const dispatched = [];
  const elements = env.elements || {};
  const win = Object.assign(
    {
      installDoctorState: null,
      keepAliveStatusState: null,
      workerAutostartStatusState: null,
      dispatchEvent: (ev) => {
        dispatched.push(ev);
        return true;
      },
    },
    env.windowExtras || {},
  );
  const document = {
    getElementById: (id) => elements[id] || null,
  };
  const localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }
  const wrapper = new Function(
    "window",
    "fetch",
    "localStorage",
    "document",
    "CustomEvent",
    "host",
    helpers +
      "\nreturn { installDoctor, installKeepAliveOnce, refreshKeepAlivePill, refreshWorkerAutostartPill };",
  );
  const api = wrapper(
    win,
    env.fetch,
    localStorage,
    document,
    CustomEvent,
    env.host,
  );
  return { api, win, dispatched };
}

function deployedHost() {
  return () => ({ isLocalDashboardOrigin: () => false });
}

describe("deployed /__proxy truthfulness — installDoctor()", () => {
  it("treats 404 HTML (deployed static host) as not implemented", async () => {
    const { api, win, dispatched } = loadHelpers({
      fetch: async () => notFoundHtmlResponse(),
    });
    const result = await api.installDoctor();
    assert.deepEqual(result, { ok: false, notImplemented: true });
    assert.equal(win.installDoctorState, null);
    assert.equal(dispatched.length, 0);
  });

  it("treats a 200 body without the expected shape as not implemented", async () => {
    const { api, win, dispatched } = loadHelpers({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {}; // no `missing` array — not the install-doctor contract
        },
      }),
    });
    const result = await api.installDoctor();
    assert.deepEqual(result, { ok: false, notImplemented: true });
    assert.equal(win.installDoctorState, null);
    assert.equal(dispatched.length, 0);
  });

  it("short-circuits without fetching when the origin is not local", async () => {
    let fetched = 0;
    const { api } = loadHelpers({
      host: deployedHost(),
      fetch: async () => {
        fetched += 1;
        return notFoundHtmlResponse();
      },
    });
    const result = await api.installDoctor();
    assert.deepEqual(result, { ok: false, notImplemented: true });
    assert.equal(fetched, 0);
  });

  it("still returns the real payload on a healthy local response", async () => {
    const body = { ok: true, tools: { node: { ok: true } }, missing: [] };
    const { api, win } = loadHelpers({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return body;
        },
      }),
    });
    const result = await api.installDoctor();
    assert.deepEqual(result, body);
    assert.deepEqual(win.installDoctorState, body);
  });
});

describe("deployed /__proxy truthfulness — refreshKeepAlivePill()", () => {
  it("hides the pill on 404 HTML instead of rendering 'Not installed — install'", async () => {
    const pill = makeFakePill();
    pill.hidden = false;
    const { api } = loadHelpers({
      elements: { keepAlivePill: pill },
      fetch: async () => notFoundHtmlResponse(),
    });
    await api.refreshKeepAlivePill();
    assert.equal(pill.hidden, true);
    assert.equal(pill.textContent, "");
  });

  it("hides the pill without fetching when the origin is not local", async () => {
    let fetched = 0;
    const pill = makeFakePill();
    pill.hidden = false;
    const { api } = loadHelpers({
      host: deployedHost(),
      elements: { keepAlivePill: pill },
      fetch: async () => {
        fetched += 1;
        return notFoundHtmlResponse();
      },
    });
    await api.refreshKeepAlivePill();
    assert.equal(pill.hidden, true);
    assert.equal(fetched, 0);
  });
});

describe("deployed /__proxy truthfulness — refreshWorkerAutostartPill()", () => {
  it("hides the button and pill on 404 HTML instead of showing a dead 'Off — start on boot'", async () => {
    const pill = makeFakePill();
    const btn = makeFakePill();
    pill.hidden = false;
    btn.hidden = false;
    const { api } = loadHelpers({
      elements: { workerAutostartPill: pill, workerAutostartBtn: btn },
      fetch: async () => notFoundHtmlResponse(),
    });
    await api.refreshWorkerAutostartPill();
    assert.equal(pill.hidden, true);
    assert.equal(btn.hidden, true);
  });

  it("hides both without fetching when the origin is not local", async () => {
    let fetched = 0;
    const pill = makeFakePill();
    const btn = makeFakePill();
    pill.hidden = false;
    btn.hidden = false;
    const { api } = loadHelpers({
      host: deployedHost(),
      elements: { workerAutostartPill: pill, workerAutostartBtn: btn },
      fetch: async () => {
        fetched += 1;
        return notFoundHtmlResponse();
      },
    });
    await api.refreshWorkerAutostartPill();
    assert.equal(pill.hidden, true);
    assert.equal(btn.hidden, true);
    assert.equal(fetched, 0);
  });

  it("still renders the real status on a healthy local response", async () => {
    const pill = makeFakePill();
    const btn = makeFakePill();
    const { api } = loadHelpers({
      elements: { workerAutostartPill: pill, workerAutostartBtn: btn },
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { installed: true };
        },
      }),
    });
    await api.refreshWorkerAutostartPill();
    assert.equal(pill.hidden, false);
    assert.equal(btn.hidden, false);
    assert.equal(pill.textContent, "On — runs on boot");
  });
});
