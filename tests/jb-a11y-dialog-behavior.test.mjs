/**
 * tests/jb-a11y-dialog-behavior.test.mjs
 *
 * Claim A11Y-01b (behavioral half) — dialog focus containment and restoration.
 *
 * WHY these pins exist: the T0 audit found dialog behavior copy-pasted per
 * module at wildly varying quality — settings-modal.js is correct, but
 * fit-profile-wizard.js has no opener capture, no inert, no Escape, and no
 * focus restore. The fix is ONE audited primitive (window.JobBoredA11y.dialog)
 * that every surface consumes. A source-shape regex pin cannot prove focus
 * actually lands or that inert is actually applied, so this file EXECUTES the
 * real jb-a11y.js inside the hand-rolled DOM from tests/fixtures/jb-a11y-dom.mjs
 * (repo convention: no jsdom / linkedom — see tests/kanban-card-attrs.test.mjs)
 * and asserts observable behavior.
 *
 * Claim classification (mirrored in JB-A11Y.md):
 *   - vm-SIMULATED here: inert assignment, opener capture, focus() call with
 *     { preventScroll: true }, Escape wiring, LIFO close, event emission.
 *   - NEEDS-BROWSER: that a real user agent honours `inert` for pointer/AT,
 *     that :focus-visible renders the ring, that Tab cannot escape the dialog.
 *     Those are e2e-smoke / manual-browser claims, NOT claimed green here.
 *
 * Mutation check: delete the inert loop, the opener capture, the Escape
 * listener, or the restore-focus call from jb-a11y.js and a named assertion
 * below fails — none of them can be satisfied by markup alone.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadA11y } from "./fixtures/jb-a11y-dom.mjs";

/** Build a body with background content + one dialog element. */
function scene() {
  const h = loadA11y();
  const backdropSibling = h.make("div", { id: "appRoot" });
  const opener = h.make("button", { id: "openerBtn" }, backdropSibling);
  const dialog = h.make("div", { id: "dlg", class: "modal" });
  const closeBtn = h.make("button", { id: "dlgClose" }, dialog);
  const input = h.make("input", { id: "dlgInput" }, dialog);
  return { h, backdropSibling, opener, dialog, closeBtn, input };
}

describe("JobBoredA11y.dialog — open contract", () => {
  it("sets role=dialog and aria-modal when the element lacks them", () => {
    const { h, dialog } = scene();
    h.api.dialog.open(dialog);
    assert.equal(
      dialog.getAttribute("role"),
      "dialog",
      "dialog.open must set role=dialog on an element that has none",
    );
    assert.equal(
      dialog.getAttribute("aria-modal"),
      "true",
      "dialog.open must set aria-modal=true on an element that has none",
    );
  });

  it("does not clobber a role/aria-modal the markup already declares", () => {
    const { h, dialog } = scene();
    dialog.setAttribute("role", "alertdialog");
    h.api.dialog.open(dialog);
    assert.equal(
      dialog.getAttribute("role"),
      "alertdialog",
      "dialog.open must respect an explicit role (partials/*.html own their semantics)",
    );
  });

  it("applies opts.label as aria-label only when no accessible name exists", () => {
    const { h, dialog } = scene();
    h.api.dialog.open(dialog, { label: "Fit profile setup" });
    assert.equal(
      dialog.getAttribute("aria-label"),
      "Fit profile setup",
      "opts.label must become aria-label when the dialog has no name",
    );

    const second = scene();
    second.dialog.setAttribute("aria-labelledby", "someTitle");
    second.h.api.dialog.open(second.dialog, { label: "Ignored" });
    assert.equal(
      second.dialog.getAttribute("aria-label"),
      null,
      "opts.label must NOT override an existing aria-labelledby (double-naming bug)",
    );
  });

  it("inerts every body child except the dialog, and releases them on close", () => {
    const { h, backdropSibling, dialog } = scene();
    assert.equal(
      backdropSibling.inert,
      false,
      "precondition: background is not inert before open",
    );

    const handle = h.api.dialog.open(dialog);
    assert.equal(
      backdropSibling.inert,
      true,
      "dialog.open must set .inert on background body children (A11Y-01b)",
    );
    assert.equal(
      dialog.inert,
      false,
      "dialog.open must never inert the dialog it is opening",
    );

    handle.close();
    assert.equal(
      backdropSibling.inert,
      false,
      "close() must release the inert set it captured (leaked inert = dead app)",
    );
  });

  it("leaves already-inert background nodes inert after close", () => {
    const { h, backdropSibling, dialog } = scene();
    // Someone else (a parent dialog, an app-level overlay) owns this node's
    // inert state. The dialog primitive must not steal it on the way out.
    backdropSibling.inert = true;
    const handle = h.api.dialog.open(dialog);
    handle.close();
    assert.equal(
      backdropSibling.inert,
      true,
      "close() must not un-inert nodes it did not inert itself",
    );
  });

  it("captures document.activeElement as the opener and restores it on close", () => {
    const { h, opener, dialog, closeBtn } = scene();
    opener.focus();
    assert.equal(
      h.document.activeElement,
      opener,
      "precondition: the opener button holds focus",
    );

    const handle = h.api.dialog.open(dialog);
    assert.equal(
      h.document.activeElement,
      closeBtn,
      "dialog.open must move focus INTO the dialog (first focusable)",
    );

    const openerFocusesBefore = opener._focusCalls.length;
    handle.close();
    assert.equal(
      h.document.activeElement,
      opener,
      "close() must return focus to the captured opener (A11Y-01b restore)",
    );
    assert.equal(
      opener._focusCalls.length,
      openerFocusesBefore + 1,
      "close() must call opener.focus() exactly once",
    );
    // Note: the opts bag is constructed inside the vm realm, so its prototype
    // is not this realm's Object.prototype — compare the field, not the object.
    assert.equal(
      opener._focusCalls[opener._focusCalls.length - 1].preventScroll,
      true,
      "focus restore must pass { preventScroll: true } (settings-modal.js:617-630 precedent)",
    );
  });

  it("honours an explicit opener over document.activeElement", () => {
    const { h, opener, dialog } = scene();
    const realOpener = h.make("button", { id: "gearBtn" });
    opener.focus();
    // Menus close and dump focus onto <body> BEFORE the dialog opens — the
    // settings modal captures the opener first for exactly this reason.
    const handle = h.api.dialog.open(dialog, { opener: realOpener });
    handle.close();
    assert.equal(
      h.document.activeElement,
      realOpener,
      "opts.opener must win over document.activeElement",
    );
  });

  it("does not throw when the opener was removed from the document", () => {
    const { h, opener, dialog } = scene();
    opener.focus();
    const handle = h.api.dialog.open(dialog);
    opener.remove();
    assert.doesNotThrow(
      () => handle.close(),
      "close() must survive an opener that was re-rendered away (best-effort focus)",
    );
  });

  it("respects opts.initialFocus as an element and as a selector string", () => {
    const byEl = scene();
    byEl.h.api.dialog.open(byEl.dialog, { initialFocus: byEl.input });
    assert.equal(
      byEl.h.document.activeElement,
      byEl.input,
      "opts.initialFocus (Element) must receive focus",
    );

    const bySel = scene();
    bySel.h.api.dialog.open(bySel.dialog, { initialFocus: "#dlgInput" });
    assert.equal(
      bySel.h.document.activeElement,
      bySel.input,
      "opts.initialFocus (selector string) must be resolved inside the dialog",
    );
  });

  it("falls back to focusing the dialog itself when it holds nothing focusable", () => {
    const h = loadA11y();
    h.make("div", { id: "appRoot" });
    const dialog = h.make("div", { id: "emptyDlg" });
    h.api.dialog.open(dialog);
    assert.equal(
      h.document.activeElement,
      dialog,
      "an empty dialog must still take focus so Tab starts inside it",
    );
    assert.equal(
      dialog.getAttribute("tabindex"),
      "-1",
      "the fallback must make the dialog programmatically focusable (tabindex=-1)",
    );
  });
});

describe("JobBoredA11y.dialog — Escape and close reasons", () => {
  it("closes the dialog on Escape and reports reason 'escape'", () => {
    const { h, dialog } = scene();
    const reasons = [];
    h.api.dialog.open(dialog, { onClose: (r) => reasons.push(r) });
    h.press("Escape");
    assert.deepEqual(
      reasons,
      ["escape"],
      "Escape must close the top dialog and report reason 'escape'",
    );
  });

  it("ignores non-Escape keys", () => {
    const { h, dialog, backdropSibling } = scene();
    h.api.dialog.open(dialog);
    h.press("Enter");
    assert.equal(
      backdropSibling.inert,
      true,
      "an unrelated keydown must not tear down the dialog",
    );
  });

  it("reports reason 'programmatic' for handle.close() with no argument", () => {
    const { h, dialog } = scene();
    const reasons = [];
    const handle = h.api.dialog.open(dialog, { onClose: (r) => reasons.push(r) });
    handle.close();
    assert.deepEqual(
      reasons,
      ["programmatic"],
      "handle.close() must default to reason 'programmatic'",
    );
  });

  it("is idempotent — a second close() does not re-run onClose or re-focus", () => {
    const { h, opener, dialog } = scene();
    opener.focus();
    const reasons = [];
    const handle = h.api.dialog.open(dialog, { onClose: (r) => reasons.push(r) });
    handle.close();
    const focusCalls = opener._focusCalls.length;
    handle.close();
    assert.equal(reasons.length, 1, "onClose must fire exactly once per dialog");
    assert.equal(
      opener._focusCalls.length,
      focusCalls,
      "a repeat close() must not re-steal focus from wherever the user went",
    );
  });

  it("removes its document keydown listener once the stack empties", () => {
    const { h, dialog } = scene();
    const handle = h.api.dialog.open(dialog);
    handle.close();
    const before = h.events.length;
    h.press("Escape");
    assert.equal(
      h.events.length,
      before + 1, // the keydown we just dispatched, and nothing else
      "no dialog events may fire from Escape after the stack drains (listener leak)",
    );
  });

  it("exposes the element on the handle", () => {
    const { h, dialog } = scene();
    const handle = h.api.dialog.open(dialog);
    assert.equal(handle.el, dialog, "handle.el must be the opened element");
  });
});

describe("JobBoredA11y.dialog — observability events", () => {
  it("emits jb:a11y:dialog:opened and :closed with depth and reason", () => {
    const { h, dialog } = scene();
    const handle = h.api.dialog.open(dialog);
    const opened = h.events.filter((e) => e.type === "jb:a11y:dialog:opened");
    assert.equal(opened.length, 1, "exactly one jb:a11y:dialog:opened per open");
    assert.equal(opened[0].detail.el, dialog, "opened detail.el must be the dialog");
    assert.equal(opened[0].detail.depth, 1, "first dialog opens at depth 1");

    handle.close("programmatic");
    const closed = h.events.filter((e) => e.type === "jb:a11y:dialog:closed");
    assert.equal(closed.length, 1, "exactly one jb:a11y:dialog:closed per close");
    assert.equal(
      closed[0].detail.reason,
      "programmatic",
      "closed detail.reason must carry the close reason",
    );
    assert.equal(
      closed[0].detail.depth,
      1,
      "closed detail.depth must report the depth the dialog occupied",
    );
  });

  it("dispatches on window as well as document", () => {
    const { h, dialog } = scene();
    const seen = [];
    h.window.addEventListener("jb:a11y:dialog:opened", (e) => seen.push(e.detail));
    h.api.dialog.open(dialog);
    assert.equal(
      seen.length,
      1,
      "AGENT_CONTRACT.md: every jb:* event family dispatches on BOTH window and " +
        "document — a window-only listener must still receive it",
    );
    assert.equal(seen[0].el, dialog, "the window copy must carry the same detail");
  });
});

describe("JobBoredA11y.drawer — dialog contract plus the detail-open body class", () => {
  it("adds detail-open on open and removes it on close", () => {
    const { h, dialog } = scene();
    const handle = h.api.drawer.open(dialog);
    assert.equal(
      h.document.body.classList.contains("detail-open"),
      true,
      "drawer.open must add the legacy 'detail-open' body class " +
        "(discovery-drawer.js:754 semantics)",
    );
    handle.close();
    assert.equal(
      h.document.body.classList.contains("detail-open"),
      false,
      "drawer close must remove 'detail-open' — a stuck class freezes page scroll",
    );
  });

  it("still inerts the background and restores focus like a dialog", () => {
    const { h, opener, backdropSibling, dialog } = scene();
    opener.focus();
    const handle = h.api.drawer.open(dialog);
    assert.equal(
      backdropSibling.inert,
      true,
      "drawer.open must inert the background — discovery-drawer.js never did (A11Y-01b)",
    );
    handle.close();
    assert.equal(
      h.document.activeElement,
      opener,
      "drawer close must restore focus — closeDiscoveryDrawer restores nothing today",
    );
  });
});

/* ============================================================
   The rest of the LOCKED API surface.

   dialog.confirm and tabs.init live in this file rather than in a seventh test
   file so the P0-F fence (six new test files) stays exact. Both are part of
   T0-SUBSTRATE.md §2 and other lanes code against them, so they need real
   behavioral coverage, not just an existence check.
   ============================================================ */

describe("JobBoredA11y.dialog.confirm — the built confirmation dialog", () => {
  it("resolves { confirmed: true } and the field values on Confirm", async () => {
    const h = loadA11y();
    h.make("div", { id: "appRoot" });
    const pending = h.api.dialog.confirm({
      title: "Mark as submitted?",
      body: "This writes the applied date to your sheet.",
      confirmLabel: "Mark submitted",
      fields: [{ id: "confirmationNumber", label: "Confirmation number" }],
    });

    const input = h.document.getElementById("confirmationNumber");
    assert.ok(input, "fields must be built via field.build with their given ids");
    input.value = "ABC-123";
    h.document.querySelector(".jb-a11y-dialog__btn--confirm").click();

    const result = await pending;
    assert.equal(result.confirmed, true, "Confirm must resolve confirmed: true");
    assert.equal(
      result.values.confirmationNumber,
      "ABC-123",
      "the typed value must come back keyed by the field id",
    );
  });

  it("resolves { confirmed: false } on Cancel without losing typed values", async () => {
    const h = loadA11y();
    h.make("div", { id: "appRoot" });
    const pending = h.api.dialog.confirm({
      title: "Mark as submitted?",
      fields: [{ id: "note", label: "Note" }],
    });
    h.document.getElementById("note").value = "half typed";
    h.document.querySelector(".jb-a11y-dialog__btn--cancel").click();

    const result = await pending;
    assert.equal(result.confirmed, false, "Cancel must resolve confirmed: false");
    assert.equal(
      result.values.note,
      "half typed",
      "a cancel must still report what the user had entered — silently dropping " +
        "it makes the caller unable to restore the draft",
    );
  });

  it("treats Escape as a cancel, never as a confirm", async () => {
    const h = loadA11y();
    h.make("div", { id: "appRoot" });
    const pending = h.api.dialog.confirm({ title: "Mark as submitted?" });
    h.press("Escape");
    const result = await pending;
    assert.equal(
      result.confirmed,
      false,
      "an Escape must never be read as consent to a write (P0-D's applied gate)",
    );
  });

  it("removes its own markup from the document after settling", async () => {
    const h = loadA11y();
    const page = h.make("div", { id: "appRoot" });
    const pending = h.api.dialog.confirm({ title: "Sure?" });
    assert.ok(
      h.document.querySelector(".jb-a11y-dialog--confirm"),
      "precondition: the confirm dialog is mounted",
    );
    h.document.querySelector(".jb-a11y-dialog__btn--cancel").click();
    await pending;
    assert.equal(
      h.document.querySelector(".jb-a11y-dialog--confirm"),
      null,
      "a built dialog must clean up after itself, or repeat opens stack corpses",
    );
    assert.equal(
      page.inert,
      false,
      "and the page must come back to life",
    );
  });

  it("uses the default labels and names itself by its title", async () => {
    const h = loadA11y();
    h.make("div", { id: "appRoot" });
    const pending = h.api.dialog.confirm({ title: "Sure?" });
    const root = h.document.querySelector(".jb-a11y-dialog--confirm");
    assert.equal(
      h.document.querySelector(".jb-a11y-dialog__btn--confirm").textContent,
      "Confirm",
      "confirmLabel must default to 'Confirm'",
    );
    assert.equal(
      h.document.querySelector(".jb-a11y-dialog__btn--cancel").textContent,
      "Cancel",
      "cancelLabel must default to 'Cancel'",
    );
    const title = h.document.querySelector(".jb-a11y-dialog__title");
    assert.equal(
      root.getAttribute("aria-labelledby"),
      title.id,
      "the dialog must be named by its own title element",
    );
    h.document.querySelector(".jb-a11y-dialog__btn--cancel").click();
    await pending;
  });
});

describe("JobBoredA11y.tabs — WAI-ARIA tablist (generalized settings-tabs.js)", () => {
  /** Two tabs with their buttons and panels, in a tablist root. */
  function tabScene() {
    const h = loadA11y();
    const root = h.make("div", { id: "tabRoot" });
    const list = h.make("div", { role: "tablist" }, root);
    const btnA = h.make("button", { id: "tabBtnA" }, list);
    const btnB = h.make("button", { id: "tabBtnB" }, list);
    const panelA = h.make("div", { id: "tabPanelA" }, root);
    const panelB = h.make("div", { id: "tabPanelB" }, root);
    const changes = [];
    const api = h.api.tabs.init(root, {
      tabs: [
        { id: "a", buttonId: "tabBtnA", panelId: "tabPanelA" },
        { id: "b", buttonId: "tabBtnB", panelId: "tabPanelB" },
      ],
      onChange: (id) => changes.push(id),
    });
    return { h, api, btnA, btnB, panelA, panelB, changes };
  }

  it("activates the first tab silently and wires the ARIA relationships", () => {
    const { h, api, btnA, btnB, panelA, panelB } = tabScene();
    assert.equal(api.getActive(), "a", "the first tab must be active on init");
    assert.equal(btnA.getAttribute("role"), "tab", "buttons must be role=tab");
    assert.equal(btnA.getAttribute("aria-selected"), "true");
    assert.equal(btnB.getAttribute("aria-selected"), "false");
    assert.equal(btnA.getAttribute("tabindex"), "0", "roving tabindex: active is 0");
    assert.equal(btnB.getAttribute("tabindex"), "-1", "roving tabindex: inactive is -1");
    assert.equal(panelA.hidden, false, "the active panel is shown");
    assert.equal(panelB.hidden, true, "inactive panels are hidden");
    assert.equal(panelA.getAttribute("role"), "tabpanel");
    assert.equal(
      panelA.getAttribute("aria-labelledby"),
      "tabBtnA",
      "each panel must be named by its tab button",
    );
    assert.equal(
      h.document.activeElement,
      h.document.body,
      "init must NOT steal focus — settings-modal.js calls this while opening",
    );
  });

  it("switches on click and on Arrow/Home/End, moving focus with the tab", () => {
    const { h, btnA, btnB, changes } = tabScene();
    btnB.click();
    assert.equal(btnB.getAttribute("aria-selected"), "true", "click activates");
    assert.equal(h.document.activeElement, btnB, "the newly active tab takes focus");

    h.pressOn(btnB, "ArrowRight");
    assert.equal(
      btnA.getAttribute("aria-selected"),
      "true",
      "ArrowRight from the last tab wraps to the first",
    );
    h.pressOn(btnA, "End");
    assert.equal(btnB.getAttribute("aria-selected"), "true", "End jumps to the last");
    h.pressOn(btnB, "Home");
    assert.equal(btnA.getAttribute("aria-selected"), "true", "Home jumps to the first");

    assert.deepEqual(
      changes,
      ["a", "b", "a", "b", "a"],
      "onChange must fire for the initial activation and every switch",
    );
  });

  it("ignores an unknown id and stops responding after destroy()", () => {
    const { api, btnA, btnB } = tabScene();
    api.activate("nope");
    assert.equal(api.getActive(), "a", "an unknown tab id must be a no-op");

    api.destroy();
    btnB.click();
    assert.equal(
      btnA.getAttribute("aria-selected"),
      "true",
      "destroy() must unbind the click handlers (re-init would double-fire)",
    );
  });
});
