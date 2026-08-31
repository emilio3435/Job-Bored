import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { flushMicrotasks, loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// SCRIBE-03 (a) — refine reports success before completion.
//
// scribe.js clicks the legacy #resumeGenerateRefine button and then
// sets a fixed 350ms window.setTimeout that snapshots the legacy
// textarea back into the editor and writes status "refined". The
// real work is resume-generation.js refineLastResumeGeneration():
// an async LLM round-trip (CommandCenterResumeGenerate
// .generateFromBundle) followed by an IndexedDB save. At 350ms it
// is still in flight, so the editor snapshots the modal's
// "Refining…" placeholder and the pane claims success.
//
// refineLastResumeGeneration is already exported on
// window.JobBoredApp.resumeGeneration and resolves after generation
// AND save; jb:draft:saved corroborates. Awaiting it directly is the
// fix — no change to resume-generation.js is needed.
// ============================================================

function makeRefineHost({ refine, session = SESSION } = {}) {
  const calls = [];
  return {
    calls,
    app: {
      resumeGeneration: {
        getLastResumeGenerationSession: () => session,
        refineLastResumeGeneration: (...args) => {
          calls.push(args);
          return refine();
        },
      },
    },
  };
}

const SESSION = {
  feature: "cover_letter",
  job: { title: "Staff Platform Engineer", company: "Northwind" },
};

const MODULES = ["scribe-state.js", "scribe.js"];

function statusOf(env) {
  const el = env.rq("[data-scribe-status]");
  return { text: el.textContent, state: el.getAttribute("data-state") };
}

describe("scribe refine — completion is awaited, never guessed (SCRIBE-03)", () => {
  it("while the refine promise is still pending the pane says 'refining…' and NOTHING claims success", async () => {
    const host = makeRefineHost({ refine: () => new Promise(() => {}) });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
    });
    env.byId("scribeRefineInput").value = "make it shorter";
    env.byId("scribeRefineBtn").click();

    // The legacy modal parks its placeholder in the textarea while it works.
    env.els.output.value = "Refining…";
    await flushMicrotasks();

    assert.deepEqual(statusOf(env), { text: "refining…", state: "busy" });
    assert.equal(
      env.timers.count(),
      0,
      "no timer may stand in for the promise — a fixed delay is a guess, not a completion signal",
    );
    assert.equal(
      env.byId("scribeEditor").textContent,
      "First draft.",
      "the editor must not snapshot the modal's in-flight placeholder",
    );
  });

  it("once the promise RESOLVES the refined text lands in the editor and the status reads 'refined'", async () => {
    let settle;
    const host = makeRefineHost({ refine: () => new Promise((r) => { settle = r; }) });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
    });
    env.byId("scribeRefineInput").value = "make it shorter";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(statusOf(env).text, "refining…");

    env.els.output.value = "Refined draft with a stronger opener.";
    settle();
    await flushMicrotasks();

    assert.equal(env.byId("scribeEditor").textContent, "Refined draft with a stronger opener.");
    assert.deepEqual(statusOf(env), { text: "refined", state: "ok" });
  });

  it("a REJECTED refine is reported as a failure and leaves the user's draft exactly as it was", async () => {
    const host = makeRefineHost({ refine: () => Promise.reject(new Error("provider 503")) });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
    });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();

    assert.equal(statusOf(env).state, "err");
    assert.match(statusOf(env).text, /refine failed/i);
    assert.match(statusOf(env).text, /provider 503/);
    assert.equal(env.byId("scribeEditor").textContent, "First draft.", "the draft survives a failure");
  });

  it("a refine that resolves without changing anything says so — it must not be reported as a successful refine", async () => {
    // resume-generation.js bails early (toast + return) when there is no
    // session, no bundle or no feedback; the promise still resolves.
    const host = makeRefineHost({ refine: () => Promise.resolve() });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
    });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();

    assert.match(statusOf(env).text, /no changes/i);
    assert.notEqual(statusOf(env).state, "ok", "an unchanged draft is not a refined draft");
    assert.equal(env.byId("scribeEditor").textContent, "First draft.");
  });

  it("a draft saved during the call corroborates success even when the text is unchanged", async () => {
    let settle;
    const host = makeRefineHost({ refine: () => new Promise((r) => { settle = r; }) });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
    });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();

    env.emit("jb:draft:saved", { feature: "cover_letter", draftId: "d9", mode: "refine" }, env.document);
    settle();
    await flushMicrotasks();

    assert.deepEqual(statusOf(env), { text: "refined", state: "ok" });
  });

  it("the freshest editor text is flushed into the legacy textarea BEFORE the refine reads it", async () => {
    let textAtRefine = null;
    const host = makeRefineHost({
      refine: () => {
        textAtRefine = env.els.output.value;
        return Promise.resolve();
      },
    });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "Old body",
    });
    const editor = env.byId("scribeEditor");
    editor.textContent = "Body the user just typed";
    env.input(editor); // still inside the 600ms debounce window
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();

    assert.equal(
      textAtRefine,
      "Body the user just typed",
      "refine must never operate on a stale draft",
    );
  });

  it("the refine instructions reach the legacy feedback textarea (refineLastResumeGeneration reads them from the DOM)", async () => {
    const host = makeRefineHost({ refine: () => Promise.resolve() });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "First draft." });
    const fbEvents = [];
    env.els.feedback.addEventListener("input", () => fbEvents.push(1));
    env.byId("scribeRefineInput").value = "make it shorter";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(env.els.feedback.value, "make it shorter");
    assert.equal(fbEvents.length, 1, "the legacy field must be notified exactly once");
  });

  it("a second click while a refine is in flight does not start a second generation", async () => {
    const host = makeRefineHost({ refine: () => new Promise(() => {}) });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "First draft." });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(host.calls.length, 1, "one refine at a time — a double call bills twice");
    assert.equal(env.byId("scribeRefineBtn").getAttribute("aria-disabled"), "true");
  });

  it("refine is refused honestly when the resume-generation API is absent — no legacy click, no phantom timer", () => {
    const env = loadScribe({ modules: MODULES, legacyText: "First draft." });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    assert.match(statusOf(env).text, /refine unavailable/i);
    assert.equal(statusOf(env).state, "err");
    assert.equal(env.timers.count(), 0, "no phantom snapshot is scheduled");
    assert.ok(
      !env.legacyClicks.includes("resumeGenerateRefine"),
      "clicking legacy would start work we cannot observe the completion of",
    );
  });

  it("refine completion is announced to screen readers when the a11y primitive is available", async () => {
    const announced = [];
    const host = makeRefineHost({ refine: () => Promise.resolve() });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
      a11y: { live: { announce: (msg) => announced.push(msg) } },
    });
    env.els.resumeGenerateRefine.addEventListener("click", () => {});
    env.byId("scribeRefineInput").value = "tighten";
    env.els.output.value = "First draft.";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(announced.length, 1, "the outcome must be announced, not just painted");
  });

  it("refine completion still reaches a screen reader on the flat announce(doc, message) primitive", async () => {
    // jb-a11y.js exists on both reconciled branches with different shapes:
    // one publishes live.announce(message), the other a flat
    // announce(doc, message, opts). scribe.js's guard means the wrong shape
    // is a SILENT no-op — nothing throws, nothing fails, the announcement
    // just never happens. Pin BOTH shapes so whichever jb-a11y.js is live,
    // a refine outcome is still spoken.
    const announced = [];
    const host = makeRefineHost({ refine: () => Promise.resolve() });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
      a11y: { announce: (doc, msg) => announced.push({ doc, msg }) },
    });
    env.els.resumeGenerateRefine.addEventListener("click", () => {});
    env.byId("scribeRefineInput").value = "tighten";
    env.els.output.value = "First draft.";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(announced.length, 1, "the flat primitive must be used when live.announce is absent");
    assert.ok(announced[0].doc, "the flat primitive takes the document as its first argument");
    assert.equal(typeof announced[0].msg, "string");
    assert.ok(announced[0].msg.length > 0, "and a real message as its second");
  });

  it("announces exactly once when BOTH primitive shapes are present", async () => {
    // The live namespace wins; the flat call is a fallback, not a second
    // announcement (a double-announce is its own a11y defect).
    const live = [];
    const flat = [];
    const host = makeRefineHost({ refine: () => Promise.resolve() });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "First draft.",
      a11y: {
        live: { announce: (msg) => live.push(msg) },
        announce: (doc, msg) => flat.push(msg),
      },
    });
    env.els.resumeGenerateRefine.addEventListener("click", () => {});
    env.byId("scribeRefineInput").value = "tighten";
    env.els.output.value = "First draft.";
    env.byId("scribeRefineBtn").click();
    await flushMicrotasks();
    assert.equal(live.length, 1, "live.announce is the primary path");
    assert.equal(flat.length, 0, "and the flat fallback must not fire on top of it");
  });
});
