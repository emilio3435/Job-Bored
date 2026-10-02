/* ============================================================
   HOLES AUTH — shared fakes for tests/holes-auth-*.test.mjs.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite. It loads the REAL auth-session.js and config-overrides.js
   (whole files, not source slices) into vm "tabs" of one origin:

     makeOrigin()    — the origin's shared localStorage, plus the
                       BroadcastChannel bus every tab of it talks over
                       (and a log of every message posted on it).
     loadAuthTab()   — auth-session.js against a fake Google Identity
                       Services client, a fake clock, and a recording
                       host bridge.
     loadConfigTab() — config-overrides.js on the same origin.
   ============================================================ */
import vm from "node:vm";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

export const CLIENT_ID = "client-123.apps.googleusercontent.com";
export const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

/** Let queued callbacks, promise chains and channel deliveries settle. */
export async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Web Storage subset that also logs every write, value included. */
export function makeStorage() {
  const data = new Map();
  const writes = [];
  return {
    writes,
    getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem(key, value) {
      writes.push([String(key), String(value)]);
      data.set(String(key), String(value));
    },
    removeItem: (key) => {
      data.delete(String(key));
    },
    get length() {
      return data.size;
    },
  };
}

/** One origin: its localStorage, and a BroadcastChannel that reaches its other tabs. */
export function makeOrigin() {
  const channels = new Set();
  const posted = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = String(name);
      this.onmessage = null;
      channels.add(this);
    }
    postMessage(data) {
      const copy = structuredClone(data);
      posted.push({ name: this.name, data: copy });
      // Like a browser: every OTHER channel of that name, on a later task.
      for (const other of channels) {
        if (other === this || other.name !== this.name) continue;
        setImmediate(() => {
          if (channels.has(other) && typeof other.onmessage === "function") {
            other.onmessage({ data: structuredClone(copy) });
          }
        });
      }
    }
    close() {
      channels.delete(this);
    }
  }
  return {
    localStorage: makeStorage(),
    BroadcastChannel: FakeBroadcastChannel,
    posted,
    channelNames: () => [...channels].map((channel) => channel.name),
  };
}

/** A clock the test moves by hand; timers fire only when it does. */
function makeClock() {
  let now = Date.UTC(2026, 9, 2, 12, 0, 0);
  let seq = 0;
  const timers = [];
  const clock = {
    now: () => now,
    setTimeout(fn, delay, ...args) {
      const timer = {
        seq: (seq += 1),
        at: now + Math.max(0, Number(delay) || 0),
        fn,
        args,
        cleared: false,
        fired: false,
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer && typeof timer === "object") timer.cleared = true;
    },
    /** Move time forward, firing every timer that falls due on the way. */
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => !t.cleared && !t.fired && t.at <= until)
          .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        now = Math.max(now, due.at);
        due.fired = true;
        // Not awaited: a refresh timer waits on Google, which only the
        // test can answer.
        due.fn(...due.args);
        await flush();
      }
      now = until;
      await flush();
    },
  };
  return clock;
}

function makeFakeDate(clock) {
  return class FakeDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(clock.now());
    }
    static now() {
      return clock.now();
    }
  };
}

function makeElement(id) {
  return {
    id,
    style: {},
    hidden: false,
    textContent: "",
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    contains: () => false,
  };
}

/** Google Identity Services, as far as auth-session.js reaches into it. */
function makeGis() {
  const gis = {
    config: null,
    requests: [],
    revoked: [],
    /** Google answers the latest request with a token. */
    reply(response = {}) {
      gis.config.callback({
        access_token: "tok-default",
        expires_in: 3600,
        scope: SCOPES,
        ...response,
      });
    },
    /** GIS error_callback: popup_closed, popup_failed_to_open, unknown. */
    fail(err) {
      gis.config.error_callback(err);
    },
  };
  const google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          gis.config = config;
          return {
            requestAccessToken(request) {
              gis.requests.push(request ? { ...request } : {});
            },
          };
        },
        revoke(token, done) {
          gis.revoked.push(token);
          if (typeof done === "function") done();
        },
      },
    },
  };
  return { gis, google };
}

function makeHost(state, calls, overrides) {
  const record =
    (name, answer) =>
    (...args) => {
      calls.push({ name, args });
      return typeof answer === "function" ? answer(...args) : answer;
    };
  return Object.assign(
    {
      getOAuthClientId: () => state.clientId,
      getSHEET_ID: () => state.sheetId,
      getSheetId: () => state.sheetId,
      setPendingSetupStarterSheetCreate(value) {
        state.pendingStarter = !!value;
      },
      getPendingSetupStarterSheetCreate: () => state.pendingStarter,
      loadAllData: record("loadAllData", () => Promise.resolve(true)),
      revealDashboardShell: record("revealDashboardShell"),
      revealSetupScreenAfterAuth: record("revealSetupScreenAfterAuth"),
      showSheetAccessGate: record("showSheetAccessGate"),
      maybeSyncSettingsModalModeAfterAuth() {},
      renderAppsScriptDeployUi() {},
      recordSheetAccessError() {},
      setPipelineRawRows: record("setPipelineRawRows"),
      setPipelineData: record("setPipelineData"),
      setDashboardDataHydrated: record("setDashboardDataHydrated"),
      renderPipeline() {},
      setInitialSheetAccessResolved() {},
      handleSetupCreateStarterSheet: record("handleSetupCreateStarterSheet"),
      escapeHtml: (value) => String(value),
      isLocalDashboardOrigin: () => false,
    },
    overrides,
  );
}

/**
 * auth-session.js in one tab of `origin`. Call `auth.initAuth()` to boot
 * it against the fake GIS client (that runs the real restore path).
 */
export function loadAuthTab(
  origin,
  { clientId = CLIENT_ID, sheetId = "", host = {}, fetchImpl, session = {} } = {},
) {
  const clock = makeClock();
  const calls = [];
  const toasts = [];
  const visibilityListeners = [];
  const state = { clientId, sheetId, pendingStarter: false };
  const { gis, google } = makeGis();
  const sessionStorage = makeStorage();
  for (const [key, value] of Object.entries(session)) sessionStorage.setItem(key, value);
  const elements = new Map(
    ["signInBtn", "authUser"].map((id) => [id, makeElement(id)]),
  );
  const document = {
    visibilityState: "visible",
    addEventListener(type, fn) {
      if (type === "visibilitychange") visibilityListeners.push(fn);
    },
    getElementById: (id) => elements.get(id) || null,
  };
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    document,
    localStorage: origin.localStorage,
    sessionStorage,
    google,
    BroadcastChannel: origin.BroadcastChannel,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: makeFakeDate(clock),
    fetch:
      fetchImpl ||
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ email: "user@example.com", given_name: "Pat" }),
      })),
    // showToast mirrors every toast into the live region first; with no
    // #toastContainer that is the whole toast, which is what we record.
    JobBoredA11y: {
      live: {
        announce(message, opts) {
          toasts.push({ message: String(message), assertive: !!(opts && opts.assertive) });
        },
      },
    },
    JobBoredApp: { core: { host: makeHost(state, calls, host) } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("auth-session.js"), ctx, {
    filename: "auth-session.js",
  });
  return {
    auth: ctx.JobBoredApp.auth,
    window: ctx,
    gis,
    clock,
    calls,
    toasts,
    state,
    sessionStorage,
    localStorage: origin.localStorage,
    callsTo: (name) => calls.filter((call) => call.name === name),
    gateModes: () =>
      calls.filter((call) => call.name === "showSheetAccessGate").map((call) => call.args[0]),
    async becomeVisible() {
      document.visibilityState = "visible";
      for (const fn of visibilityListeners) fn();
      await flush();
    },
  };
}

/** Interactive sign-in the way a click does it: request, then Google answers. */
export async function signInInteractively(tab, accessToken) {
  const attempt = tab.auth.signIn();
  tab.gis.reply({ access_token: accessToken });
  await flush();
  return attempt;
}

/** config-overrides.js in one tab of `origin`, over `config` (config.js). */
export function loadConfigTab(origin, { config = {}, search = "", session = {} } = {}) {
  const sessionStorage = makeStorage();
  for (const [key, value] of Object.entries(session)) sessionStorage.setItem(key, value);
  const events = [];
  const win = {
    COMMAND_CENTER_CONFIG: { ...config },
    location: {
      protocol: "http:",
      hostname: "localhost",
      port: "8080",
      origin: "http://localhost:8080",
      pathname: "/",
      search,
      hash: "",
      get href() {
        return `http://localhost:8080${this.pathname}${this.search}${this.hash}`;
      },
    },
    history: { replaceState() {} },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const ctx = {
    window: win,
    document: { getElementById: () => null },
    localStorage: origin.localStorage,
    sessionStorage,
    indexedDB: { deleteDatabase() {} },
    BroadcastChannel: origin.BroadcastChannel,
    CustomEvent: FakeCustomEvent,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    URL,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("config-overrides.js"), ctx, {
    filename: "config-overrides.js",
  });
  return {
    window: win,
    overrides: win.JobBoredApp.configOverrides,
    config: () => win.COMMAND_CENTER_CONFIG,
    sessionStorage,
    events,
  };
}
