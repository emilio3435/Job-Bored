/* PIPE-06 — two unrelated closure models wearing each other's labels.

   dismissJob writes Pipeline!W (Dismissed At) plus a Blacklist row, and the
   row then disappears from every board unless "show dismissed" is on.
   markStatusExpired writes Pipeline!M = "Expired" and the row stays visible
   — in the column pipeline.js labelled "Dismissed". So the column named
   Dismissed showed expired rows, dismissed rows showed nowhere, restoreJob
   only reversed dismissedAt, and nothing could un-expire anything.

   Convergence for T0: one vocabulary (dismiss/restore, expire/unexpire —
   each with an inverse), one intent event, zero direct cell writes from a
   surface. The handler that performs the write is integrator-owned
   (T0-SUBSTRATE.md §3), so `jb:closure:change` is dispatched cancelable and
   surfaces keep their legacy call as the default binding until a handler
   claims the intent with preventDefault(). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/** Surfaces that offer a closure affordance and must route it as an intent. */
const CLOSURE_SURFACES = ["dawn.js", "pipeline-render.js", "expired-review-ui.js"];

function loadRegistry(doc) {
  const ctx = { window: {}, document: doc, Object, String, Array, CustomEvent: FakeCustomEvent };
  vm.runInNewContext(read("stage-registry.js"), ctx);
  return ctx.window.JobBoredStages;
}

class FakeCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = (init && init.detail) || null;
    this.cancelable = !!(init && init.cancelable);
    this.bubbles = !!(init && init.bubbles);
    this.defaultPrevented = false;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function makeDoc() {
  const listeners = [];
  return {
    seen: [],
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    dispatchEvent(ev) {
      this.seen.push(ev);
      for (const l of listeners) if (l.type === ev.type) l.fn(ev);
      return !ev.defaultPrevented;
    },
  };
}

describe("one closure vocabulary (PIPE-06)", () => {
  it("declares four actions and every one has an inverse", () => {
    const registry = loadRegistry(makeDoc());
    assert.deepEqual([...registry.CLOSURE_ACTIONS].sort(), [
      "dismiss",
      "expire",
      "restore",
      "unexpire",
    ]);
    for (const action of registry.CLOSURE_ACTIONS) {
      const inverse = registry.CLOSURE_INVERSE[action];
      assert.ok(inverse, `${action} needs an inverse — a closure you cannot undo is a trap`);
      assert.equal(
        registry.CLOSURE_INVERSE[inverse],
        action,
        `${action}/${inverse} must be a true pair`,
      );
    }
  });

  it("keeps dismiss and expire as separate facts, not synonyms", () => {
    const registry = loadRegistry(makeDoc());
    assert.notEqual(registry.CLOSURE_INVERSE.dismiss, registry.CLOSURE_INVERSE.expire);
    // The Expired column may never be labelled "Dismissed" again.
    assert.equal(
      /\{ key: "expired",\s+label: "Dismissed"/.test(read("pipeline.js")),
      false,
      "pipeline.js labelled Status=Expired rows as 'Dismissed', which is a different write entirely",
    );
  });

  it("dispatches jb:closure:change with the contracted payload", () => {
    const doc = makeDoc();
    const registry = loadRegistry(doc);
    registry.requestClosure(7, "expire", "dawn");
    assert.equal(doc.seen.length, 1);
    const ev = doc.seen[0];
    assert.equal(ev.type, "jb:closure:change");
    assert.deepEqual({ ...ev.detail }, { jobKey: 7, action: "expire", source: "dawn" });
    assert.equal(ev.cancelable, true, "a handler must be able to claim the intent");
  });

  it("reports the intent unclaimed so the surface can run its legacy write", () => {
    const doc = makeDoc();
    const registry = loadRegistry(doc);
    assert.equal(
      registry.requestClosure(1, "dismiss", "board"),
      false,
      "with no handler bound, the caller keeps today's behaviour",
    );
  });

  it("reports the intent claimed once a handler calls preventDefault", () => {
    const doc = makeDoc();
    const registry = loadRegistry(doc);
    doc.addEventListener("jb:closure:change", (ev) => ev.preventDefault());
    assert.equal(registry.requestClosure(1, "dismiss", "board"), true);
  });

  it("refuses an action outside the vocabulary", () => {
    const doc = makeDoc();
    const registry = loadRegistry(doc);
    assert.equal(registry.requestClosure(1, "delete", "board"), false);
    assert.equal(doc.seen.length, 0, "an unknown closure action must not reach the bus");
  });

  for (const rel of CLOSURE_SURFACES) {
    it(`${rel} asks for closure through the intent bus first`, () => {
      const src = read(rel);
      assert.ok(
        /requestClosure\(/.test(src),
        `${rel} should call JobBoredStages.requestClosure before its legacy write`,
      );
    });
  }

  it("expired-review-ui no longer writes the status cell itself", () => {
    const src = read("expired-review-ui.js");
    assert.equal(
      /updateMultipleCells\(/.test(src),
      false,
      "a surface writing Pipeline!M directly bypasses every closure handler and " +
        "the write-atomicity repair gate (T0-SUBSTRATE.md §1)",
    );
  });

  it("offers the inverse wherever it offers a closure", () => {
    // The review modal could expire a row but never un-expire one, so a
    // mis-click was unrecoverable from the surface that caused it.
    const src = read("expired-review-ui.js");
    assert.ok(/unexpire/.test(src), "the review modal needs an un-expire affordance");
  });
});
