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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function load() {
  const window = {};
  vm.runInNewContext(readFileSync(join(repoRoot, "materials-insights.js"), "utf8"), { window }, { filename: "materials-insights.js" });
  return window.JobBoredMaterialsInsights;
}

const mi = load();
const plain = (v) => JSON.parse(JSON.stringify(v));

/* The HTML between one element's open tag and the next group marker. */
function group(html, name) {
  const start = html.indexOf(`data-group="${name}"`);
  if (start < 0) return "";
  const next = html.indexOf("data-group=", start + 12);
  return html.slice(start, next < 0 ? undefined : next);
}

describe("D1 · scorecard v2 reads the K3 record", () => {
  it("FIX1 P1-1: the whole verdict uses grading model copy for success, unsupported facts and failures", () => {
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
      const html = mi.scorecardHtml({ qa }, "cover_letter");
      const verdict = html.match(/<div class="mat-verdict [^"]*">([\s\S]*?)<\/div>/);
      assert.ok(verdict);
      const text = verdict[1].replace(/<[^>]*>/g, " ");
      assert.doesNotMatch(text, /\bjudge\b/i, status);
      assert.match(text, /grading model/i, status);
    }
  });
  it("should pill the verdict with its score out of 100", () => {
    assert.equal(mi.pillText(V2_LETTER_FAIL), "FAIL · 64 / 100");
    assert.equal(mi.pillText(V2_RESUME_READY_SAME_MODEL), "READY · 86 / 100");
    assert.equal(mi.pillText(V2_LETTER_JUDGE_DOWN), "REVIEW", "no score when nobody graded it");
    assert.equal(mi.isFail(V2_LETTER_FAIL), true);
    assert.equal(mi.dispositionOf(V2_LETTER_JUDGE_DOWN), "REVIEW");
  });

  it("should give the verdict's reason in one line", () => {
    const html = mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter");
    assert.match(html, /data-qa-disposition="FAIL"/);
    assert.match(html, /data-qa-contract="v2"/);
    assert.match(html, /class="mat-verdict__why">One sentence claims a result your background doesn(’|&#39;)t support\.</);
  });

  it("should keep factual blockers apart from writing feedback, with the sentence quoted", () => {
    const html = mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter");
    const facts = group(html, "facts");
    const check = group(html, "check");
    const writing = group(html, "writing");
    assert.ok(facts && writing, "both groups render");
    assert.ok(html.indexOf('data-group="facts"') < html.indexOf('data-group="writing"'), "blockers come first");
    /* The blocker quotes the unsupported sentence and says why. */
    assert.match(facts, /Factual blockers/);
    assert.match(facts, /<q class="mat-issue__quote">At Contoso I cut churn by 40% across the enterprise book\.<\/q>/);
    assert.match(facts, /The 40% churn cut is not in your background\./);
    assert.doesNotMatch(facts, /stock line|usage-based/);
    /* An uncertain fact is not a blocker, and not a writing note either. */
    assert.match(check, /usage-based pricing/);
    /* The writing note stays in its own group, never among the facts. */
    assert.match(writing, /Writing feedback/);
    assert.match(writing, /The close is a stock line; end on something specific to them\./);
    assert.match(writing, /<q class="mat-issue__quote">Worth a quick call this week\?<\/q>/);
    assert.doesNotMatch(writing, /churn/);
  });

  it("should show the five judge dimensions scored 0–4, each with its reason, and the total out of 100", () => {
    const html = mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter");
    const dims = [...html.matchAll(/data-dimension="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(dims, ["role_relevance", "evidence_quality", "voice", "coherence", "economy"]);
    assert.match(html, /<summary>Writing quality · 64 \/ 100<\/summary>/);
    assert.match(html, /data-dimension="evidence_quality"[\s\S]*?2 \/ 4[\s\S]*?One result has no source in your background\./);
    assert.match(html, /data-dimension="voice"[\s\S]*?The close reads like a template line\./);
    /* Four pips per dimension, lit to the score: 3+2+2+3+3. */
    const dimsHtml = html.slice(html.indexOf('class="mat-dims"'));
    assert.equal((dimsHtml.match(/mat-pip--on/g) || []).length, 13);
  });

  it("should list gaps in the background as information, not as a defect", () => {
    const html = mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter");
    const gaps = group(html, "gaps");
    assert.match(gaps, /Gaps in your background for this role · 2/);
    assert.match(gaps, /managing a team of 10 or more/);
    assert.match(gaps, /No marketplace experience on file\./);
    assert.match(gaps, /not a problem with the writing/i);
    assert.doesNotMatch(gaps, /mat-issue--hard|fail/i);
  });

  /* J-FE4: who graded it, and when nobody did, why, with the two ways out. */
  const judgeDown = (judge) => ({ ...V2_LETTER_JUDGE_DOWN, qa: { ...V2_LETTER_JUDGE_DOWN.qa, judge: { ...V2_LETTER_JUDGE_DOWN.qa.judge, ...judge } } });
  const verdictLine = (html) => {
    const at = html.indexOf('class="mat-verdict__judge"');
    return at < 0 ? "" : html.slice(at, html.indexOf("</p>", at));
  };
  /* The words a reader sees in the line: tags and attributes dropped. */
  const visible = (line) => line.replace(/<[^>]*>/g, " ").replace(/^[^>]*>/, "");

  it("should say which grading model graded it, never 'judge'", () => {
    assert.match(mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter"), /data-judge="independent">Graded by grok-judge-1</);
    const down = mi.scorecardHtml(V2_LETTER_JUDGE_DOWN, "cover_letter");
    assert.doesNotMatch(down, /Writing quality ·/, "no score to show");
    for (const html of [mi.scorecardHtml(V2_LETTER_FAIL, "cover_letter"), mi.scorecardHtml(V2_RESUME_READY_SAME_MODEL, "resume"), down]) {
      /* The fixture's fictional model id is "grok-judge-1"; only our own words count. */
      assert.doesNotMatch(visible(verdictLine(html)).replace(/grok-judge-1/g, ""), /judge/i);
    }
  });

  it("J-FE4a · a timeout names the model and how long it waited, with Try again and Change", () => {
    const line = verdictLine(mi.scorecardHtml(judgeDown({ status: "unavailable", errorCode: "timeout", latencyMs: 240000 }), "cover_letter"));
    assert.match(line, /data-judge="unavailable"/);
    assert.match(line, /Grading by grok-judge-1 didn(’|&#39;|')t finish: it timed out after 240 s\./);
    assert.match(line, /<button[^>]*data-action="materials-retry"[^>]*data-feature="cover_letter"[^>]*>Try again<\/button>/);
    assert.match(line, /<button[^>]*data-action="settings-open-grading"[^>]*>Change grading model<\/button>/);
  });

  it("J-FE4b · a rejected key says so and links to the grading model settings", () => {
    const line = verdictLine(mi.scorecardHtml(judgeDown({ status: "unavailable", errorCode: "auth" }), "resume"));
    assert.match(line, /the key was rejected\./);
    assert.match(line, /data-action="settings-open-grading"[^>]*>Change grading model</);
    assert.match(line, /data-feature="resume"[^>]*>Try again</);
    const noKey = verdictLine(mi.scorecardHtml(judgeDown({ status: "unavailable", errorCode: "unconfigured" }), "resume"));
    assert.match(noKey, /no key is saved for it\./);
    const busy = verdictLine(mi.scorecardHtml(judgeDown({ status: "unavailable", errorCode: "rate_limited" }), "resume"));
    assert.match(busy, /the provider was busy\./);
  });

  it("J-FE4c · an unusable grade reads differently from an unavailable model", () => {
    const invalid = verdictLine(mi.scorecardHtml(judgeDown({ status: "invalid", errorCode: "invalid_judgment" }), "cover_letter"));
    const unavailable = verdictLine(mi.scorecardHtml(judgeDown({ status: "unavailable" }), "cover_letter"));
    assert.match(invalid, /data-judge="invalid"/);
    assert.match(invalid, /it returned a grade we couldn(’|&#39;|')t use\./);
    assert.match(unavailable, /data-judge="unavailable"/);
    assert.match(unavailable, /it didn(’|&#39;|')t answer\./);
    assert.notEqual(visible(invalid), visible(unavailable));
    /* A pre-BE2 invalid record with no errorCode still reads as unusable. */
    assert.match(verdictLine(mi.scorecardHtml(judgeDown({ status: "invalid" }), "cover_letter")), /couldn(’|&#39;|')t use/);
  });

  it("J-FE4d · a self-graded document names the writer and offers a second opinion", () => {
    const line = verdictLine(mi.scorecardHtml(V2_RESUME_READY_SAME_MODEL, "resume"));
    assert.match(line, /data-judge="same"/);
    assert.match(line, /Graded by your writing model \(gemini-writer-1\)\./);
    assert.match(line, /<button[^>]*data-action="settings-open-grading"[^>]*>Add a second opinion<\/button>/);
    assert.doesNotMatch(line, /Try again/);
  });

  it("should never lose an unsupported sentence or a failed hard gate the issues list left out", () => {
    const qa = {
      ...V2_LETTER_FAIL.qa,
      issues: [],
      gates: [{ id: "metric_mismatch", kind: "hard", pass: false, reason: "The 18% figure differs from your claim (12%).", sentenceIds: [] }],
    };
    const facts = group(mi.scorecardHtml({ status: "fail", issues: [], qa }, "cover_letter"), "facts");
    assert.match(facts, /At Contoso I cut churn by 40%/);
    assert.match(facts, /No claim mentions a churn figure\./);
    assert.match(facts, /The 18% figure differs from your claim \(12%\)\./);
  });

  it("Grok P2 · should show every failed hard gate, even when another gate already has its issue", () => {
    const qa = {
      ...V2_LETTER_FAIL.qa,
      sentences: [],
      issues: [{ id: "i1", code: "i1", kind: "fact", severity: "hard", sentenceIds: [], reason: "Invented tools: rust.", action: "rewrite", origin: "gate" }],
      gates: [
        { id: "tool_support", kind: "hard", pass: false, reason: "Invented tools: rust.", sentenceIds: [] },
        { id: "metric_mismatch", kind: "hard", pass: false, reason: "The 18% figure differs from your claim (12%).", sentenceIds: [] },
      ],
    };
    const facts = group(mi.scorecardHtml({ status: "fail", issues: [], qa }, "cover_letter"), "facts");
    assert.match(facts, /The 18% figure differs from your claim \(12%\)\./, "the second blocker still shows");
    assert.equal((facts.match(/Invented tools: rust\./g) || []).length, 1, "a gate with its own issue shows once");
  });

  it("Grok P3 · should escape every record field it prints: reason, issue, dimension, gap, judge, instruction, diff", () => {
    const x = "<b>x</b>";
    const qa = {
      ...V2_LETTER_FAIL.qa,
      dispositionReason: `why ${x}`,
      issues: V2_LETTER_FAIL.qa.issues.map((i) => ({ ...i, reason: `issue ${x}` })),
      quality: { score: 64, ratings: V2_LETTER_FAIL.qa.quality.ratings.map((r) => ({ ...r, reason: `dim ${x}` })) },
      qualificationGaps: [`gap ${x}`],
      judge: { ...V2_LETTER_FAIL.qa.judge, model: `model ${x}` },
    };
    const html = mi.scorecardHtml({ status: "fail", issues: [], qa }, "cover_letter");
    for (const label of ["why", "issue", "dim", "gap", "model"]) {
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
    const html = mi.scorecardHtml({ status: "fail", issues: [], qa }, "cover_letter");
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x/);
  });

  it("should offer Repair on every v2 verdict, READY included", () => {
    for (const [fixture, type] of [[V2_LETTER_FAIL, "cover_letter"], [V2_RESUME_READY_SAME_MODEL, "resume"], [V2_LETTER_JUDGE_DOWN, "cover_letter"]]) {
      assert.match(mi.scorecardHtml(fixture, type), new RegExp(`data-action="materials-repair" data-feature="${type}">Repair<`));
    }
    assert.equal(mi.canRepair(V2_LETTER_FAIL), true);
  });
});

describe("D2 · old runs still render, read-only", () => {
  it("should render a v1 rubric record in the old style with a graded-by-the-old-checker note", () => {
    const html = mi.scorecardHtml(V1_RESUME_FAIL, "resume");
    assert.match(html, /data-qa-contract="v1"/);
    assert.match(html, /This resume failed its quality check\./);
    assert.match(html, /<details class="mat-rubric" open><summary>Quality check · 6 of 12/);
    assert.match(html, /Graded by the old checker/);
    assert.equal(mi.pillText(V1_RESUME_FAIL), "FAIL · 6 / 12");
  });

  it("should offer no Repair on an old run: its run has no per-document draft to rewrite from", () => {
    assert.doesNotMatch(mi.scorecardHtml(V1_RESUME_FAIL, "resume"), /materials-repair/);
    assert.equal(mi.canRepair(V1_RESUME_FAIL), false);
    assert.equal(mi.canRepair(undefined), true, "no verdict at all: the server decides");
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
