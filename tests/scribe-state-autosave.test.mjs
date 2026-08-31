import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { flushMicrotasks, loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// scribe-state.js — the SINGLE write choke point for Scribe.
//
// Every draft write goes through CommandCenterUserContent
// (saveGeneratedDraft / putGeneratedDraft) and nothing else, so the
// pending write-atomicity repair gate can swap the store under one
// adapter. Two store behaviors are load-bearing and must be handled
// explicitly rather than discovered at runtime:
//   - saveGeneratedDraft THROWS "Draft text is required" on empty text
//     (user-content-store.js:1027)
//   - it silently truncates at GENERATED_DRAFT_TEXT_MAX_CHARS (60000)
//
// The visible save state must be truthful, never optimistic: an
// autosave that has not landed may not read "saved".
// ============================================================

const SESSION = {
  feature: "cover_letter",
  job: { title: "Staff Platform Engineer", company: "Northwind" },
};

const MODULES = ["scribe-state.js", "scribe.js"];

function makeStore({ failOn = null } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    api: {
      saveGeneratedDraft: async (payload) => {
        calls.push({ op: "saveGeneratedDraft", payload });
        if (failOn === "save") throw new Error("QuotaExceededError");
        const text = String(payload.text || "").trim();
        if (!text) throw new Error("Draft text is required");
        n += 1;
        return {
          id: `d${n}`,
          feature: payload.feature,
          mode: payload.mode,
          jobKey: "northwind::staff",
          versionNumber: n,
          text: text.slice(0, 60000),
          title: payload.title || "",
          createdAt: `2026-08-31T0${n}:00:00.000Z`,
        };
      },
      putGeneratedDraft: async (record) => {
        calls.push({ op: "putGeneratedDraft", payload: record });
        if (failOn === "put") throw new Error("IndexedDB is closing");
        return record;
      },
    },
  };
}

function makeApp({ session = SESSION, drafts = [] } = {}) {
  const refreshes = [];
  return {
    refreshes,
    app: {
      resumeGeneration: { getLastResumeGenerationSession: () => session },
      materialsState: {
        getDraftsForJob: () => drafts,
        formatDraftSavedAt: () => "Aug 31, 1:00 AM",
        refreshGeneratedDraftLibraryCache: async () => {
          refreshes.push(1);
        },
      },
    },
  };
}

function saveStateOf(env) {
  const pill = env.rq("[data-scribe-save]");
  return { state: pill.getAttribute("data-state"), text: pill.textContent };
}

describe("scribe-state — debounced autosave through the user-content adapter", () => {
  it("an edit is 'unsaved' until the autosave actually lands, then 'saved' — never optimistic", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original body",
    });
    const editor = env.byId("scribeEditor");
    editor.textContent = "Body the user just typed";
    env.input(editor);

    assert.equal(saveStateOf(env).state, "unsaved", "a pending write is not a save");
    assert.equal(store.calls.length, 0);

    env.timers.flush(); // editor debounce -> autosave debounce
    env.timers.flush();
    await flushMicrotasks();

    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].op, "saveGeneratedDraft");
    assert.equal(store.calls[0].payload.text, "Body the user just typed");
    assert.equal(saveStateOf(env).state, "saved");
  });

  it("rapid edits collapse into one autosave (a write per keystroke would flood the version history)", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    const state = env.window.JobBoredScribeState;
    state.noteEditorChange("one");
    state.noteEditorChange("one two");
    state.noteEditorChange("one two three");
    env.timers.flush();
    await flushMicrotasks();
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].payload.text, "one two three");
  });

  it("subsequent autosaves UPDATE the same record rather than minting a new version each time", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    const state = env.window.JobBoredScribeState;

    state.noteEditorChange("first pass");
    env.timers.flush();
    await flushMicrotasks();
    state.noteEditorChange("second pass");
    env.timers.flush();
    await flushMicrotasks();

    assert.deepEqual(
      store.calls.map((c) => c.op),
      ["saveGeneratedDraft", "putGeneratedDraft"],
    );
    assert.equal(store.calls[1].payload.id, "d1", "the same draft row is rewritten");
    assert.equal(store.calls[1].payload.versionNumber, 1, "autosave never bumps the version number");
    assert.equal(store.calls[1].payload.text, "second pass");
  });

  it("re-noting identical text does not write again", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    const state = env.window.JobBoredScribeState;
    state.noteEditorChange("same text");
    env.timers.flush();
    await flushMicrotasks();
    state.noteEditorChange("same text");
    env.timers.flush();
    await flushMicrotasks();
    assert.equal(store.calls.length, 1, "an unchanged draft is already saved");
  });
});

describe("scribe-state — the save state tells the truth about failures", () => {
  it("emptying the editor is reported as unsaved-because-empty; the store's empty-text throw is never triggered", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    const state = env.window.JobBoredScribeState;
    state.noteEditorChange("   ");
    env.timers.flush();
    await flushMicrotasks();

    assert.equal(store.calls.length, 0, "an empty draft must not reach saveGeneratedDraft");
    assert.equal(saveStateOf(env).state, "unsaved");
    assert.match(saveStateOf(env).text, /empty/i);
  });

  it("a rejected write reads 'save failed' with the store's reason — it must never settle on 'saved'", async () => {
    const store = makeStore({ failOn: "save" });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    env.window.JobBoredScribeState.noteEditorChange("some new text");
    env.timers.flush();
    await flushMicrotasks();

    assert.equal(saveStateOf(env).state, "failed");
    assert.match(saveStateOf(env).text, /QuotaExceededError/);
  });

  it("text past the 60,000-char store cap is saved AND flagged as truncated, not silently clipped", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original",
    });
    env.window.JobBoredScribeState.noteEditorChange("x".repeat(60001));
    env.timers.flush();
    await flushMicrotasks();

    assert.equal(saveStateOf(env).state, "saved");
    assert.match(saveStateOf(env).text, /truncated/i);
    assert.equal(env.window.JobBoredScribeState.getSaveState().truncated, true);
  });

  it("with no local store available the pane says the draft is not saved instead of pretending", async () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      legacyText: "Original",
    });
    env.window.JobBoredScribeState.noteEditorChange("some new text");
    env.timers.flush();
    await flushMicrotasks();
    assert.equal(saveStateOf(env).state, "failed");
    assert.match(saveStateOf(env).text, /store unavailable/i);
  });

  it("with no role bound the draft is not filed under a junk key — it is reported unsaved with the reason", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp({ session: null }).app,
      userContent: store.api,
      legacyText: "Original",
    });
    env.window.JobBoredScribeState.noteEditorChange("some new text");
    env.timers.flush();
    await flushMicrotasks();
    assert.equal(store.calls.length, 0);
    assert.equal(saveStateOf(env).state, "unsaved");
    assert.match(saveStateOf(env).text, /no role/i);
  });
});

describe("scribe-state — named versions and the version rail", () => {
  it("Save version mints a NEW numbered version carrying the user's title", async () => {
    const store = makeStore();
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: store.api,
      legacyText: "Original body",
    });
    env.byId("scribeVersionTitle").value = "Sent to recruiter";
    env.byId("scribeSaveVersionBtn").click();
    await flushMicrotasks();

    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].op, "saveGeneratedDraft");
    assert.equal(store.calls[0].payload.title, "Sent to recruiter");
    assert.equal(store.calls[0].payload.text, "Original body");
    assert.equal(saveStateOf(env).state, "saved");
    assert.equal(env.byId("scribeVersionTitle").value, "", "the title field resets for the next version");
  });

  it("the version rail lists the drafts the materials cache holds for the bound role, newest first", () => {
    const drafts = [
      { id: "d2", versionNumber: 2, title: "Sent to recruiter", createdAt: "2026-08-31T02:00:00.000Z", mode: "refine" },
      { id: "d1", versionNumber: 1, title: "", createdAt: "2026-08-31T01:00:00.000Z", mode: "initial" },
    ];
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp({ drafts }).app,
      userContent: makeStore().api,
      legacyText: "Original body",
    });
    const items = env.rqa("[data-scribe-version]");
    assert.equal(items.length, 2);
    assert.match(items[0].textContent, /V2/);
    assert.match(items[0].textContent, /Sent to recruiter/);
    assert.match(items[1].textContent, /V1/);
    assert.match(items[1].textContent, /Version 1/, "an untitled version is labeled by its number, not left blank");
  });

  it("says the rail is still loading rather than claiming the role has no versions", () => {
    const app = makeApp().app;
    app.materialsState.getGeneratedDraftLibraryCache = () => ({ loaded: false });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: app,
      userContent: makeStore().api,
      legacyText: "Original body",
    });
    assert.match(env.byId("scribeVersions").textContent, /Loading saved versions/i);
    assert.ok(
      !/No saved versions/i.test(env.byId("scribeVersions").textContent),
      "an unloaded cache is unknown, not empty",
    );
  });

  it("the rail says so plainly when the role has no saved versions yet", () => {
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: makeApp().app,
      userContent: makeStore().api,
      legacyText: "Original body",
    });
    assert.equal(env.rqa("[data-scribe-version]").length, 0);
    assert.match(env.byId("scribeVersions").textContent, /No saved versions yet/i);
  });

  it("picking a version reopens it through the legacy openSavedDraftVersion path (one canonical loader)", async () => {
    const opened = [];
    const app = makeApp({
      drafts: [{ id: "d1", versionNumber: 1, title: "", createdAt: "2026-08-31T01:00:00.000Z", mode: "initial" }],
    }).app;
    app.resumeGeneration.openSavedDraftVersion = async (id) => {
      opened.push(id);
    };
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: app,
      userContent: makeStore().api,
      legacyText: "Original body",
    });
    env.rq('[data-scribe-version="d1"]').click();
    await flushMicrotasks();
    assert.deepEqual(opened, ["d1"]);
  });
});
