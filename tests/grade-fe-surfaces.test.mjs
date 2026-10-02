/* grade-fe-surfaces.test.mjs — GRADE lane W-FE: no number anywhere.

   D1/D7 (SPEC-GRADE A2 "Scope of D1"): the verdict button, the modal, both
   version lists, the Case tile and "You have", Scribe's header and the
   legacy draft modal show no "/ 100", "of 100", letter grade or ATS "%"
   in their text or aria — even when the ATS scorecard in the store says
   91. G3: the Case tile is this draft's requirement coverage. G2: no
   browser file reads quality.score or renders overallScore. */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

import * as V3 from "./fixtures/materials-qa-v3.mjs";
import { V2_LETTER_FAIL, V1_RESUME_FAIL } from "./fixtures/materials-qa-v2.mjs";
import { load, makeScoreEnv, repoRoot, text } from "./fixtures/holes-score-dom.mjs";

const NUMBERS = /\/\s*100|\bof 100\b|\d+\s*%|\bGrade [A-F][+-]?\b|\b[A-F][+-]?\s·\s\d+|\b91\b/;
const ATS = { overallScore: 91, dimensionScores: { requirementsCoverage: 88, experienceRelevance: 90, impactClarity: 80, atsParseability: 95, toneFit: 85 }, topStrengths: ["Ships forecasts"], criticalGaps: [], evidence: [], rewriteSuggestions: [], confidence: 0.8, model: "ats-model-1" };
const qd = (qa) => ({ status: "pass", issues: [], qa });
const RECORDS = [...Object.values(V3.RECORD_FIXTURES), V3.LEGACY_V2, V3.LEGACY_V1, V2_LETTER_FAIL.qa, V1_RESUME_FAIL.qa];

/** Every text node and every aria-label / title under `root` — except a
    quoted sentence of the user's own draft (<q>), which may say "40%". */
function said(root) {
  const out = [];
  const walk = (n) => {
    if (String(n.tagName || "").toLowerCase() === "q") return;
    const kids = n.childNodes || n.children || [];
    if (n.nodeType === 3 || !kids.length) out.push(n.textContent || n.value || "");
    for (const k of ["aria-label", "title", "aria-description"]) {
      const v = n.getAttribute && n.getAttribute(k);
      if (v) out.push(v);
    }
    for (const c of kids) walk(c);
  };
  walk(root);
  return out.join(" \n ");
}

function assertNoNumbers(root, where, reads = /Ready|Fails|Needs review|Not rescored|Not graded|Graded by/) {
  const all = said(root);
  assert.match(all, reads, `${where}: the walk read the surface`);
  assert.doesNotMatch(all, NUMBERS, `${where} shows a total, a letter or an ATS %`);
  assert.equal(root.querySelector("[data-grade]"), null, `${where} carries a letter attribute`);
}

function scoreEnv() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

describe("GRADE-F G1 · the button, the modal and both version lists show no number", () => {
  it("GRADE-F G1: no button or modal over any fixture shows '/ 100', 'of 100', a letter or an ATS %", () => {
    const win = scoreEnv();
    const ms = win.JobBoredMaterialsScore;
    const open = { why: true, coverage: true, writing: true, reviews: true, versions: true, rewrites: true, keywords: true };
    for (const rec of RECORDS) {
      const box = win.document.createElement("div");
      const view = ms.verdictView(qd(rec));
      box.innerHTML = ms.buttonHtml(view, { feature: "cover_letter", scope: "row" })
        + ms.modalHtml(ms.modelOf({ feature: "cover_letter", qualityDoc: qd(rec), ats: { result: ATS, feature: "cover_letter" }, keywords: { matched: ["forecasting"], missing: ["mentoring"], total: 2 }, can: { fix: true, repair: true, rescore: true, promote: true } }), { open, history: V3.RUN_SUMMARIES });
      assertNoNumbers(box, `${rec.contract} ${rec.disposition}`);
    }
  });

  it("GRADE-F G1: both version lists over every RunSummary show no number", () => {
    const win = scoreEnv();
    for (const feature of ["resume", "cover_letter"]) {
      const box = win.document.createElement("div");
      box.innerHTML = win.JobBoredMaterialsScore.versionsHtml(V3.RUN_SUMMARIES, feature, { base: "", promote: true, rescore: true })
        + win.JobBoredMaterialsInsights.historyHtml(V3.RUN_SUMMARIES, feature, { base: "" });
      assertNoNumbers(box, `${feature} versions`);
    }
  });
});

/* ---------- The Case (role-case-model.js + role-case.js) ---------- */

const STAGES = ["new", "researching", "applied", "rejected"];
const stages = { pairs: () => STAGES.map((k) => ({ key: k, label: k })), toKey: (v) => (STAGES.includes(v) ? v : ""), toLabel: String, isClosed: (v) => v === "rejected" };

function caseWindow() {
  const window = { JobBoredStages: stages };
  for (const f of ["jb-text.js", "dossier-field-provenance.js", "recruiter-strip.js", "materials-insights.js", "materials-score.js", "role-case-model.js", "role-case.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, f), "utf8"), { window }, { filename: f });
  }
  return window;
}

function caseDeps(over = {}) {
  return {
    vm: { job: { jobKey: "job-1", role: "Dispatch analyst", company: "Acme Robotics", stage: "researching", links: [], requirements: [], enrichment: { status: "ready" } } },
    keywords: null,
    scorecard: { feature: "resume_update", storedAt: "2026-10-02T10:00:00Z", result: ATS },
    manifest: { documents: [], pending: null, runId: V3.V3_READY.runId, quality: { documents: { resume: qd({ ...V3.V3_COVERAGE_MISSES, document: "resume" }) } } },
    materialsError: "", stages, nowMs: Date.parse("2026-10-02T12:00:00Z"),
    parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}

function renderCase(over) {
  const w = caseWindow();
  const model = w.JobBoredCase.model.buildCaseModel("job-1", caseDeps(over));
  const mount = { innerHTML: "" };
  w.JobBoredCase.render(mount, model);
  return { html: mount.innerHTML, model };
}

describe("GRADE-F G3 · the Case tile is this draft's requirement coverage", () => {
  it("GRADE-F G3: the tile reads 'Covers 1 of 3 requirements' and names what is missing, tied to the run", () => {
    const { html, model } = renderCase();
    assert.equal(model.numbers.ats, undefined, "the ATS number left the model");
    assert.deepEqual({ ...model.score.coverage, missing: [...model.score.coverage.missing] }, { covered: 1, total: 3, missing: ["Team mentoring"], runId: V3.V3_READY.runId, stale: false });
    const tile = /<li><(?:div|button)[^>]*data-num="coverage"[\s\S]*?<\/li>/.exec(html);
    assert.ok(tile, "the coverage tile renders");
    assert.match(tile[0], /Covers 1 of 3 requirements/);
    assert.match(tile[0], /missing: Team mentoring/);
    assert.match(tile[0], /data-score-open[^>]*data-feature="resume"/, "the tile opens the modal");
    assert.doesNotMatch(html, /<small>\/100<\/small>|data-num="ats"/);
  });

  it("GRADE-F G3: a stale tile says 'From an earlier version'; a record with no coverage shows no number", () => {
    const stale = renderCase({ scoreStale: () => true }).html;
    assert.match(stale, /From an earlier version/);
    const legacy = renderCase({ manifest: { documents: [], pending: null, quality: { documents: { resume: qd({ ...V3.V3_LEGACY_V1_VIEW }) } } } });
    assert.equal(legacy.model.score.coverage, null);
    const tile = /data-num="coverage"[\s\S]*?<\/li>/.exec(legacy.html);
    if (tile) assert.doesNotMatch(tile[0].replace(/<[^>]+>/g, " "), /\d/);
  });

  it("GRADE-F G1: 'You have' is the verdict button, and the Case shows no ATS number", () => {
    const { html } = renderCase();
    const you = /<section class="case__section case__section--you">([\s\S]*?)<\/section>/.exec(html);
    assert.ok(you, "You have renders");
    assert.match(you[1], /class="jb-grade"[^>]*data-scope="case"[^>]*>[\s\S]*Ready/);
    const visible = html.replace(/<[^>]+aria-label="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visible, NUMBERS);
    assert.doesNotMatch(html, /Scorecard dimensions|case__dim/);
  });
});

/* ---------- Scribe's header (scribe-v2.js) ---------- */

describe("GRADE-F G1 · Scribe's header", () => {
  it("GRADE-F G1: the header button is the open document's verdict, with no number", async () => {
    const win = makeScoreEnv({ bodyClass: "jb-v2" });
    win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
    load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js", "scribe-v2-diff.js", "scribe-v2.js"]);
    const ms = win.JobBoredMaterialsScore;
    const opener = win.document.createElement("button");
    win.document.body.appendChild(opener);
    const views = { resume: { verdict: ms.verdictView(qd(V3.V3_UNSUPPORTED)), stale: false } };
    const api = {
      mode: "stub",
      listVersions: () => Promise.resolve({ currentRunId: "r1", versions: [{ runId: "r1", n: 1, createdAt: "2026-10-02T09:00:00.000Z", source: "draft", label: "Drafted", pinned: true, starred: false, pages: 1, words: 300, family: "signal" }] }),
      preview: () => Promise.resolve({ html: "<html><body><main data-page=\"1\">x</main></body></html>", words: 1, pageBudget: 1 }),
      propose: () => new Promise(() => {}), stream: () => new Promise(() => {}),
      rejectEdit: () => Promise.resolve(null), acceptEdit: () => Promise.resolve({ run: { runId: "r2", n: 2 } }),
    };
    win.JB_SCRIBE_V2.open({ slug: "acme", doc: "resume", opener, api, title: "Dispatch analyst", company: "Acme Robotics", score: { gradeFor: (d) => views[d] || null, open: () => null } });
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    const host = win.document.querySelector("jb-scribe");
    const btn = host.querySelector('[data-scribe="grade"] [data-score-open]');
    assert.ok(btn, "the header has the verdict button");
    assert.equal(text(btn), "Fails · 1 claim needs a source");
    assertNoNumbers(host.querySelector('[data-scribe="grade"]'), "Scribe header");
  });
});

/* ---------- The legacy draft modal (resume-generation.js) ---------- */

describe("GRADE-F G1 · the legacy draft modal", () => {
  it("GRADE-F G1: the draft modal has no grade slot and shows no ATS % or score once a scorecard lands", async () => {
    const markup = readFileSync(join(repoRoot, "partials/resume-generation-modals.html"), "utf8");
    assert.doesNotMatch(markup, /resumeGenerateAtsCard|resumeGenerateAtsGrade|Role match/);
    const win = makeScoreEnv({ bodyClass: "jb-v2" });
    const doc = win.document;
    const el = (tag, attrs = {}, parent = doc.body) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.appendChild(n); return n; };
    const modal = el("div", { id: "resumeGenerateModal", role: "dialog", "aria-modal": "true" });
    modal.style.display = "none";
    const head = el("header", {}, modal);
    el("h3", { id: "resumeGenerateTitle" }, head);
    el("button", { id: "resumeGenerateClose" }, head);
    const output = el("textarea", { id: "resumeGenerateOutput" }, modal);
    const insights = el("div", { id: "resumeGenerateInsights", hidden: "" }, modal);
    el("section", { id: "resumeGenerateHistoryCard", hidden: "" }, insights);
    el("textarea", { id: "resumeGenerateFeedback" }, modal);
    let atsState = { cacheKey: "", status: "idle", result: null, error: "", payload: null };
    win.setTimeout = (fn) => { fn(); return 1; };
    win.clearTimeout = () => {};
    win.JobBoredApp = {
      core: { host: { escapeHtml: (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;"), fillVisualThemeSelect() {}, showToast() {} } },
      materialsState: { getUserContent: () => null, getAtsScorecardState: () => atsState, setAtsScorecardState: (s) => { atsState = s; }, getDraftsForJob: () => [] },
      ats: {
        computeAtsScorecardCacheKey: (t, job, f) => `${f}|${job.company}|${t.length}`,
        buildAtsScorecardRequestPayload: (t, j) => ({ docText: t, job: { title: j.title, company: j.company } }),
        startAtsScorecardAnalysis: (cacheKey, payload) => { atsState = { cacheKey, status: "loading", result: null, error: "", payload }; },
      },
    };
    load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js", "resume-generation.js"]);
    const rg = win.JobBoredApp.resumeGeneration;
    const job = { title: "Dispatch analyst", company: "Acme Robotics" };
    rg.setLastResumeGenerationSession({ job, feature: "cover_letter", text: "Dear Acme Robotics team." });
    await rg.openResumeGenerateModal("Cover letter", "", "Dear Acme Robotics team.", false, "cover_letter", null, job);
    atsState = { ...atsState, status: "success", result: ATS };
    rg.renderResumeGenerateInsights(output.value, job);
    assertNoNumbers(modal, "legacy draft modal", /Cover letter/);
    assert.equal(modal.querySelector("[data-score-open]"), null, "no grade button: this modal has no QA verdict");
  });
});

/* ---------- G2: the browser files ---------- */

describe("GRADE-F G2 · no browser file reads a total", () => {
  const files = readdirSync(repoRoot).filter((f) => f.endsWith(".js"));

  it("GRADE-F G2: no browser file reads quality.score", () => {
    const hits = files.filter((f) => /\bquality\.score\b/.test(readFileSync(join(repoRoot, f), "utf8")));
    assert.deepEqual(hits, []);
  });

  it("GRADE-F G2: overallScore is read only by the ATS normalizer, and rendered nowhere", () => {
    const hits = [];
    for (const f of files) {
      /* Comments are blanked (line numbers kept): only code counts. */
      const code = readFileSync(join(repoRoot, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
      code.split("\n").forEach((line, i) => {
        if (!/overallScore/.test(line)) return;
        if (f === "ats-scorecard.js" && /^\s*(overallScore: toScore\(input\.overallScore\)|\.\.\.\(typeof input\.overallScoreSource|\? \{ overallScoreSource)/.test(line)) return;
        if (/^\s*\/\//.test(line)) return;
        hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});
