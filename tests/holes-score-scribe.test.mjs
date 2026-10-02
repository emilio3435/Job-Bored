/* HOLES lane SCORE · Scribe v2 ("Scribe v2 shows no score", U12).

   The desk's header carries the open document's verdict button (GRADE
   D7: "<word> · <first reason>", never a letter). It follows
   the document tabs and the manifest, opens the score modal with a fill
   hook that lands Fix this / Apply / Repair in the composer, and Esc
   inside that modal closes the modal, never the desk. A save tells the
   rows (jb:scribe:saved) so the verdict goes stale until the fresh one. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V3_READY, V3_UNSUPPORTED } from "./fixtures/materials-qa-v3.mjs";
import { click, keydown, load, makeScoreEnv, text } from "./fixtures/holes-score-dom.mjs";

const VERSIONS = {
  resume: { currentRunId: "r1", versions: [{ runId: "r1", n: 1, createdAt: "2026-09-27T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 380, family: "signal" }] },
  cover_letter: { currentRunId: "l0", versions: [{ runId: "l0", n: 0, createdAt: "2026-09-25T16:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 210, family: "signal" }] },
};

const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js", "scribe-v2-diff.js", "scribe-v2.js"]);
  const doc = win.document;
  const opener = doc.createElement("button");
  doc.body.appendChild(opener);
  const ms = win.JobBoredMaterialsScore;
  const view = (qa) => ms.verdictView({ status: "pass", issues: [], qa });
  const grades = {
    resume: { verdict: view(V3_READY), stale: false },
    cover_letter: { verdict: view(V3_UNSUPPORTED), stale: false },
  };
  const opened = [];
  const score = {
    gradeFor: (d) => grades[d] || null,
    open: (d, btn, hooks) => {
      opened.push({ d, btn, hooks });
      return ms.open({ opener: btn, read: () => ({ feature: d, qualityDoc: { status: "pass", issues: [], qa: V3_READY }, can: { fix: true, apply: true, repair: true } }), repair: () => hooks.fill("Fix these: the opener") });
    },
  };
  const saved = [];
  win.addEventListener("jb:scribe:saved", (e) => saved.push(JSON.parse(JSON.stringify(e.detail))));
  const api = {
    mode: "stub",
    listVersions: (d) => Promise.resolve(JSON.parse(JSON.stringify(VERSIONS[d]))),
    preview: (b) => Promise.resolve({ html: `<html><body><main data-page="1">${b.doc}</main></body></html>`, words: 1, pageBudget: 1 }),
    propose: () => new Promise(() => {}),
    stream: () => new Promise(() => {}),
    rejectEdit: () => Promise.resolve(null),
    acceptEdit: () => Promise.resolve({ run: { runId: "r2", n: 2 } }),
  };
  const ctl = win.JB_SCRIBE_V2.open({ slug: "acme-pm", doc: "resume", opener, api, title: "PM", company: "Acme", score });
  const host = () => doc.querySelector("jb-scribe");
  const gradeBtn = () => host() && host().querySelector('[data-scribe="grade"] [data-score-open]');
  return { win, doc, ctl, host, gradeBtn, grades, opened, saved, ms, view };
}

describe("Scribe v2 shows the verdict", () => {
  it("should put the open document's verdict button in the header, named with its verdict", async () => {
    const env = boot();
    await settle();
    const btn = env.gradeBtn();
    assert.ok(btn, "the header has a verdict button");
    assert.equal(btn.getAttribute("data-feature"), "resume");
    assert.equal(btn.getAttribute("aria-label"), "Resume: Ready. Open the quality check.");
  });

  it("should follow the document tab and the manifest", async () => {
    const env = boot();
    await settle();
    env.ctl.setDoc("cover_letter");
    await settle();
    assert.equal(env.gradeBtn().getAttribute("data-feature"), "cover_letter");
    assert.equal(text(env.gradeBtn()), "Fails · 1 claim needs a source");
    env.grades.cover_letter = { verdict: env.view(V3_READY), stale: true };
    env.win.dispatchEvent(new env.win.CustomEvent("jb:materials:manifest", { detail: {} }));
    assert.equal(text(env.gradeBtn()), "Ready");
    assert.equal(env.gradeBtn().getAttribute("data-stale"), "true");
  });

  it("should open the score modal from the button, and its Repair fills the composer", async () => {
    const env = boot();
    await settle();
    const btn = env.gradeBtn();
    btn.dispatchEvent(click(btn));
    assert.equal(env.opened.length, 1);
    assert.equal(env.opened[0].d, "resume");
    assert.equal(env.opened[0].btn, btn);
    const repair = env.doc.querySelector(".jb-score [data-score-repair]");
    assert.ok(repair, "the modal offers Repair");
    repair.dispatchEvent(click(repair));
    const ta = env.host().querySelector("textarea");
    assert.equal(ta.value, "Fix these: the opener");
  });
});

describe("Esc in the score modal over Scribe", () => {
  it("should close only the modal: the desk hears the key first and leaves it alone", async () => {
    const env = boot();
    await settle();
    const btn = env.gradeBtn();
    btn.dispatchEvent(click(btn));
    const modal = env.doc.querySelector(".jb-score");
    const inside = modal.querySelector("[data-score-close]") || modal;
    /* The desk listens on the document in the capture phase. */
    env.doc.dispatchEvent(keydown(inside, "Escape"));
    assert.ok(env.host(), "Scribe is still open");
    inside.dispatchEvent(keydown(inside, "Escape"));
    assert.equal(env.doc.querySelector(".jb-score"), null, "the modal closed");
    assert.ok(env.host(), "and Scribe is still open");
  });
});

describe("U12 · a Scribe save tells the rows", () => {
  it("should emit jb:scribe:saved with the slug, the document and the new run", async () => {
    const env = boot();
    await settle();
    env.ctl.state.proposal = { id: "p1", ops: [{}], changes: [{ opId: "o1", kind: "replace", op: { rationale: "Tighter." } }], decisions: { o1: "accepted" } };
    const save = env.doc.createElement("button");
    save.setAttribute("data-review", "save");
    env.host().appendChild(save);
    save.dispatchEvent(click(save));
    await settle();
    assert.deepEqual(env.saved, [{ slug: "acme-pm", doc: "resume", runId: "r2" }]);
  });
});
