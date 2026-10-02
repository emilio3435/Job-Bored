/**
 * MREV lane C · materials-insights.js view helpers for the judge-era
 * materials: the v2 scorecard (D1), old rubric runs (D2), the Repair
 * dialog (D3), what a repair changed (D4) and the K7 stage timeline (D6).
 *
 * Why these matter: the user has to see WHY a document got its verdict
 * (a fact problem is not a writing note), ask Repair for something
 * specific, and see exactly what the rewrite changed, including when it
 * changed nothing or was not adopted.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText, splitSentences } from "../server/materials-judge.mjs";
import {
  V1_RESUME_FAIL,
  V2_LETTER_FAIL,
  V2_LETTER_JUDGE_DOWN,
  V2_RESUME_READY_SAME_MODEL,
} from "./fixtures/materials-qa-v2.mjs";
import { V3_LOW_DIMENSION, V3_READY, V3_SECOND_DISAGREEMENT, V3_SECOND_OUTAGE, V3_UNSUPPORTED } from "./fixtures/materials-qa-v3.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function load() {
  const window = {};
  vm.runInNewContext(readFileSync(join(repoRoot, "materials-insights.js"), "utf8"), { window }, { filename: "materials-insights.js" });
  return window.JobBoredMaterialsInsights;
}

const mi = load();
const plain = (v) => JSON.parse(JSON.stringify(v));



/* materials-insights.js then materials-score.js in one window, as index.html loads them. */
function loadScore() {
  const window = {};
  const ctx = { window };
  for (const rel of ["materials-insights.js", "materials-score.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, rel), "utf8"), ctx, { filename: rel });
  }
  return window;
}

/* HOLES SCORE (spec §0.3): the judge's verdict no longer paints inline in
   the row; everything below reads the quality-check modal
   (materials-score.js). The intents are the same: the reason first, the
   deciding checks with their sentences, every blocker kept, the reviewer
   named, failures with their ways out — and, since GRADE, no score. */
const sw = loadScore();
const ms = sw.JobBoredMaterialsScore;
const CAN = { fix: true, apply: true, repair: true, rescore: true, promote: true, retry: true, profile: true };
const modal = (qualityDoc, feature, can = CAN) => ms.modalHtml(ms.modelOf({ feature, qualityDoc, can }));
/* The visible words of a fragment: tags dropped, entities read. */
const words = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/* One step of the modal, as markup. */
function step(html, id) {
  const start = html.indexOf(`data-step="${id}"`);
  if (start < 0) return "";
  const next = html.indexOf('<li class="jb-score__step"', start);
  return html.slice(start, next < 0 ? undefined : next);
}

/* The Why items of one group (a check kind), as markup. */
function items(html, group) {
  return [...step(html, "why").matchAll(new RegExp(`<li class="jb-score__item" data-group="${group}"[^>]*>([\\s\\S]*?)</li>`, "g"))].map((m) => m[1]);
}

const verdictBlock = (html) => {
  const head = /<header class="jb-score__head">([\s\S]*?)<\/header>/.exec(html);
  assert.ok(head, "the modal has a header");
  const pick = (cls) => (new RegExp(`<p class="${cls}"[^>]*>([\\s\\S]*?)</p>`).exec(head[1]) || ["", ""])[1];
  return { verdict: pick("jb-score__verdict"), prov: pick("jb-score__prov"), head: head[1] };
};

/* GRADE (SPEC-GRADE D1, D4, D7): a v2 judge record is an old checker's
   now. The modal shows its stored verdict and the gates and sentences that
   decided it — never its 0-100 score, its weights or its stored prose —
   and the reviews of a v3 record name who reviewed it and why one didn't. */
describe("D1 · the modal reads the judge's record as the old checker's", () => {
  it("FIX1 P1-1: our own words never say judge, whatever the grade's outcome", () => {
    const finalText = "I built a forecast.";
    const textHash = hashRenderedText(finalText);
    for (const status of ["ok", "unsupported", "unavailable", "invalid"]) {
      const judgment = { documents: [{ document: "letter", textHash,
        sentences: splitSentences(finalText, "letter").map((sentence) => ({ ...sentence, status: status === "unsupported" ? "unsupported" : "supported", reason: "", citations: [] })),
        ratings: ["role_relevance", "evidence_quality", "voice", "coherence", "economy"].map((dimension) => ({ dimension, score: 4, reason: "Fictional feedback.", sentenceIds: [] })),
      }] };
      const qa = buildQaRecord({ document: "letter", runId: "fictional-fix1", finalText, textHash,
        judge: { status: ["ok", "unsupported"].includes(status) ? "ok" : status, judgment,
          meta: { model: "fictional-grader", independent: true, errorCode: "timeout" } } });
      assert.doesNotMatch(words(modal({ qa }, "cover_letter")).replace(/fictional-grader/g, ""), /\bjudge\b/i, status);
    }
  });

  it("should head the modal with the verdict word, never the score out of 100", () => {
    assert.match(verdictBlock(modal(V2_LETTER_FAIL, "cover_letter")).head, /Fails/);
    assert.match(verdictBlock(modal(V2_RESUME_READY_SAME_MODEL, "resume")).head, /Ready/);
    assert.match(verdictBlock(modal(V2_LETTER_JUDGE_DOWN, "cover_letter")).head, /Needs review/);
    for (const f of [V2_LETTER_FAIL, V2_RESUME_READY_SAME_MODEL]) assert.doesNotMatch(modal(f, "resume"), /\/ 100|of 100|\b(64|86)\b/);
    assert.equal(mi.isFail(V2_LETTER_FAIL), true);
    assert.equal(mi.dispositionOf(V2_LETTER_JUDGE_DOWN), "REVIEW");
  });

  it("should give the first deciding reason in one line, never the stored prose", () => {
    const html = modal(V2_LETTER_FAIL, "cover_letter");
    assert.equal(verdictBlock(html).verdict, "1 claim needs a source");
    assert.equal(verdictBlock(html).prov, "Graded by the old checker");
    assert.doesNotMatch(html, /One sentence claims a result/);
  });

  it("should keep the deciding claims together, each with its sentence quoted", () => {
    const html = modal(V2_LETTER_FAIL, "cover_letter");
    const claims = items(html, "sentence");
    assert.equal(claims.length, 2, "the unsupported claim and the one to confirm");
    assert.match(claims[0], /Claim needs a source/);
    assert.match(claims[0], /<q class="jb-score__quote">At Contoso I cut churn by 40% across the enterprise book\.<\/q>/);
    assert.match(claims[0], /No claim mentions a churn figure\./);
    assert.match(claims[1], /Claim to confirm/);
    assert.match(claims[1], /usage-based pricing/);
    assert.doesNotMatch(step(html, "why"), /stock line/, "a writing note is not a deciding check");
  });

  it("should show the five Writing dimensions 0–4, each with its reason, and no total", () => {
    const html = modal({ status: "review", issues: [], qa: V3_LOW_DIMENSION }, "cover_letter");
    const dims = step(html, "writing");
    const labels = [...dims.matchAll(/class="jb-score__dim-label">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Fits this role", "Evidence", "Sounds like you", "Holds together", "No padding"]);
    assert.match(dims, /Evidence<\/span>[\s\S]*?2 \/ 4/);
    assert.doesNotMatch(html, /\/ 100|of 100/);
  });

  it("should list gaps in the background as information, not as a defect", () => {
    const gaps = items(modal(V2_LETTER_FAIL, "cover_letter"), "background");
    assert.equal(gaps.length, 2);
    assert.match(gaps[0], /managing a team of 10 or more/);
    assert.match(gaps[1], /No marketplace experience on file\./);
    for (const g of gaps) assert.match(g, /not a problem with the writing/i);
    assert.match(step(modal(V2_LETTER_FAIL, "cover_letter"), "why"), /Background gaps/);
  });

  /* J-FE4, on the v3 reviews: who reviewed it, and when a review didn't
     run, why, with the two ways out. */
  const second = (review) => ({ status: "pass", issues: [], qa: { ...V3_SECOND_OUTAGE, reviews: [V3_SECOND_OUTAGE.reviews[0], { ...V3_SECOND_OUTAGE.reviews[1], ...review }] } });
  const reviews = (html) => step(html, "reviews");

  it("should name who reviewed it, never 'judge'", () => {
    assert.equal(verdictBlock(modal({ status: "pass", issues: [], qa: V3_SECOND_DISAGREEMENT }, "cover_letter")).prov, "First review: writer-example · Second review: judge-example");
    for (const html of [modal({ qa: V3_SECOND_DISAGREEMENT }, "cover_letter"), modal(second({}), "resume")]) {
      assert.doesNotMatch(words(reviews(html)).replace(/judge-example/g, ""), /judge/i);
    }
  });

  it("J-FE4a · a timeout says how long it waited, with Try again and Change grading model", () => {
    const html = reviews(modal(second({ errorCode: "timeout", latencyMs: 240000 }), "cover_letter"));
    assert.match(html, /Second review didn(’|&#39;|')t run — it timed out after 240 s\./);
    assert.match(html, /<button[^>]*data-score-rescore[^>]*>Try again<\/button>/);
    assert.match(html, /<button[^>]*data-action="settings-open-grading"[^>]*>Change grading model<\/button>/);
  });

  it("J-FE4b · a rejected key says so", () => {
    assert.match(reviews(modal(second({ errorCode: "auth" }), "resume")), /the key was rejected/);
    assert.match(reviews(modal(second({ errorCode: "unconfigured" }), "resume")), /no key is saved for it/);
    assert.match(reviews(modal(second({ errorCode: "rate_limited" }), "resume")), /the provider was busy/);
  });

  it("J-FE4c · an unusable review reads differently from an unavailable model", () => {
    const invalid = reviews(modal(second({ status: "invalid", errorCode: "invalid_judgment" }), "cover_letter"));
    const unavailable = reviews(modal(second({ errorCode: "" }), "cover_letter"));
    assert.match(invalid, /it returned a grade we couldn(’|&#39;|')t use/);
    assert.match(unavailable, /it didn(’|&#39;|')t answer/);
    assert.notEqual(words(invalid), words(unavailable));
  });

  it("J-FE4d · a document only the writer reviewed offers a second review", () => {
    const html = reviews(modal({ status: "pass", issues: [], qa: V3_READY }, "resume"));
    assert.match(html, /First review: writer-example — Ready/);
    assert.match(html, /<button[^>]*data-action="settings-open-grading"[^>]*>Add a second review<\/button>/);
    assert.doesNotMatch(html, /Try again/);
    const skipped = reviews(modal(second({ status: "skipped", errorCode: undefined, error: undefined }), "resume"));
    assert.match(skipped, /Second review skipped — it uses the same model as the first review/);
  });

  it("should never lose an unsupported sentence or a failed hard gate the issues list left out", () => {
    const qa = {
      ...V2_LETTER_FAIL.qa,
      issues: [],
      gates: [{ id: "metric_mismatch", kind: "hard", pass: false, reason: "The 18% figure differs from your claim (12%).", sentenceIds: [] }],
    };
    const why = step(modal({ status: "fail", issues: [], qa }, "cover_letter"), "why");
    assert.match(why, /At Contoso I cut churn by 40%/);
    assert.match(why, /No claim mentions a churn figure\./);
    assert.match(why, /The 18% figure differs from your claim \(12%\)\./);
  });

  it("Grok P2 · should show every failed hard gate, each once", () => {
    const qa = {
      ...V2_LETTER_FAIL.qa,
      sentences: [],
      issues: [{ id: "i1", code: "i1", kind: "fact", severity: "hard", sentenceIds: [], reason: "Invented tools: rust.", action: "rewrite", origin: "gate" }],
      gates: [
        { id: "tool_support", kind: "hard", pass: false, reason: "Invented tools: rust.", sentenceIds: [] },
        { id: "metric_mismatch", kind: "hard", pass: false, reason: "The 18% figure differs from your claim (12%).", sentenceIds: [] },
      ],
    };
    const facts = items(modal({ status: "fail", issues: [], qa }, "cover_letter"), "gate").join("");
    assert.match(facts, /The 18% figure differs from your claim \(12%\)\./, "the second gate still shows");
    assert.equal((facts.match(/Invented tools: rust\./g) || []).length, 1, "a gate with its own issue shows once");
  });

  it("Grok P3 · should escape every record field it prints: reason, check, rating, gap, review, instruction, diff", () => {
    const x = "<b>x</b>";
    const qa = {
      ...V3_SECOND_DISAGREEMENT,
      reasons: [{ checkId: "review:disagreement", text: `why ${x}` }],
      checks: [{ ...V3_UNSUPPORTED.checks[0], detail: `check ${x}` }],
      issues: V3_UNSUPPORTED.issues.map((i) => ({ ...i, reason: `issue ${x}` })),
      ratings: V3_READY.ratings.map((r) => ({ ...r, reason: `dim ${x}` })),
      qualificationGaps: [`gap ${x}`],
      reviews: [{ ...V3_SECOND_DISAGREEMENT.reviews[0], model: `model ${x}` }],
    };
    const html = ms.modalHtml(ms.modelOf({ feature: "cover_letter", qualityDoc: { status: "fail", issues: [], qa }, can: CAN }), { open: { why: true, writing: true, reviews: true } });
    for (const label of ["why", "check", "dim", "gap", "model"]) {
      assert.match(html, new RegExp(`${label} &lt;b&gt;x&lt;/b&gt;`), `${label} is escaped`);
    }
    const panel = mi.repairPanelHtml("cover_letter", { qa }, { instruction: `ins ${x}` });
    assert.match(panel, /ins &lt;b&gt;x&lt;\/b&gt;<\/textarea>/);
    assert.match(panel, /issue &lt;b&gt;x&lt;\/b&gt;<\/span>/);
    const out = mi.repairOutcomeHtml({ feature: "cover_letter", changed: true, adopted: true, diff: { added: 1, removed: 1, lines: [{ op: "del", text: `old ${x}` }, { op: "add", text: `line ${x}` }] } });
    assert.match(out, /line &lt;b&gt;x&lt;\/b&gt;/);
    assert.match(out, /old &lt;b&gt;x&lt;\/b&gt;/);
    for (const s of [html, panel, out]) assert.doesNotMatch(s, /<b>x/);
  });

  it("should escape document text", () => {
    const qa = { ...V2_LETTER_FAIL.qa, sentences: [{ id: "L2", text: "<img src=x onerror=alert(1)>", status: "unsupported", reason: "x", citations: [] }] };
    const html = modal({ status: "fail", issues: [], qa }, "cover_letter");
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x/);
  });

  it("should offer Repair on every v2 verdict, READY included", () => {
    for (const fixture of [V2_LETTER_FAIL, V2_RESUME_READY_SAME_MODEL, V2_LETTER_JUDGE_DOWN]) {
      assert.equal(mi.canRepair(fixture), true, "the host offers it (role-materials: can.repair = canRepair)");
    }
    assert.match(modal(V2_RESUME_READY_SAME_MODEL, "resume"), /data-score-repair[^>]*>Repair</);
  });
});

describe("D2 · old runs still open, read-only", () => {
  it("should show a v1 rubric record's verdict and flags, graded by the old checker, with no score", () => {
    const html = modal(V1_RESUME_FAIL, "resume", { ...CAN, fix: false, apply: false, repair: false });
    assert.equal(verdictBlock(html).prov, "Graded by the old checker");
    assert.match(verdictBlock(html).verdict, /Resume is missing an experience section/);
    assert.doesNotMatch(html, /\/ 100|of 100|0 \/ 2|6 of 12|\b50\b/);
  });

  it("should offer no Repair on an old run: its run has no per-document draft to rewrite from", () => {
    assert.equal(mi.canRepair(V1_RESUME_FAIL), false);
    assert.equal(mi.canRepair(undefined), true, "no verdict at all: the server decides");
    assert.doesNotMatch(modal(V1_RESUME_FAIL, "resume", { rescore: true }), /data-score-(repair|fix)/);
    const confirm = mi.failConfirmHtml("resume", { kind: "link", href: "x", filename: "resume.pdf" }, { repair: false });
    assert.doesNotMatch(confirm, /Repair first/);
    assert.match(confirm, /data-action="materials-confirm-cancel">Cancel</);
    assert.match(mi.failConfirmHtml("resume", { kind: "link" }), /Repair first/, "a v2 FAIL still offers it");
  });
});

describe("D3 · the Repair dialog", () => {
  it("should offer an instruction box of at most 600 characters with an example placeholder", () => {
    const html = mi.repairPanelHtml("cover_letter", V2_LETTER_FAIL, {});
    assert.match(html, /<form class="mat-repair" data-repair-for="cover_letter"/);
    assert.match(html, /<textarea[^>]*maxlength="600"/);
    assert.match(html, /placeholder="e\.g\. make it less formulaic; end on something specific to them"/);
    assert.match(html, /0 \/ 600/);
    assert.match(html, /<button type="submit"[^>]*>Repair the cover letter<\/button>/);
    assert.match(html, /data-action="materials-repair-cancel">Cancel</);
  });

  it("should list one checkbox per issue id, with the hard ones pre-checked", () => {
    const html = mi.repairPanelHtml("cover_letter", V2_LETTER_FAIL, {});
    const boxes = [...html.matchAll(/<input type="checkbox" data-repair-issue value="([^"]+)"( checked)?/g)].map((m) => [m[1], !!m[2]]);
    assert.deepEqual(boxes, [["i1", true], ["i2", false], ["i3", false]]);
    assert.match(html, /The 40% churn cut is not in your background\./);
  });

  it("should fall back to the issue code when an id is missing", () => {
    const qa = { ...V2_LETTER_FAIL.qa, issues: [{ code: "i7", kind: "voice", severity: "review", sentenceIds: [], reason: "Flat opening.", action: "rewrite" }] };
    assert.match(mi.repairPanelHtml("cover_letter", { qa }, {}), /value="i7"/);
  });

  it("should keep what was typed and ticked across a repaint, and show an error", () => {
    const html = mi.repairPanelHtml("cover_letter", V2_LETTER_FAIL, {
      instruction: "end on <their> pricing launch",
      checked: { i1: false, i3: true },
      error: "This document changed since you opened it; refresh",
    });
    assert.match(html, />end on &lt;their&gt; pricing launch<\/textarea>/);
    assert.match(html, /value="i1"(?! checked)/);
    assert.match(html, /value="i3" checked/);
    assert.match(html, /role="alert">This document changed since you opened it; refresh</);
    assert.match(html, /29 \/ 600/);
  });

  it("should still offer the instruction box when a document has no issues", () => {
    const html = mi.repairPanelHtml("resume", { status: "review", issues: [] }, {});
    assert.match(html, /<textarea/);
    assert.doesNotMatch(html, /type="checkbox"/);
  });
});

describe("D4 · what a repair changed", () => {
  const diff = {
    added: 2, removed: 2,
    lines: [
      { op: "same", text: "Dear Meridian Labs team," },
      { op: "del", text: "At Contoso I cut churn by 40% across the enterprise book." },
      { op: "add", text: "At Contoso I rebuilt the renewal pricing review that the enterprise team still runs." },
    ],
  };

  it("should say No material change when the text did not move", () => {
    const html = mi.repairOutcomeHtml({ feature: "cover_letter", changed: false, adopted: true, diff: { added: 0, removed: 0, lines: [] } });
    assert.match(html, /No material change: try a more specific instruction/);
    assert.doesNotMatch(html, /mat-diff__l/);
  });

  it("should say the previous version was kept, and still show the rewrite's diff", () => {
    const html = mi.repairOutcomeHtml({ feature: "cover_letter", changed: true, adopted: false, diff });
    assert.match(html, /Kept your previous version: the rewrite introduced a factual problem/);
    assert.match(html, /mat-diff__l--add[\s\S]*renewal pricing review/);
  });

  it("should open the before/after diff for an adopted repair", () => {
    const html = mi.repairOutcomeHtml({ feature: "cover_letter", changed: true, adopted: true, diff });
    assert.match(html, /role="status"/);
    assert.match(html, /What changed in the cover letter/);
    assert.match(html, /2 lines added, 2 removed/);
    assert.match(html, /data-action="materials-repair-dismiss"/);
  });

  it("should read an unknown change from the diff itself", () => {
    const html = mi.repairOutcomeHtml({ feature: "resume", changed: null, adopted: null, diff: { added: 0, removed: 0, lines: [{ op: "same", text: "x" }] } });
    assert.match(html, /No material change/);
  });

  it("should find the repair's own run: by its parent first, else the newest other run of that document", () => {
    const runs = [
      { runId: "mr_5", date: "2026-09-28T09:50:00.000Z", documents: ["cover_letter"], active: [] },
      { runId: "mr_4", date: "2026-09-28T09:40:00.000Z", documents: ["resume"], active: ["resume"] },
      { runId: "mr_3", date: "2026-09-28T09:30:00.000Z", documents: ["cover_letter"], active: [], repair: { parentRunId: "mr_1", changed: true, adopted: false } },
      { runId: "mr_2", date: "2026-09-28T09:20:00.000Z", documents: ["cover_letter"], active: ["cover_letter"] },
      { runId: "mr_1", date: "2026-09-28T09:00:00.000Z", documents: ["cover_letter"], active: [] },
    ];
    assert.equal(mi.pickRepairRun(runs, { feature: "cover_letter", parentRunId: "mr_1" }).runId, "mr_3");
    const bare = runs.map(({ repair: _r, ...r }) => r);
    assert.equal(mi.pickRepairRun(bare, { feature: "cover_letter", parentRunId: "mr_1", since: "2026-09-28T09:10:00.000Z" }).runId, "mr_5");
    assert.equal(mi.pickRepairRun(bare, { feature: "cover_letter", parentRunId: "mr_1", since: "2026-09-28T09:55:00.000Z" }), null);
  });

  it("should take changed/adopted from the run's repair record, else from whether the run is in use", () => {
    assert.deepEqual(plain(mi.repairResultOf({ runId: "r", repair: { changed: true, adopted: false, parentRunId: "p" }, active: [] }, "cover_letter")),
      { parentRunId: "p", changed: true, adopted: false });
    assert.deepEqual(plain(mi.repairResultOf({ runId: "r", active: ["cover_letter"] }, "cover_letter")), { parentRunId: "", changed: null, adopted: true });
    assert.deepEqual(plain(mi.repairResultOf({ runId: "r", active: [] }, "cover_letter")), { parentRunId: "", changed: null, adopted: false });
  });
});

describe("D6 · the stage timeline speaks K7", () => {
  const k7 = (...pairs) => pairs.map(([stage, status, extra]) => ({ stage, status, ms: 10, ...(extra || {}) }));
  const labels = (steps) => plain(steps.map((s) => s.label));
  const states = (steps) => plain(Object.fromEntries(steps.map((s) => [s.id, s.state])));

  it("FIX1 visual: fallback notes sit outside the exact stage label", () => {
    const html = mi.timelineHtml({ phase: "drafting", stages: k7(["prepare", "ok"], ["write", "review", { degraded: true, detail: "fell back to rules: output cut off (MAX_TOKENS)" }]) }, "cover_letter");
    const labels = [...html.matchAll(/<span class="mat-tl__label">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Prepare", "Write", "Check &amp; render", "Grade", "Save"]);
    assert.match(html, /<span class="mat-tl__label">Write<\/span><span class="mat-tl__why">Fell back to rules:/);
  });

  it("should name the K7 steps in plain words", () => {
    const steps = mi.stageTimeline({ phase: "drafting", stages: k7(["prepare", "ok"], ["write", "ok"]) }, "cover_letter");
    assert.deepEqual(labels(steps), ["Prepare", "Write", "Check & render", "Grade", "Save"]);
    assert.deepEqual(states(steps), { prepare: "done", write: "done", check: "running", judge: "next", save: "next" });
  });

  it("should add a Repair pass only when the run made one, before Save, without skipping ahead", () => {
    const early = mi.stageTimeline({ phase: "drafting", stages: k7(["repair", "ok"], ["prepare", "ok"]) }, "cover_letter");
    assert.deepEqual(labels(early), ["Prepare", "Write", "Check & render", "Grade", "Repair pass", "Save"]);
    assert.equal(states(early).write, "running", "a repair record does not mark later steps done");
    assert.equal(states(early).judge, "next");
    const late = mi.stageTimeline({ phase: "drafting", stages: k7(["prepare", "ok"], ["write", "ok"], ["validate", "ok"], ["render", "ok"], ["judge", "ok"], ["repair", "ok"]) }, "cover_letter");
    assert.deepEqual(states(late), { prepare: "done", write: "done", check: "done", judge: "done", repair: "done", save: "running" });
  });

  it("should show a degraded judge in amber with its reason, and a failed stage as stopped", () => {
    const html = mi.timelineHtml({ phase: "drafting", stages: k7(["prepare", "ok"], ["write", "ok"], ["validate", "ok"], ["render", "ok"], ["judge", "review", { degraded: true, detail: "judge timed out" }]) }, "resume");
    assert.match(html, /data-step="judge" data-state="degraded"/);
    assert.match(html, /the AI provider took too long|judge timed out/i);
    const failed = mi.stageTimeline({ phase: "failed", message: "Rendering failed.", stages: k7(["prepare", "ok"], ["write", "ok"], ["validate", "failed", { detail: "unsafe markup" }]) }, "resume");
    assert.equal(states(failed).check, "failed");
  });

  it("should use the K7 names for a run that has not reported a stage yet", () => {
    assert.deepEqual(labels(mi.stageTimeline({ phase: "queued" }, "resume")), ["Prepare", "Write", "Check & render", "Grade", "Save"]);
  });

  it("should keep an old run's old labels", () => {
    const steps = mi.stageTimeline({ phase: "drafting", stages: [{ stage: "intake", status: "ok" }, { stage: "jd.resolve", status: "ok" }] }, "resume");
    assert.deepEqual(labels(steps), ["Read the job", "Load facts", "Pick facts", "Write", "Check facts", "Render", "Check quality"]);
  });

  it("should never show a raw K7 stage id", () => {
    const html = mi.timelineHtml({ phase: "drafting", stages: k7(["prepare", "ok"], ["write", "ok"], ["validate", "ok"]) }, "resume");
    assert.doesNotMatch(html, />(prepare|validate|judge|save|repair)</);
    assert.match(html, />Check &amp; render</);
  });
});
