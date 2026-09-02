/* ============================================================
   role-case-a11y.test.mjs
   ------------------------------------------------------------
   The Case polish pass, lane P3 (surface truth): the dossier must
   not print a claim it has not earned (P0-B, P0-5, P0-6, P0-9,
   P0-11), must be navigable and readable by assistive tech
   (P1-1…P1-6), and must say what it means in words a hunter can
   act on (P2-2, P2-3, P2-7).

   Harness: trap 2 from role-case-render.test.mjs — jb-text.js,
   dossier-field-provenance.js and recruiter-strip.js all evaluate
   BEFORE role-case-model.js, or the renderer silently returns
   empty HTML and every assertion here passes on nothing.
   Trap 4 (cascade): the CSS assertions require every new rule to
   be scoped under `body.jb-v2 [data-region="role"] .case`.
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
  /* The registry title-cases; the raw key does not. P0-11 turns on that gap. */
  toLabel: (v) => String(v).replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};
const NOW = Date.parse("2026-09-01T12:00:00Z");

function load() {
  const sandbox = { window: { JobBoredStages: stages } };
  const run = (f) => vm.runInNewContext(readFileSync(join(repoRoot, f), "utf8"), sandbox, { filename: f });
  run("jb-text.js");
  assert.equal(typeof sandbox.window.JobBoredText.escapeHtml, "function", "jb-text must load first");
  run("dossier-field-provenance.js");
  run("recruiter-strip.js");
  run("role-case-model.js");
  run("role-case.js");
  return sandbox.window.JobBoredCase;
}
const Case = load();
const caseCss = readFileSync(join(repoRoot, "role-case.css"), "utf8");

function baseDeps(over = {}) {
  return {
    vm: {
      job: {
        jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", location: "Austin, TX", employment: "Full-time",
        salary: "$185–230k", source: "Ashby", stage: "researching", daysInStage: 2, appliedAt: "",
        fitScore: 8, tags: [], links: [{ label: "Posting", href: "https://jobs.test/1" }], foundAt: "2026-08-29", talkingPoints: [],
        notes: { body: "", editedAt: "" }, priority: "", favorite: false, logoUrl: "",
        matchScore: null, lastHeardFrom: "", followUpDate: "", replied: "Unknown",
        requirements: ["5+ years design systems"], skills: ["React"],
        enrichment: {
          roleInOneLine: "Design infrastructure that ships.", mustHaves: ["5+ years design systems"], niceToHaves: [],
          toolsAndStack: ["React"], talkingPoints: [], status: "ready", enrichedAt: NOW - 3 * 864e5, scrapeMethod: "ats-api",
        },
      },
    },
    keywords: {
      percentage: 74, foundCount: 12, partialCount: 4, missingTerms: [{ label: "Kubernetes" }],
      byLabel: new Map([["5+ years design systems", "found"], ["react", "found"]]),
    },
    scorecard: null,
    manifest: { documents: [], pending: null },
    materialsError: "",
    health: { state: "open", label: "Posting open", detail: "", checkedAt: "2026-08-31" },
    stages, providerLabel: "OpenAI", nowMs: NOW,
    parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}
function model(over = {}) {
  const { vmPatch, ...depsOver } = over;
  const deps = baseDeps(depsOver);
  if (vmPatch) deps.vm = { job: { ...deps.vm.job, ...vmPatch } };
  return Case.model.buildCaseModel("job-1", deps);
}
function html(over = {}) {
  const mount = { innerHTML: "" };
  Case.render(mount, model(over));
  return mount.innerHTML;
}

describe("P0 — the dossier never prints a claim it has not earned", () => {
  /* P0-B. A Greenhouse mirror carrying a validThrough ten months stale is a
     stale feed, not a closed posting — and getPostingHealth returns "open" for
     any active row with an http link, having verified nothing. */
  it("a validThrough far in the past prints neither a closes pill nor 'Posting open'", () => {
    const out = html({ vmPatch: { closesAt: "2025-11-01" } });
    assert.doesNotMatch(out, /Closed 30[0-9] days ago/, "a 305-day-stale close date is not a pill");
    assert.doesNotMatch(out, /data-pill="closes"/, "the closes pill is suppressed below -30 days");
    assert.doesNotMatch(out, /case__pill--open/, "'Posting open' never sits beside a past close date");
  });
  it("a close date just past still shows the pill, but not beside 'Posting open'", () => {
    const out = html({ vmPatch: { closesAt: "2026-08-29" } });
    assert.match(out, /data-pill="closes"[\s\S]*?Closed 3 days ago/);
    assert.doesNotMatch(out, /case__pill--open/);
  });
  it("a live posting still gets its open pill", () => {
    assert.match(html(), /case__pill--open/);
  });

  /* P0-5. The caption branched only on `drafting`, so 0/4 read "All ready". */
  it("the Materials caption counts, it does not congratulate", () => {
    /* Nothing drafted yet: the four Case doc types are all missing, so the
       tile reads 0/4 — and 0/4 has never been "All ready". */
    const out = html({ manifest: { documents: [], pending: null } });
    assert.match(out, /data-num="materials"[\s\S]*?0 of 4 ready/);
    assert.doesNotMatch(out, /data-num="materials"[\s\S]*?All ready/);
  });
  it("'All ready' survives when every row really is ready", () => {
    const documents = Case.model.CASE_DOC_TYPES.map((d) => ({
      type: d.type, label: d.label, status: "ready", lastModifiedAt: "2026-08-30T09:00:00Z", files: [],
    }));
    assert.match(html({ manifest: { documents, pending: null } }), /data-num="materials"[\s\S]*?All ready/);
  });

  /* P0-6 / spec §3: "each tile hides when its input is absent". */
  it("the Reply tile hides when nothing was recorded", () => {
    assert.doesNotMatch(html(), /data-num="reply"/);
    assert.doesNotMatch(html(), /case__num-v">Unknown/);
  });
  it("the Reply tile renders on a real answer", () => {
    assert.match(html({ vmPatch: { replied: "Yes" } }), /data-num="reply"[\s\S]*?Yes/);
  });

  /* P0-9. All-partial keyword terms yield no strengths and no gaps. */
  it("'You have' hides when strengths, evidence, gaps and dimensions are all empty", () => {
    const keywords = { percentage: 40, foundCount: 0, partialCount: 3, missingTerms: [], byLabel: new Map([["react", "partial"]]) };
    const out = html({ keywords, scorecard: null });
    assert.doesNotMatch(out, /case__lane--you/, "a header with nothing under it is not a lane");
    assert.doesNotMatch(out, /You have/);
  });

  /* P0-11. Every non-terminal step goes through the registry's label. */
  it("the terminal chip prints the stage label, not the raw key", () => {
    const out = html({ vmPatch: { stage: "rejected" } });
    assert.match(out, /class="case__terminal">Rejected/);
    assert.doesNotMatch(out, /class="case__terminal">rejected/);
  });
});

describe("P1 — the dossier is navigable and readable by assistive tech", () => {
  /* P1-1: H-key navigation and the rotor returned an empty list. */
  it("carries an h2 role identity and an h3 per lane", () => {
    const out = html();
    assert.match(out, /<h2 class="case__vh">Senior PM at Meridian Labs<\/h2>/);
    assert.match(out, /<h3 class="case__lane-title">They want<\/h3>/);
    assert.match(out, /<h3 class="case__lane-title">Your moves<\/h3>/);
  });
  it("the visually-hidden heading is hidden by a Case-scoped rule, not display:none", () => {
    assert.match(caseCss, /body\.jb-v2 \[data-region="role"\] \.case \.case__vh\b/);
    assert.doesNotMatch(caseCss, /\.case__vh[^{]*\{[^}]*display:\s*none/);
  });

  /* P1-2: N identical buttons, current stage encoded only in a CSS class. */
  it("the stepper is a labelled group whose buttons say what they do", () => {
    const out = html();
    assert.match(out, /<div class="case__stepper" role="group" aria-label="Stage">/);
    assert.match(out, /data-stage="researching"[^>]*aria-current="step"/);
    assert.match(out, /data-stage="applied"[^>]*aria-label="Move to Applied"/);
    assert.doesNotMatch(out, /data-stage="applied"[^>]*aria-current/, "only the current step is current");
  });

  /* P1-3: stack chips carried match status in color alone (WCAG 1.4.1). */
  it("stack chips emit the same status word the requirement rows do", () => {
    const out = html();
    const chip = /<span class="case__chip" data-status="found">[\s\S]*?<\/span><\/span>/.exec(out);
    assert.ok(chip, "the React chip must render");
    assert.match(chip[0], /<span class="case__st case__st--vh">found<\/span>/);
    assert.match(caseCss, /body\.jb-v2 \[data-region="role"\] \.case \.case__st--vh\b/);
  });

  /* P1-4: ~10 stray tokens per full read ("Fit sheet 8 slash 10"). */
  it("provenance chips are aria-hidden and their meaning moves to the tile's label", () => {
    const out = html();
    assert.doesNotMatch(out, /<span class="case__src case__src--[a-z]+">/, "every source chip is aria-hidden");
    assert.match(out, /class="case__src case__src--sheet" aria-hidden="true"/);
    assert.match(out, /data-num="fit" aria-label="Fit, from your sheet"/);
  });

  /* P1-5: outline:none at (0,4,1) beats the app's :focus-visible rule. */
  it("every edit surface that kills the outline restores a focus-visible ring", () => {
    const killers = caseCss.match(/^body\.jb-v2 \[data-region="role"\] \.case [^{]*\{[^}]*outline:\s*none[^}]*\}/gm) || [];
    assert.ok(killers.length, "the outline:none rules this pins must still exist");
    for (const selector of ["case__title", "case__company", "case__fact-input", "case__v--edit", "case__notes textarea"]) {
      const re = new RegExp('body\\.jb-v2 \\[data-region="role"\\] \\.case [^{]*' + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '[^{]*:focus-visible[^{]*\\{[^}]*outline:', "m");
      assert.match(caseCss, re, selector + " must define its own focus-visible outline");
    }
  });

  /* P1-6: doc-action buttons ~70x21px and 6px apart; stepper steps ~21px. */
  it("the stepper and the rail fact inputs reach the 24px hit floor", () => {
    assert.match(caseCss, /body\.jb-v2 \[data-region="role"\] \.case \.case__step::after\b/);
    assert.match(caseCss, /body\.jb-v2 \[data-region="role"\] \.case \.case__fact-input::after|\.case__fact-input\s*\{[^}]*min-height:\s*24px/);
  });
});

describe("P1-0 — the Case surface holds its own gutter and colors", () => {
  /* P1-0: the only v2 region not using the shared flow width. */
  it(".case sits in the shared flow width instead of running to the browser edge", () => {
    assert.match(caseCss, /body\.jb-v2 \[data-region="role"\] \.case\s*\{[^}]*--jb-flow-content-width/);
  });
  /* P1-0b: hardcoded 5 columns for a band that usually renders 2-4 tiles. */
  it("the numbers band tracks off data-count, not a hardcoded five", () => {
    assert.match(caseCss, /\.case__numbers\[data-count="3"\]/);
    assert.match(caseCss, /\.case__numbers\[data-count="2"\]/);
  });
  /* P1-0c: mint-deep on parchment is 2.81:1 — the saved mark is invisible. */
  it("the on-light mint is darkened to a readable value", () => {
    /* The file's own convention: a var(--jb-*) reference with the hex only as
       the sanctioned fallback, never a literal of record. */
    assert.match(caseCss, /--case-mint-on-light:\s*var\(--jb-[a-z-]+,\s*#3F6B55\)/i);
    assert.match(caseCss, /\.case__saved \{[^}]*color: var\(--case-mint-on-light\)/);
    assert.doesNotMatch(caseCss, /\.case__saved \{[^}]*color:\s*var\(--mint-deep\)/);
  });
  /* P1-0f: two dead rules with visible effects. */
  it("the freshness stamp's margin override is not undone by a later base rule", () => {
    const fresh = caseCss.indexOf(".case__stamp--fresh");
    const base = caseCss.search(/body\.jb-v2 \[data-region="role"\] \.case \.case__stamp\s*\{/);
    assert.ok(fresh > base, "the --fresh modifier must be declared after the base .case__stamp rule");
  });
  /* P1-0g: "View posting" is the only pill with no hover. */
  it("the posting link and the keywords tile both have hover and focus states", () => {
    assert.match(caseCss, /\.case__cta:hover/);
    assert.match(caseCss, /\.case__num--btn:hover/);
    assert.match(caseCss, /\.case__num--btn:focus-visible/);
  });
});

describe("P2 — the copy says what it means", () => {
  /* P2-2: "parse" is about JSON, not the job. */
  it("a recovered payload is tagged unverified, in words a hunter can act on", () => {
    const out = html({ vmPatch: { enrichment: { ...baseDeps().vm.job.enrichment, scrapeMethod: "loose-json" } } });
    assert.doesNotMatch(out, /recovered parse/);
    if (/case__src--review/.test(out)) {
      assert.match(out, /class="case__src case__src--review" aria-hidden="true">unverified</);
      assert.match(out, /Requirements · unverified — read these against the posting before you rely on them/);
    }
  });

  /* P2-3: the acronym is never expanded, and crimson is the alarm color. */
  it("the ATS tile is 'Resume score', and only a low score is crimson", () => {
    const good = html({ scorecard: { result: { overallScore: 94, topStrengths: ["Led a11y guild"], evidence: [], criticalGaps: [], dimensionScores: {} }, storedAt: "2026-08-30T00:00:00Z" } });
    assert.match(good, /data-num="ats"[\s\S]*?Resume score/);
    assert.match(good, /How well your draft answers this posting/);
    assert.doesNotMatch(good, /data-num="ats"[\s\S]*?case__num-v--crimson/, "a 94 is not bad news");
    const bad = html({ scorecard: { result: { overallScore: 41, topStrengths: ["Led a11y guild"], evidence: [], criticalGaps: [], dimensionScores: {} }, storedAt: "2026-08-30T00:00:00Z" } });
    assert.match(bad, /data-num="ats"[\s\S]*?case__num-v--crimson/);
  });

  /* P2-7: the engineering reliability legend, shipped as UI with no key. */
  it("source tags read as English, not as SHEET / SCRAPE / AI / DERIVED / FILES", () => {
    const out = html();
    assert.match(out, /case__src--sheet" aria-hidden="true">from your sheet</);
    assert.match(out, /case__src--scrape" aria-hidden="true">from the posting</);
    assert.match(out, /case__src--ai" aria-hidden="true">written by AI</);
    assert.match(out, /case__src--files" aria-hidden="true">your files</);
    assert.match(out, /case__src--derived" aria-hidden="true">(matched here|matched|keyword match)</);
  });
});
