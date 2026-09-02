/**
 * tests/sixbeats-boot-null-parent-toast.test.mjs
 *
 * SIXBEATS claim C1 — "cold start throws before the user does anything":
 * an uncaught `TypeError: Cannot read properties of null (reading
 * 'appendChild')`.
 *
 * WHY this pin exists. Lane B2 traced every `appendChild` in the 115
 * scripts index.html boots (the RCA is in LANE-REPORT-boot-error.md).
 * Exactly ONE of them dereferences a parent it looked up and never
 * null-checked:
 *
 *     auth-session.js  showToast()
 *       const container = document.getElementById("toastContainer");
 *       ...
 *       container.appendChild(toast);          // ← C1's exact shape
 *
 * Every other boot-path append either builds its own parent in the same
 * function or guards the lookup. `#toastContainer` (index.html:1419) is a
 * static body child, so on the shipped page a deferred caller does find
 * it — but `showToast` is not a private helper: it is published as
 * `window.showToast` and `JobBoredApp.auth.showToast` and called from
 * ~220 sites, and jb-a11y.js's `toast()` wrapper already wraps it in
 * try/catch precisely because it can throw. A feedback toast that cannot
 * paint must not take the caller's flow down with it — that is the whole
 * failure mode C1 names.
 *
 * The contract pinned here: with no `#toastContainer` on the page,
 * `showToast` still announces (the announcement is the accessible
 * channel — jb-a11y.js:182), still returns a callable dismiss so callers
 * that hold onto it keep working, and never throws.
 *
 * Mutation check: delete the `if (!container)` guard from showToast and
 * "does not throw when #toastContainer is absent" fails with the exact
 * TypeError C1 reported.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const authSessionJs = readFileSync(join(repoRoot, "auth-session.js"), "utf8");

const TOAST_START = authSessionJs.indexOf(
  "// ============================================\n// TOAST SYSTEM",
);
const TOAST_END = authSessionJs.indexOf(
  "// ============================================\n// AUTH — Google Identity Services",
);
if (TOAST_START === -1 || TOAST_END === -1) {
  throw new Error("Could not isolate the TOAST SYSTEM section of auth-session.js");
}
const toastSource = authSessionJs.slice(TOAST_START, TOAST_END);

/**
 * The smallest DOM `showToast` actually touches. `innerHTML` is stored,
 * not parsed, so `querySelector` hands back a stub for the two nodes the
 * function reaches into (.toast-message, .toast-close) — the point of the
 * probe is the container lookup, not markup fidelity.
 */
function makeStubNode() {
  return {
    listeners: [],
    addEventListener(name, fn) {
      this.listeners.push({ name, fn });
    },
    after() {},
  };
}

function makeToastNode() {
  return {
    className: "",
    innerHTML: "",
    classList: { added: [], add(name) { this.added.push(name); } },
    remove() {},
    querySelector() {
      return makeStubNode();
    },
  };
}

/**
 * Run the toast section with `#toastContainer` present or absent.
 * `containerless: true` is the C1 shape — getElementById resolves to null.
 */
function loadToastSystem({ containerless }) {
  const appended = [];
  const announced = [];
  const container = containerless
    ? null
    : { appendChild(node) { appended.push(node); } };

  const context = {
    console,
    setTimeout(_fn) { return { unref() {} }; },
    clearTimeout() {},
    document: {
      getElementById(id) {
        return id === "toastContainer" ? container : null;
      },
      createElement() {
        return makeToastNode();
      },
    },
    host: () => ({ escapeHtml: (value) => String(value) }),
  };
  context.window = {
    JobBoredA11y: {
      live: {
        announce(message, options) {
          announced.push({ message, options });
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(toastSource, context, {
    filename: "auth-session.js#toast-system",
  });
  return { context, appended, announced };
}

describe("SIXBEATS C1 — a boot-path append must never dereference a null parent", () => {
  it("renders into #toastContainer when the page has one (the shipped path)", () => {
    const h = loadToastSystem({ containerless: false });
    const dismiss = h.context.showToast("Moved to Applied", "success");
    assert.equal(
      h.appended.length,
      1,
      "with a container present the toast must still be appended — the guard " +
        "may not cost the shipped page its feedback channel",
    );
    assert.equal(typeof dismiss, "function", "showToast returns its dismiss fn");
  });

  it("does not throw when #toastContainer is absent (claim C1's exact shape)", () => {
    const h = loadToastSystem({ containerless: true });
    assert.doesNotThrow(
      () => h.context.showToast("Sheet write failed", "error", true),
      "showToast must not raise TypeError: Cannot read properties of null " +
        "(reading 'appendChild') when the page has no #toastContainer — that " +
        "uncaught throw is claim C1, and it kills whatever flow called it",
    );
  });

  it("still announces to assistive tech when there is nowhere to paint", () => {
    const h = loadToastSystem({ containerless: true });
    h.context.showToast("Sheet write failed", "error");
    assert.deepEqual(
      h.announced.map((a) => [a.message, a.options.assertive]),
      [["Sheet write failed", true]],
      "the live-region mirror is the accessible channel (jb-a11y.js:182) and " +
        "must not be skipped just because rendering is impossible",
    );
  });

  it("still returns a callable dismiss so held references keep working", () => {
    const h = loadToastSystem({ containerless: true });
    const dismiss = h.context.showToast("Running setup doctor…", "info", true);
    assert.equal(
      typeof dismiss,
      "function",
      "callers store the dismiss fn and call it later; returning undefined " +
        "just moves the TypeError to their call site",
    );
    assert.doesNotThrow(() => dismiss(), "the returned dismiss must be safe to call");
  });
});
