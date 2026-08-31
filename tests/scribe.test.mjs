import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_LEGACY_BUTTONS,
  FakeEvent,
  loadScribe,
} from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// Behavioral coverage for scribe.js — the v2 ATS + cover-letter
// workspace. scribe.js is a classic-global IIFE that renders into
// [data-region="scribe"], bridges its export actions to the LEGACY
// modal controls by id (#resumeGenerate*), keeps #resumeGenerateOutput
// the source of truth for body text, and debounces editor keystrokes
// via window.setTimeout before syncing back.
//
// Harness: tests/fixtures/scribe/scribe-dom.mjs — the hand-rolled fake
// DOM + fake clock this file used to carry inline, now shared with the
// four SCRIBE-0x probe files (there is no jsdom in this repo, see
// tests/kanban-card-attrs.test.mjs).
//
// Scoring lives in scribe-score-adapter.js (tests/scribe-real-score),
// persistence in scribe-state.js (tests/scribe-state-autosave), and
// refine/export truth in tests/scribe-refine-async-truth +
// tests/scribe-stale-export. This file covers the workspace shell:
// boot gating, the legacy text bridge, the debounce, and the smoke
// harness.
// ============================================================

// ============================================================
// Boot gating + public API
// ============================================================

describe("scribe — boot gating + frozen public API", () => {
  it("leaves the legacy UI untouched when the page is not in jb-v2 mode (the v2 workspace must never leak into the classic dashboard)", () => {
    const env = loadScribe({ v2: false });
    assert.equal(env.region.childNodes.length, 0, "region must not be rendered into");
    assert.equal(env.byId("scribeEditor"), null, "no v2 editor in legacy mode");
  });

  it("renders the full split-pane workspace once jb-v2 is active (editor, scorecard, refine strip, tabs)", () => {
    const env = loadScribe();
    assert.ok(env.byId("scribeEditor"), "editor pane must exist");
    assert.ok(env.q("#scribeFitRing"), "fit ring must exist");
    assert.equal(
      env.qa(".scribe-axis").length,
      0,
      "no axis renders before a real score arrives — scribe owns no scoring heuristic",
    );
    assert.equal(
      env.byId("scribeScorecard").getAttribute("data-score-state"),
      "absent",
      "with no score adapter mounted the card says so rather than inventing numbers",
    );
    assert.ok(env.byId("scribeRefineInput"), "refine strip must exist");
    assert.equal(env.qa("[data-scribe-tab]").length, 2, "cover letter + resume tabs");
    assert.equal(env.q("[data-scribe-status]").textContent, "idle", "status pip starts idle");
  });

  it("an existing legacy draft is prefilled into the editor at boot (the textarea is the source of truth, not the new pane)", () => {
    const env = loadScribe({ legacyText: "Hello there." });
    const editor = env.byId("scribeEditor");
    assert.equal(editor.textContent, "Hello there.");
    assert.equal(editor.dataset.empty, "false");
    assert.equal(env.q("[data-scribe-counter]").textContent, "2 words");
  });

  it("boot is a safe no-op when the scribe region is absent — the API still loads and its calls never throw", () => {
    const env = loadScribe({ withRegion: false });
    assert.ok(env.JB, "JB_SCRIBE must still be exposed");
    env.JB.flushEditor();
    env.JB.syncEditorIntoLegacy();
    env.JB.setEditorFromLegacy();
  });

  it("the public JB_SCRIBE handle is frozen so host code cannot monkey-patch the bridge out from under the legacy pipeline", () => {
    const env = loadScribe();
    assert.ok(Object.isFrozen(env.JB));
    for (const key of ["smoke", "flushEditor", "syncEditorIntoLegacy", "setEditorFromLegacy"]) {
      assert.equal(typeof env.JB[key], "function", `JB_SCRIBE.${key} must be a function`);
    }
    assert.equal(
      env.JB.rescore,
      undefined,
      "the demo scorer's entry point is gone — scoring goes through the jb:ats:state adapter",
    );
    assert.throws(() => {
      env.JB.flushEditor = () => {};
    }, TypeError);
  });

  it("when the script loads before the DOM is ready it waits for DOMContentLoaded instead of rendering into a half-built page", () => {
    const env = loadScribe({ readyState: "loading" });
    assert.equal(env.byId("scribeEditor"), null, "must not render before DOMContentLoaded");
    const ready = env.docListeners.find((l) => l.type === "DOMContentLoaded");
    assert.ok(ready, "must register a DOMContentLoaded listener");
    ready.fn();
    assert.ok(env.byId("scribeEditor"), "renders once the DOM is ready");
  });
});

// ============================================================
// Legacy textarea bridge — text conversion both directions
// ============================================================

describe("scribe — legacy textarea bridge (lossless round-trip + escaping)", () => {
  it("legacy plain text becomes paragraph blocks with stable p-N anchors (the editor keeps addressable paragraphs across a round-trip)", () => {
    const env = loadScribe();
    env.els.output.value = "One.\n\nTwo.\nthree";
    env.JB.setEditorFromLegacy();
    const editor = env.byId("scribeEditor");
    const ps = editor.querySelectorAll("p");
    assert.equal(ps.length, 2, "double newline splits paragraphs");
    assert.equal(ps[0].getAttribute("data-scribe-anchor"), "p-0");
    assert.equal(ps[1].getAttribute("data-scribe-anchor"), "p-1");
    assert.equal(ps[1].querySelectorAll("br").length, 1, "single newline becomes a <br>");
  });

  it("markup in a draft is escaped, never executed — a job description containing HTML must not inject elements into the editor DOM", () => {
    const env = loadScribe();
    const hostile = '<script>alert("x")</script> & <b>bold</b>';
    env.els.output.value = hostile;
    env.JB.setEditorFromLegacy();
    const editor = env.byId("scribeEditor");
    assert.equal(editor.querySelector("script"), null, "no script element may be created");
    assert.equal(editor.querySelector("b"), null, "no markup element may be created");
    assert.equal(
      editor.textContent,
      hostile,
      "the draft text must survive verbatim as text",
    );
  });

  it("editor → legacy sync is idempotent: an unchanged draft writes nothing and fires NO input event (each event triggers a full ATS rescore)", () => {
    const env = loadScribe();
    env.els.output.value = "One.\n\nTwo.\nthree";
    env.JB.setEditorFromLegacy();
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));
    env.JB.syncEditorIntoLegacy();
    assert.equal(env.els.output.value, "One.\n\nTwo.\nthree", "round-trip must be lossless");
    assert.equal(taEvents.length, 0, "no spurious input event when nothing changed");
  });

  it("a real editor edit lands in the legacy textarea WITH a bubbling input event so the legacy ATS pipeline reruns", () => {
    const env = loadScribe({ legacyText: "Old body" });
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", (e) => taEvents.push(e));
    editor.textContent = "Brand new body";
    env.JB.syncEditorIntoLegacy();
    assert.equal(env.els.output.value, "Brand new body");
    assert.equal(taEvents.length, 1, "exactly one input event per real change");
    assert.equal(taEvents[0].bubbles, true, "must bubble for delegated listeners");
    assert.equal(env.q("[data-scribe-counter]").textContent, "3 words");
  });

  it("the word counter pluralizes honestly (1 word vs N words) so the strip never reads like filler", () => {
    const env = loadScribe();
    env.els.output.value = "Word";
    env.JB.setEditorFromLegacy();
    assert.equal(env.q("[data-scribe-counter]").textContent, "1 word");
    env.els.output.value = "";
    env.JB.setEditorFromLegacy();
    assert.equal(env.q("[data-scribe-counter]").textContent, "0 words");
    assert.equal(env.byId("scribeEditor").dataset.empty, "true", "empty flag restores the placeholder");
  });
});

// ============================================================
// Debounced editor → legacy sync
// ============================================================

describe("scribe — debounced keystroke sync (one legacy write per idle pause, not per keystroke)", () => {
  it("a keystroke does NOT hit the legacy textarea until the idle debounce elapses — then exactly one sync + rescore fires", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));

    editor.textContent = "Hello world";
    env.input(editor);

    assert.equal(env.els.output.value, "", "legacy textarea untouched before the idle window");
    assert.equal(env.q("[data-scribe-status]").textContent, "typing…");
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "busy");
    assert.equal(env.timers.count(), 1, "one pending debounce task");

    env.timers.flush();
    assert.equal(env.els.output.value, "Hello world", "sync lands after the idle window");
    assert.equal(taEvents.length, 1, "exactly one input event reaches the ATS pipeline");
    assert.equal(
      env.q("[data-scribe-status]").textContent,
      "synced",
      "the idle pause syncs the text — it does not claim the draft was scored",
    );
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "ok");
  });

  it("rapid consecutive keystrokes collapse into ONE pending sync (each keystroke resets the timer instead of stacking rescores)", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));

    editor.textContent = "Hello";
    env.input(editor);
    editor.textContent = "Hello brave world";
    env.input(editor);

    assert.equal(env.timers.count(), 1, "the second keystroke must replace the first timer, not add one");
    env.timers.flush();
    assert.equal(env.els.output.value, "Hello brave world", "only the final text syncs");
    assert.equal(taEvents.length, 1, "one sync for the whole burst");
  });

  it("the empty-placeholder flag tracks every keystroke immediately (it cannot wait for the debounce or the placeholder flickers late)", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    editor.textContent = "x";
    env.input(editor);
    assert.equal(editor.dataset.empty, "false");
    editor.textContent = "";
    env.input(editor);
    assert.equal(editor.dataset.empty, "true", "flag flips before any timer runs");
  });
});

// ============================================================
// Toolbar actions — every control proxies to the legacy modal
// ============================================================

describe("scribe — toolbar actions bridge to the legacy modal controls", () => {
  it("Print / PDF triggers the legacy #resumeGeneratePrint flow (no parallel print implementation)", () => {
    const env = loadScribe();
    env.byId("scribePrintBtn").click();
    assert.deepEqual(env.legacyClicks, ["resumeGeneratePrint"]);
    assert.equal(env.printCalls.length, 0, "window.print is only the fallback");
  });

  it("Print / PDF falls back to window.print() when the legacy button is missing — the user still gets a PDF path", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGeneratePrint") });
    env.byId("scribePrintBtn").click();
    assert.equal(env.printCalls.length, 1);
    assert.deepEqual(env.legacyClicks, []);
  });

  it("Copy syncs the editor into the legacy textarea BEFORE clicking legacy copy — otherwise the user copies a stale draft", () => {
    const env = loadScribe({ legacyText: "Original" });
    const editor = env.byId("scribeEditor");
    let valueAtCopyClick = null;
    env.els.resumeGenerateCopy.addEventListener("click", () => {
      valueAtCopyClick = env.els.output.value;
    });
    editor.textContent = "Edited body";
    env.byId("scribeCopyBtn").click();
    assert.equal(valueAtCopyClick, "Edited body", "legacy copy must see the freshest text");
    assert.ok(env.legacyClicks.includes("resumeGenerateCopy"));
  });

  it("Copy falls back to the clipboard API with the editor's plain text when the legacy button is gone", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateCopy") });
    env.byId("scribeEditor").textContent = "Plain copy text";
    env.byId("scribeCopyBtn").click();
    assert.deepEqual(env.clipboardWrites, ["Plain copy text"]);
  });

  it("Done clicks legacy Done and does NOT also fire Close (double-dispatch would close the modal twice)", () => {
    const env = loadScribe();
    env.byId("scribeDoneBtn").click();
    assert.ok(env.legacyClicks.includes("resumeGenerateDone"));
    assert.ok(!env.legacyClicks.includes("resumeGenerateClose"), "Close is only the fallback");
  });

  it("Done falls back to legacy Close when Done is missing, so the user is never trapped in the workspace", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateDone") });
    env.byId("scribeDoneBtn").click();
    assert.ok(env.legacyClicks.includes("resumeGenerateClose"));
  });

  // Refine no longer proxies a legacy click and no longer guesses completion
  // with a 350ms timer: it awaits JobBoredApp.resumeGeneration
  // .refineLastResumeGeneration(). Its full behavior (pending / resolved /
  // rejected / no-change / API-absent) is covered by
  // tests/scribe-refine-async-truth.test.mjs.

  it("the Appearance select mirrors the legacy theme options and pushes changes back with a change event (the legacy renderer listens for it)", () => {
    const env = loadScribe({ withThemeSelect: true });
    const sel = env.byId("scribeAppearance");
    assert.equal(sel.querySelectorAll("option").length, 2, "options copied from the legacy select");
    assert.equal(sel.value, "mono", "current legacy theme preselected");
    const themeEvents = [];
    env.els.theme.addEventListener("change", () => themeEvents.push(1));
    sel.value = "classic";
    sel.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    assert.equal(env.els.theme.value, "classic", "theme choice must reach the legacy select");
    assert.equal(themeEvents.length, 1, "legacy change listeners must re-render the preview");
  });
});

// ============================================================
// Tabs + refine chips
// ============================================================

describe("scribe — tabs and refine chips", () => {
  it("switching to the Resume tab flips aria-selected, retitles the editor, and re-dispatches through the legacy draft-tab switch", () => {
    const env = loadScribe({ withDraftTabs: true });
    const coverTab = env.q('[data-scribe-tab="cover_letter"]');
    const resumeTab = env.q('[data-scribe-tab="resume_update"]');

    resumeTab.click();
    assert.equal(resumeTab.getAttribute("aria-selected"), "true");
    assert.equal(coverTab.getAttribute("aria-selected"), "false");
    assert.equal(env.q("[data-scribe-kicker]").textContent, "Resume draft");
    assert.ok(env.legacyClicks.includes("draft-tab:resume_update"), "legacy panel must flip too");

    coverTab.click();
    assert.equal(coverTab.getAttribute("aria-selected"), "true");
    assert.equal(resumeTab.getAttribute("aria-selected"), "false");
    assert.equal(env.q("[data-scribe-kicker]").textContent, "Cover letter draft");
    assert.ok(env.legacyClicks.includes("draft-tab:cover_letter"));
  });

  it("quick-refine chips ACCUMULATE instructions with '; ' (a second chip must not erase the first) and refocus the input", () => {
    const env = loadScribe();
    const chips = env.qa("[data-scribe-chip]");
    const refineInput = env.byId("scribeRefineInput");
    chips[0].click();
    assert.equal(refineInput.value, "more specific");
    chips[1].click();
    assert.equal(refineInput.value, "more specific; cut to 250 words");
    assert.ok(refineInput._focusCalls >= 2, "input is refocused so the user can keep typing");
  });
});

// ============================================================
// External regeneration mirror + echo suppression
// ============================================================

describe("scribe — legacy regeneration mirror (echo-loop suppression)", () => {
  it("a fresh legacy generation (textarea input NOT caused by the editor) is mirrored into the editor", () => {
    const env = loadScribe();
    env.els.output.value = "Para one.\n\nPara two.";
    env.input(env.els.output);
    const editor = env.byId("scribeEditor");
    assert.equal(editor.querySelectorAll("p").length, 2, "regenerated body replaces the editor content");
    assert.equal(editor.dataset.empty, "false");
    assert.equal(env.q("[data-scribe-counter]").textContent, "4 words");
  });

  it("the editor's own debounced write-back must NOT echo into the editor and clobber in-flight typing", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    editor.textContent = "User typing here";
    env.input(editor); // marks the edit as ours (lastEditAt = now)
    env.els.output.value = "STALE ECHO";
    env.input(env.els.output); // the echo arrives within the debounce window
    assert.equal(
      editor.textContent,
      "User typing here",
      "an input within the debounce window of our own edit must never overwrite the editor",
    );
  });
});

// ============================================================
// Smoke harness gating
// ============================================================


/** Refine is an awaited API call now, so the smoke probe needs it present. */
function smokeApp() {
  return {
    resumeGeneration: {
      getLastResumeGenerationSession: () => ({
        feature: "cover_letter",
        job: { title: "Staff Platform Engineer", company: "Northwind" },
      }),
      refineLastResumeGeneration: () => Promise.resolve(),
    },
  };
}

describe("scribe — smoke harness is URL-gated, honest, and inert in production", () => {
  it("a normal page load runs NO smoke: no prototype monkey-patch, no console output, no results global", () => {
    const env = loadScribe();
    env.timers.flush();
    assert.equal(env.window.__JB_SCRIBE_SMOKE_RESULTS__, undefined);
    assert.equal(env.window.__JB_SCRIBE_HOOK__, undefined, "HTMLElement.prototype.click must stay unpatched");
    assert.deepEqual(env.consoleLines, [], "no console noise in normal sessions");
  });

  it("?jb-v2-test=scribe drives all four toolbar buttons through the legacy bridge and reports a PASS block", () => {
    const env = loadScribe({ search: "?jb-v2-test=scribe", jobBoredApp: smokeApp() });
    env.timers.flush(); // the deferred runSmoke tick
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    assert.ok(Array.isArray(results), "smoke must publish its results");
    assert.equal(results.length, 4, "print, copy, done, refine are all exercised");
    assert.equal(
      results[3].legacy,
      "resumeGeneration.refineLastResumeGeneration",
      "the refine probe watches the awaited API call, not a legacy button dispatch",
    );
    for (const r of results) {
      assert.equal(r.ok, true, `${r.btn} must reach legacy ${r.legacy}`);
    }
    assert.ok(env.consoleLines.includes("[scribe smoke] PASS"));
  });

  it("smoke reports FAIL honestly when a legacy target is missing (a silently broken bridge is the failure smoke exists to catch)", () => {
    const env = loadScribe({
      search: "?jb-v2-test=scribe",
      jobBoredApp: smokeApp(),
      buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGeneratePrint"),
    });
    env.timers.flush();
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    const print = results.find((r) => r.btn === "#scribePrintBtn");
    assert.equal(print.ok, false, "the unmapped print bridge must be flagged");
    assert.equal(print.reason, "legacy id never clicked");
    assert.ok(env.consoleLines.includes("[scribe smoke] FAIL"));
    assert.equal(env.printCalls.length, 1, "the user-facing fallback still fired during the probe");
  });

  it("JB_SCRIBE.smoke() works as a manual handle without the URL param (on-demand QA from the console)", () => {
    const env = loadScribe({ jobBoredApp: smokeApp() });
    env.JB.smoke();
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.ok === true));
  });
});
