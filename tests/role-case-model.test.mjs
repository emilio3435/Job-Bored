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
    assert.deepEqual(m.theyWant.stack.map((s) => s.status), ["found", "partial", "unknown"]); // React, Storybook, Design Systems(tag)
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
    assert.equal(people({ contacts: [{ name: "Dana Reyes" }], followUpDate: "2026-09-04" }).nextMove, "Follow up on Sep 4");
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
