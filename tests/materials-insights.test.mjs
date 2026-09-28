/**
 * materials-insights.js — the pure view helpers behind Materials Wave 2:
 * the stage timeline mapping (U-4), the quality scorecard (U-1), the
 * Download menu and FAIL confirm (U-3), role-term coverage (U-7) and the
 * version history + diff views (U-6). Plus the server's line diff.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { diffLines } from "../server/materials-history.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function load() {
  const window = {};
  vm.runInNewContext(readFileSync(join(repoRoot, "materials-insights.js"), "utf8"), { window }, { filename: "materials-insights.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "scribe-score-adapter.js"), "utf8"), { window, document: undefined, console }, { filename: "scribe-score-adapter.js" });
  return window;
}

const win = load();
const mi = win.JobBoredMaterialsInsights;

const stages = (...pairs) => pairs.map(([stage, status, reason]) => (reason ? { stage, status, reason } : { stage, status }));
const stateOf = (steps) => JSON.parse(JSON.stringify(Object.fromEntries(steps.map((s) => [s.id, s.state]))));

/* The Northwind failure the spec traced: 0 experience bullets, 2 AI steps
   fell back, QA FAIL 6/12. */
const NORTHWIND_FAIL = {
  status: "fail",
  issues: [{ code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" }],
  qa: {
    runId: "mr_20260927_northwind_086c",
    status: "fail",
    disposition: "FAIL",
    dispositionReason: "Resume is missing an experience section.",
    degraded: [
      "jd.extract: deterministic half (output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts)",
      "claims.select: deterministic ranks (reply was not valid JSON after 2 attempts)",
    ],
    rubric: {
      score: 6, max: 12, threshold: 10,
      rows: [
        { id: "outcome_coverage", score: 0, max: 2, note: "0/3 outcomes mapped by kept claims" },
        { id: "noun_fidelity", score: 0, max: 2, note: "0/24 role nouns appear in the resume" },
        { id: "proof_density", score: 1, max: 2, note: "1/4 kept claims carry metrics" },
        { id: "transfer_honesty", score: 2, max: 2, note: "every tool is evidenced" },
        { id: "delint_clean", score: 2, max: 2, note: "clean" },
        { id: "underfill", score: 1, max: 2, note: "page 48% full; 0 experience bullets" },
      ],
    },
  },
};

describe("U-4 · stage timeline mapping", () => {
  it("should name the seven steps in order", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(mi.TIMELINE_STEPS.map((s) => s.label))), [
      "Read the job", "Load facts", "Pick facts", "Write", "Check facts", "Render", "Check quality",
    ]);
  });

  it("should show every step as next while the run is queued", () => {
    const steps = mi.stageTimeline({ phase: "queued" }, "resume");
    assert.ok(steps.every((s) => s.state === "next"));
  });

  it("should mark finished steps done and the step holding the next stage running", () => {
    const steps = mi.stageTimeline({
      phase: "drafting",
      stages: stages(["intake", "ok"], ["jd.resolve", "ok"], ["jd.gate", "ok"], ["claims.load", "ok"], ["cache.lookup", "ok"],
        ["jd.extract", "ok"], ["claims.score", "ok"], ["claims.select", "ok"], ["outline", "ok"]),
    }, "resume");
    assert.deepEqual(stateOf(steps), {
      read: "done", load: "done", pick: "done", write: "running", check: "next", render: "next", quality: "next",
    });
  });

  it("should keep Read the job running while the AI extract works after the facts load", () => {
    const steps = mi.stageTimeline({
      phase: "drafting",
      stages: stages(["intake", "ok"], ["jd.resolve", "ok"], ["jd.gate", "ok"], ["claims.load", "ok"], ["cache.lookup", "ok"]),
    }, "resume");
    assert.equal(stateOf(steps).read, "running");
    assert.equal(stateOf(steps).load, "done");
  });

  it("should turn a fallen-back step amber with the reason in plain words", () => {
    const steps = mi.stageTimeline({
      phase: "drafting",
      stages: stages(["intake", "ok"], ["jd.resolve", "ok"], ["jd.gate", "ok"], ["claims.load", "ok"], ["cache.lookup", "ok"],
        ["jd.extract", "review", "fell back to rules: output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts"], ["claims.score", "ok"]),
    }, "resume");
    const read = steps.find((s) => s.id === "read");
    assert.equal(read.state, "degraded");
    assert.equal(read.fellBack, true);
    const html = mi.timelineHtml({ phase: "drafting", stages: [
      { stage: "intake", status: "ok" }, { stage: "jd.resolve", status: "ok" }, { stage: "jd.gate", status: "ok" },
      { stage: "claims.load", status: "ok" }, { stage: "cache.lookup", status: "ok" },
      { stage: "jd.extract", status: "review", reason: "fell back to rules: output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts" },
    ] }, "resume");
    assert.match(html, /mat-tl__step--degraded" data-step="read"/);
    assert.match(html, />Fallback</);
    assert.match(html, /Fell back to rules: the AI’s answer was cut off/);
  });

  it("should skip the letter-only fact check on a resume run", () => {
    const steps = mi.stageTimeline({
      phase: "drafting",
      stages: stages(["intake", "ok"], ["jd.resolve", "ok"], ["jd.gate", "ok"], ["claims.load", "ok"], ["cache.lookup", "ok"],
        ["jd.extract", "ok"], ["claims.score", "ok"], ["claims.select", "ok"], ["outline", "ok"], ["draft", "ok"], ["delint", "ok"], ["tag-metrics", "ok"]),
    }, "resume");
    assert.equal(stateOf(steps).check, "done");
    assert.equal(stateOf(steps).render, "running");
  });

  it("should stop the timeline at the step where a failed run died", () => {
    const steps = mi.stageTimeline({
      phase: "failed",
      message: "The AI provider failed. Try again.",
      stages: stages(["intake", "ok"], ["jd.resolve", "ok"], ["jd.gate", "ok"], ["claims.load", "ok"], ["cache.lookup", "ok"],
        ["jd.extract", "ok"], ["claims.score", "ok"], ["claims.select", "ok"], ["outline", "ok"]),
    }, "cover_letter");
    assert.equal(stateOf(steps).write, "failed");
    assert.equal(steps.find((s) => s.id === "write").reason, "The AI provider failed. Try again.");
    assert.equal(stateOf(steps).render, "next");
  });

  it("should never show a raw stage id or status pair in the timeline", () => {
    const html = mi.timelineHtml({ phase: "drafting", stages: stages(["intake", "ok"], ["claims.select", "review", "the AI's picks couldn't be used"]) }, "resume");
    assert.doesNotMatch(html, /claims\.select|jd\.extract|: running|: review/);
  });
});

describe("U-1 · quality scorecard", () => {
  it("should pill the verdict with its score", () => {
    assert.equal(mi.pillText(NORTHWIND_FAIL), "FAIL · 6 / 12");
    assert.equal(mi.isFail(NORTHWIND_FAIL), true);
    assert.equal(mi.isFail({ status: "review", issues: [], qa: { ...NORTHWIND_FAIL.qa, disposition: "REVIEW" } }), false);
  });

  it("should explain the Northwind failure and offer the fix", () => {
    const html = mi.scorecardHtml(NORTHWIND_FAIL, "resume");
    assert.match(html, /data-qa-disposition="FAIL"/);
    assert.match(html, /This resume failed its quality check\./);
    assert.match(html, /Resume is missing an experience section\./);
    assert.match(html, /2 AI steps fell back to rules:/);
    assert.match(html, /Reading the job fell back to rules: the AI’s answer was cut off\./);
    assert.match(html, /Picking your facts fell back to rules: the AI’s answer couldn’t be read\./);
    assert.match(html, /data-action="materials-open-profile" data-focus="details">Review your details</);
    /* MREV D2: an old (rubric) run is read-only; Repair needs a v2 run. */
    assert.doesNotMatch(html, /materials-repair/);
    assert.match(html, /Graded by the old checker/);
    /* Rubric rows as pips, open on a FAIL. */
    assert.match(html, /<details class="mat-rubric" open><summary>Quality check · 6 of 12/);
    assert.match(html, /data-rubric="outcome_coverage"[\s\S]*?Job outcomes covered[\s\S]*?0 \/ 2/);
    assert.match(html, /0 experience bullets/);
    assert.equal((html.match(/mat-pip--on/g) || []).length, 6);
  });

  it("should point a letter that sounds machine-made at the voice guide", () => {
    const html = mi.scorecardHtml({
      status: "review",
      issues: [{ code: "sounds_machine", message: "Two stock phrases.", severity: "review" }],
      qa: { disposition: "REVIEW", dispositionReason: "rubric 9/12 below 10", degraded: [], rubric: { score: 9, max: 12, rows: [{ id: "sounds_human", score: 1, max: 2, note: "two tells" }] } },
    }, "cover_letter");
    assert.match(html, /This cover letter needs a look before you send it\./);
    assert.match(html, /It scored 9 of 12; a ready draft needs 10\./);
    assert.match(html, /Add a voice guide/);
    assert.match(html, /<details class="mat-rubric">/, "closed on REVIEW");
  });

  it("should show a READY verdict without a banner", () => {
    const html = mi.scorecardHtml({ status: "pass", issues: [], qa: { disposition: "READY", degraded: [], rubric: { score: 12, max: 12, rows: [] } } }, "resume");
    assert.match(html, /mat-pill--ready">READY · 12 \/ 12/);
    assert.doesNotMatch(html, /mat-banner/);
  });

  it("should render nothing without a pipeline verdict", () => {
    assert.equal(mi.scorecardHtml({ status: "review", issues: [{ code: "x", message: "y" }] }, "resume"), "");
  });

  it("should say a missing model in plain words", () => {
    assert.equal(mi.plainDegraded("no pin: every model stage degrades"), "No AI model is set up, so every step used rules.");
    assert.equal(mi.plainDegraded("draft: verbatim claim text (rate limited (HTTP 429) after 3 attempts)"), "Writing fell back to rules: the AI provider was busy.");
  });
});

describe("U-3 · Download menu and the FAIL confirm", () => {
  const opts = {
    type: "resume",
    pdfHref: "http://127.0.0.1:3847/api/applications/a/files/resume.pdf?download=1",
    txtHref: "http://127.0.0.1:3847/api/applications/a/files/resume.txt?download=1",
    docxHref: "http://127.0.0.1:3847/api/applications/a/export/resume.docx?download=1",
    linkedin: true,
  };

  it("should offer PDF, ATS text, Word and LinkedIn copy", () => {
    const html = mi.downloadMenuHtml(opts);
    assert.match(html, /aria-haspopup="true" aria-expanded="false">Download</);
    const titles = [...html.matchAll(/mat-dl__title">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(titles, ["PDF", "ATS plain text", "Word document", "Copy for LinkedIn"]);
    assert.match(html, /data-filename="resume\.txt"/);
    assert.match(html, /data-filename="resume\.docx"/);
    assert.doesNotMatch(html, /data-gate/);
  });

  it("should gate every entry on a FAIL verdict", () => {
    const html = mi.downloadMenuHtml({ ...opts, fail: true });
    assert.equal((html.match(/data-gate="fail"/g) || []).length, 4);
  });

  it("should leave LinkedIn copy off the cover letter", () => {
    const html = mi.downloadMenuHtml({ ...opts, type: "cover_letter", linkedin: false });
    assert.doesNotMatch(html, /LinkedIn/);
    assert.match(html, /data-filename="cover-letter\.pdf"/);
  });

  it("should ask in the page, with Download anyway and Repair first", () => {
    const html = mi.failConfirmHtml("resume", { kind: "link", href: opts.pdfHref, filename: "resume.pdf" });
    assert.match(html, /role="alertdialog"/);
    assert.match(html, />This draft failed its quality check\. Download anyway\?</);
    assert.match(html, /data-action="materials-download-anyway" data-kind="link" data-href="[^"]+resume\.pdf/);
    assert.match(html, /data-action="materials-repair" data-feature="resume">Repair first</);
  });
});

describe("U-7 · role-term coverage", () => {
  it("should count the rubric's nouns with Scribe's keywordCoverage", () => {
    const terms = mi.termsFromExtract({ nouns: [{ term: "streaming audio" }, { term: "Podcast" }, { term: "podcast" }, { term: "CTV" }, { term: "" }] });
    assert.deepEqual([...terms], ["streaming audio", "Podcast", "CTV"]);
    const cov = win.JobBoredScribeScore.keywordCoverage("Led streaming audio and podcast sales.", terms);
    const html = mi.coverageHtml(cov, "resume");
    assert.match(html, /<b>2 \/ 3<\/b> role terms/);
    assert.match(html, /1 missing/);
    assert.match(html, /mat-kw__chip">CTV</);
  });

  it("should render nothing when the posting named no terms", () => {
    assert.equal(mi.coverageHtml({ matched: [], missing: [], total: 0 }, "resume"), "");
  });
});

describe("U-6 · versions and diff", () => {
  const runs = [
    { runId: "mr_3", date: "2026-09-27T15:00:00.000Z", template: "dossier", documents: ["resume"], verdicts: { resume: { disposition: "READY", score: 11, max: 12 } }, active: ["resume"] },
    { runId: "mr_2", date: "2026-09-27T14:00:00.000Z", template: "signal", documents: ["cover_letter"], verdicts: {}, active: ["cover_letter"] },
    { runId: "mr_1", date: "2026-09-27T13:00:00.000Z", template: "signal", documents: ["resume"], verdicts: { resume: { disposition: "FAIL", score: 6, max: 12 } }, active: [] },
  ];

  it("should list this document's runs with verdicts, the one in use, and a compare form", () => {
    const html = mi.historyHtml(runs, "resume");
    assert.equal((html.match(/mat-hist__run"/g) || []).length, 2);
    assert.match(html, /data-run="mr_3"[\s\S]*?READY · 11 \/ 12[\s\S]*?In use/);
    assert.match(html, /data-run="mr_1"[\s\S]*?FAIL · 6 \/ 12[\s\S]*?data-action="materials-promote" data-run="mr_1"/);
    assert.match(html, /<select data-hist-a><option value="mr_3">[^<]*<\/option><option value="mr_1" selected>/);
  });

  it("should say so when a document has no versions", () => {
    assert.match(mi.historyHtml([], "cover_letter"), /No earlier versions of this cover letter yet\./);
  });

  it("should diff two texts by line and render additions and removals", () => {
    const lines = diffLines("Name\nOld line\nShared\n", "Name\nNew line\nShared\nAdded\n");
    assert.deepEqual(lines, [
      { op: "same", text: "Name" },
      { op: "del", text: "Old line" },
      { op: "add", text: "New line" },
      { op: "same", text: "Shared" },
      { op: "add", text: "Added" },
    ]);
    const html = mi.diffHtml({ lines, added: 2, removed: 1 });
    assert.match(html, /2 lines added, 1 removed/);
    assert.match(html, /mat-diff__l--del"><span class="mat-diff__s" aria-hidden="true">−<\/span><span class="mat-vh">removed: <\/span>Old line/);
    assert.match(mi.diffHtml({ lines: [{ op: "same", text: "x" }], added: 0, removed: 0 }), /say the same thing/);
  });
});

describe("Wave 3 surfaces · outreach note and company facts", async () => {
  const { W3_OUTREACH, W3_INTEL, W3_MANIFEST_EXTRA } = await import("./fixtures/materials-w3-package.mjs");

  it("should show the LinkedIn note and the email, each with Copy", () => {
    const html = mi.outreachHtml(W3_OUTREACH, W3_MANIFEST_EXTRA.outreach);
    assert.match(html, /To Dana/);
    assert.match(html, /data-out="linkedin"[\s\S]*?LinkedIn note[\s\S]*?\d+ \/ 300 characters/);
    assert.match(html, /data-out="email"[\s\S]*?45 \/ 120 words[\s\S]*?Subject: Senior Product Manager: pricing roadmap/);
    assert.equal((html.match(/data-action="materials-copy-text"/g) || []).length, 2);
    assert.match(html, /mat-out__flags[\s\S]*No support verdicts/);
  });

  it("should read the QA pill from manifest.outreach.qa, its status, or the record", () => {
    assert.equal(mi.outreachStatus({ qa: { status: "fail" } }, null), "fail");
    assert.equal(mi.outreachStatus({ status: "pass" }, null), "ready");
    assert.equal(mi.outreachStatus({}, W3_OUTREACH), "review");
    assert.equal(mi.outreachStatus(null, null), "");
  });

  it("should render nothing for an absent or empty note", () => {
    assert.equal(mi.outreachHtml(null, null), "");
    assert.equal(mi.outreachHtml({ linkedin: { text: "" }, email: { body: "" } }, null), "");
  });

  it("should list intel facts with dates and source links, like the server's intelFacts", () => {
    const facts = mi.intelFactsFrom(W3_INTEL, W3_MANIFEST_EXTRA.intel);
    assert.deepEqual(JSON.parse(JSON.stringify(facts.map((f) => [f.kind, f.date]))), [["news", "2026-08"], ["product", "2026-09-27"], ["mission", "2026-09-27"]]);
    const html = mi.intelHtml(facts, "Meridian Labs", "");
    assert.match(html, /<details class="mat-intel"><summary>Company facts about Meridian Labs · 3<\/summary>/);
    assert.match(html, /News · 2026-08[\s\S]*?Meridian Labs raises a Series B: to expand its pricing platform[\s\S]*?href="https:\/\/news\.example\.com\/meridian-series-b"[^>]*>news\.example\.com</);
    assert.equal(mi.intelHtml([], "x", ""), "");
    assert.equal(mi.intelFactsFrom(null, null).length, 0);
  });

  it("should prefer manifest.intel.facts when it is a list, and drop non-http links", () => {
    const facts = mi.intelFactsFrom(null, { facts: [{ kind: "news", text: "A fact", date: "2026-09", url: "javascript:alert(1)" }] });
    const html = mi.intelHtml(facts, "", "search failed");
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /may be short/);
  });
});
