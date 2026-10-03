/* HOLES lane SCORE · the Case (role-case-model.js, role-case.js), as
   GRADE re-scoped it (SPEC-GRADE D6, D7).

   The coverage tile and the "You have" block show the package's verdict
   and nothing of the ATS scorecard: the tile is that draft's requirement
   coverage, "You have" its verdict button. Both agree with the row on
   staleness (U12), and a click outside the materials rows opens the
   quality-check modal. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

import { V3_COVERAGE_MISSES, V3_UNSUPPORTED } from "./fixtures/materials-qa-v3.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGES = ["new", "researching", "applied", "rejected"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k })),
  toKey: (v) => (STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v),
  isClosed: (v) => v === "rejected",
};
const NOW = Date.parse("2026-09-01T12:00:00Z");

function load() {
  const window = { JobBoredStages: stages };
  const sandbox = { window };
  for (const f of ["jb-text.js", "dossier-field-provenance.js", "recruiter-strip.js", "materials-score.js", "role-case-model.js", "role-case.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, f), "utf8"), sandbox, { filename: f });
  }
  return window;
}

const SCORECARD = {
  feature: "cover_letter", storedAt: "2026-08-30T00:00:00Z",
  result: {
    overallScore: 88, topStrengths: ["Led the accessibility guild for three years"],
    evidence: [{ claim: "Shipped tokens", sourceSnippet: "cut drift 80%", sourceType: "resume" }],
    criticalGaps: [{ gap: "No Kubernetes", whyItMatters: "They run on it.", severity: "high" }],
    dimensionScores: { requirementsCoverage: 84 },
  },
};
const QUALITY = { documents: {
  resume: { status: "pass", issues: [], qa: { ...V3_COVERAGE_MISSES, document: "resume" } },
  cover_letter: { status: "fail", issues: [], qa: V3_UNSUPPORTED },
} };

function deps(over = {}) {
  return {
    vm: { job: { jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", stage: "researching", links: [], requirements: [], enrichment: { status: "ready" } } },
    keywords: null, scorecard: null, manifest: { documents: [], pending: null }, materialsError: "",
    stages, nowMs: NOW, parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}

/* GRADE (D6, D7): the Case reads the package's own verdict — the resume's,
   else the letter's — and that draft's requirement coverage; the stored ATS
   scorecard's number never grades anything. */
describe("HOLES SCORE · the Case's score model, as GRADE reads it", () => {
  it("should read the package resume's verdict and coverage, with the row's staleness", () => {
    const w = load();
    const asked = [];
    const m = w.JobBoredCase.model.buildCaseModel("job-1", deps({ scorecard: SCORECARD, manifest: { documents: [], pending: null, quality: QUALITY }, scoreStale: (f) => { asked.push(f); return true; } }));
    assert.equal(m.score.feature, "resume");
    assert.equal(m.score.verdict.word, "Ready");
    assert.equal(m.score.stale, true);
    assert.equal(m.score.coverage.covered, 1);
    assert.equal(m.score.coverage.total, 3);
    assert.equal(m.score.coverage.stale, true);
    assert.deepEqual(asked, ["resume"]);
  });

  it("should fall back to the letter, and give nothing — not an ATS grade — without a verdict", () => {
    const w = load();
    const letterOnly = { documents: [], pending: null, quality: { documents: { cover_letter: QUALITY.documents.cover_letter } } };
    const m = w.JobBoredCase.model.buildCaseModel("job-1", deps({ manifest: letterOnly }));
    assert.equal(m.score.feature, "cover_letter");
    assert.equal(m.score.verdict.word, "Fails");
    assert.equal(m.score.coverage, null);
    assert.equal(w.JobBoredCase.model.buildCaseModel("job-1", deps({ scorecard: SCORECARD })).score, null);
  });
});

describe("HOLES SCORE · the tile and You have", () => {
  function render(over) {
    const w = load();
    const mount = { innerHTML: "" };
    w.JobBoredCase.render(mount, w.JobBoredCase.model.buildCaseModel("job-1", deps(over)));
    return mount.innerHTML;
  }

  it("should put the coverage in the tile, as a button that opens the quality check", () => {
    const html = render({ scorecard: SCORECARD, manifest: { documents: [], pending: null, quality: QUALITY } });
    assert.match(html, /<button type="button" class="case__num case__num--btn" data-num="coverage" data-score-open data-feature="resume"[^>]*aria-label="Resume coverage: Covers 1 of 3 requirements; missing: Team mentoring\. Open the quality check\."/);
    assert.doesNotMatch(html, /<small>\/100<\/small>|data-num="ats"|88/);
  });

  it("should render You have as its heading and the verdict button, no strengths, evidence, gaps or dimensions", () => {
    const html = render({ scorecard: SCORECARD, manifest: { documents: [], pending: null, quality: QUALITY } });
    const you = /<section class="case__section case__section--you">([\s\S]*?)<\/section>/.exec(html);
    assert.ok(you, "You have renders");
    assert.match(you[1], />You have</);
    assert.match(you[1], /class="jb-grade"[^>]*data-scope="case"/);
    assert.doesNotMatch(you[1], /accessibility guild|cut drift|Kubernetes|case__dim|case__sev|Scored 2026/);
  });
});

describe("HOLES SCORE · a grade click on the board opens the score modal", () => {
  function node(attrs, parent) {
    return { parentNode: parent || null, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  }
  function boot() {
    const w = load();
    const opened = [];
    w.JobBoredRoleMaterials = { openScore: (feature, opener) => { opened.push({ feature, opener }); return {}; } };
    const handlers = {};
    const mount = { innerHTML: "", addEventListener: (t, fn) => { handlers[t] = fn; } };
    w.JobBoredCase.render(mount, w.JobBoredCase.model.buildCaseModel("job-1", deps({ manifest: { documents: [], pending: null, quality: QUALITY } })));
    return { opened, click: (target) => handlers.click({ target, preventDefault() {} }) };
  }

  it("should open it for the button's document, with the button as the opener", () => {
    const env = boot();
    const tile = node({ class: "case__num case__num--btn", "data-num": "coverage", "data-score-open": "", "data-feature": "resume" });
    env.click(node({ class: "case__num-v" }, tile));
    assert.equal(env.opened.length, 1);
    assert.equal(env.opened[0].feature, "resume");
    assert.equal(env.opened[0].opener, tile);
    const btn = node({ class: "jb-grade", "data-score-open": "", "data-feature": "cover_letter" });
    env.click(node({ class: "jb-grade__word" }, btn));
    assert.equal(env.opened[1].feature, "cover_letter");
    assert.equal(env.opened[1].opener, btn);
  });

  it("should leave a button inside the materials rows to role-materials", () => {
    const env = boot();
    const rows = node({ class: "case__materials", "data-mount": "materials" });
    env.click(node({ class: "jb-grade", "data-score-open": "", "data-feature": "resume" }, rows));
    assert.equal(env.opened.length, 0);
  });
});
