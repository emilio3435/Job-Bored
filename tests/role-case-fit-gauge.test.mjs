/* ============================================================
   role-case-fit-gauge.test.mjs
   ------------------------------------------------------------
   DFIT supplementary coverage: the dial geometry of DESIGN §3.4,
   the three meter shapes, the zero-value corners (no 0 / 0% /
   Unknown ever renders as a value), and the drawer contents.
   Written red-first alongside the §6.5 suite.
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
  toKey: (v) => STAGES.includes(v) ? v : "",
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};
const NOW = Date.parse("2026-09-01T12:00:00Z");

function load() {
  const sandbox = { window: { JobBoredStages: stages } };
  vm.runInNewContext(readFileSync(join(repoRoot, "jb-text.js"), "utf8"), sandbox, { filename: "jb-text.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "recruiter-strip.js"), "utf8"), sandbox, { filename: "recruiter-strip.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case-model.js"), "utf8"), sandbox, { filename: "role-case-model.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case.js"), "utf8"), sandbox, { filename: "role-case.js" });
  return sandbox.window.JobBoredCase;
}
const Case = load();

function baseDeps(over = {}) {
  return {
    vm: { job: {
      jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", location: "Austin, TX", employment: "Full-time",
      salary: "$185–230k", source: "Ashby", stage: "researching", daysInStage: 2, appliedAt: "",
      fitScore: 6, tags: [], links: [{ label: "Posting", href: "https://jobs.test/1" }], foundAt: "2026-08-29", talkingPoints: [],
      notes: { body: "", editedAt: "" }, priority: "", favorite: false, logoUrl: "",
      matchScore: 9, lastHeardFrom: "", followUpDate: "", replied: "Unknown",
      requirements: ["Alpha systems", "Beta tooling", "Gamma stack", "Delta docs", "Epsilon oncall", "Zeta hiring", "Eta budgets", "Theta travel"],
      skills: [],
      enrichment: { roleInOneLine: "", mustHaves: [], niceToHaves: [], toolsAndStack: [], talkingPoints: [], status: "ready", enrichedAt: NOW - 3 * 864e5,
        fitAssessment: "Strong fit (score: 8/10). Deep design-systems ownership. Matches: Design systems · Accessibility. Concerns: No Go experience. Application: Single-step apply." },
    } },
    keywords: { percentage: 67, foundCount: 5, partialCount: 2, missingTerms: [{ label: "Theta travel" }, { label: "Go" }],
      uniqueTerms: [
        { label: "Alpha systems", status: "found", evidence: { snippet: "Ran the alpha program for years.", source: "resume" } },
        { label: "Beta tooling", status: "found" },
        { label: "Gamma stack", status: "found" },
        { label: "Delta docs", status: "found" },
        { label: "Epsilon oncall", status: "found" },
        { label: "Zeta hiring", status: "partial", evidence: { snippet: "Hired two contractors.", source: "resume" } },
        { label: "Eta budgets", status: "partial" },
        { label: "Theta travel", status: "missing" },
        { label: "Go", status: "missing" },
      ],
      byLabel: new Map() },
    scorecard: null,
    manifest: { documents: [], pending: null },
    materialsError: "",
    health: null,
    stages, providerLabel: "", nowMs: NOW, parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}
function gaugeModel(patch = {}, depsOver = {}) {
  const deps = baseDeps(depsOver);
  const base = deps.vm.job;
  deps.vm = { job: { ...base, ...patch, enrichment: { ...base.enrichment, ...((patch && patch.enrichment) || {}) } } };
  /* The model is assembled inside the vm realm: round-trip through JSON so
     deepEqual compares values, not prototypes (model test idiom). */
  return JSON.parse(JSON.stringify(Case.model.buildCaseModel("job-1", deps)));
}
function renderFull(m) {
  const mount = { innerHTML: "" };
  Case.render(mount, m);
  return mount.innerHTML;
}
function plateOf(m) {
  const html = renderFull(m);
  const at = html.indexOf('<section class="case__fit');
  if (at === -1) return "";
  const end = html.indexOf("<!--/case__fit-->", at);
  assert.ok(end !== -1, "the plate closes with its end marker");
  return html.slice(at, end);
}
/* DESIGN §3.4, recomputed here: θ = 150° + 24° × value. */
function dialPoint(r, v) {
  const a = (150 + 24 * v) * Math.PI / 180;
  return [+(100 + r * Math.cos(a)).toFixed(2), +(100 + r * Math.sin(a)).toFixed(2)];
}

describe("DFIT — dial geometry (§3.4)", () => {
  it("pct is value × 10 and the index crosses the fill at the value angle", () => {
    const dial = gaugeModel().fitGauge.dial;
    assert.equal(dial.pct, 60);
    const [x1, y1] = dialPoint(70, 6), [x2, y2] = dialPoint(91, 6);
    assert.deepEqual(dial.index, { x1, y1, x2, y2 });
  });

  it("the SVG carries the arc, three zones, eleven ticks and the 5/8 edges", () => {
    const p = plateOf(gaugeModel());
    assert.match(p, /<svg viewBox="0 0 200 150" aria-hidden="true" focusable="false">/);
    assert.match(p, /<path class="case__fit-zone case__fit-zone--low" d="M 30\.72 140 A 80 80 0 1 1 169\.28 140" pathLength="100"\/>/);
    assert.match(p, /case__fit-zone--mid/);
    assert.match(p, /case__fit-zone--high/);
    assert.match(p, /<path class="case__fit-fill" d="M 30\.72 140 A 80 80 0 1 1 169\.28 140" pathLength="100"\/>/);
    assert.equal((p.match(/<line class="case__fit-tick/g) || []).length, 11);
    assert.match(p, /<text class="case__fit-tick-label"[^>]*>5<\/text>/);
    assert.match(p, /<text class="case__fit-tick-label"[^>]*>8<\/text>/);
    const [x1, y1] = dialPoint(70, 6), [x2, y2] = dialPoint(91, 6);
    assert.ok(p.includes('<line class="case__fit-index" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'),
      "the index line matches the model geometry");
    assert.match(p, /<div class="case__fit-dial" role="img" aria-label="Fit score 6 out of 10, solid fit" style="--fit-pct:60">/);
  });
});

describe("DFIT — meters", () => {
  it("requirements are one segment each, found then partial then missing", () => {
    const p = plateOf(gaugeModel());
    const segs = [...p.matchAll(/<i class="case__fit-seg" data-status="([a-z]+)"><\/i>/g)].map((m) => m[1]);
    assert.deepEqual(segs, ["found", "found", "found", "found", "found", "partial", "partial", "missing"]);
    assert.match(p, /5<small>of 8 met<\/small>/);
    assert.match(p, /2 partial · 1 missing/);
  });

  it("past 24 requirements the segments become one proportional bar", () => {
    const reqs = Array.from({ length: 25 }, (_, i) => "Requirement " + (i + 1));
    const terms = reqs.map((label) => ({ label, status: "found" }));
    const m = gaugeModel({ requirements: reqs }, {
      keywords: { percentage: 100, foundCount: 25, partialCount: 0, missingTerms: [], uniqueTerms: terms, byLabel: new Map() },
    });
    const p = plateOf(m);
    assert.match(p, /case__fit-meter--stacked/);
    assert.doesNotMatch(p, /case__fit-seg/);
  });

  it("reasons tally one tick per match and concern, capped at twelve", () => {
    const p = plateOf(gaugeModel());
    const ticks = [...p.matchAll(/<i data-kind="(fit|watch)"><\/i>/g)].map((m) => m[1]);
    assert.deepEqual(ticks, ["fit", "fit", "watch"]);
    const many = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"];
    const k = "Strong fit (score: 8/10). Rationale. Matches: " + many.join(" · ") + ". Concerns: C1 · C2 · C3 · C4 · C5. Application: X.";
    const capped = plateOf(gaugeModel({ enrichment: { fitAssessment: k } }));
    assert.equal((capped.match(/<i data-kind="(fit|watch)"><\/i>/g) || []).length, 12);
    assert.match(capped, /\+3/);
  });

  it("keywords bar widths follow found then partial over the total", () => {
    const p = plateOf(gaugeModel());
    assert.match(p, /67<small>% on your resume<\/small>/);
    const bar = /<span class="case__fit-meter case__fit-meter--bar" aria-hidden="true">([\s\S]*?)<\/span>/.exec(p);
    assert.ok(bar, "the bar renders");
    /* found 5 + partial 2 over 5 + 2 + 2 = 9 terms. */
    assert.match(bar[1], /<i class="f" style="width:55\.6%"><\/i>/);
    assert.match(bar[1], /<i class="p" style="width:22\.2%"><\/i>/);
  });
});

describe("DFIT — measured zeros never render as 0 or 0%", () => {
  it("no requirement met reads None of N met; nothing matched reads under one percent", () => {
    const m = gaugeModel({ requirements: ["Alpha systems", "Beta tooling"] }, {
      keywords: { percentage: 0, foundCount: 0, partialCount: 0,
        missingTerms: [{ label: "Alpha systems" }, { label: "Beta tooling" }],
        uniqueTerms: [{ label: "Alpha systems", status: "missing" }, { label: "Beta tooling", status: "missing" }],
        byLabel: new Map() },
    });
    const p = plateOf(m);
    assert.match(p, /None of 2 met/);
    assert.match(p, /<1<small>% on your resume<\/small>/);
    assert.doesNotMatch(p, />0</);
    assert.doesNotMatch(p, />0<small>%/);
  });

  it("a zero side of the tally is omitted, not printed", () => {
    const k = "Strong fit (score: 8/10). Rationale. Concerns: Late nights · Travel. Application: X.";
    const p = plateOf(gaugeModel({ enrichment: { fitAssessment: k } }));
    assert.match(p, /2<small>to watch<\/small>/);
    assert.doesNotMatch(p, />0</);
  });

  /* DFIT-1: drawer headings are built from the same zero-omitting strings
     as the glance values, so "0 fits", "0 of N met" and "0%" never print. */
  it("drawer headings omit zeros exactly like the glance values", () => {
    const k = "Strong fit (score: 8/10). Rationale. Concerns: Late nights · Travel. Application: X.";
    const reasonsHead = plateOf(gaugeModel({ enrichment: { fitAssessment: k } }));
    assert.match(reasonsHead, /<p class="case__fit-panel-h">Reasons · 2 to watch<\/p>/);
    const m = gaugeModel({ requirements: ["Alpha systems", "Beta tooling"] }, {
      keywords: { percentage: 0, foundCount: 0, partialCount: 0,
        missingTerms: [{ label: "Alpha systems" }, { label: "Beta tooling" }],
        uniqueTerms: [{ label: "Alpha systems", status: "missing" }, { label: "Beta tooling", status: "missing" }],
        byLabel: new Map() },
    });
    const p = plateOf(m);
    assert.match(p, /<p class="case__fit-panel-h">Requirements · None of 2 met<\/p>/);
    assert.match(p, /<p class="case__fit-panel-h">Keywords · &lt;1% on your resume<\/p>/);
    assert.doesNotMatch(p, /0 fits/);
    assert.doesNotMatch(p, /0 of \d+ met/);
    assert.doesNotMatch(p, />0%/);
  });
});

describe("DFIT — drawers", () => {
  it("reasons keep the full rationale, the drift note and how the score was made", () => {
    const p = plateOf(gaugeModel());
    assert.match(p, /<p class="case__fit-prose">Deep design-systems ownership\.<\/p>/);
    assert.match(p, /These reasons were written when it scored 8\/10\. It now scores 6\/10\./);
    assert.match(p, /Applying: Single-step apply/);
    assert.match(p, /<details class="case__fit-how"><summary>How this score was made<\/summary>Discovery scored this role against your fit profile/);
  });

  it("an unparsed K is your note, shown whole", () => {
    const raw = "Met the hiring manager <b>last week</b> & liked the team.";
    const p = plateOf(gaugeModel({ enrichment: { fitAssessment: raw } }));
    assert.match(p, /Your note/);
    assert.match(p, /Written in your sheet/);
    assert.match(p, /Met the hiring manager &lt;b&gt;last week&lt;\/b&gt; &amp; liked the team\./);
    assert.doesNotMatch(p, /<b>last week<\/b>/);
  });

  it("requirements triage missing first, quote the resume, and link the full list", () => {
    const p = plateOf(gaugeModel());
    const iMissing = p.indexOf("Missing · 1"), iPartial = p.indexOf("Partial · 2"), iMet = p.indexOf("Met · 5");
    assert.ok(iMissing !== -1 && iPartial !== -1 && iMet !== -1, "all three groups render");
    assert.ok(iMissing < iPartial && iPartial < iMet, "missing first");
    assert.match(p, /<details class="case__fit-ev"><summary>Alpha systems<span class="case__st case__st--vh"> met<\/span><\/summary>/);
    assert.match(p, /Ran the alpha program for years\./);
    assert.match(p, /from your resume/);
    assert.match(p, /<a class="case__fit-all" href="#case-they-job-1">See all 8 in They want<\/a>/);
    assert.match(renderFull(gaugeModel()), /<section class="case__section case__section--they" id="case-they-job-1">/);
  });

  it("keywords list gaps first, fold the found terms, and keep the full match action", () => {
    const p = plateOf(gaugeModel());
    assert.match(p, /Missing · 2/);
    assert.match(p, /Partial · 2/);
    assert.match(p, /<details class="case__fit-found"><summary>5 found<\/summary>/);
    assert.match(p, /<button type="button" class="case__fit-btn" data-action="open-profile-match">Open the full keyword match<\/button>/);
  });
});
