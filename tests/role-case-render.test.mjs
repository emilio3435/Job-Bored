/* ============================================================
   role-case-render.test.mjs
   ------------------------------------------------------------
   The Case renderer paints every block of the approved design
   (spec §1, §5, §7) from the CaseModel alone: status rail,
   stage stepper, numbers band, the three evidence lanes, notes,
   and the dated record — with the DOM contract (data-action
   values, the materials mount, case__* classes) L5 wires to.

   Harness: trap 2 — jb-text.js evaluates BEFORE role-case-model.js
   and role-case.js, or both consumers throw and the renderer
   silently returns empty HTML. Every assertion here is positive
   content except the four that pin a block's absence.
   ============================================================ */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => STAGES.includes(v) ? v : "",
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};
const NOW = Date.parse("2026-09-01T12:00:00Z");

function load() {
  const sandbox = { window: { JobBoredStages: stages } };
  vm.runInNewContext(readFileSync(join(repoRoot, "jb-text.js"), "utf8"), sandbox, { filename: "jb-text.js" });
  assert.equal(typeof sandbox.window.JobBoredText.escapeHtml, "function", "jb-text must load first");
  /* Trap 2's sibling: the model reads the provenance classifier off the same
     global surface, so it loads before role-case-model.js or every provenance
     assertion below would silently pass on an empty block. */
  vm.runInNewContext(readFileSync(join(repoRoot, "dossier-field-provenance.js"), "utf8"), sandbox, { filename: "dossier-field-provenance.js" });
  assert.equal(typeof sandbox.window.JobBoredDossierProvenance.classify, "function", "the provenance classifier must load");
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case-model.js"), "utf8"), sandbox, { filename: "role-case-model.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case.js"), "utf8"), sandbox, { filename: "role-case.js" });
  return sandbox.window.JobBoredCase;
}
const Case = load();
const roleCssSource = readFileSync(join(repoRoot, "role.css"), "utf8");

/* Same fixture as tests/role-case-model.test.mjs (Meridian Labs, fictional). */
function baseDeps(over = {}) {
  return {
    vm: { job: {
      jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", location: "Austin, TX", employment: "Full-time",
      salary: "$185–230k", source: "Ashby", stage: "researching", daysInStage: 2, appliedAt: "",
      fitScore: 8, tags: ["Design Systems"], links: [{ label: "Posting", href: "https://jobs.test/1" }], foundAt: "2026-08-29", talkingPoints: [],
      notes: { body: "Recruiter: Dana", editedAt: "" }, priority: "high", favorite: true, logoUrl: "",
      matchScore: null, lastHeardFrom: "2026-08-31", followUpDate: "2026-09-04", replied: "No",
      requirements: ["5+ years design systems", "WCAG 2.2"], skills: ["React"],
      enrichment: { roleInOneLine: "Design **infrastructure** that ships.", mustHaves: ["5+ years design systems"], niceToHaves: ["Mentoring"],
        toolsAndStack: ["React", "Storybook"], talkingPoints: ["Shipped tokens; cut drift 80%"], status: "ready", enrichedAt: NOW - 3 * 864e5, scrapeMethod: "ats-api" },
    } },
    keywords: { percentage: 74, foundCount: 12, partialCount: 4, missingTerms: [{ label: "Kubernetes" }],
      byLabel: new Map([["5+ years design systems", "found"], ["wcag 2.2", "found"], ["react", "found"], ["storybook", "partial"], ["mentoring", "missing"]]) },
    scorecard: { result: { overallScore: 82, topStrengths: ["Led a11y guild"], evidence: [{ claim: "Token pipeline", sourceSnippet: "Built a token pipeline", sourceType: "resume" }],
      criticalGaps: [{ gap: "Experimentation", whyItMatters: "Named twice", severity: "high" }],
      dimensionScores: { requirementsCoverage: 84, experienceRelevance: 88, impactClarity: 72, atsParseability: 90, toneFit: 78 } }, storedAt: "2026-08-30T00:00:00Z" },
    manifest: { documents: [
      { type: "resume", label: "Tailored resume", status: "ready", lastModifiedAt: "2026-08-30T09:00:00Z", files: [] },
      { type: "cover_letter", label: "Cover letter", status: "pending", files: [] },
      { type: "qa_report", label: "QA report", status: "ready", lastModifiedAt: "2026-08-30T09:05:00Z", files: [] },
    ], pending: { feature: "cover_letter", progress: { phase: "drafting", elapsedSeconds: 42, attempt: 1 } } },
    materialsError: "",
    health: { state: "open", label: "Posting open", detail: "", checkedAt: "2026-08-31" },
    stages, providerLabel: "OpenAI", nowMs: NOW, parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}

/** A CaseModel; `vmPatch` overrides fields on the fixture job. */
function model(over = {}) {
  const { vmPatch, ...depsOver } = over;
  const deps = baseDeps(depsOver);
  if (vmPatch) deps.vm = { job: { ...deps.vm.job, ...vmPatch } };
  return Case.model.buildCaseModel("job-1", deps);
}

function renderHtml(m) {
  const mount = { innerHTML: "" };
  Case.render(mount, m);
  return mount.innerHTML;
}

describe("The Case renders every block from the model", () => {
  it("rail, stepper, numbers, one-line", () => {
    const html = renderHtml(model());
    assert.match(html, /<header class="case__rail">/);
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="title"[^>]*value="Senior PM"/);
    assert.match(html, /data-action="brief-view-posting"[^>]*href="https:\/\/jobs\.test\/1"/);
    assert.match(html, /<button[^>]*class="case__cta case__cta--btn"[^>]*data-action="resume-cover"[^>]*aria-label="Draft a cover letter for this role"[^>]*>Draft cover letter<\/button>/);
    assert.match(html, /<button[^>]*data-action="resume-tailor"[^>]*aria-label="Tailor your resume for this role"[^>]*>Tailor resume<\/button>/);
    assert.match(html, /class="case__pill case__pill--due"[^>]*>[\s\S]*?2026-09-04[\s\S]*?in 3 days/);
    assert.match(html, /class="case__pill case__pill--open"/);
    assert.match(html, /<button[^>]*data-action="stage-step"[^>]*data-stage="applied"/);
    assert.match(html, /class="case__step case__step--now"[^>]*>[\s\S]*?researching[\s\S]*?day 2/i);
    assert.match(html, /<div class="case__num"[^>]*data-num="fit">[\s\S]*?8<small>\/10<\/small>/);
    assert.match(html, /data-num="keywords"[\s\S]*?74<small>%<\/small>[\s\S]*?12 found · 4 partial · 1 missing/);
    assert.match(html, /<button[^>]*data-action="open-profile-match"/);
    assert.match(html, /class="case__quote"[^>]*>[\s\S]*?Design infrastructure that ships\./);
  });
  /* L7 gap 1 (spec §5): the rail edits four fields, not two. Location and
     salary are inline fact inputs on the navy rail, carrying the same
     edit-field contract role.js wires — not read-only text. */
  it("location and salary are editable inline fact inputs on the rail", () => {
    const html = renderHtml(model());
    assert.match(html, /<input[^>]*class="case__fact-input"[^>]*data-action="edit-field"[^>]*data-field="location"[^>]*data-original="Austin, TX"[^>]*value="Austin, TX"[^>]*aria-label="Location"/);
    assert.match(html, /<input[^>]*class="case__fact-input"[^>]*data-action="edit-field"[^>]*data-field="salary"[^>]*data-original="\$185–230k"[^>]*value="\$185–230k"[^>]*aria-label="Salary"/);
    assert.match(html, /data-field="location"[^>]*autocomplete="off"/, "the rail inputs keep the edit-field guards");
    assert.match(html, /class="case__meta">[\s\S]*?<span>Full-time<\/span>/, "employment stays plain text beside the inputs");
  });

  it("renders empty location and salary inputs so a missing fact can be filled in", () => {
    const html = renderHtml(model({ vmPatch: { location: "", salary: "" } }));
    assert.match(html, /data-field="location"[^>]*value=""[^>]*aria-label="Location"/);
    assert.match(html, /data-field="salary"[^>]*value=""[^>]*aria-label="Salary"/);
  });

  it("they want / you have / your moves lanes", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__lane case__lane--they"[\s\S]*?<li[^>]*data-status="found"[^>]*>[\s\S]*?5\+ years design systems/);
    assert.match(html, /class="case__chip"[^>]*data-status="partial"[^>]*>[\s\S]*?Storybook/);
    assert.match(html, /class="case__lane case__lane--you"[\s\S]*?case__sev--high[\s\S]*?Experimentation/);
    assert.match(html, /class="case__dim"[\s\S]*?style="width: 84%;"/);
    assert.match(html, /class="case__lane case__lane--moves"[\s\S]*?<span class="case__idx">01<\/span>/);
    assert.match(html, /<div class="case__materials" data-mount="materials"><\/div>/);
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="followupAt"[^>]*type="date"[^>]*value="2026-09-04"/);
    assert.match(html, /<button[^>]*data-action="edit-field"[^>]*data-field="reply"[^>]*data-value="Yes"/);
    assert.match(html, /<textarea[^>]*data-action="notes"[^>]*>Recruiter: Dana<\/textarea>/);
  });
  it("record with hollow future step and configured provider", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__ev case__ev--future"[\s\S]*?Applied[\s\S]*?Not yet/);
    assert.match(html, /Enriched[\s\S]*?OpenAI/);
    assert.doesNotMatch(html, /Gemini/);
  });
  it("hides blocks with no inputs and shows the no-resume line", () => {
    const html = renderHtml(model({ keywords: null, scorecard: null, manifest: null, vmPatch: { followUpDate: "" } }));
    assert.doesNotMatch(html, /case__pill--due/);
    assert.doesNotMatch(html, /data-num="keywords"/);
    assert.doesNotMatch(html, /case__lane--you/);
    assert.match(html, /Add a resume to see what matches/);
  });
  it("escapes exactly once", () => {
    const html = renderHtml(model({ vmPatch: { role: 'Eng <b>"x"</b> & co', location: 'Austin & "TX" <b>' } }));
    assert.match(html, /value="Eng &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; co"/);
    assert.match(html, /data-field="location"[^>]*value="Austin &amp; &quot;TX&quot; &lt;b&gt;"/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
  /* L7 gap 3: the Brief's skeleton announced itself; the Case's first cut
     carried aria-busy alone, so a screen-reader user got silence while the
     enrichment ran. Announcement + one visible status line, both pinned. */
  it("the loading skeleton announces itself and says what it is doing", () => {
    const html = renderHtml(model({
      keywords: null,
      vmPatch: { requirements: [], skills: [], tags: [], enrichment: { status: "loading" } },
    }));
    assert.match(html, /class="case__lane case__lane--they"[\s\S]*?class="case__skeleton"/, "the skeleton stands in for the THEY WANT lane");
    assert.match(html, /<div class="case__skeleton"[^>]*role="status"/);
    assert.match(html, /<div class="case__skeleton"[^>]*aria-live="polite"/);
    assert.match(html, /<div class="case__skeleton"[^>]*aria-busy="true"/);
    assert.match(html, /<span class="case__skeleton-status">Reading the posting…<\/span>/);
    assert.match(html, /class="case__shimmer/, "the shimmer rows still render beneath the status line");
  });

  it("the status line is gone once the requirements land", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__req"/, "precondition: real requirements rendered");
    assert.doesNotMatch(html, /case__skeleton-status/);
    assert.doesNotMatch(html, /aria-busy="true"/);
  });

  /* L7 gap 4: the classifier and the validator have been live since the
     resilience work, but the cutover left nothing rendering them — a payload
     the pipeline had to recover, or a summary inferred from a title alone,
     read exactly like a clean posting scrape. */
  it("a recovered parse flags the they-want lane for review", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      roleInOneLine: "Design infrastructure that ships.",
      mustHaves: ["5+ years design systems"], status: "ready", parseMode: "repaired",
    } } }));
    assert.match(html, /class="case__lane case__lane--they"[\s\S]*?class="case__src case__src--review">recovered parse · review<\/span>/);
    assert.match(html, /<div class="case__sub">Requirements · recovered parse — review before relying on these<\/div>/);
    assert.match(html, /class="case__req"[\s\S]*?5\+ years design systems/, "the recovered requirements still render, flagged");
  });

  it("a validator review verdict flags the lane even on a clean schema parse", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      mustHaves: ["5+ years design systems"], status: "ready", parseMode: "schema",
      reviewState: { status: "needs_review", reason: "Malformed model delimiters polluted structured fields.", pollutedFields: ["mustHaves"] },
    } } }));
    assert.match(html, /class="case__src case__src--review">recovered parse · review<\/span>/);
    assert.match(html, /Requirements · recovered parse — review before relying on these/);
  });

  it("a clean schema parse the validator cleared says nothing about review", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      mustHaves: ["5+ years design systems"], status: "ready", parseMode: "schema",
      reviewState: { status: "ok", reason: "", pollutedFields: [] },
    } } }));
    assert.match(html, /<div class="case__sub">Requirements · vs\. your resume<\/div>/, "the normal sub-head stands");
    assert.doesNotMatch(html, /case__src--review/);
  });

  it("an identity inferred from title and company is tagged on the rail", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      roleInOneLine: "Lead paid media.", mustHaves: ["Paid media strategy"], status: "ready",
      parseMode: "schema", source: "title-and-company", scrapeBlocked: true, enrichedAt: "2026-08-30T12:00:00.000Z",
    } } }));
    assert.match(html, /class="case__meta">[\s\S]*?<span class="case__src case__src--inferred">inferred<\/span>/);
    assert.doesNotMatch(html, /grounded in the posting/i);
  });

  it("a real posting scrape is never tagged inferred", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      roleInOneLine: "Design infrastructure that ships.", mustHaves: ["5+ years design systems"], status: "ready",
      parseMode: "schema", source: "cheerio", enrichedAt: "2026-08-30T12:00:00.000Z",
      description: "A long, real job description scraped straight from the posting page, well past the minimum length the grounding rules require before anything may be called posting-grounded.",
    } } }));
    assert.match(html, /class="case__meta">/, "precondition: the rail meta rendered");
    assert.doesNotMatch(html, /case__src--inferred/);
  });

  it("the cache freshness label stamps under the one-line quote", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      roleInOneLine: "Design infrastructure that ships.", mustHaves: ["5+ years design systems"], status: "ready",
      parseMode: "schema", source: "cheerio", scrapedAt: NOW - 2 * 3600e3,
    } } }));
    assert.match(html, /class="case__quote"[\s\S]*?<\/div><div class="case__stamp case__stamp--fresh">fetched 2h ago<\/div>/);
    assert.doesNotMatch(html, /stale/i, "a two-hour-old scrape is inside the TTL");
  });

  it("stamps nothing when the enrichment carries no fetch time", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      roleInOneLine: "Design infrastructure that ships.", mustHaves: ["5+ years design systems"], status: "ready",
    } } }));
    assert.match(html, /class="case__quote"/, "precondition: the quote rendered");
    assert.doesNotMatch(html, /case__stamp--fresh/);
    assert.doesNotMatch(html, /fetched time unknown/);
  });

  it("terminal stage collapses the stepper", () => {
    const html = renderHtml(model({ vmPatch: { stage: "rejected" } }));
    assert.match(html, /class="case__terminal"[^>]*>[\s\S]*?rejected/i);
    assert.doesNotMatch(html, /data-action="stage-step"/);
  });
});

/* ------------------------------------------------------------
   The Brief is retired (plan Task 10, LD3). Its renderer, its
   styles and its script tag are gone; only CHANGELOG history may
   still name it. This guard is what keeps a revert from quietly
   resurrecting the old presentation layer underneath the Case.
   ------------------------------------------------------------ */
describe("the Brief is retired", () => {
  it("role.css carries no .brief__* presentation rules", () => {
    assert.doesNotMatch(roleCssSource, /\.brief__lede/);
    assert.doesNotMatch(roleCssSource, /\.brief__masthead/);
    assert.doesNotMatch(roleCssSource, /\.brief__fact-input/);
    assert.doesNotMatch(roleCssSource, /\.skim\b/);
    assert.doesNotMatch(roleCssSource, /\.brief-notes\b/);
    /* .brief-materials* survives: role-materials still renders the legacy
       panel into a brief-only mount (plan Task 9). */
    assert.match(roleCssSource, /\.brief-materials__head/);
  });

  it("role-brief.js is gone and nothing loads or falls back to it", () => {
    assert.equal(existsSync(join(repoRoot, "role-brief.js")), false, "role-brief.js must be deleted");
    for (const file of ["index.html", "role.js"]) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      assert.doesNotMatch(source, /role-brief\.js/, file + " must not load role-brief.js");
      assert.doesNotMatch(source, /JobBoredDossierBrief/, file + " must not reference the Brief renderer");
    }
  });
});
