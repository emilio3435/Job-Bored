import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALL_LEGACY_BUTTONS, flushMicrotasks, loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// SCRIBE-03 (b) — Done / Print export stale text.
//
// Editor keystrokes only reach #resumeGenerateOutput after a 600ms
// idle debounce (scribe.js DEBOUNCE_MS). Print and Done click their
// legacy handlers immediately and WITHOUT flushing first, and Done
// maps to closeResumeGenerateModal — so anything typed inside the
// last 600ms is printed stale or dropped entirely when the modal
// closes. Copy already flushes; Print and Done must too, and the
// flush has to be SYNCHRONOUS: it must complete before the legacy
// click fires, not on a later tick.
//
// syncEditorIntoLegacy stays the single legacy-write choke point.
// ============================================================

const SESSION = {
  feature: "cover_letter",
  job: { title: "Staff Platform Engineer", company: "Northwind" },
};

const MODULES = ["scribe-state.js", "scribe.js"];

function appWithSession() {
  return { resumeGeneration: { getLastResumeGenerationSession: () => SESSION } };
}

/** Type into the editor without letting the idle debounce elapse. */
function typeFresh(env, text) {
  const editor = env.byId("scribeEditor");
  editor.textContent = text;
  env.input(editor);
  return editor;
}

describe("scribe export — Done and Print flush the editor first (SCRIBE-03)", () => {
  it("Done carries the text typed one keystroke ago — the legacy Done handler closes the modal, so an unflushed edit is lost forever", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    let valueAtDone = null;
    env.els.resumeGenerateDone.addEventListener("click", () => {
      valueAtDone = env.els.output.value;
    });

    typeFresh(env, "Body the user just typed");
    env.byId("scribeDoneBtn").click();

    assert.equal(valueAtDone, "Body the user just typed");
    assert.ok(env.legacyClicks.includes("resumeGenerateDone"));
  });

  it("Print carries the freshest text — a PDF of a stale draft is a silently wrong artifact", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    let valueAtPrint = null;
    env.els.resumeGeneratePrint.addEventListener("click", () => {
      valueAtPrint = env.els.output.value;
    });

    typeFresh(env, "Body the user just typed");
    env.byId("scribePrintBtn").click();

    assert.equal(valueAtPrint, "Body the user just typed");
  });

  it("the flush happens BEFORE the legacy click, not on a later tick — no pending timer may hold the newest text", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    typeFresh(env, "Body the user just typed");
    assert.equal(
      env.timers.count(),
      2,
      "before the export, both the editor->legacy debounce and the autosave debounce are pending",
    );

    env.byId("scribeDoneBtn").click();

    assert.equal(env.els.output.value, "Body the user just typed", "synced synchronously");
    assert.equal(
      env.timers.count(),
      0,
      "the pending debounce must be cancelled by the flush, not left to fire into a closed modal",
    );
  });

  it("the flush fires exactly one input event, so the export does not double-trigger the legacy ATS pipeline", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));
    typeFresh(env, "Body the user just typed");
    env.byId("scribeDoneBtn").click();
    env.timers.flush();
    assert.equal(taEvents.length, 1, "exactly one write reaches the legacy pipeline");
  });

  it("an unchanged draft still exports, and writes nothing (idempotent flush: no spurious input event)", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));
    env.byId("scribeDoneBtn").click();
    assert.equal(taEvents.length, 0);
    assert.ok(env.legacyClicks.includes("resumeGenerateDone"));
  });

  it("Print's window.print() fallback also flushes first — the fallback path cannot be the stale one", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
      buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGeneratePrint"),
    });
    typeFresh(env, "Body the user just typed");
    env.byId("scribePrintBtn").click();
    assert.equal(env.els.output.value, "Body the user just typed");
    assert.equal(env.printCalls.length, 1);
  });

  it("Done falls back to legacy Close and still flushes, so the user is never trapped nor silently truncated", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
      buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateDone"),
    });
    let valueAtClose = null;
    env.els.resumeGenerateClose.addEventListener("click", () => {
      valueAtClose = env.els.output.value;
    });
    typeFresh(env, "Body the user just typed");
    env.byId("scribeDoneBtn").click();
    assert.equal(valueAtClose, "Body the user just typed");
  });

  it("Copy keeps flushing (regression guard on the one export path that was already correct)", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      legacyText: "Original body",
    });
    let valueAtCopy = null;
    env.els.resumeGenerateCopy.addEventListener("click", () => {
      valueAtCopy = env.els.output.value;
    });
    typeFresh(env, "Body the user just typed");
    env.byId("scribeCopyBtn").click();
    assert.equal(valueAtCopy, "Body the user just typed");
  });
});

describe("scribe export — Done persists the draft through the state module (SCRIBE-03)", () => {
  it("Done flushes the pending autosave instead of leaving the last edit only in the DOM", async () => {
    const saves = [];
    const userContent = {
      saveGeneratedDraft: async (payload) => {
        saves.push(payload);
        return { id: "d1", versionNumber: 1, text: payload.text, createdAt: "2026-08-31T00:00:00.000Z" };
      },
      putGeneratedDraft: async (record) => {
        saves.push(record);
        return record;
      },
    };
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: appWithSession(),
      userContent,
      legacyText: "Original body",
    });

    typeFresh(env, "Body the user just typed");
    assert.equal(saves.length, 0, "autosave has not fired yet — it is still debounced");

    env.byId("scribeDoneBtn").click();
    await flushMicrotasks();

    assert.equal(saves.length, 1, "Done must not leave an unsaved edit behind");
    assert.equal(saves[0].text, "Body the user just typed");
  });
});
