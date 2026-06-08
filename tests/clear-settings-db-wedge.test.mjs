import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Regression: "Clear settings" + a second JobBored tab wedged
   the user-content IndexedDB forever.

   deleteDatabase() stays pending while another tab holds a
   connection; every later indexedDB.open() queues behind it and
   never settles. Settings gear and the avatar menu awaited a DB
   read BEFORE mutating the DOM, so both buttons went silently
   dead with zero console errors.

   Fix contract (encoded below):
   1. user-content-store.js: connections release on versionchange
      (so a delete in one tab can't be blocked by another), and a
      hung open fails loud via a watchdog instead of hanging.
   2. settings-modal.js: the modal becomes visible BEFORE any
      IndexedDB-backed hydration is awaited.
   3. auth-session.js: the avatar menu opens BEFORE the
      preferences panel refresh is awaited.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);
const authSessionJs = readFileSync(join(repoRoot, "auth-session.js"), "utf8");

/** Fake IDBOpenDBRequest the test drives by hand. */
function makeFakeOpenRequest() {
  return {
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    result: null,
    error: null,
  };
}

function makeFakeDb() {
  let closed = false;
  return {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    close() {
      closed = true;
    },
    get isClosed() {
      return closed;
    },
  };
}

/**
 * Run user-content-store.js in a vm with a scripted indexedDB and
 * captured timers, so the test controls open success/hang.
 */
function loadStore() {
  const openRequests = [];
  const timers = [];
  const ctx = {
    window: {},
    indexedDB: {
      open() {
        const req = makeFakeOpenRequest();
        openRequests.push(req);
        return req;
      },
    },
    crypto: { randomUUID: () => "test-uuid" },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(userContentStoreJs, ctx, {
    filename: "user-content-store.js",
  });
  return { UC: ctx.window.CommandCenterUserContent, openRequests, timers };
}

describe("user-content-store open hardening", () => {
  it("releases the connection on versionchange so Clear settings in another tab can proceed", async () => {
    const { UC, openRequests } = loadStore();
    const opening = UC.openDb();
    const db = makeFakeDb();
    openRequests[0].result = db;
    openRequests[0].onsuccess();
    assert.equal(await opening, db);
    assert.equal(
      typeof db.onversionchange,
      "function",
      "openDb must install a versionchange handler — without it a deleteDatabase from another tab blocks forever",
    );
    db.onversionchange();
    assert.equal(
      db.isClosed,
      true,
      "versionchange must close the connection so the pending delete can complete",
    );
    // The cached promise must reset so the next call reopens fresh.
    void UC.openDb();
    assert.equal(
      openRequests.length,
      2,
      "after versionchange the next openDb() must issue a new indexedDB.open",
    );
  });

  it("fails loud (rejects) instead of hanging forever when the open is blocked", async () => {
    const { UC, openRequests, timers } = loadStore();
    const opening = UC.openDb();
    // Open never succeeds (queued behind a blocked delete). Fire the watchdog.
    const watchdog = timers.find((t) => !t.cleared);
    assert.ok(watchdog, "openDb must arm a watchdog timer");
    watchdog.fn();
    await assert.rejects(opening, /timed out/i);
    // A later call must retry with a fresh open request, not the dead promise.
    void UC.openDb();
    assert.equal(
      openRequests.length,
      2,
      "openDb must reset its cached promise after a watchdog rejection",
    );
  });

  it("closes a connection that succeeds only after the watchdog fired", async () => {
    const { UC, openRequests, timers } = loadStore();
    const opening = UC.openDb();
    timers.find((t) => !t.cleared).fn();
    await assert.rejects(opening, /timed out/i);
    const db = makeFakeDb();
    openRequests[0].result = db;
    openRequests[0].onsuccess();
    assert.equal(
      db.isClosed,
      true,
      "a late success after rejection must not leave a dangling connection",
    );
  });
});

/** Slice a top-level `async function name(...) { ... }` body out of a source file. */
function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("UI opens before IndexedDB hydration", () => {
  it("settings modal becomes visible before discovery-profile hydration is awaited", () => {
    const body = functionBody(settingsModalJs, "openCommandCenterSettingsModal");
    const show = body.indexOf('modal.style.display = "flex"');
    const hydrate = body.indexOf("populateDiscoveryProfileIntoSettingsForm()");
    assert.notEqual(show, -1, "modal show statement must exist");
    assert.notEqual(hydrate, -1, "discovery profile hydration must exist");
    assert.ok(
      show < hydrate,
      "the settings modal must be shown BEFORE awaiting IndexedDB-backed hydration — " +
        "a wedged DB (blocked Clear-settings delete in another tab) silently killed the Settings button",
    );
  });

  it("avatar menu opens before the preferences panel refresh is awaited", () => {
    const body = functionBody(authSessionJs, "toggleAuthUserMenu");
    const show = body.indexOf("menu.hidden = !willOpen");
    const refresh = body.indexOf("refreshPersonalPreferencesPanel()");
    assert.notEqual(show, -1, "menu un-hide statement must exist");
    assert.notEqual(refresh, -1, "preferences refresh must exist");
    assert.ok(
      show < refresh,
      "the avatar menu must open BEFORE awaiting the IndexedDB-backed preferences refresh — " +
        "a wedged DB silently killed the profile button",
    );
  });
});
