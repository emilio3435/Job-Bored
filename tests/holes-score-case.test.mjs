/* HOLES lane SCORE · the Case (role-case-model.js, role-case.js).

   Spec §0.3: the ATS tile and the "You have" block show one grade button
   and nothing of the scorecard. The button grades the document the stored
   scorecard rated, agrees with the row on staleness (U12), and a click on
   it outside the materials rows opens the score modal. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

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

function deps(over = {}) {
  return {
    vm: { job: { jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", stage: "researching", links: [], requirements: [], enrichment: { status: "ready" } } },
    keywords: null, scorecard: null, manifest: { documents: [], pending: null }, materialsError: "",
    stages, nowMs: NOW, parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}

describe("HOLES SCORE · the Case's score model", () => {
  it("should grade the document the stored scorecard rated, with the row's staleness", () => {
    const w = load();
    const asked = [];
    const m = w.JobBoredCase.model.buildCaseModel("job-1", deps({ scorecard: SCORECARD, scoreStale: (f) => { asked.push(f); return true; } }));
    assert.equal(m.score.feature, "cover_letter");
    assert.equal(m.score.grade.letter, "B+");
    assert.equal(m.score.grade.score, 88);
    assert.equal(m.score.stale, true);
    assert.deepEqual(asked, ["cover_letter"]);
  });

  it("should grade the package's resume when no scorecard is stored, and nothing when there is no verdict", () => {
    const w = load();
    const manifest = { documents: [], pending: null, quality: { documents: { resume: { status: "pass", issues: [], qa: { disposition: "READY", degraded: [], rubric: { score: 12, max: 12, rows: [] } } } } } };
    const m = w.JobBoredCase.model.buildCaseModel("job-1", deps({ manifest }));
    assert.equal(m.score.feature, "resume");
    assert.equal(m.score.grade.letter, "A+");
    assert.equal(w.JobBoredCase.model.buildCaseModel("job-1", deps()).score, null);
  });
});

describe("HOLES SCORE · the tile and You have are the grade button only", () => {
  function render(over) {
    const w = load();
    const mount = { innerHTML: "" };
    w.JobBoredCase.render(mount, w.JobBoredCase.model.buildCaseModel("job-1", deps(over)));
    return mount.innerHTML;
  }

  it("should put the button in the tile, named with grade and score", () => {
    const html = render({ scorecard: SCORECARD });
    assert.match(html, /data-num="ats"[\s\S]*?Cover letter draft score[\s\S]*?<button type="button" class="jb-grade"[^>]*data-feature="cover_letter" data-scope="tile"[^>]*aria-label="Grade B\+, 88 of 100 — open score details"/);
    assert.doesNotMatch(html, /<small>\/100<\/small>/);
  });

  it("should render You have as its heading and the button, no strengths, evidence, gaps or dimensions", () => {
    const html = render({ scorecard: SCORECARD });
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
    w.JobBoredCase.render(mount, w.JobBoredCase.model.buildCaseModel("job-1", deps({ scorecard: SCORECARD })));
    return { opened, click: (target) => handlers.click({ target, preventDefault() {} }) };
  }

  it("should open it for the button's document, with the button as the opener", () => {
    const env = boot();
    const tileNum = node({ class: "case__num", "data-num": "ats" });
    const btn = node({ class: "jb-grade", "data-score-open": "", "data-feature": "cover_letter" }, tileNum);
    env.click(node({ class: "jb-grade__ring" }, btn));
    assert.equal(env.opened.length, 1);
    assert.equal(env.opened[0].feature, "cover_letter");
    assert.equal(env.opened[0].opener, btn);
  });

  it("should leave a button inside the materials rows to role-materials", () => {
    const env = boot();
    const rows = node({ class: "case__materials", "data-mount": "materials" });
    env.click(node({ class: "jb-grade", "data-score-open": "", "data-feature": "resume" }, rows));
    assert.equal(env.opened.length, 0);
  });
});
