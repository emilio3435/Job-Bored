import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flowingStoreJs = readFileSync(join(repoRoot, "flowing-store.js"), "utf8");

// ============================================================
// Behavioral coverage for flowing-store.js — the flowing-page
// shared store (window.JobBoredFlowing.openRole / .recents).
//
// The module is a classic-global IIFE with zero repo deps. We load
// it into a fresh VM context per test with recording fakes for the
// host bridges it touches: location/history (hash sync), the
// window/document event targets (jb:role:opened / jb:role:closed),
// localStorage (recents persistence), and document.querySelector
// (kanban-card meta lookup). requestAnimationFrame is synchronous
// so the deferred boot dispatch is deterministic.
// ============================================================

const STORAGE_KEY = "jb-v2-flowing-recents";
const DAY_MS = 24 * 60 * 60 * 1000;

function makeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

function makeCard({ role, company } = {}) {
  return {
    querySelector(selector) {
      if (selector === ".kanban-card__title") return role == null ? null : { textContent: role };
      if (selector === ".kanban-card__company") return company == null ? null : { textContent: company };
      return null;
    },
  };
}

function loadFlowing({
  hash = "",
  search = "",
  withHistory = true,
  localStorage: localStorageOption,
  cards = {},
  readyState = "complete",
} = {}) {
  const ls = localStorageOption === null ? undefined : localStorageOption || makeLocalStorage();
  const winListeners = new Map();
  const events = [];
  const replaceCalls = [];
  const win = {
    location: { pathname: "/flow", search, hash },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
        this.bubbles = Boolean(init.bubbles);
      }
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatchEvent(ev) {
      events.push({ type: ev.type, detail: ev.detail });
      for (const fn of [...(winListeners.get(ev.type) || [])]) fn(ev);
      return true;
    },
    requestAnimationFrame(fn) {
      fn();
      return 0;
    },
  };
  if (ls) win.localStorage = ls;
  if (withHistory) {
    win.history = {
      replaceState(_state, _title, url) {
        replaceCalls.push(String(url));
        const i = String(url).indexOf("#");
        win.location.hash = i === -1 ? "" : String(url).slice(i);
      },
    };
  }
  const docEvents = [];
  const docListeners = new Map();
  const selectors = [];
  const doc = {
    readyState,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      docEvents.push({ type: ev.type, detail: ev.detail });
      return true;
    },
    querySelector(selector) {
      selectors.push(String(selector));
      const m = /\[data-stable-key="(.*)"\]$/.exec(String(selector));
      const key = m ? m[1] : null;
      return (key && cards[key]) || null;
    },
  };
  const ctx = { window: win, document: doc, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(flowingStoreJs, ctx, { filename: "flowing-store.js" });
  return {
    win,
    events,
    docEvents,
    selectors,
    replaceCalls,
    ls,
    openRole: win.JobBoredFlowing.openRole,
    recents: win.JobBoredFlowing.recents,
    fireHashChange(nextHash) {
      win.location.hash = nextHash;
      for (const fn of [...(winListeners.get("hashchange") || [])]) fn({ type: "hashchange" });
    },
    fireDomContentLoaded() {
      for (const fn of [...(docListeners.get("DOMContentLoaded") || [])]) fn({ type: "DOMContentLoaded" });
    },
  };
}

function ofType(events, type) {
  return events.filter((e) => e.type === type);
}

// VM-realm arrays/objects carry the context's prototypes, so deepStrictEqual
// against host literals always fails. These convert to host values first.
function keysOf(list) {
  return Array.from(list, (r) => r.jobKey);
}

function detailOf(event) {
  return { ...event.detail };
}

describe("flowing-store — openRole open/close contract", () => {
  it("set() exposes the open jobKey via get() and announces jb:role:opened on BOTH window and document so every region can re-render independently", () => {
    const env = loadFlowing();
    env.openRole.set("job-1");
    assert.equal(env.openRole.get(), "job-1");
    const opened = ofType(env.events, "jb:role:opened");
    assert.equal(opened.length, 1, "exactly one opened announcement on window");
    assert.deepEqual(detailOf(opened[0]), { jobKey: "job-1" });
    const docOpened = ofType(env.docEvents, "jb:role:opened");
    assert.equal(docOpened.length, 1, "document listeners must hear it too");
    assert.deepEqual(detailOf(docOpened[0]), { jobKey: "job-1" });
  });

  it("re-setting the SAME key does not re-dispatch jb:role:opened — regions must not re-render on redundant card clicks", () => {
    const env = loadFlowing();
    env.openRole.set("job-1");
    env.openRole.set("job-1");
    assert.equal(ofType(env.events, "jb:role:opened").length, 1);
  });

  it("clear() nulls the open role and announces jb:role:closed exactly once; a second clear() stays silent", () => {
    const env = loadFlowing();
    env.openRole.set("job-1");
    env.openRole.clear();
    assert.equal(env.openRole.get(), null);
    assert.equal(ofType(env.events, "jb:role:closed").length, 1);
    env.openRole.clear();
    assert.equal(ofType(env.events, "jb:role:closed").length, 1, "closing a closed store must not spam regions");
  });

  it("set(null) on an open role behaves as a close (jb:role:closed), never a phantom open", () => {
    const env = loadFlowing();
    env.openRole.set("job-1");
    env.openRole.set(null);
    assert.equal(env.openRole.get(), null);
    assert.equal(ofType(env.events, "jb:role:opened").length, 1, "only the real open announces");
    assert.equal(ofType(env.events, "jb:role:closed").length, 1);
  });

  it("numeric job keys are coerced to strings so hash sync and recents dedupe compare consistently", () => {
    const env = loadFlowing();
    env.openRole.set(123);
    assert.equal(env.openRole.get(), "123");
    assert.deepEqual(detailOf(ofType(env.events, "jb:role:opened")[0]), { jobKey: "123" });
  });
});

describe("flowing-store — URL hash sync (deep-linkable, no history spam)", () => {
  it("set() syncs #role=<key> through history.replaceState (URL stays shareable without pushing a history entry per card click)", () => {
    const env = loadFlowing({ search: "?greenfield=1" });
    env.openRole.set("job-1");
    assert.deepEqual(env.replaceCalls, ["/flow?greenfield=1#role=job-1"], "pathname + search must survive the rewrite");
    assert.equal(env.win.location.hash, "#role=job-1");
  });

  it("foreign hash params survive open/close — the store only owns the role key", () => {
    const env = loadFlowing({ hash: "#view=letters" });
    env.openRole.set("job-1");
    assert.ok(env.win.location.hash.includes("view=letters"), "open must not clobber other regions' hash state");
    assert.ok(env.win.location.hash.includes("role=job-1"));
    env.openRole.clear();
    assert.equal(env.win.location.hash, "#view=letters", "close removes only the role key");
  });

  it("a set() after a legacy #letter= deep-link scrubs the stale letter param so old links cannot reopen the wrong role", () => {
    const env = loadFlowing({ hash: "#letter=old" });
    env.openRole.set("new");
    assert.equal(env.win.location.hash, "#role=new");
  });

  it("clear() also scrubs the legacy letter= param so an old deep-link does not survive the close", () => {
    const env = loadFlowing({ hash: "#letter=old" });
    env.openRole.clear();
    assert.equal(env.win.location.hash, "");
    assert.equal(ofType(env.events, "jb:role:closed").length, 1);
  });

  it("keys with spaces round-trip: written percent-encoded into the hash, decoded back out of a hashchange", () => {
    const env = loadFlowing();
    env.openRole.set("a b");
    assert.equal(env.win.location.hash, "#role=a%20b");
    env.fireHashChange("#role=c%20d");
    assert.equal(env.openRole.get(), "c d", "the store must hand regions the decoded key");
  });

  it("when history.replaceState is unavailable the store falls back to a direct location.hash write so deep links still work", () => {
    const env = loadFlowing({ withHistory: false });
    env.openRole.set("job-1");
    assert.equal(env.win.location.hash, "#role=job-1");
  });

  it("a hash already in sync is left untouched — no redundant replaceState churn on every re-click", () => {
    const env = loadFlowing({ hash: "#role=job-1" });
    env.openRole.set("job-1");
    assert.equal(env.replaceCalls.length, 0);
  });
});

describe("flowing-store — boot deep-link + hashchange wiring", () => {
  it("booting with #role=<key> opens that role and announces jb:role:opened after a frame so deep-linked pages render the role region", () => {
    const env = loadFlowing({ hash: "#role=deep1" });
    assert.equal(env.openRole.get(), "deep1");
    const opened = ofType(env.events, "jb:role:opened");
    assert.equal(opened.length, 1);
    assert.deepEqual(detailOf(opened[0]), { jobKey: "deep1" });
  });

  it("legacy #letter=<key> deep-links from older builds still open the role", () => {
    const env = loadFlowing({ hash: "#letter=old1" });
    assert.equal(env.openRole.get(), "old1");
    assert.deepEqual(detailOf(ofType(env.events, "jb:role:opened")[0]), { jobKey: "old1" });
  });

  it("while the document is still loading, the boot announcement waits for DOMContentLoaded so regions attach their listeners first", () => {
    const env = loadFlowing({ hash: "#role=deep1", readyState: "loading" });
    assert.equal(env.openRole.get(), "deep1", "synchronous reads see the role immediately");
    assert.equal(ofType(env.events, "jb:role:opened").length, 0, "the announcement must NOT fire before listeners exist");
    env.fireDomContentLoaded();
    assert.deepEqual(detailOf(ofType(env.events, "jb:role:opened")[0]), { jobKey: "deep1" });
  });

  it("an external hashchange to a new role opens it and removing the role closes it — back/forward navigation drives the store", () => {
    const env = loadFlowing();
    env.fireHashChange("#role=r1");
    assert.equal(env.openRole.get(), "r1");
    assert.deepEqual(detailOf(ofType(env.events, "jb:role:opened")[0]), { jobKey: "r1" });
    env.fireHashChange("");
    assert.equal(env.openRole.get(), null);
    assert.equal(ofType(env.events, "jb:role:closed").length, 1);
  });

  it("a hashchange that does not alter the role key is ignored — other regions' hash edits must not re-render the role", () => {
    const env = loadFlowing({ hash: "#role=r1" });
    const before = env.events.length;
    env.fireHashChange("#role=r1&view=x");
    assert.equal(env.events.length, before, "no new announcements for an unchanged role");
    assert.equal(env.openRole.get(), "r1");
  });
});

describe("flowing-store — recents: ordering, dedupe, cap, TTL", () => {
  it("record() puts the newest entry first so the empty-state shelf shows the most recent work on top", () => {
    const env = loadFlowing();
    env.recents.record({ jobKey: "k1", role: "R1", company: "C1" });
    env.recents.record({ jobKey: "k2", role: "R2", company: "C2" });
    env.recents.record({ jobKey: "k3", role: "R3", company: "C3" });
    const list = env.recents.list();
    assert.deepEqual(keysOf(list), ["k3", "k2", "k1"]);
    assert.ok(list.every((r) => Number.isFinite(r.ts)), "every entry carries a timestamp for the TTL sweep");
  });

  it("re-recording a jobKey dedupes and bubbles it to the top with the fresh role/company — re-opens must not pile up duplicates", () => {
    const env = loadFlowing();
    env.recents.record({ jobKey: "k1", role: "Old title", company: "C" });
    env.recents.record({ jobKey: "k2", role: "R2", company: "C2" });
    env.recents.record({ jobKey: "k1", role: "New title", company: "C" });
    const list = env.recents.list();
    assert.deepEqual(keysOf(list), ["k1", "k2"], "one entry per role, freshest first");
    assert.equal(list[0].role, "New title");
  });

  it("the shelf caps at 12 entries — oldest are evicted so localStorage never grows unbounded", () => {
    const env = loadFlowing();
    for (let i = 1; i <= 14; i++) {
      env.recents.record({ jobKey: `k${i}`, role: `R${i}`, company: "C" });
    }
    const list = env.recents.list();
    assert.equal(list.length, 12);
    assert.equal(list[0].jobKey, "k14", "newest survives at the top");
    assert.ok(!list.some((r) => r.jobKey === "k1" || r.jobKey === "k2"), "the two oldest are evicted");
  });

  it("entries older than the 7-day TTL are dropped on read so the shelf never resurfaces stale roles", () => {
    const ls = makeLocalStorage({
      [STORAGE_KEY]: JSON.stringify([
        { jobKey: "fresh", role: "R", company: "C", ts: Date.now() - DAY_MS },
        { jobKey: "stale", role: "R", company: "C", ts: Date.now() - 8 * DAY_MS },
      ]),
    });
    const env = loadFlowing({ localStorage: ls });
    assert.deepEqual(keysOf(env.recents.list()), ["fresh"]);
  });

  it("recents persist across page loads — a fresh module instance reads what the last one wrote", () => {
    const ls = makeLocalStorage();
    const first = loadFlowing({ localStorage: ls });
    first.recents.record({ jobKey: "persisted", role: "R", company: "C" });
    const second = loadFlowing({ localStorage: ls });
    const list = second.recents.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].jobKey, "persisted");
  });

  it("clear() empties the shelf for the next read", () => {
    const env = loadFlowing();
    env.recents.record({ jobKey: "k1", role: "R", company: "C" });
    env.recents.clear();
    assert.equal(env.recents.list().length, 0);
  });
});

describe("flowing-store — recents: defensive persistence", () => {
  it("non-JSON garbage in localStorage degrades to an empty shelf instead of crashing the flowing page, and recording recovers", () => {
    const ls = makeLocalStorage({ [STORAGE_KEY]: "{not json" });
    const env = loadFlowing({ localStorage: ls });
    assert.equal(env.recents.list().length, 0);
    env.recents.record({ jobKey: "k1", role: "R", company: "C" });
    assert.deepEqual(keysOf(env.recents.list()), ["k1"], "a fresh record overwrites the garbage");
  });

  it("a persisted non-array payload is treated as empty (cross-version schema drift must not throw)", () => {
    const ls = makeLocalStorage({ [STORAGE_KEY]: JSON.stringify({ v: 2, items: [] }) });
    const env = loadFlowing({ localStorage: ls });
    assert.equal(env.recents.list().length, 0);
  });

  it("malformed entries (missing/non-string jobKey, bad ts) are filtered out while healthy ones survive", () => {
    const now = Date.now();
    const ls = makeLocalStorage({
      [STORAGE_KEY]: JSON.stringify([
        { jobKey: "good", role: "R", company: "C", ts: now },
        { role: "no jobKey", company: "C", ts: now },
        { jobKey: 5, role: "numeric key", company: "C", ts: now },
        { jobKey: "bad-ts", role: "R", company: "C", ts: "yesterday" },
        null,
      ]),
    });
    const env = loadFlowing({ localStorage: ls });
    assert.deepEqual(keysOf(env.recents.list()), ["good"]);
  });

  it("a missing localStorage (private mode) makes recents a safe no-op, never a crash", () => {
    const env = loadFlowing({ localStorage: null });
    assert.doesNotThrow(() => env.recents.record({ jobKey: "k1", role: "R", company: "C" }));
    assert.equal(env.recents.list().length, 0);
    assert.doesNotThrow(() => env.recents.clear());
  });

  it("a quota-exceeded setItem is swallowed — recording must never break the role-open flow", () => {
    const ls = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const env = loadFlowing({ localStorage: ls });
    assert.doesNotThrow(() => env.recents.record({ jobKey: "k1", role: "R", company: "C" }));
    env.openRole.set("job-1");
    assert.equal(ofType(env.events, "jb:role:opened").length, 1, "the open still announces despite the failed write");
  });
});

describe("flowing-store — openRole records recents with kanban-card meta", () => {
  it("opening a role snapshots its card title/company (trimmed) into recents so the shelf shows human-readable entries", () => {
    const env = loadFlowing({
      cards: { "job-1": makeCard({ role: "  Senior Engineer \n", company: " Acme Co " }) },
    });
    env.openRole.set("job-1");
    const list = env.recents.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].jobKey, "job-1");
    assert.equal(list[0].role, "Senior Engineer");
    assert.equal(list[0].company, "Acme Co");
  });

  it("a deep-link open before the cards render still records the jobKey with empty meta — the shelf entry exists either way", () => {
    const env = loadFlowing({ cards: {} });
    env.openRole.set("job-2");
    const list = env.recents.list();
    assert.equal(list[0].jobKey, "job-2");
    assert.equal(list[0].role, "");
    assert.equal(list[0].company, "");
  });

  it("jobKeys with quotes/brackets are escaped in the card selector (no selector injection) and recorded under the exact key", () => {
    const hostile = 'k"1]';
    const env = loadFlowing();
    assert.doesNotThrow(() => env.openRole.set(hostile));
    assert.equal(env.openRole.get(), hostile);
    assert.equal(env.recents.list()[0].jobKey, hostile);
    const selector = env.selectors[env.selectors.length - 1];
    assert.ok(
      !selector.includes('k"1'),
      "the raw quote must never reach the attribute selector — a real browser would throw on the lookup",
    );
  });
});
