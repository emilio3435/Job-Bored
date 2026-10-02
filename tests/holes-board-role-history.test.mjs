/**
 * HOLES BOARD — B15: the browser's Back button closes an open role.
 *
 * flowing-store.js synced #role=<key> with history.replaceState only, so
 * opening a role never added a history entry and Back left the app instead of
 * closing the role. Now opening a role from none pushes ONE entry (marked in
 * its state), switching roles replaces it, Back (popstate / hashchange) closes
 * the role through an idempotent handler, and a close from the UI pops the
 * store's own entry with history.back() so a later Back does not land on a dead
 * duplicate. Without a History API the location.hash fallback still works.
 *
 * The fake tab below models a browser's session history: pushState/replaceState
 * apply at once, back() is queued and traversed later (as browsers do), and a
 * traversal fires popstate and then hashchange when the fragment changed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flowingStoreJs = readFileSync(join(repoRoot, "flowing-store.js"), "utf8");

const hashOf = (url) => {
  const at = String(url).indexOf("#");
  return at === -1 ? "" : String(url).slice(at);
};
// history.state is a structured clone in a browser; a JSON round-trip is close
// enough here and brings vm-realm objects into this realm.
const clone = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));

/** One browser tab: location + session history that outlive a page load. */
function makeTab({ hash = "", state = null } = {}) {
  const location = { pathname: "/flow", search: "", hash };
  const entries = [{ hash, state: clone(state) }];
  let index = 0;
  const queued = [];
  const calls = { push: [], replace: [], back: 0 };
  let page = null;

  const history = {
    get state() {
      return clone(entries[index].state);
    },
    get length() {
      return entries.length;
    },
    pushState(state, _title, url) {
      calls.push.push({ state: clone(state), url: String(url) });
      entries.splice(index + 1);
      entries.push({ hash: hashOf(url), state: clone(state) });
      index = entries.length - 1;
      location.hash = hashOf(url);
    },
    replaceState(state, _title, url) {
      calls.replace.push({ state: clone(state), url: String(url) });
      entries[index] = { hash: hashOf(url), state: clone(state) };
      location.hash = hashOf(url);
    },
    back() {
      calls.back += 1;
      queued.push(-1);
    },
  };

  function traverse(delta, { hashchange = true } = {}) {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return false;
    const oldHash = location.hash;
    index = target;
    location.hash = entries[index].hash;
    if (page) page.fire("popstate", { type: "popstate", state: clone(entries[index].state) });
    if (hashchange && oldHash !== location.hash && page) page.fire("hashchange", { type: "hashchange" });
    return true;
  }

  return {
    location,
    history,
    calls,
    index: () => index,
    attach(next) {
      page = next;
    },
    /** Run the traversals history.back() queued (the browser does this a moment later). */
    settle() {
      while (queued.length) traverse(queued.shift());
    },
    /** The user presses the browser's Back / Forward button. */
    userBack: (opts) => traverse(-1, opts),
    userForward: (opts) => traverse(1, opts),
  };
}

/** Load flowing-store.js as a page in `tab` (a second call models a reload). */
function loadStore(tab = makeTab(), { withHistory = true } = {}) {
  const listeners = new Map();
  const events = [];
  const win = {
    location: tab.location,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at !== -1) list.splice(at, 1);
    },
    dispatchEvent(ev) {
      events.push(ev.type);
      for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev);
      return true;
    },
    requestAnimationFrame(fn) {
      fn();
      return 0;
    },
  };
  if (withHistory) win.history = tab.history;
  const page = {
    fire(type, ev) {
      for (const fn of [...(listeners.get(type) || [])]) fn(ev);
    },
  };
  tab.attach(page);
  const doc = {
    readyState: "complete",
    addEventListener() {},
    dispatchEvent: () => true,
    querySelector: () => null,
  };
  const ctx = { window: win, document: doc, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(flowingStoreJs, ctx, { filename: "flowing-store.js" });
  return {
    tab,
    win,
    openRole: win.JobBoredFlowing.openRole,
    count: (type) => events.filter((t) => t === type).length,
  };
}

describe("B15 · opening a role adds one history entry", () => {
  it("should push exactly one marked entry when a role opens from none, keeping pathname + search", () => {
    const env = loadStore();
    env.openRole.set("job-1");
    assert.equal(env.tab.calls.push.length, 1, "one entry, so Back has something to close");
    assert.equal(env.tab.calls.push[0].url, "/flow#role=job-1");
    assert.equal(env.tab.calls.replace.length, 0);
    assert.equal(env.tab.history.length, 2);
    const marker = env.tab.calls.push[0].state;
    assert.ok(marker && typeof marker === "object", "the pushed entry carries the store's marker in its state");
  });

  it("should replace that entry, not push another, when switching between open roles — no history spam per card click", () => {
    const env = loadStore();
    env.openRole.set("a");
    env.openRole.set("b");
    env.openRole.set("c");
    assert.equal(env.tab.calls.push.length, 1);
    assert.equal(env.tab.calls.replace.length, 2);
    assert.equal(env.tab.history.length, 2);
    assert.equal(env.tab.location.hash, "#role=c");
    assert.deepEqual(
      env.tab.history.state,
      env.tab.calls.push[0].state,
      "the marker survives the switch, so a later close still pops this entry",
    );
    assert.equal(env.count("jb:role:opened"), 3, "each switch is still announced once");
  });
});

describe("B15 · Back closes an open role", () => {
  it("should close the role exactly once when Back fires popstate and then hashchange", () => {
    const env = loadStore();
    env.openRole.set("a");
    assert.equal(env.tab.userBack(), true);
    assert.equal(env.openRole.get(), null);
    assert.equal(env.tab.location.hash, "");
    assert.equal(env.count("jb:role:closed"), 1, "two events, one close — the handler is idempotent");
  });

  it("should close on popstate alone — a traversal's hashchange may arrive later or not at all", () => {
    const env = loadStore();
    env.openRole.set("a");
    env.tab.userBack({ hashchange: false });
    assert.equal(env.openRole.get(), null);
    assert.equal(env.count("jb:role:closed"), 1);
  });

  it("should reopen the role exactly once on Forward", () => {
    const env = loadStore();
    env.openRole.set("a");
    env.tab.userBack();
    env.tab.userForward();
    assert.equal(env.openRole.get(), "a");
    assert.equal(env.count("jb:role:opened"), 2, "the first open plus the Forward");
    assert.equal(env.count("jb:role:closed"), 1);
  });
});

describe("B15 · a close from the UI pops the store's own entry", () => {
  it("should call history.back() when clear() closes a role the store pushed, so the next Back does not land on a dead duplicate", () => {
    const env = loadStore();
    env.openRole.set("a");
    env.openRole.clear();
    assert.equal(env.tab.calls.back, 1);
    assert.equal(env.tab.calls.replace.length, 0, "no rewrite of the entry that is about to be popped");
    assert.equal(env.openRole.get(), null, "the store closes at once, not when the traversal lands");
    assert.equal(env.count("jb:role:closed"), 1, "announced synchronously, as before");

    env.tab.settle();
    assert.equal(env.tab.index(), 0, "back on the entry from before the role opened");
    assert.equal(env.tab.location.hash, "");
    assert.equal(env.count("jb:role:closed"), 1, "the traversal's popstate/hashchange must not close it twice");
    assert.equal(env.count("jb:role:opened"), 1);
  });

  it("should not pop twice when clear() runs again before the traversal lands — a second pop would leave the app", () => {
    const env = loadStore();
    env.openRole.set("a");
    env.openRole.clear();
    env.openRole.clear();
    assert.equal(env.tab.calls.back, 1, "only the open-to-closed change pops");
    env.tab.settle();
    assert.equal(env.tab.index(), 0, "still on the page's own entry");
    assert.equal(env.tab.location.hash, "");
    assert.equal(env.count("jb:role:closed"), 1);
  });

  it("should fall back to replaceState when the open role came from a deep link the store did not push", () => {
    const env = loadStore(makeTab({ hash: "#role=deep" }));
    assert.equal(env.openRole.get(), "deep");
    env.openRole.clear();
    assert.equal(env.tab.calls.back, 0, "popping here would leave the app");
    assert.deepEqual(
      env.tab.calls.replace.map((c) => c.url),
      ["/flow"],
    );
    assert.equal(env.count("jb:role:closed"), 1);
  });

  it("should not pop an entry an earlier page load pushed — after a reload, going back would load the page again", () => {
    const tab = makeTab();
    loadStore(tab).openRole.set("a");
    const reloaded = loadStore(tab);
    assert.equal(reloaded.openRole.get(), "a", "the reload reopens the role from the hash");
    reloaded.openRole.clear();
    assert.equal(tab.calls.back, 0);
    assert.equal(tab.location.hash, "");
    assert.equal(reloaded.count("jb:role:closed"), 1);
  });
});

describe("B15 · no History API", () => {
  it("should still sync through location.hash and announce each change once", () => {
    const env = loadStore(makeTab(), { withHistory: false });
    env.openRole.set("a");
    assert.equal(env.tab.location.hash, "#role=a");
    // A real browser follows a location.hash write with a hashchange.
    env.win.dispatchEvent({ type: "hashchange" });
    assert.equal(env.count("jb:role:opened"), 1);
    env.openRole.clear();
    assert.equal(env.tab.location.hash, "");
    env.win.dispatchEvent({ type: "hashchange" });
    assert.equal(env.count("jb:role:closed"), 1);
  });
});
