/* ============================================================
   ONEFLOW B5 — pending-fuel slot (B5 spec C3, Option 3).

   The claims this lane exists to hold:

     · the slot lives under the exact C3 key `oneflow.pendingFuel.v1`
       with the exact C3 API names save/load/clearPendingFuel.
     · the value contract is `{ keyDraft, savedAt }` — fuelPassed is
       NEVER persisted; a restored draft must be re-proven live.
     · the backend is sessionStorage only: nothing pending ever touches
       IndexedDB, and nothing is emitted in events.
     · missing or blocked storage degrades to null/false no-ops —
       the slot never throws.

   Every key draft below is an obvious fake, compared in memory only —
   never logged, never snapshotted (spec §4.2).
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadStore, makeFakeSessionStorage } from "./oneflow-l0-harness.mjs";

const PENDING_KEY = "oneflow.pendingFuel.v1";
const DRAFT_A = "pending-draft-key-aaa";
const DRAFT_B = "pending-draft-key-bbb";

describe("ONEFLOW B5 · pending-fuel slot contract (spec C3)", () => {
  it("exposes the exact C3 key and API names on the store", () => {
    const { store } = loadStore();
    assert.equal(store.PENDING_FUEL_KEY, PENDING_KEY);
    assert.equal(typeof store.savePendingFuel, "function");
    assert.equal(typeof store.loadPendingFuel, "function");
    assert.equal(typeof store.clearPendingFuel, "function");
  });

  it("mirrors the same contract on the standalone handle", () => {
    const { window, store } = loadStore();
    const standalone = window.JobBoredPendingFuel;
    assert.ok(standalone, "the beat reads one contract either way");
    assert.equal(standalone.PENDING_FUEL_KEY, PENDING_KEY);
    assert.equal(standalone.savePendingFuel, store.savePendingFuel);
    assert.equal(standalone.loadPendingFuel, store.loadPendingFuel);
    assert.equal(standalone.clearPendingFuel, store.clearPendingFuel);
  });

  it("round-trips { keyDraft, savedAt } under the C3 key", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    assert.equal(store.loadPendingFuel(), null, "the slot starts empty");
    const saved = store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1234 });
    assert.equal(saved, true, "a non-empty draft reports persisted");
    const loaded = store.loadPendingFuel();
    assert.ok(loaded, "presence, not the value, is the first claim");
    assert.equal(loaded.keyDraft, DRAFT_A);
    assert.equal(loaded.savedAt, 1234);
    const touchedKeys = sessionStorage.seen.map(([, key]) => key);
    assert.ok(touchedKeys.length > 0);
    for (const key of touchedKeys) {
      assert.equal(key, PENDING_KEY, "the slot owns exactly one key");
    }
  });

  it("an empty draft clears the slot instead of storing an empty string", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 });
    assert.equal(
      store.savePendingFuel({ keyDraft: "", savedAt: 2 }),
      false,
      "clearing is not persisting",
    );
    assert.equal(store.loadPendingFuel(), null);
    assert.equal(
      store.savePendingFuel({ keyDraft: DRAFT_B, savedAt: 3 }),
      true,
    );
    assert.equal(store.loadPendingFuel().keyDraft, DRAFT_B);
  });

  it("clearPendingFuel empties the slot", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 });
    store.clearPendingFuel();
    assert.equal(store.loadPendingFuel(), null);
    store.clearPendingFuel();
    assert.equal(store.loadPendingFuel(), null, "clearing twice is fine");
  });

  it("a corrupt slot reads as empty, never throws", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    sessionStorage.setItem(PENDING_KEY, "{not json");
    assert.equal(store.loadPendingFuel(), null);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ keyDraft: "" }));
    assert.equal(store.loadPendingFuel(), null);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ nope: true }));
    assert.equal(store.loadPendingFuel(), null);
  });

  it("fuelPassed is NEVER persisted, even when the caller passes it", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1, fuelPassed: true });
    const loaded = store.loadPendingFuel();
    assert.ok(loaded);
    assert.equal(loaded.keyDraft, DRAFT_A);
    assert.equal(
      "fuelPassed" in loaded,
      false,
      "a restored draft must be re-proven by a live check",
    );
  });

  it("pending ops never touch IndexedDB", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store, indexedDB } = loadStore({ sessionStorage });
    store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 });
    store.loadPendingFuel();
    store.clearPendingFuel();
    assert.equal(
      indexedDB._databases.has("command-center-user-content"),
      false,
      "an unverified key is a secret: sessionStorage only, never disk",
    );
  });
});

describe("ONEFLOW B5 · pending-fuel degrades silently (spec C3)", () => {
  it("missing storage reads null, writes false, clears silently", () => {
    const { store } = loadStore();
    assert.equal(store.loadPendingFuel(), null);
    assert.equal(
      store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 }),
      false,
    );
    assert.doesNotThrow(() => store.clearPendingFuel());
  });

  it("blocked storage reads null, writes false, clears silently", () => {
    const sessionStorage = makeFakeSessionStorage({ throwing: true });
    const { store } = loadStore({ sessionStorage });
    assert.equal(store.loadPendingFuel(), null);
    assert.equal(
      store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 }),
      false,
    );
    assert.doesNotThrow(() => store.clearPendingFuel());
  });

  it("a storage that dies mid-session never takes the caller down", () => {
    const sessionStorage = makeFakeSessionStorage();
    const { store } = loadStore({ sessionStorage });
    store.savePendingFuel({ keyDraft: DRAFT_A, savedAt: 1 });
    const dead = makeFakeSessionStorage({ throwing: true });
    // Swap the backend the way a revoked permission would: every later
    // access throws, and every API still answers.
    sessionStorage.getItem = dead.getItem;
    sessionStorage.setItem = dead.setItem;
    sessionStorage.removeItem = dead.removeItem;
    assert.equal(store.loadPendingFuel(), null);
    assert.equal(
      store.savePendingFuel({ keyDraft: DRAFT_B, savedAt: 2 }),
      false,
    );
    assert.doesNotThrow(() => store.clearPendingFuel());
  });
});
