/**
 * HOLES BOARD — B8: the five-minute refresh poll respects tab visibility and
 * never stacks loads.
 *
 * app-bootstrap.js polled loadAllData every REFRESH_INTERVAL whether or not
 * anyone could see the tab, and a slow read could still be running when the
 * next tick started another one. These probes run the real app-bootstrap.js in
 * a vm with a clock the test owns: a hidden tab does not poll, coming back
 * after a full interval refreshes once right away (and the cadence restarts
 * from that load), coming back sooner does not, and a poll load never starts
 * while the previous poll load is still pending.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bootstrapJs = readFileSync(join(repoRoot, "app-bootstrap.js"), "utf8");

const MINUTE = 60 * 1000;
const INTERVAL = 5 * MINUTE;
const EPOCH = Date.UTC(2026, 9, 2, 9, 0, 0);

/** Let every queued microtask settle (a load's promise callbacks). */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** setInterval/setTimeout and Date.now() on a clock only the test advances. */
function makeClock() {
  let now = EPOCH;
  let nextId = 1;
  const timers = new Map();
  const schedule = (fn, ms, repeat) => {
    const id = nextId++;
    timers.set(id, { fn, ms: Number(ms) || 0, at: now + (Number(ms) || 0), repeat });
    return id;
  };
  return {
    now: () => now,
    setInterval: (fn, ms) => schedule(fn, ms, true),
    setTimeout: (fn, ms) => schedule(fn, ms, false),
    clear: (id) => {
      timers.delete(id);
    },
    /** Fire every timer due within `ms`, in time order, settling after each. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let due = null;
        for (const [id, t] of timers) {
          if (t.at <= end && (!due || t.at < due.t.at)) due = { id, t };
        }
        if (!due) break;
        now = due.t.at;
        if (due.t.repeat) due.t.at += due.t.ms;
        else timers.delete(due.id);
        due.t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function makeEl(id) {
  const classes = new Set();
  return {
    id,
    style: {},
    dataset: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
  };
}

/** A load promise the test settles by hand. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Run app-bootstrap.js and init() on a signed-in session with a sheet, the
 * path that starts the refresh poll. `loadAllData` decides what each load
 * returns (default: resolves true at once).
 */
async function bootSignedIn({ hidden = false, loadAllData } = {}) {
  const clock = makeClock();
  const listeners = new Map();
  const elements = new Map();
  const doc = {
    hidden,
    readyState: "loading",
    body: makeEl("body"),
    documentElement: makeEl("html"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    querySelector: () => null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    dispatchEvent: () => true,
  };

  const loadTimes = [];
  const host = {
    getSheetId: () => "sheet-1",
    getSHEET_ID: () => "sheet-1",
    getAccessToken: () => "token-abc",
    getOAuthClientId: () => "client-1",
    loadPersistedRuntimeOAuthSession: () => null,
    loadPersistedOAuthSession: () => null,
    getConfig: () => null,
    loadAllData() {
      loadTimes.push(clock.now());
      return loadAllData ? loadAllData() : Promise.resolve(true);
    },
  };

  class ClockDate extends Date {
    static now() {
      return clock.now();
    }
  }

  const win = {
    JobBoredStartupLog: { mark() {} },
    JobBoredApp: { bootstrap: { host } },
  };
  const ctx = {
    window: win,
    document: doc,
    console: { info() {}, warn() {}, error() {}, log() {} },
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    Date: ClockDate,
    CustomEvent: class CustomEvent {},
  };
  vm.createContext(ctx);
  vm.runInContext(bootstrapJs, ctx, { filename: "app-bootstrap.js" });
  const bootstrap = win.JobBoredApp.bootstrap;
  bootstrap.init();
  await flush();

  const startedAt = clock.now();
  // init() loads once on its own; the probes below count poll loads only.
  assert.equal(loadTimes.length, 1, "init() starts the first load itself");
  loadTimes.length = 0;

  return {
    bootstrap,
    clock,
    /** Poll loads so far, as whole minutes since init(). */
    pollLoadMinutes: () => loadTimes.map((t) => (t - startedAt) / MINUTE),
    async setHidden(next) {
      doc.hidden = next;
      for (const fn of [...(listeners.get("visibilitychange") || [])]) fn({ type: "visibilitychange" });
      await flush();
    },
  };
}

describe("B8 · the refresh poll keeps its five-minute cadence while the tab is visible", () => {
  it("should load on every REFRESH_INTERVAL tick while visible — the dashboard still refreshes itself", async () => {
    const env = await bootSignedIn();
    assert.equal(env.bootstrap.REFRESH_INTERVAL, INTERVAL, "REFRESH_INTERVAL stays exported at five minutes");
    await env.clock.advance(2 * INTERVAL);
    assert.deepEqual(env.pollLoadMinutes(), [5, 10]);
  });
});

describe("B8 · a hidden tab does not poll", () => {
  it("should not start a poll load while document.hidden — nobody is looking, so the Sheets read is wasted quota", async () => {
    const env = await bootSignedIn();
    await env.setHidden(true);
    await env.clock.advance(3 * INTERVAL);
    assert.deepEqual(env.pollLoadMinutes(), [], "every tick while hidden must skip the load");
  });

  it("should load once the moment the tab comes back after a full interval, then keep the cadence from that load", async () => {
    const env = await bootSignedIn();
    await env.setHidden(true);
    await env.clock.advance(7 * MINUTE);
    await env.setHidden(false);
    assert.deepEqual(env.pollLoadMinutes(), [7], "stale data refreshes as soon as the user can see it");

    // The cadence restarts from the catch-up load: no second load three
    // minutes later at the old 10-minute tick, the next one five minutes on.
    await env.clock.advance(4 * MINUTE);
    assert.deepEqual(env.pollLoadMinutes(), [7], "no back-to-back load on the old tick");
    await env.clock.advance(1 * MINUTE);
    assert.deepEqual(env.pollLoadMinutes(), [7, 12]);
  });

  it("should not load on coming back when the last load is younger than the interval — it is still fresh", async () => {
    const env = await bootSignedIn();
    await env.clock.advance(1 * MINUTE);
    await env.setHidden(true);
    await env.clock.advance(2 * MINUTE);
    await env.setHidden(false);
    assert.deepEqual(env.pollLoadMinutes(), [], "three minutes since init() is not stale");
    await env.clock.advance(2 * MINUTE);
    assert.deepEqual(env.pollLoadMinutes(), [5], "the regular tick still runs");
  });
});

describe("B8 · poll loads never overlap", () => {
  it("should not start a poll load while the previous poll load is still pending — a slow read must not stack reads", async () => {
    const pending = [];
    const env = await bootSignedIn({
      loadAllData() {
        const d = deferred();
        pending.push(d);
        return d.promise;
      },
    });
    await env.clock.advance(3 * INTERVAL);
    assert.deepEqual(env.pollLoadMinutes(), [5], "ticks at 10 and 15 must wait for the 5-minute load");

    // pending[0] is init()'s own load; the last one is the 5-minute poll load.
    pending.at(-1).resolve(true);
    await flush();
    await env.clock.advance(INTERVAL);
    assert.deepEqual(env.pollLoadMinutes(), [5, 20], "the next tick after it settles loads again");
  });

  it("should not start the catch-up load on coming back while a poll load is still pending", async () => {
    const pending = [];
    const env = await bootSignedIn({
      loadAllData() {
        const d = deferred();
        pending.push(d);
        return d.promise;
      },
    });
    await env.clock.advance(INTERVAL);
    assert.deepEqual(env.pollLoadMinutes(), [5]);
    await env.setHidden(true);
    await env.clock.advance(INTERVAL + MINUTE);
    await env.setHidden(false);
    assert.deepEqual(env.pollLoadMinutes(), [5], "the 5-minute load is still running; coming back must not start another");
  });
});
