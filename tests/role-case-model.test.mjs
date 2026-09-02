import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function load() {
  const sandbox = { window: {} };
  // trap 2: the shared text module must exist before its consumer evaluates.
  vm.runInNewContext(readFileSync(join(repoRoot, "jb-text.js"), "utf8"), sandbox, { filename: "jb-text.js" });
  assert.equal(typeof sandbox.window.JobBoredText.normalizeInline, "function", "jb-text must load first");
  /* Trap 2's sibling: the next-move sentence comes from recruiter-strip.js
     `nextAction`, so the strip evaluates BEFORE the model or every sentence
     assertion below would silently pass on "". */
  vm.runInNewContext(readFileSync(join(repoRoot, "recruiter-strip.js"), "utf8"), sandbox, { filename: "recruiter-strip.js" });
  assert.equal(typeof sandbox.window.JobBoredRecruiterStrip.nextAction, "function", "recruiter-strip must export nextAction");
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case-model.js"), "utf8"), sandbox, { filename: "role-case-model.js" });
  return sandbox.window.JobBoredCase.model;
}

/* The model is assembled inside the vm realm, so its arrays/objects are not
   reference-equal to this realm's intrinsics. Round-trip through JSON so
   assert.deepEqual compares values, not prototypes (same idiom as
   tests/dawn-data-jd-blocks.test.mjs). */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
function build(deps) {
  return plain(load().buildCaseModel("job-1", deps));
}
const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => STAGES.includes(v) ? v : "",
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed"].includes(v),
  isArchived: (v) => v === "expired",
};
const NOW = Date.parse("2026-09-01T12:00:00Z");
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

describe("buildCaseModel", () => {
  it("assembles identity, stage, next action, and numbers from the sources", () => {
    const m = build(baseDeps());
    assert.equal(m.identity.title, "Senior PM");
    assert.equal(m.identity.priority, "high");
    assert.equal(m.stage.current, "researching");
    assert.deepEqual(m.stage.order, STAGES.slice(0, 6));
    assert.equal(m.stage.terminal, false);
    assert.equal(m.nextAction.daysUntil, 3);
    assert.equal(m.numbers.fit.value, 8);
    assert.equal(m.numbers.ats.value, 82);
    assert.deepEqual(m.numbers.keywords, { percentage: 74, found: 12, partial: 4, missing: 1 });
    assert.deepEqual(m.numbers.materials, { ready: 2, total: 4, drafting: 1 });
    assert.equal(m.numbers.reply.value, "No");
  });
  it("demotes markdown in the one-liner and marks requirements from keyword analysis", () => {
    const m = build(baseDeps());
    assert.equal(m.oneLine, "Design infrastructure that ships.");
    assert.deepEqual(m.theyWant.requirements, [{ text: "5+ years design systems", status: "found" }, { text: "WCAG 2.2", status: "found" }]);
    /* P0-0 changed this line: the "Design Systems" tag is covered by the
       analyzer's "5+ years design systems" term, which the resume matched.
       `unknown` here was the exact-lookup bug, not the intended answer. */
    assert.deepEqual(m.theyWant.stack.map((s) => s.status), ["found", "partial", "found"]); // React, Storybook, Design Systems(tag)
    assert.equal(m.theyWant.hasMatchData, true);
  });
  it("uses the scorecard for YOU HAVE and falls back to keywords without one", () => {
    const with_ = build(baseDeps());
    assert.equal(with_.youHave.source, "scorecard");
    assert.equal(with_.youHave.gaps[0].severity, "high");
    assert.equal(with_.youHave.dimensions.length, 5);
    const without = build(baseDeps({ scorecard: null }));
    assert.equal(without.youHave.source, "keywords");
    assert.deepEqual(without.youHave.gaps.map((g) => g.gap), ["Kubernetes"]);
  });
  it("builds a dated record with future steps hollow", () => {
    const m = build(baseDeps());
    const labels = m.record.map((e) => e.label + ":" + e.state);
    assert.deepEqual(labels, ["Found:done", "Enriched:done", "Resume drafted:done", "Contacted:done", "Follow-up due:due", "Applied:future"]);
    assert.equal(m.meta.providerLabel, "OpenAI");
  });
  it("hides blocks whose inputs are missing", () => {
    const m = build(baseDeps({ keywords: null, scorecard: null, manifest: null,
      vm: { job: { ...baseDeps().vm.job, followUpDate: "", enrichment: { status: "", mustHaves: [], niceToHaves: [], toolsAndStack: [], talkingPoints: [] }, requirements: [], skills: [], tags: [] } } }));
    assert.equal(m.nextAction, null);
    assert.equal(m.numbers.keywords, null);
    assert.equal(m.numbers.materials, null);
    assert.equal(m.theyWant.hasMatchData, false);
    assert.equal(m.youHave.source, "none");
    assert.equal(m.moves.materials, null);
  });
  it("collapses terminal stages", () => {
    const m = build(baseDeps({ vm: { job: { ...baseDeps().vm.job, stage: "rejected" } } }));
    assert.equal(m.stage.terminal, true);
  });
});

/* ------------------------------------------------------------
   People: the next move is one sentence, and it is the SAME
   sentence the kanban compact strip shows — recruiter-strip.js
   `nextAction` is the only place the four branches live.
   ------------------------------------------------------------ */
describe("moves.people.nextMove", () => {
  function people(patch) {
    return build(baseDeps({ vm: { job: { ...baseDeps().vm.job, ...patch } } })).moves.people;
  }

  it("asks for a contact before anything else", () => {
    assert.equal(people({ contacts: [], followUpDate: "2026-09-04", replied: "Yes" }).nextMove, "Find a recruiter contact");
  });

  it("names the follow-up date once a contact is known", () => {
    assert.equal(people({ contacts: [{ name: "Dana Reyes" }], followUpDate: "2026-09-04" }).nextMove, "Follow up on 2026-09-04");
  });

  it("moves to scheduling when they replied and no follow-up is set", () => {
    assert.equal(people({ contacts: [{ name: "Dana Reyes" }], followUpDate: "", replied: "Yes" }).nextMove, "Schedule the next conversation");
  });

  it("asks for a follow-up date when they have not replied", () => {
    assert.equal(people({ contacts: [{ name: "Dana Reyes" }], followUpDate: "", replied: "No" }).nextMove, "Set a follow-up date");
  });

  it("is the same function the compact kanban strip calls", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(readFileSync(join(repoRoot, "jb-text.js"), "utf8"), sandbox, { filename: "jb-text.js" });
    vm.runInNewContext(readFileSync(join(repoRoot, "recruiter-strip.js"), "utf8"), sandbox, { filename: "recruiter-strip.js" });
    assert.equal(
      sandbox.window.JobBoredRecruiterStrip.nextAction({ contact: "Dana", reply: "No", followUp: "Unknown" }),
      "Set a follow-up date",
    );
  });
});

/* ------------------------------------------------------------
   Posting facts (A<->B contract): the scrape's own dates and
   advertised salary ride the identity block, and the closing
   date is counted in whole days so the rail can act on it.
   ------------------------------------------------------------ */
describe("identity posting facts", () => {
  function identity(patch) {
    return build(baseDeps({ vm: { job: { ...baseDeps().vm.job, ...patch } } })).identity;
  }

  it("passes postedAt, closesAt and postingSalary through", () => {
    const id = identity({ postedAt: "2026-08-27", closesAt: "2026-09-30", postingSalary: "$185,000–$230,000 USD/yr" });
    assert.equal(id.postedAt, "2026-08-27");
    assert.equal(id.closesAt, "2026-09-30");
    assert.equal(id.postingSalary, "$185,000–$230,000 USD/yr");
  });

  it("is blank, never undefined, when the scrape carried no posting facts", () => {
    const id = identity({});
    assert.deepEqual([id.postedAt, id.closesAt, id.postingSalary], ["", "", ""]);
    assert.equal(id.closesInDays, null);
  });

  it("counts whole days to the close for ahead, today and past", () => {
    // NOW is 2026-09-01T12:00:00Z.
    assert.equal(identity({ closesAt: "2026-09-04" }).closesInDays, 3);
    assert.equal(identity({ closesAt: "2026-09-01" }).closesInDays, 0);
    assert.equal(identity({ closesAt: "2026-08-25" }).closesInDays, -7);
  });

  it("leaves closesInDays null when the date will not parse", () => {
    assert.equal(identity({ closesAt: "rolling" }).closesInDays, null);
  });
});

/* ---- Polish pass: the model's truth claims (P0-0, P0-0c/d, P0-7/8/10, P0-E) ---- */

/* P0-0: the analyzer stores FRAGMENTS — it splits long requirements on
   `;,|`/and/or, skips items over 8 words, truncates labels past 72 chars — so
   a full requirement sentence never equals a stored label and the THEY WANT
   lane renders `unknown` for everything that is not a single token. These are
   the shapes analyzeJob actually produces. */
describe("requirement marking (P0-0)", () => {
  function depsWith(requirements, terms) {
    const byLabel = new Map(terms.map((t) => [t.label.toLowerCase(), t.status]));
    const d = baseDeps({ keywords: { percentage: 50, foundCount: 1, partialCount: 0, missingTerms: [], byLabel, uniqueTerms: terms } });
    d.vm.job.requirements = requirements;
    d.vm.job.skills = [];
    d.vm.job.tags = [];
    d.vm.job.enrichment = { mustHaves: [], niceToHaves: [], toolsAndStack: [] };
    return d;
  }

  it("marks a sentence-shaped requirement from the fragment the analyzer stored", () => {
    const m = build(depsWith(
      ["5+ years building design systems at scale"],
      [{ label: "building design systems", status: "found" }],
    ));
    assert.equal(m.theyWant.requirements[0].status, "found", "a contained analyzer term must mark the requirement");
  });

  it("takes the strongest status when several terms overlap one requirement", () => {
    const m = build(depsWith(
      ["React and Storybook with WCAG 2.2 accessibility"],
      [{ label: "storybook", status: "missing" }, { label: "react", status: "partial" }, { label: "wcag 2.2", status: "found" }],
    ));
    assert.equal(m.theyWant.requirements[0].status, "found");
  });

  it("marks a requirement the analyzer truncated at 72 chars", () => {
    const long = "Deep experience partnering with product and engineering leadership across a distributed org";
    const m = build(depsWith([long], [{ label: `${long.slice(0, 69).trim()}…`, status: "partial" }]));
    assert.equal(m.theyWant.requirements[0].status, "partial");
  });

  it("keeps unknown when nothing overlaps", () => {
    const m = build(depsWith(["Willingness to travel quarterly"], [{ label: "kubernetes", status: "found" }]));
    assert.equal(m.theyWant.requirements[0].status, "unknown");
  });
});

describe("scores that were never scored (P0-0c)", () => {
  it("hides the ATS tile rather than reporting 0/100", () => {
    const d = baseDeps();
    d.scorecard = { result: { overallScore: null, topStrengths: [], dimensionScores: { requirementsCoverage: null, experienceRelevance: undefined, impactClarity: "", atsParseability: 90, toneFit: 78 } } };
    const m = build(d);
    assert.equal(m.numbers.ats, null, "an unscored card must not render ATS 0/100");
    assert.deepEqual(m.youHave.dimensions.map((x) => x.key), ["atsParseability", "toneFit"], "unscored dimensions must not render as 0% bars");
  });
});

/* P0-0d: both suites pin a UTC noon "now", which cancels the off-by-one out.
   These use a local evening west of UTC — the exact case that reads a day
   early in production. */
describe("day counts are local calendar days (P0-0d)", () => {
  const LOCAL_EVENING = Date.parse("2026-09-03T18:30:00-06:00");
  it("a follow-up due tomorrow is 1 day out, not 0, at 18:30 local", () => {
    const d = baseDeps({ nowMs: LOCAL_EVENING });
    d.vm.job.followUpDate = "2026-09-04";
    assert.equal(build(d).nextAction.daysUntil, 1);
  });
  it("a follow-up due today is 0, not overdue", () => {
    const d = baseDeps({ nowMs: LOCAL_EVENING });
    d.vm.job.followUpDate = "2026-09-03";
    assert.equal(build(d).nextAction.daysUntil, 0);
  });
  it("a posting closing tomorrow is 1 day out", () => {
    const d = baseDeps({ nowMs: LOCAL_EVENING });
    d.vm.job.closesAt = "2026-09-04";
    assert.equal(build(d).identity.closesInDays, 1);
  });
});

describe("the keyword fallback claims nothing it was not told (P0-7, P0-10)", () => {
  function fallbackDeps() {
    const d = baseDeps({ scorecard: null, keywords: {
      percentage: 50, foundCount: 2, partialCount: 0,
      missingTerms: [{ label: "Kubernetes", fullLabel: "Kubernetes" }],
      byLabel: new Map([["wcag 2.2", "found"], ["figma design systems", "found"]]),
      uniqueTerms: [{ label: "WCAG 2.2", status: "found" }, { label: "Figma design systems", status: "found" }, { label: "Kubernetes", status: "missing" }],
    } });
    return d;
  }
  it("emits no severity for a gap no engine graded (P0-7)", () => {
    const g = build(fallbackDeps()).youHave.gaps[0];
    assert.equal(g.gap, "Kubernetes");
    assert.ok(!g.severity, `the fallback must not invent a severity, got ${JSON.stringify(g.severity)}`);
  });
  it("renders the term's own casing, not the lowercased map key (P0-10)", () => {
    assert.deepEqual(build(fallbackDeps()).youHave.strengths, ["WCAG 2.2", "Figma design systems"]);
  });
  it("keeps the scorecard's own severity untouched", () => {
    assert.equal(build(baseDeps()).youHave.gaps[0].severity, "high");
  });
});

describe("an overdue follow-up is not done (P0-8)", () => {
  it("stays due when nobody was contacted after the date passed", () => {
    const d = baseDeps({ nowMs: Date.parse("2026-09-10T12:00:00Z") });
    d.vm.job.followUpDate = "2026-09-04";
    d.vm.job.lastHeardFrom = "2026-08-31";
    const row = build(d).record.filter((e) => e.label === "Follow-up due")[0];
    assert.equal(row.state, "due", "a missed follow-up must not render as completed");
  });
  it("is done once a contact lands on or after the follow-up date", () => {
    const d = baseDeps({ nowMs: Date.parse("2026-09-10T12:00:00Z") });
    d.vm.job.followUpDate = "2026-09-04";
    d.vm.job.lastHeardFrom = "2026-09-05";
    const row = build(d).record.filter((e) => e.label === "Follow-up due")[0];
    assert.equal(row.state, "done");
  });
});

/* P0-E: a provenance throw used to clear inferredFields, so a title the model
   GUESSED rendered identically to one read from the posting — failing toward
   over-confidence, the opposite of the stated design intent. */
describe("failures are loud, and never upgrade a guess (P0-E)", () => {
  it("keeps the inferred marks it already collected when the classifier throws", () => {
    const d = baseDeps();
    let n = 0;
    d.provenance = {
      CLAIM_FIELDS: ["inferredTitle", "inferredCompany", "inferredSalary"],
      freshness: () => ({ scrapedAt: "2026-08-30", label: "3 days ago" }),
      resolveSource: () => "scrape",
      resolveGrounding: () => "posting",
      classify: () => { n += 1; if (n > 1) throw new Error("classifier blew up"); return { label: "inferred" }; },
    };
    const m = build(d);
    assert.deepEqual(m.provenance.inferredFields, ["inferredTitle"], "a throw must not erase the guesses already found");
    assert.equal(m.provenance.inferredIdentity, true, "an inferred title must still be flagged");
  });
});
