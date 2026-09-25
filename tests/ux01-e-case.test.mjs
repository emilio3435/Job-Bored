/* ============================================================
   ux01-e-case.test.mjs — UX01 lane E, the Case half.
   C11: the resume gate and its provenance reach the model/renderer.
   C12: a down materials server turns the drafting controls off; the
        missing-AI notice is one inline line, not a toast.
   C13: a ready document that QA flagged is "review", never "ready",
        and the score names the document it rates.
   Loader order is trap 2: jb-text → provenance → recruiter-strip →
   model → renderer.
   ============================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => (STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed"].includes(v),
  isArchived: (v) => v === "expired",
};
const NOW = Date.parse("2026-09-01T12:00:00Z");

function load() {
  const sandbox = { window: { JobBoredStages: stages } };
  for (const f of ["jb-text.js", "dossier-field-provenance.js", "recruiter-strip.js", "role-case-model.js", "role-case.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.window.JobBoredCase;
}
const Case = load();

function baseDeps(over = {}) {
  return {
    vm: { job: {
      jobKey: "job-1", role: "Staff Frontend Engineer", company: "Kestrel", stage: "researching", daysInStage: 2,
      fitScore: 8, links: [{ href: "https://jobs.test/1" }], foundAt: "2026-08-29",
      requirements: ["Design systems", "Performance budgets"], skills: ["React"],
      enrichment: { status: "ready", mustHaves: ["Design systems"], toolsAndStack: ["React"] },
    } },
    keywords: { percentage: 70, foundCount: 2, partialCount: 0, missingTerms: [{ label: "Performance budgets" }],
      byLabel: new Map([["design systems", "found"], ["react", "found"], ["performance budgets", "missing"]]) },
    scorecard: null,
    manifest: { documents: [
      { type: "resume", status: "ready", lastModifiedAt: "2026-09-01T09:00:00Z", files: [{ filename: "resume.pdf", format: "pdf" }] },
      { type: "cover_letter", status: "ready", lastModifiedAt: "2026-09-01T09:00:00Z", files: [{ filename: "cover-letter.pdf", format: "pdf" }] },
    ], pending: null },
    materialsError: "",
    health: null,
    stages, providerLabel: "OpenAI", nowMs: NOW,
    parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}
function model(over) { return Case.model.buildCaseModel("job-1", baseDeps(over)); }
function renderHtml(m) { const mount = { innerHTML: "" }; Case.render(mount, m); return mount.innerHTML; }
function docket(html) {
  const m = /<div class="case__docket-actions">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(m, "the docket actions must render");
  return m[1];
}

describe("C13 · a QA flag is a review state, not ready", () => {
  const flagged = {
    documents: [
      { type: "resume", status: "ready", lastModifiedAt: "2026-09-01T09:00:00Z", files: [] },
      { type: "cover_letter", status: "ready", lastModifiedAt: "2026-09-01T09:00:00Z", files: [] },
    ],
    pending: null,
    quality: { documents: { resume: { issues: [
      { code: "resume_page_count_high", message: "Runs to 2 pages. Trim to 1 before sending." },
      { code: "x", message: "Second flag." },
    ] } } },
  };

  it("should mark the flagged document review and carry its issues", () => {
    const m = model({ manifest: flagged });
    const resume = m.moves.materials.find((d) => d.type === "resume");
    assert.equal(resume.status, "review");
    assert.equal(resume.issues.length, 2);
    assert.equal(resume.issues[0], "Runs to 2 pages. Trim to 1 before sending.");
  });

  it("should never say both documents are ready while one carries a flag", () => {
    const m = model({ manifest: flagged });
    assert.doesNotMatch(m.verdict.gap, /both ready/);
    assert.match(m.verdict.gap, /2 flags to check/);
  });

  it("should name the document and date the score rates", () => {
    const m = model({ scorecard: { result: { overallScore: 81 }, feature: "cover_letter", storedAt: "2026-08-30T00:00:00Z", version: 3 } });
    const html = renderHtml(m);
    assert.match(html, /Cover letter score/);
    assert.match(html, /scored cover letter v3 · 2026-08-30/);
  });

  it("should label an untyped legacy score as the draft it rated, not the resume", () => {
    const m = model({ scorecard: { result: { overallScore: 81 }, storedAt: "2026-08-30T00:00:00Z" } });
    const html = renderHtml(m);
    assert.match(html, /Draft score/);
    assert.doesNotMatch(html, /Resume score/);
  });
});

describe("C12 · a down materials server turns drafting off", () => {
  it("should disable Draft cover letter and Tailor resume when the server is down", () => {
    const html = renderHtml(model({ materialsServer: "down" }));
    const actions = docket(html);
    assert.match(actions, /data-action="resume-cover"[^>]*disabled/);
    assert.match(actions, /data-action="resume-tailor"[^>]*disabled/);
  });

  it("should keep them enabled when the server state is unknown or up", () => {
    const actions = docket(renderHtml(model({ materialsServer: "" })));
    assert.doesNotMatch(actions, /disabled/);
  });

  it("should say the missing-AI notice once, inline, with where to fix it", () => {
    const html = renderHtml(model({ providerNotice: "Posting insights are off until an AI provider is set up in Settings → AI." }));
    const notices = html.match(/class="case__notice"/g) || [];
    assert.equal(notices.length, 1);
    assert.match(html, /Settings → AI/);
  });
});

describe("C11 · the resume gate reaches the dossier", () => {
  it("should turn the 'Add a resume' hint into a control that opens the resume", () => {
    const html = renderHtml(model({ keywords: null, resume: null }));
    assert.match(html, /<button[^>]*data-action="open-resume"[^>]*>Add your resume<\/button>/);
  });

  it("should carry the resume summary into the model", () => {
    const m = model({ resume: { filename: "alex-rivera-resume.pdf", addedAt: "2026-09-25T10:00:00Z" } });
    assert.equal(m.moves.resume.filename, "alex-rivera-resume.pdf");
  });
});
