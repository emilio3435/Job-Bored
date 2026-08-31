/**
 * tests/jb-a11y-toast-announcement.test.mjs
 *
 * Claim A11Y-01a — toasts are silent to screen readers.
 *
 * WHY these pins exist: `showToast` (auth-session.js:475-521) is THE user-facing
 * feedback channel for every write in this app — "Moved to Applied", "Sheet write
 * failed", "Draft saved". It appends into #toastContainer (index.html:1566), a
 * plain <div> with no role and no aria-live, so none of that reaches assistive
 * tech. Two ad-hoc live regions exist elsewhere (lattice.js:693-706 #jb-lat-live,
 * pipeline.js:1593-1608 pipe-toast) but neither covers the canonical toast.
 *
 * The locked API (T0-SUBSTRATE.md §2) answers this with singleton live regions
 * owned by the primitive plus a `toast()` wrapper that ALWAYS mirrors into
 * live.announce, so a surface gets the announcement even if the integrator's
 * #toastContainer attribute edit has not landed yet.
 *
 * Claim classification (mirrored in JB-A11Y.md):
 *   - vm-SIMULATED here: region injection + attributes, polite/assertive
 *     routing, the ~150ms identical-repeat debounce, mirroring into
 *     host().showToast, lazy host() binding, dismiss-fn passthrough.
 *   - SOURCE-PINNED here: the live-region markup recipe is not re-derived from
 *     lattice.js; it is asserted directly on the injected nodes.
 *   - NEEDS-BROWSER: that a real screen reader actually speaks the region
 *     update, and the perceived ordering of polite vs assertive speech.
 *
 * Mutation check: drop the live.announce mirror from toast(), or emit the
 * region without aria-live, and a named assertion below fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadA11y, repoRoot } from "./fixtures/jb-a11y-dom.mjs";

const a11yJs = readFileSync(join(repoRoot, "jb-a11y.js"), "utf8");

/** Install a fake host bridge the way bridge-registry.js does at runtime. */
function bridgeHost(h, showToast) {
  h.window.JobBoredApp = { core: { host: { showToast } } };
}

describe("JobBoredA11y.live — singleton visually-hidden regions", () => {
  it("injects a polite region with the lattice.js markup recipe on first use", () => {
    const h = loadA11y();
    assert.equal(
      h.document.querySelectorAll("[data-jb-a11y-live]").length,
      0,
      "no live region may be injected at script load — jb-a11y.js must stay " +
        "inert until something actually announces (cold-start safety)",
    );

    h.api.live.announce("Moved to Applied");

    const region = h.document.querySelector('[data-jb-a11y-live="polite"]');
    assert.ok(region, "live.announce must inject a polite live region");
    assert.equal(
      region.getAttribute("role"),
      "status",
      "polite region must be role=status (lattice.js:693-706 precedent)",
    );
    assert.equal(
      region.getAttribute("aria-live"),
      "polite",
      "polite region must declare aria-live=polite",
    );
    assert.equal(
      region.getAttribute("aria-atomic"),
      "true",
      "aria-atomic=true so the whole message is re-read, not just the diff",
    );
    assert.equal(
      region.textContent,
      "Moved to Applied",
      "the message must land in the region's text",
    );
  });

  it("injects a separate assertive region only when assertive is requested", () => {
    const h = loadA11y();
    h.api.live.announce("Saved");
    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="assertive"]'),
      null,
      "the assertive region must not be created for polite announcements",
    );

    h.api.live.announce("Sheet write failed", { assertive: true });
    const alert = h.document.querySelector('[data-jb-a11y-live="assertive"]');
    assert.ok(alert, "assertive announcements need their own region");
    assert.equal(
      alert.getAttribute("role"),
      "alert",
      "assertive region must be role=alert so errors interrupt",
    );
    assert.equal(
      alert.getAttribute("aria-live"),
      "assertive",
      "assertive region must declare aria-live=assertive",
    );
    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="polite"]').textContent,
      "Saved",
      "an assertive announcement must not clobber the polite region",
    );
  });

  it("reuses the same region node across announcements (singleton, not per-call)", () => {
    const h = loadA11y();
    h.api.live.announce("one");
    const first = h.document.querySelector('[data-jb-a11y-live="polite"]');
    h.api.live.announce("two");
    const all = h.document.querySelectorAll('[data-jb-a11y-live="polite"]');
    assert.equal(all.length, 1, "exactly one polite region may ever exist");
    assert.equal(all[0], first, "the region node must be reused, not replaced");
    assert.equal(all[0].textContent, "two", "the region shows the latest message");
  });

  it("carries the visually-hidden class so the region never paints", () => {
    const h = loadA11y();
    h.api.live.announce("hi");
    const region = h.document.querySelector('[data-jb-a11y-live="polite"]');
    assert.equal(
      region.classList.contains("jb-a11y-visually-hidden"),
      true,
      "the region must use the jb-a11y-visually-hidden utility from jb-a11y.css — " +
        "display:none or hidden would make it unreadable to AT",
    );
  });

  it("debounces an identical repeat and lets a different message through", () => {
    const h = loadA11y();
    h.api.live.announce("Moved to Applied");
    const region = h.document.querySelector('[data-jb-a11y-live="polite"]');
    region.textContent = "";
    h.api.live.announce("Moved to Applied");
    assert.equal(
      region.textContent,
      "",
      "an identical message inside the debounce window must not re-announce " +
        "(rapid duplicate writes would otherwise spam the screen reader)",
    );

    h.api.live.announce("Moved to Rejected");
    assert.equal(
      region.textContent,
      "Moved to Rejected",
      "a DIFFERENT message must always announce immediately",
    );
  });

  it("ignores empty and non-string messages instead of clearing the region", () => {
    const h = loadA11y();
    h.api.live.announce("real message");
    const region = h.document.querySelector('[data-jb-a11y-live="polite"]');
    h.api.live.announce("");
    h.api.live.announce(null);
    h.api.live.announce(undefined);
    assert.equal(
      region.textContent,
      "real message",
      "empty announcements must be dropped, not used to blank the region",
    );
  });
});

describe("JobBoredA11y.toast — always announces, renders when bridged", () => {
  it("mirrors every toast into the polite live region", () => {
    const h = loadA11y();
    h.api.toast("Draft saved");
    const region = h.document.querySelector('[data-jb-a11y-live="polite"]');
    assert.ok(region, "toast() must create the live region (A11Y-01a)");
    assert.equal(
      region.textContent,
      "Draft saved",
      "toast() must ALWAYS mirror into live.announce, bridged or not",
    );
  });

  it("routes error toasts to the assertive region", () => {
    const h = loadA11y();
    h.api.toast("Sheet write failed", "error");
    const alert = h.document.querySelector('[data-jb-a11y-live="assertive"]');
    assert.ok(alert, "an error toast must reach the assertive region");
    assert.equal(
      alert.textContent,
      "Sheet write failed",
      "error text must be the assertive announcement",
    );
  });

  it("calls host().showToast lazily, at invocation, with the full argument list", () => {
    const h = loadA11y();
    const calls = [];
    bridgeHost(h, (...args) => {
      calls.push(args);
      return () => calls.push(["dismissed"]);
    });

    const action = { label: "Undo", onClick() {} };
    h.api.toast("Moved to Applied", "success", { persistent: true, action });

    assert.equal(calls.length, 1, "toast() must call the bridged host().showToast");
    assert.deepEqual(
      calls[0],
      ["Moved to Applied", "success", true, action],
      "arguments must match auth-session.js showToast(message, type, persistent, action)",
    );
  });

  it("returns the host's dismiss fn, and a no-op dismiss fn when unbridged", () => {
    const bridged = loadA11y();
    let dismissed = false;
    bridgeHost(bridged, () => () => {
      dismissed = true;
    });
    const dismiss = bridged.api.toast("hi");
    assert.equal(
      typeof dismiss,
      "function",
      "toast() must return a dismiss function (auth-session.js contract)",
    );
    dismiss();
    assert.equal(dismissed, true, "the returned fn must be the host's dismiss fn");

    const unbridged = loadA11y();
    const noop = unbridged.api.toast("hi");
    assert.equal(
      typeof noop,
      "function",
      "an unbridged toast must still return a callable dismiss fn, not undefined",
    );
    assert.doesNotThrow(() => noop(), "the no-op dismiss must be safe to call");
  });

  it("still announces when the host bridge throws", () => {
    const h = loadA11y();
    bridgeHost(h, () => {
      throw new Error("toast container missing");
    });
    assert.doesNotThrow(
      () => h.api.toast("Saved anyway"),
      "a broken visual toast must never break the caller's write path",
    );
    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="polite"]').textContent,
      "Saved anyway",
      "the announcement must survive a failing visual renderer",
    );
  });
});

describe("jb-a11y.js — cold-start / script-order safety (source pin)", () => {
  // Source-pinned, not vm-simulated: the failure mode is a ReferenceError at
  // PARSE/LOAD time in the browser, which a vm run that already succeeded
  // cannot demonstrate. bridge-registry.js assigns app.core.host at runtime
  // (line ~480); jb-a11y.js loads EARLY, before that exists.
  it("never dereferences window.JobBoredApp.core.host at load time", () => {
    // Strip comments first: the file's own header explains this rule in prose,
    // and a naive text search would match the explanation instead of the code.
    const code = a11yJs
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const prologue = code.slice(0, code.indexOf("function host"));
    assert.equal(
      /window\.JobBoredApp/.test(prologue),
      false,
      "the module prologue must not read the host bridge — jb-a11y.js loads " +
        "before bridge-registry.js assigns it (tests/index-html-cold-start pins boot)",
    );
    assert.match(
      a11yJs,
      /function host\s*\(\)\s*\{[\s\S]*?window\.JobBoredApp[\s\S]*?\}/,
      "host() must be a lazy accessor function, resolved at call time",
    );
  });

  it("is a classic IIFE with no ES export (an export kills the whole file)", () => {
    assert.equal(
      /^\s*export\s/m.test(a11yJs),
      false,
      "jb-a11y.js is loaded as a classic defer script — a top-level `export` " +
        "silently aborts the entire file (jb-ui.js:472-474 warns about this)",
    );
    assert.match(
      a11yJs,
      /window\.JobBoredA11y\s*=/,
      "the API must be attached to window.JobBoredA11y like its neighbours",
    );
  });

  it("survives a hostile bridge shape without throwing", () => {
    const h = loadA11y();
    h.window.JobBoredApp = { core: {} }; // host not assigned yet
    assert.doesNotThrow(
      () => h.api.toast("early toast"),
      "toast() before the bridge lands must degrade to announce-only",
    );
    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="polite"]').textContent,
      "early toast",
      "the announcement is the part that must never depend on the bridge",
    );
  });
});
