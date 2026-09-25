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
  /* Trap 2's sibling: the People block's next-move sentence comes from
     recruiter-strip.js `nextAction`, so the strip loads before the model or
     the sentence assertions would pass on an empty string. */
  vm.runInNewContext(readFileSync(join(repoRoot, "recruiter-strip.js"), "utf8"), sandbox, { filename: "recruiter-strip.js" });
  assert.equal(typeof sandbox.window.JobBoredRecruiterStrip.nextAction, "function", "recruiter-strip must export nextAction");
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case-model.js"), "utf8"), sandbox, { filename: "role-case-model.js" });
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case.js"), "utf8"), sandbox, { filename: "role-case.js" });
  return sandbox.window.JobBoredCase;
}
const Case = load();
const roleCssSource = readFileSync(join(repoRoot, "role.css"), "utf8");
const caseCssSource = readFileSync(join(repoRoot, "role-case.css"), "utf8");

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

/** Just the rail's meta row — `case__src--*` tags live in the lanes too. */
function railMeta(html) {
  const match = /<div class="case__meta">([\s\S]*?)<\/div><\/div>/.exec(html);
  assert.ok(match, "the rail meta must render");
  return match[1];
}

describe("The Case renders every block from the model", () => {
  it("rail, stepper, numbers, one-line", () => {
    const html = renderHtml(model());
    assert.match(html, /<header class="case__rail">/);
    /* TEARDOWN §7: an <input width: 100%> lost 81px of a real posting title
       with no ellipsis and no wrap. The title wraps now (SPEC §5.2), through the
       same frozen edit-field contract. */
    assert.match(html, /<textarea class="case__title" rows="1" data-action="edit-field" data-field="title" data-original="Senior PM"[^>]*>Senior PM<\/textarea>/);
    assert.match(html, /data-action="brief-view-posting"[^>]*href="https:\/\/jobs\.test\/1"/);
    assert.match(html, /class="case__pill case__pill--due"[^>]*>[\s\S]*?2026-09-04[\s\S]*?in 3 days/);
    assert.match(html, /class="case__pill case__pill--open"/);
    assert.match(html, /<button[^>]*data-action="stage-step"[^>]*data-stage="applied"/);
    assert.match(html, /class="case__step case__step--now"[^>]*>[\s\S]*?researching[\s\S]*?day 2/i);
    assert.match(html, /<div class="case__num" data-num="fit"[^>]*>[\s\S]*?8<small>\/10<\/small>/);
    assert.match(html, /data-num="keywords"[\s\S]*?74<small>%<\/small>[\s\S]*?12 found · 4 partial · 1 missing/);
    assert.match(html, /<button[^>]*data-action="open-profile-match"/);
    assert.match(html, /class="case__quote"[^>]*>[\s\S]*?Design infrastructure that ships\./);
  });

  /* The docket (SPEC §5.1). The drafting actions used to sit in the masthead,
     which scrolls away after ~200px of a 1,956px-tall dossier — so for 88% of
     the scroll depth there was no way to request materials without going back
     to the top. They live in a sticky bar now, with the stage stepper and the
     close control that role.js has always been wired for. */
  describe("the docket", () => {
    it("carries the stepper, both drafting actions and close", () => {
      const html = renderHtml(model({ manifest: { documents: [], pending: null } }));
      assert.match(html, /<div class="case__docket" role="group" aria-label="Role docket">/);
      assert.match(html, /class="case__docket"[\s\S]*?class="case__stepper"/, "the stepper moved into the docket");
      assert.match(html, /<button[^>]*class="case__btn case__btn--primary"[^>]*data-action="resume-cover"[^>]*aria-label="Draft a cover letter for this role"[^>]*>Draft cover letter<\/button>/);
      assert.match(html, /<button[^>]*data-action="resume-tailor"[^>]*aria-label="Tailor your resume for this role"[^>]*>Tailor resume<\/button>/);
      assert.match(html, /<button[^>]*data-action="close-role"[^>]*aria-label="Close this role"/);
      assert.doesNotMatch(html, /case__rail[\s\S]*?data-action="resume-cover"[\s\S]*?case__docket/, "one home per action: the masthead keeps none of them");
    });

    /* A run in flight replaces its own request button, so the same draft
       cannot be asked for twice from the same surface — and the chip reads
       from the manifest the ledger row renders from, in the same pass. */
    it("replaces the button of a run in flight with a live chip", () => {
      const html = renderHtml(model());
      assert.match(html, /<span class="case__inflight" role="status" aria-live="polite" data-doc="cover_letter" data-phase="drafting">[\s\S]*?Drafting cover letter · 42s<\/span>/);
      assert.doesNotMatch(html, /data-action="resume-cover"/, "the request cannot be issued twice");
      assert.match(html, /data-action="resume-tailor"/, "the resume is not in flight, so its button stands");
    });

    it("a failed run offers the retry in the docket, in crimson", () => {
      const html = renderHtml(model({
        manifest: { documents: [], pending: { feature: "cover_letter", progress: { phase: "failed", elapsedSeconds: 67, attempt: 2 } } },
      }));
      assert.match(html, /<button[^>]*class="case__inflight case__inflight--failed"[^>]*data-action="materials-retry"[^>]*data-feature="cover_letter"[^>]*>Cover letter failed · retry<\/button>/);
    });

    it("a terminal role keeps close and drops the drafting actions", () => {
      const html = renderHtml(model({ vmPatch: { stage: "rejected" } }));
      assert.match(html, /data-action="close-role"/);
      assert.doesNotMatch(html, /data-action="resume-cover"/);
      assert.doesNotMatch(html, /data-action="resume-tailor"/);
    });
  });

  /* The verdict (SPEC §4): the single most valuable sentence in the dossier
     was the one it never wrote. Every clause is traceable to a model field,
     and an absent input drops its clause rather than guessing it. */
  describe("the verdict line", () => {
    it("opens with standing, gap and the one urgent clause", () => {
      const html = renderHtml(model({ vmPatch: { closesAt: "2026-09-10" } }));
      assert.match(html, /<p class="case__verdict-line"><b>Strong fit — 2 of 2 requirements matched, 1 keyword missing\.<\/b> <em>The cover letter is being written now\.<\/em> Closes in 9 days\.<\/p>/);
    });

    it("says it is still reading rather than printing a fit read it does not have", () => {
      const html = renderHtml(model({
        keywords: null,
        vmPatch: { requirements: [], skills: [], tags: [], enrichment: { status: "loading" } },
      }));
      assert.match(html, /case__verdict-line"><b>Reading the posting\.<\/b>[\s\S]*?land in a few seconds\./);
      assert.doesNotMatch(html, /fit —/i);
    });

    it("invites a resume instead of leaving the match empty", () => {
      const html = renderHtml(model({ keywords: null, scorecard: null }));
      assert.match(html, /case__verdict-line"><b>Fit 8 of 10\.<\/b>[\s\S]*?Add a resume to see which of the 2 requirements you actually answer\./);
    });

    it("a closed role's lede is what happened and what is still on file", () => {
      const html = renderHtml(model({ vmPatch: { stage: "rejected", appliedAt: "2026-08-20" } }));
      assert.match(html, /case__verdict-line"><b>rejected, applied 2026-08-20\.<\/b> <em>The cover letter is being written now\.<\/em>/i);
      assert.doesNotMatch(html, /case__verdict-line[^<]*<b>[^<]*<\/b>[\s\S]*?Day \d/, "a closed role has no next move");
    });
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

  /* The canvas holds the read, the ledger holds the widgets, and the ledger
     follows the canvas in source order so tab order and reading order agree at
     every width (SPEC §2). The three equal-weight lanes are gone: "They want"
     and "You have" are a pair, and the board split them into adjacent columns
     whose vertical positions never corresponded (TEARDOWN §6). */
  it("the canvas carries the read and the ledger carries the widgets", () => {
    const html = renderHtml(model());
    const body = /<div class="case__body">([\s\S]*)<\/div><\/div>$/.exec(html);
    assert.ok(body, "the body must render");
    const canvas = /<div class="case__canvas">([\s\S]*?)<\/div><aside class="case__ledger"/.exec(html);
    const ledger = /<aside class="case__ledger" aria-label="Role ledger">([\s\S]*)<\/aside>/.exec(html);
    assert.ok(canvas && ledger, "the canvas must precede the ledger in source order");

    assert.match(canvas[1], /class="case__quote"[^>]*>[\s\S]*?In their words/, "the lede opens the canvas");
    assert.match(canvas[1], /class="case__section case__section--they"[\s\S]*?<li[^>]*data-status="found"[^>]*>[\s\S]*?5\+ years design systems/);
    assert.match(canvas[1], /class="case__chip"[^>]*data-status="partial"[^>]*>[\s\S]*?Storybook/);
    assert.match(canvas[1], /class="case__section case__section--you"[\s\S]*?case__sev--high[\s\S]*?Experimentation/);
    assert.match(canvas[1], /class="case__dim"[\s\S]*?style="width: 84%;"/);
    assert.match(canvas[1], /class="case__section case__section--say"[\s\S]*?<span class="case__idx">01<\/span>/);
    assert.match(canvas[1], /<textarea[^>]*data-action="notes"[^>]*>Recruiter: Dana<\/textarea>/);

    assert.match(ledger[1], /class="case__section case__section--materials"[\s\S]*?<div class="case__materials" data-mount="materials"><\/div>/);
    assert.match(ledger[1], /class="case__section case__section--people"/);
    assert.match(ledger[1], /<input[^>]*data-action="edit-field"[^>]*data-field="followupAt"[^>]*type="date"[^>]*value="2026-09-04"/);
    assert.match(ledger[1], /<span class="case__seg"[^>]*role="group"[^>]*aria-label="Replied"/);
    assert.match(ledger[1], /class="case__section case__section--record"/);
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
    assert.doesNotMatch(html, /case__section--you/);
    assert.match(html, /Add a resume to see what matches/);
  });
  it("escapes exactly once", () => {
    const html = renderHtml(model({ vmPatch: { role: 'Eng <b>"x"</b> & co', location: 'Austin & "TX" <b>' } }));
    assert.match(html, /data-original="Eng &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; co"[^>]*>Eng &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; co<\/textarea>/);
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
    assert.match(html, /class="case__section case__section--they"[\s\S]*?class="case__skeleton"/, "the skeleton stands in for the THEY WANT section");
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
    assert.match(html, /class="case__section case__section--they"[\s\S]*?class="case__src case__src--review" aria-hidden="true">unverified<\/span>/);
    assert.match(html, /<div class="case__sub">Requirements · unverified — read these against the posting before you rely on them<\/div>/);
    assert.match(html, /class="case__req"[\s\S]*?5\+ years design systems/, "the recovered requirements still render, flagged");
  });

  it("a validator review verdict flags the lane even on a clean schema parse", () => {
    const html = renderHtml(model({ vmPatch: { enrichment: {
      mustHaves: ["5+ years design systems"], status: "ready", parseMode: "schema",
      reviewState: { status: "needs_review", reason: "Malformed model delimiters polluted structured fields.", pollutedFields: ["mustHaves"] },
    } } }));
    assert.match(html, /class="case__src case__src--review" aria-hidden="true">unverified<\/span>/);
    assert.match(html, /Requirements · unverified — read these against the posting before you rely on them/);
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
    assert.match(html, /class="case__meta">[\s\S]*?<span class="case__src case__src--inferred" aria-hidden="true">inferred<\/span>/);
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
    /* The freshness stamp closes the record now: how old the read is belongs
       with what has happened to the role, not floating under the lede. */
    assert.match(html, /case__section--record"[\s\S]*?<div class="case__stamp case__stamp--fresh">fetched 2h ago<\/div>/);
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

/* ------------------------------------------------------------
   People is ONE block (program `dossier-case-followups`, lane A).
   Before this, the Case painted its own People rows AND mounted
   the recruiter strip's boxed card directly beneath them — the
   same four CRM facts twice, over two write paths. The block now
   opens with the next move as a sentence and nothing follows it
   but the ledger.
   ------------------------------------------------------------ */
describe("the People block", () => {
  it("opens with the next move as a sentence, not a form field", () => {
    const html = renderHtml(model({ vmPatch: { contacts: [{ name: "Dana Reyes" }], followUpDate: "2026-09-04" } }));
    assert.match(html, /<h3 class="case__section-title">People<\/h3>[\s\S]*?<p class="case__move"><span class="case__move-k">Next move<\/span><span class="case__move-v">Follow up on 2026-09-04<\/span><\/p>/);
    assert.doesNotMatch(html, /Next action/, "the strip's label is retired; the Case says Next move");
  });

  it("renders replied as a three-state segmented control with the active chip filled", () => {
    const html = renderHtml(model({ vmPatch: { replied: "Unknown" } }));
    assert.match(html, /<span class="case__seg" role="group" aria-label="Replied">/);
    for (const value of ["Yes", "No", "Unknown"]) {
      assert.match(html, new RegExp(`data-action="edit-field" data-field="reply" data-value="${value}"`), value + " must be its own chip");
    }
    assert.match(html, /class="case__seg-b case__seg-b--on"[^>]*data-value="Unknown"[^>]*aria-pressed="true">Unknown</);
    assert.match(html, /class="case__seg-b"[^>]*data-value="Yes"[^>]*aria-pressed="false">Yes</);
    assert.doesNotMatch(html, /case__v--toggle/, "the two-state toggle is gone");
  });

  it("marks the chip the sheet actually holds", () => {
    const html = renderHtml(model({ vmPatch: { replied: "No" } }));
    assert.match(html, /class="case__seg-b case__seg-b--on"[^>]*data-value="No"/);
  });

  it("carries an empty saved slot on every writable People row", () => {
    const html = renderHtml(model());
    for (const field of ["contact", "heardBack", "reply", "followupAt"]) {
      assert.match(
        html,
        new RegExp(`<span class="case__saved" data-saved="${field}" role="status" aria-live="polite"></span>`),
        field + " needs a saved slot the write result can land in",
      );
    }
  });

  it("uses placeholders, not hint paragraphs, for the empty contact row", () => {
    const html = renderHtml(model({ vmPatch: { contacts: [] } }));
    assert.match(html, /data-field="contact"[^>]*value=""[^>]*aria-label="Contact" placeholder="Add a contact"/);
    assert.match(html, /data-field="heardBack"[^>]*placeholder="Aug 30"/);
  });

  it("no longer mounts the recruiter strip's dossier card under People", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__rows case__rows--people"/, "precondition: the People ledger rendered");
    assert.doesNotMatch(html, /data-mount="recruiter-strip"/);
    assert.doesNotMatch(html, /jb-recruiter-strip/);
    assert.doesNotMatch(html, /Save follow-up/);
  });
});

/* ------------------------------------------------------------
   The rail's posting facts (the A↔B contract). The dates come
   from the posting itself; the closing one earns a pill only
   when it is close enough to act on, and never a pill AND a
   meta line for the same date.
   ------------------------------------------------------------ */
describe("posting dates and salary on the rail", () => {
  it("adds Posted and Closes to the meta, in that order after Found", () => {
    const html = renderHtml(model({ vmPatch: { postedAt: "2026-08-27", closesAt: "2026-10-30" } }));
    assert.match(html, /<span>Found 2026-08-29<\/span><span>Posted 2026-08-27<\/span><span>Closes 2026-10-30<\/span>/);
  });

  it("says nothing about dates the posting did not carry", () => {
    const html = renderHtml(model());
    assert.match(html, /<span>Found 2026-08-29<\/span>/, "precondition: the meta rendered");
    assert.doesNotMatch(html, /Posted /);
    assert.doesNotMatch(html, /Closes /);
  });

  it("promotes a close inside 14 days to an amber pill and drops the meta line", () => {
    const html = renderHtml(model({ vmPatch: { closesAt: "2026-09-04" } }));
    assert.match(html, /<span class="case__pill case__pill--due" data-pill="closes"><span class="case__dot case__dot--amber"><\/span>Closes in 3 days<\/span>/);
    assert.doesNotMatch(html, /<span>Closes 2026-09-04<\/span>/, "never a pill and a meta line for the same date");
  });

  it("says Closes today and Closed N days ago at the boundaries", () => {
    assert.match(renderHtml(model({ vmPatch: { closesAt: "2026-09-01" } })), /data-pill="closes"[\s\S]*?Closes today</);
    assert.match(renderHtml(model({ vmPatch: { closesAt: "2026-09-02" } })), /data-pill="closes"[\s\S]*?Closes in 1 day</);
    assert.match(renderHtml(model({ vmPatch: { closesAt: "2026-08-25" } })), /data-pill="closes"[\s\S]*?Closed 7 days ago</);
  });

  it("leaves a close 40 days out as a meta line with no pill", () => {
    const html = renderHtml(model({ vmPatch: { closesAt: "2026-10-11" } }));
    assert.match(html, /<span>Closes 2026-10-11<\/span>/);
    assert.doesNotMatch(html, /data-pill="closes"/);
  });

  it("offers the posting's salary as a placeholder, tagged scrape, when the sheet has none", () => {
    const meta = railMeta(renderHtml(model({ vmPatch: { salary: "", postingSalary: "$185,000–$230,000 USD/yr" } })));
    /* A placeholder, never a value: it is the posting's number, not the user's,
       so a blur must not write it back into the sheet. */
    assert.match(meta, /data-field="salary"[^>]*value=""[^>]*placeholder="\$185,000–\$230,000 USD\/yr"/);
    assert.match(meta, /placeholder="\$185,000[^"]*"[^>]*><\/span><span><span class="case__src case__src--scrape" aria-hidden="true">from the posting<\/span><\/span>/);
  });

  it("never overwrites the sheet's own salary with the posting's", () => {
    const meta = railMeta(renderHtml(model({ vmPatch: { postingSalary: "$185,000–$230,000 USD/yr" } })));
    assert.match(meta, /data-field="salary"[^>]*value="\$185–230k"[^>]*placeholder="Salary"/);
    assert.doesNotMatch(meta, /case__src--scrape/, "a sheet salary needs no scrape tag");
  });
});

/* ------------------------------------------------------------
   The rail fact inputs' width (the sizing tension L7 flagged).
   12ch is a compromise on every engine: too wide for "Remote",
   too narrow for a salary band. The fix keeps 12ch as the
   fallback role.js re-sizes in `ch`, and lets engines that ship
   field-sizing hug the value instead.
   ------------------------------------------------------------ */
describe("rail fact inputs hug their value where field-sizing is supported", () => {
  const base = /\.case__fact-input \{([^}]*)\}/.exec(caseCssSource);

  it("keeps 12ch as the fallback width, unconditionally", () => {
    assert.ok(base, "the base .case__fact-input rule must exist");
    assert.match(base[1], /width: 12ch/);
    assert.doesNotMatch(
      base[1],
      /field-sizing/,
      "field-sizing in the base rule is ignored where unsupported and leaves 12ch as the only width",
    );
  });

  it("hugs the value behind an @supports guard", () => {
    const guarded = /@supports \(field-sizing: content\) \{\s*body\.jb-v2 \[data-region="role"\] \.case \.case__fact-input \{([^}]*)\}/.exec(caseCssSource);
    assert.ok(guarded, "the hug must be behind @supports (field-sizing: content)");
    assert.match(guarded[1], /field-sizing: content/);
    assert.match(guarded[1], /width: auto/, "auto is what lets the input shrink to its value");
    assert.match(guarded[1], /min-width: 6ch/, "an empty fact still has to show its placeholder");
  });

  it("stays scoped under the Case, like every other rule in this sheet", () => {
    assert.match(caseCssSource, /body\.jb-v2 \[data-region="role"\] \.case \.case__fact-input \{ font: inherit/);
  });
});
