/**
 * tests/holes-board-modal-dialogs.test.mjs
 *
 * HOLES BOARD B5 — Settings and the scraper setup guide hand their focus trap
 * to the shared dialog primitive (window.JobBoredA11y.dialog) instead of each
 * keeping a private inert list, a private focus restore and a private
 * "lift over Settings" patch.
 *
 * WHY behaviour, all in one vm context: the bugs this move fixes only show up
 * when the two modals and the primitive run together. The real jb-a11y.js,
 * settings-modal.js and scraper-ats-config.js execute against the hand-rolled
 * DOM in tests/fixtures/jb-a11y-dom.mjs; the app host is a Proxy whose every
 * call is a no-op, which is all the open/close paths need.
 *
 * WHY this file models the Escape phases itself: the fixture's dispatch
 * ignores the capture flag and has no stopImmediatePropagation, and the whole
 * Escape contract lives in those two details. Settings and the guide listen
 * in the CAPTURE phase and stop the press, so neither jb-a11y.js's
 * bubble-phase Escape (which cannot be vetoed, and would close Settings
 * without the unsaved-changes question) nor materials-feature.js's raw
 * closer (~669-700, stood in for here by a recorder registered at init, as
 * the real one is) ever sees it. A real keydown targets the focused element,
 * so document sees it twice: capture on the way down, bubble on the way up.
 * Element-level keydown listeners play no part in Escape and are not modelled.
 *
 * Mutation checks: put the guide's inert juggling back (its own settings.inert,
 * no shared stack) and "a node added after Settings opened" and "Settings
 * closing underneath the guide" go red; move Settings' Escape handler to the
 * bubble phase and the unsaved-changes test goes red because the primitive's
 * Escape releases the page; drop the re-open guard and the double-open test
 * leaves the page inert after Settings closes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

import { createDom, loadA11y, repoRoot } from "./fixtures/jb-a11y-dom.mjs";

const settingsModalJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");
const scraperAtsJs = readFileSync(join(repoRoot, "scraper-ats-config.js"), "utf8");

/**
 * Route document keydown listeners through a two-phase model and return a
 * press(key) that runs capture listeners, then bubble listeners, honouring
 * stopPropagation and stopImmediatePropagation. Must be installed before any
 * listener registers; other event types keep the fixture's own dispatch.
 */
function modelDocumentKeydownPhases(doc) {
  const fixtureAdd = doc.addEventListener;
  const fixtureRemove = doc.removeEventListener;
  const keydown = [];
  const isCapture = (opts) => opts === true || Boolean(opts && opts.capture);
  doc.addEventListener = function (type, fn, opts) {
    if (type !== "keydown") return fixtureAdd.call(this, type, fn, opts);
    const capture = isCapture(opts);
    if (keydown.some((l) => l.fn === fn && l.capture === capture)) return;
    keydown.push({ fn, capture });
  };
  doc.removeEventListener = function (type, fn, opts) {
    if (type !== "keydown") return fixtureRemove.call(this, type, fn, opts);
    const capture = isCapture(opts);
    const i = keydown.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i >= 0) keydown.splice(i, 1);
  };
  return function press(key) {
    const evt = {
      type: "keydown",
      key,
      defaultPrevented: false,
      stopped: false,
      stoppedNow: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
        this.stoppedNow = true;
      },
    };
    for (const capture of [true, false]) {
      if (evt.stopped) break;
      for (const l of keydown.filter((x) => x.capture === capture)) {
        if (!keydown.includes(l)) continue; // removed mid-dispatch: skipped
        l.fn.call(doc, evt);
        if (evt.stoppedNow) break;
      }
    }
    return evt;
  };
}

/**
 * The page, Settings (#settingsModal) and the guide (#scraperSetupModal) as
 * body siblings, the way index.html includes the two partials.
 */
function scene({ withA11y = true } = {}) {
  let h;
  if (withA11y) {
    h = loadA11y();
  } else {
    h = createDom();
    vm.createContext(h.context);
  }
  const press = modelDocumentKeydownPhases(h.document);
  const rawCloserSaw = [];
  h.document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") rawCloserSaw.push(e.key);
  });

  const page = h.make("div", { id: "appRoot" });
  const gear = h.make("button", { id: "settingsBtn" }, page);

  const settings = h.make("div", { id: "settingsModal", role: "dialog", "aria-modal": "true" });
  settings.style.display = "none";
  const settingsClose = h.make("button", { id: "settingsModalClose" }, settings);
  const sheetField = h.make("input", { id: "settingsSheetId" }, settings);
  const openGuideBtn = h.make("button", { id: "openScraperSetupFromSettings" }, settings);
  const clearBar = h.make("div", { id: "settingsClearConfirmBar" }, settings);
  clearBar.hidden = true;

  const guide = h.make("div", { id: "scraperSetupModal", role: "dialog", "aria-modal": "true" });
  guide.style.display = "none";
  const guideX = h.make("button", { id: "scraperSetupModalClose" }, guide);
  h.make("div", { id: "scraperTestResult" }, guide);
  const done = h.make("button", { id: "scraperSetupDoneBtn" }, guide);
  // Done sits at the foot of a long, scrolling guide (partials/scraper-setup-modal.html).
  const doneScrolls = [];
  done.scrollIntoView = (opts) => doneScrolls.push(opts);

  // The fixture's selector engine has no [attr^=value]; the unsaved-changes
  // snapshot (readSettingsFormState) asks for 'input[id^="settings"], ...'.
  const fixtureQsa = settings.querySelectorAll;
  settings.querySelectorAll = function (sel) {
    if (!/\[id\^=/.test(sel)) return fixtureQsa.call(this, sel);
    const out = [];
    (function visit(node) {
      for (const child of node.children) {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(child.tagName) && child.id.startsWith("settings")) {
          out.push(child);
        }
        visit(child);
      }
    })(this);
    return out;
  };

  h.window.JobBoredApp = { core: { host: new Proxy({}, { get: () => () => false }) } };
  h.context.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  h.context.AbortController = AbortController;
  h.context.location = { hostname: "127.0.0.1" };
  vm.runInContext(settingsModalJs, h.context, { filename: "settings-modal.js" });
  vm.runInContext(scraperAtsJs, h.context, { filename: "scraper-ats-config.js" });
  const app = h.window.JobBoredApp;
  app.scraperAts.initScraperSetupGuide();

  /** Open Settings the way the header gear does, and let any frame run. */
  async function openSettingsFrom(opener) {
    opener.focus();
    await app.settings.openCommandCenterSettingsModal();
    h.flushRaf();
  }

  /** Click the "setup guide" control inside Settings, as a user would. */
  function openGuideFromSettings() {
    openGuideBtn.focus();
    openGuideBtn.click();
    h.flushRaf();
  }

  const openedEvents = () =>
    h.events.filter((e) => e.type === "jb:a11y:dialog:opened").map((e) => e.detail);

  return {
    h,
    app,
    press,
    rawCloserSaw,
    page,
    gear,
    settings,
    settingsClose,
    sheetField,
    openGuideBtn,
    clearBar,
    guide,
    guideX,
    done,
    doneScrolls,
    openSettingsFrom,
    openGuideFromSettings,
    openedEvents,
  };
}

const isOpen = (el) => el.style.display === "flex";
// Compare ids, not nodes: a failing deepEqual on a fake DOM node prints the
// whole document graph.
const focusedId = (s) => (s.h.document.activeElement ? s.h.document.activeElement.id : null);

describe("Settings on the shared dialog stack (settings-modal.js)", () => {
  it("opens through JobBoredA11y.dialog: page contained, focus on the close button", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);

    assert.equal(isOpen(s.settings), true, "precondition: Settings is showing");
    assert.deepEqual(
      s.openedEvents().map((d) => [d.el.id, d.depth]),
      [["settingsModal", 1]],
      "Settings must open through the shared primitive (one owner for modality), " +
        "not a private inert list the next dialog cannot see",
    );
    assert.equal(s.page.inert, true, "the page behind Settings must be inert");
    assert.equal(s.settings.inert, false, "Settings itself must stay live");
    assert.equal(
      focusedId(s),
      s.settingsClose.id,
      "focus must land on #settingsModalClose, the discoverable way out",
    );
  });

  it("closing hands focus back to the control that opened it and frees the page", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    s.app.settings.closeCommandCenterSettingsModal();

    assert.equal(isOpen(s.settings), false);
    assert.equal(s.page.inert, false, "a leaked inert leaves the whole app dead");
    assert.equal(focusedId(s), s.gear.id, "focus must return to the gear");
  });

  it("Escape with unsaved edits asks first; cancelling keeps Settings open and contained", async () => {
    const s = scene();
    const asked = [];
    let answer = false;
    s.h.window.confirm = (message) => {
      asked.push(message);
      return answer;
    };
    await s.openSettingsFrom(s.gear);
    s.sheetField.value = "an unsaved edit";

    s.press("Escape");
    assert.equal(asked.length, 1, "Escape must ask before discarding edits");
    assert.match(asked[0], /Discard/);
    assert.equal(isOpen(s.settings), true, "a cancelled discard keeps Settings open");
    assert.equal(
      s.page.inert,
      true,
      "and still contained: the primitive's own Escape (which cannot be vetoed) " +
        "must never see the press, or it releases the page under an open Settings",
    );
    assert.deepEqual(s.rawCloserSaw, [], "materials-feature.js must not see it either");

    answer = true;
    s.press("Escape");
    assert.equal(isOpen(s.settings), false, "a confirmed discard closes Settings");
    assert.equal(s.page.inert, false);
    assert.equal(focusedId(s), s.gear.id);
  });

  it("Escape with the clear-settings bar showing only hides the bar", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    s.clearBar.hidden = false;

    s.press("Escape");
    assert.equal(s.clearBar.hidden, true, "the first Escape backs out of the clear bar");
    assert.equal(isOpen(s.settings), true, "Settings stays open behind it");
    assert.equal(s.page.inert, true);
    assert.deepEqual(s.rawCloserSaw, []);
  });

  it("re-opening Settings while it is open does not stack a second entry", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    await s.app.settings.openCommandCenterSettingsModal({ tab: "ai" });
    s.app.settings.closeCommandCenterSettingsModal();

    assert.equal(
      s.page.inert,
      false,
      "one close must free the page — a second stack entry would keep it inert forever",
    );
    assert.equal(focusedId(s), s.gear.id, "focus returns to the first opener");
  });

  it("without jb-a11y.js it still opens on the close button and closes cleanly", async () => {
    const s = scene({ withA11y: false });
    await s.openSettingsFrom(s.gear);
    assert.equal(isOpen(s.settings), true);
    assert.equal(focusedId(s), s.settingsClose.id);

    s.app.settings.closeCommandCenterSettingsModal();
    assert.equal(isOpen(s.settings), false);
  });
});

describe("the scraper setup guide stacked over Settings (scraper-ats-config.js)", () => {
  it("opening it from Settings inerts Settings and focuses Done", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    s.openGuideFromSettings();

    assert.equal(isOpen(s.guide), true, "precondition: the guide is showing");
    assert.deepEqual(
      s.openedEvents().map((d) => [d.el.id, d.depth]),
      [
        ["settingsModal", 1],
        ["scraperSetupModal", 2],
      ],
      "the guide must join the shared stack above Settings rather than patch " +
        "Settings' inert by hand",
    );
    assert.equal(s.settings.inert, true, "Settings must be inert under the guide");
    assert.equal(s.guide.inert, false, "the guide must be live — UX01 SS-03 dead buttons");
    assert.equal(s.page.inert, true, "the page stays inert");
    assert.equal(focusedId(s), s.done.id, "focus must land on Done");
    assert.equal(
      s.doneScrolls.length,
      1,
      "Done must be scrolled into view: the primitive focuses with preventScroll, " +
        "and Done sits below the fold, so keyboard focus would be invisible",
    );
    assert.equal(s.guide.style.zIndex, "2001", "the guide still paints above Settings");
  });

  it("covers a node added after Settings opened", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    const toastHost = s.h.make("div", { id: "toastContainer" });
    s.openGuideFromSettings();

    assert.equal(
      toastHost.inert,
      true,
      "opening the guide must re-derive the background from the top dialog; " +
        "a hand-set settings.inert never covers nodes Settings' open predates",
    );
  });

  it("Escape closes only the guide; focus returns into Settings, which stays open and live", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    s.openGuideFromSettings();

    s.press("Escape");
    assert.equal(isOpen(s.guide), false, "Escape closes the guide");
    assert.equal(isOpen(s.settings), true, "but not Settings behind it");
    assert.equal(s.settings.inert, false, "Settings must be usable again");
    assert.equal(s.page.inert, true, "the page stays inert while Settings is open");
    assert.equal(
      focusedId(s),
      s.openGuideBtn.id,
      "focus returns to the Settings control that opened the guide",
    );
    assert.deepEqual(s.rawCloserSaw, [], "materials-feature.js never sees that press");

    s.press("Escape");
    assert.equal(isOpen(s.settings), false, "the next Escape belongs to Settings");
    assert.equal(s.page.inert, false);
    assert.equal(focusedId(s), s.gear.id);
    assert.deepEqual(s.rawCloserSaw, []);
  });

  it("Done, the X and a stray programmatic close each close it once and leave Settings in place", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);

    s.openGuideFromSettings();
    s.done.click();
    assert.equal(isOpen(s.guide), false, "Done closes the guide");
    assert.equal(focusedId(s), s.openGuideBtn.id);

    s.app.scraperAts.closeScraperSetupModal();
    assert.equal(isOpen(s.settings), true, "a second close must not touch Settings");
    assert.equal(s.settings.inert, false);
    assert.equal(s.page.inert, true, "nor release the page under it");
    assert.equal(focusedId(s), s.openGuideBtn.id, "nor move focus");

    s.openGuideFromSettings();
    s.guideX.click();
    assert.equal(isOpen(s.guide), false, "the X closes the guide");
    assert.equal(s.settings.inert, false);
    assert.equal(s.guide.style.zIndex, "", "the lift over Settings is undone");

    s.press("Escape");
    assert.equal(isOpen(s.settings), false, "Settings is still the dialog Escape reaches");
    assert.equal(s.page.inert, false);
  });

  it("Settings closing underneath it keeps the page contained and focus in the guide", async () => {
    const s = scene();
    await s.openSettingsFrom(s.gear);
    s.openGuideFromSettings();

    // e.g. a Settings save that resolves after the user opened the guide.
    s.app.settings.closeCommandCenterSettingsModal();
    assert.equal(isOpen(s.guide), true, "precondition: the guide is still showing");
    assert.equal(s.page.inert, true, "the guide is still modal, so the page stays inert");
    assert.equal(
      focusedId(s),
      s.done.id,
      "closing the dialog underneath must not yank focus out of the guide",
    );

    s.done.click();
    assert.equal(s.page.inert, false, "the page is live once the last dialog closes");
  });

  it("without jb-a11y.js it still opens on Done and Escape still closes only the guide", async () => {
    const s = scene({ withA11y: false });
    await s.openSettingsFrom(s.gear);
    s.openGuideFromSettings();
    assert.equal(isOpen(s.guide), true);
    assert.equal(focusedId(s), s.done.id);

    s.press("Escape");
    assert.equal(isOpen(s.guide), false);
    assert.equal(isOpen(s.settings), true);
    assert.deepEqual(s.rawCloserSaw, []);
  });
});
