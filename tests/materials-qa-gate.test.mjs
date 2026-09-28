/**
 * Wave 1 L4 — QA, grounding and the publish gate.
 *
 * A failing document never ships quietly (K6, P-16b, P-10), every number
 * traces to its own claim (P-9), and the resume shows dates, education and
 * the candidate's own headline (P-4, P-5). No live model calls: every
 * reply is scripted or recorded.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildManifest } from "../server/application-materials.mjs";
import { delint, loadVoicePack } from "../server/materials-delint.mjs";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { tagDraftMetrics } from "../server/materials-metric-tag.mjs";
import { buildOutline } from "../server/materials-outline.mjs";
import { runPipeline } from "../server/materials-pipeline.mjs";
import { buildQaRecord, formatDocumentQaReport, rubricIssues } from "../server/materials-qa.mjs";
import { scoreRubric } from "../server/materials-rubric.mjs";

const FIXTURE_84D0 = new URL("./fixtures/materials/northwind-84d0/", import.meta.url);
const read84d0 = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(name, FIXTURE_84D0), "utf8"));

const RESUME_TEXT = [
  "Jordan Rivera",
  "Revenue Operations Leader • Analytics Builder",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.",
  "- Drove 125% YoY paid-search conversion growth on a flagship account.",
  "- Led the market to a 60% digital revenue mix with clear weekly readouts.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool that ran 24+ forecasts against $3.1M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
  "EDUCATION",
  "Bachelor of Arts, Economics | Example College 2015",
].join("\n");

const PROFILE = {
  version: 1,
  identity: { targetRoles: ["Revenue Operations Director"], targetSeniority: "director", primaryNarrative: "Revenue operator." },
  strengths: [],
  experiences: [{ slug: "northwind", company: "Northwind", title: "Digital Sales Manager" }],
  hardConstraints: { workMode: "any" },
};

const JD_TEXT = [
  "Revenue Operations Director at Acme Analytics in Austin, TX. This role owns pipeline math,",
  "forecasting and spend reporting for a digital sales team, and partners with analysts on",
  "weekly readouts. Requirements: digital sales leadership, forecasting, Google Ads, and clear",
  "reporting practices across paid search and streaming analytics.",
].join("\n");

const GOOD_LETTER = {
  thesis: "Acme Analytics runs pipeline math and spend reporting for its digital sales team, and I've spent years building the weekly readouts that people in that seat actually use to make decisions. Spreadsheets are my favorite kind of instrument.",
  analyticsProof: "At Northwind I grew Austin to a top-4 national ranking on a $12M+ book with Google Ads, and I led the market to a 60% digital revenue mix. Every week I owned the pipeline math with our analysts and turned it into clear weekly readouts for the digital sales team. People read them. That is rarer than it sounds.",
  aiOpsProof: "I also shipped an SEM forecast tool that ran 24+ forecasts against $3.1M of pipeline, and built streaming ingestion for analytics events with Kafka and Postgres. It's the same shape of work as your forecasting and spend reporting. A quiet data error there becomes a bad budget call.",
  nextStep: "Here's my offer: I'd trace one Acme Analytics forecast from source to readout, then write down where it can break and who would notice. Give me a short call with your team and I'll bring the sketch.",
};

const validateQa = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(new URL("../schemas/materials-qa.v1.schema.json", import.meta.url), "utf8")),
);

const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };

/**
 * Routes each stage call by its system prompt. extract/select fail (so
 * they take their deterministic halves), the delint rewrite changes
 * nothing, and the draft replies come from `drafts` in order (the last
 * one repeats).
 * @param {Array<(user: string) => Record<string, unknown>>} drafts
 */
function routedFetch(drafts, { modelStages = false } = {}) {
  /** @type {Array<{ stage: string, user: string }>} */
  const calls = [];
  const fetchImpl = async (/** @type {unknown} */ _url, /** @type {{ body: string }} */ init) => {
    const body = JSON.parse(init.body);
    const system = String(body.messages[0].content);
    const user = String(body.messages[1].content);
    const stage = /rewrite/i.test(system) ? "delint" : /job posting/i.test(system) ? "extract" : /select/i.test(system) ? "select" : "draft";
    calls.push({ stage, user });
    if ((stage === "extract" || stage === "select") && !modelStages) throw new Error("stage offline in this fixture");
    if (stage === "extract") return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(EXTRACT_REPLY) } }] }) };
    if (stage === "select") {
      const ids = [...user.matchAll(/^(\d+)\. (\S+)/gm)].map((m) => m[2]);
      const kept = ids.slice(0, 5);
      const content = JSON.stringify({
        kept: kept.map((claimId, i) => ({ claimId, slot: `resume.featured.pick.b${i + 1}`, reason: "maps to the role" })),
        dropped: ids.slice(5).map((claimId) => ({ claimId, code: "budget", reason: "outside the kept set" })),
        transfers: [],
        letter: { analyticsProof: kept[0], aiOpsProof: kept[1] || kept[0] },
      });
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    }
    const draftIndex = calls.filter((c) => c.stage === "draft").length - 1;
    const content = stage === "delint" ? "{}" : JSON.stringify(drafts[Math.min(draftIndex, drafts.length - 1)](user));
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return { fetchImpl, calls };
}

/* A healthy jd.extract model fill, so a run can finish undegraded. */
const EXTRACT_REPLY = {
  outcomes: [
    { id: "pipe-math", text: "Own pipeline math and forecasting", weight: 0.9 },
    { id: "spend", text: "Report spend across paid search", weight: 0.8 },
  ],
  differentiators: [],
  bars: [],
  constraints: [{ type: "location", text: "Austin, TX" }],
  echoBans: [],
  nounWeights: { forecasting: 1.0, pipeline: 0.9 },
};

/** Featured claim ids and texts from a draft prompt. */
function featuredFrom(/** @type {string} */ user) {
  return [...user.split("Earlier lines:")[0].matchAll(/^- (\S+): (.*)$/gm)].map((m) => ({ claimId: m[1], text: m[2] }));
}

describe("P-9: a bullet may only use its own claim's numbers", () => {
  const ledger = {
    claims: [
      { id: "c1", text: "Grew a $12M+ book.", metrics: [{ token: "$12M+" }] },
      { id: "c2", text: "Coached 12 AE desks.", metrics: [{ token: "12" }] },
    ],
  };

  it("should fail a bullet that borrows another claim's metric", () => {
    const { issues } = tagDraftMetrics({
      ledger,
      draft: { bullets: [{ claimId: "c2", text: "Coached 12 AE desks on a $12M+ book." }], letter: {} },
    });
    assert.deepEqual(issues.map((i) => [i.code, i.token]), [["metric_borrowed", "$12M+"]]);
  });

  it("should pass a bullet that uses only its own claim's metric", () => {
    const { issues, matched } = tagDraftMetrics({
      ledger,
      draft: { bullets: [{ claimId: "c1", text: "Grew a $12M+ book across the region." }], letter: {} },
    });
    assert.deepEqual(issues, []);
    assert.equal(matched, 1);
  });

  it("should flag the four new banned phrases as failing filler", async () => {
    const pack = await loadVoicePack();
    const text = "I welcome the opportunity to protect operational integrity, advance strategic initiatives and your ongoing success.";
    const { spans } = delint({ fields: { "letter.nextStep": text }, pack });
    const hits = spans.filter((s) => s.code === "banned_filler" && s.severity === "fail").length;
    assert.equal(hits, 4, JSON.stringify(spans));
  });
});

describe("new rubric rows", () => {
  const extract = { outcomes: [], nouns: [] };
  const selection = { kept: [] };
  const ledger = {
    claims: [
      { id: "c1", text: "Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.", metrics: [{ token: "top-4" }, { token: "$12M+" }] },
      { id: "c2", text: "Drove 125% YoY paid-search conversion growth on a flagship account.", metrics: [{ token: "125%" }] },
    ],
  };
  /** @param {Record<string, string>} letter */
  const letterRows = (letter, company = "Acme Analytics, Inc.") =>
    Object.fromEntries(
      scoreRubric({ document: "letter", extract, selection, ledger, draft: { letter }, company }).rows.map((r) => [r.id, r]),
    );

  it("should score company_specificity by mentions and the first 40 words", () => {
    assert.equal(letterRows({ thesis: "Acme Analytics needs this.", proof1: "Acme Analytics again." }).company_specificity.score, 2);
    assert.equal(letterRows({ thesis: `${"word ".repeat(45)}Acme Analytics once.` }).company_specificity.score, 1);
    const none = letterRows({ thesis: "Your team needs this." }).company_specificity;
    assert.equal(none.score, 0);
    assert.match(none.note, /never named/);
  });

  it("should count traced letter metrics and fail ungrounded proof paragraphs", () => {
    const grounded = letterRows({
      thesis: "Acme Analytics hires for growth.",
      proof1: "I grew Austin to a top-4 ranking on a $12M+ book.",
      proof2: "I drove 125% YoY paid-search conversion growth.",
    });
    assert.equal(grounded.metric_in_letter.score, 2);
    assert.equal(grounded.letter_ungrounded.score, 2);
    const abstract = letterRows({
      thesis: "Acme Analytics hires for growth.",
      proof1: "I prioritize robust evaluation and actionable reporting practices.",
      proof2: "I emphasize pipeline resilience and systematic monitoring.",
    });
    assert.equal(abstract.metric_in_letter.score, 0);
    assert.equal(abstract.letter_ungrounded.score, 0);
    assert.match(abstract.letter_ungrounded.note, /proof1, proof2/);
    const invented = letterRows({ thesis: "Acme Analytics.", proof1: "I grew a $99M book at top-4 rank." });
    assert.equal(invented.letter_ungrounded.score, 0, "an untraced numeral is ungrounded");
  });

  it("should flag metric_dropped when a bullet loses its claim's number", () => {
    const rows = scoreRubric({
      document: "resume",
      extract,
      selection,
      ledger,
      draft: { bullets: [{ claimId: "c1", text: "Grew Austin to a national ranking." }, { claimId: "c2", text: "Drove 125% YoY growth." }] },
      fill: { ratio: 1, basis: "measured" },
    }).rows;
    const dropped = rows.find((r) => r.id === "metric_dropped");
    assert.equal(dropped?.score, 1);
    assert.match(String(dropped?.note), /c1/);
  });

  it("should flag a thin page as underfill and name the claims the budget dropped (P-15)", () => {
    const led = {
      employers: [{ id: "e1", name: "Northwind" }],
      claims: ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id, employerId: "e1", text: `Claim ${id}.` })),
    };
    const outline = buildOutline({
      selection: { kept: led.claims.map((c) => ({ claimId: c.id })), budget: { featuredEmployers: 1, bulletsPerFeatured: 3, earlierLines: 2 } },
      ledger: led,
      feature: "resume",
    });
    /* A featured company's overflow never lands in Earlier: it is dropped. */
    assert.deepEqual(outline.dropped, [
      { claimId: "d", reason: "page_budget" },
      { claimId: "e", reason: "page_budget" },
      { claimId: "f", reason: "page_budget" },
      { claimId: "g", reason: "page_budget" },
    ]);
    const rubric = scoreRubric({
      document: "resume",
      extract,
      selection,
      ledger: led,
      draft: { bullets: [] },
      fill: { ratio: 0.4, basis: "136 words of 340 estimated" },
      droppedClaims: outline.dropped,
    });
    const underfill = rubric.rows.find((r) => r.id === "underfill");
    assert.equal(underfill?.score, 0);
    assert.match(String(underfill?.note), /40% full.*dropped 4 claim/);
    assert.ok(rubricIssues("resume", rubric).some((i) => i.code === "underfill"));
  });
});

describe("QA record and report (rule 10)", () => {
  const row = (/** @type {string} */ id, /** @type {number} */ score) => ({ id, score, max: 2, note: `${id} note` });

  it("should block READY when company_specificity is 0, even at a passing total", () => {
    const rubric = {
      rows: [row("outcome_coverage", 2), row("noun_fidelity", 2), row("transfer_honesty", 2), row("delint_clean", 2), row("company_specificity", 0), row("metric_in_letter", 2), row("letter_ungrounded", 2)],
      total: 12,
      max: 14,
      threshold: 12,
    };
    const qa = buildQaRecord({ document: "letter", runId: "r1", issues: rubricIssues("letter", rubric), rubric });
    assert.equal(qa.disposition, "FAIL");
    assert.equal(qa.dispositionReason, "company_specificity note");
  });

  it("should never print 'Issues: None' below full marks, and list every row below max", () => {
    const rubric = { rows: [row("outcome_coverage", 2), row("noun_fidelity", 1)], total: 3, max: 4, threshold: 4 };
    const qa = buildQaRecord({ document: "resume", runId: "r1", issues: [], rubric });
    const report = formatDocumentQaReport({ records: [qa] });
    assert.match(report, /`noun_fidelity` 1\/2: noun_fidelity note/);
    assert.doesNotMatch(report.split("### Issues")[1], /None\./, report);
    assert.ok(qa.checks.some((c) => c.code === "rubric.noun_fidelity"));

    const full = buildQaRecord({ document: "resume", runId: "r2", issues: [], rubric: { rows: [row("outcome_coverage", 2)], total: 2, max: 2, threshold: 2 } });
    assert.equal(full.disposition, "READY");
    assert.match(formatDocumentQaReport({ records: [full] }).split("### Issues")[1], /None\./);
  });
});

describe("publish gate through the pipeline", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-qa-gate-"));
    dir = join(root, "acme-role");
    await mkdir(dir);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** @param {Record<string, unknown>} overrides */
  function base(overrides = {}) {
    return {
      dir,
      payload: {
        slug: "acme-role",
        company: "Acme Analytics",
        title: "Revenue Operations Director",
        feature: "both",
        jobUrl: "https://example.com/job",
        notes: "",
        resume: { source: "upload", filename: "resume.txt", addedAt: "2026-09-27T00:00:00.000Z", text: RESUME_TEXT },
      },
      pin: PIN,
      jdText: JD_TEXT,
      jdSource: "paste",
      gate: GATE,
      ledger: buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT }),
      resumeText: RESUME_TEXT,
      now: new Date("2026-09-27T05:00:00.000Z"),
      runId: "run-qa-1",
      openSession: async () => null,
      readMarks: async () => [],
      ...overrides,
    };
  }

  const goodDraft = (/** @type {string} */ user) => ({
    statement: "Revenue operations leader who owns pipeline math, forecasting and spend reporting for digital sales teams, with weekly readouts the business trusts and analytics tooling built in-house.",
    bullets: featuredFrom(user),
    earlier: [],
    letter: GOOD_LETTER,
  });
  /* The first draft borrows the $12M+ book into every bullet. */
  const borrowingDraft = (/** @type {string} */ user) => ({
    ...goodDraft(user),
    bullets: featuredFrom(user).map((b) => ({ claimId: b.claimId, text: `${b.text.replace(/\.$/, "")} on a $12M+ book.` })),
  });

  it("the recorded _84d0 letter fails with named reasons after exactly one repair", async () => {
    const recorded = read84d0("draft.json");
    const { fetchImpl, calls } = routedFetch([() => recorded]);
    const out = await runPipeline(base({
      payload: { ...base().payload, slug: "northwindmedia-inc-director-digital-sales", company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", feature: "cover_letter" },
      jdText: readFileSync(new URL("job-description.txt", FIXTURE_84D0), "utf8"),
      ledger: read84d0("ledger.json"),
      runId: "mr_fixture_84d0",
      fetchImpl,
    }));
    assert.equal(out.outcome, "published");
    const repairCalls = calls.filter((c) => c.stage === "draft" && /REPAIR/.test(c.user));
    assert.equal(repairCalls.length, 1, "exactly one automatic repair");
    assert.match(repairCalls[0].user, /company_unnamed/, "QA issues are the repair instructions");

    const letter = JSON.parse(await readFile(join(dir, "qa.letter.json"), "utf8"));
    assert.equal(letter.disposition, "FAIL");
    const codes = letter.checks.map((/** @type {{ code: string }} */ c) => c.code);
    for (const code of ["company_unnamed", "letter_ungrounded", "metric_in_letter", "rubric.delint_clean"]) {
      assert.ok(codes.includes(code), `${code} named: ${codes.join(", ")}`);
    }
    assert.match(letter.dispositionReason, /NorthwindMedia, Inc\. is never named/);
    assert.equal(letter.repair.attempted, true);
    assert.equal(letter.repair.before.status, "fail");
    assert.ok(letter.degraded.length >= 2, "extract and select degraded are carried");

    assert.equal(validateQa(letter), true, JSON.stringify(validateQa.errors));
    const combined = JSON.parse(await readFile(join(dir, "qa.json"), "utf8"));
    assert.equal(validateQa(combined), true, JSON.stringify(validateQa.errors));
    assert.equal(combined.disposition, "FAIL");

    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.deepEqual(run.repairs.map((/** @type {{ code: string }} */ r) => r.code), ["auto_repair"]);
    assert.equal(run.stages.filter((/** @type {{ stage: string }} */ s) => s.stage === "jd.extract").length, 1, "extract reused, not re-run");
    assert.equal(run.stages.filter((/** @type {{ stage: string }} */ s) => s.stage === "qa").length, 2, "scored before and after the repair");

    const report = await readFile(join(dir, "qa-report.md"), "utf8");
    assert.match(report, /## Cover letter: FAIL/);
    assert.match(report, /`company_specificity` 0\/2/);
    assert.doesNotMatch(report, /Issues\n\nNone\./);
  });

  it("repairs a borrowed-metric FAIL once and re-scores the fixed draft", async () => {
    const { fetchImpl, calls } = routedFetch([borrowingDraft, goodDraft]);
    const out = await runPipeline(base({ fetchImpl, payload: { ...base().payload, feature: "resume" } }));
    assert.equal(calls.filter((c) => c.stage === "draft").length, 2);
    assert.match(calls.filter((c) => c.stage === "draft")[1].user, /metric_borrowed/);
    const resume = JSON.parse(await readFile(join(dir, "qa.resume.json"), "utf8"));
    assert.notEqual(resume.disposition, "FAIL", JSON.stringify(resume.checks));
    assert.equal(resume.repair.before.status, "fail");
    assert.ok(resume.repair.before.codes.includes("metric_borrowed"));
    assert.equal(out.qa.repaired, true);
  });

  it("P-8 x P-16b: a run that still FAILs after its repair is never cached", async () => {
    const first = routedFetch([borrowingDraft], { modelStages: true });
    const out = await runPipeline(base({ fetchImpl: first.fetchImpl, payload: { ...base().payload, feature: "resume" } }));
    assert.equal(out.qa.status, "fail");
    assert.equal(out.degraded.length, 0, "not degraded: only QA decides");
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.equal(run.cacheKey, undefined);
    assert.match(run.stages.at(-1).detail, /not cached: QA failed/);
    /* The repair pass carries the first pass's call records (L2 P-7). */
    assert.ok(run.stages.find((/** @type {{ stage: string }} */ s) => s.stage === "jd.extract").call, "extract call record kept");
    assert.equal(run.stages.filter((/** @type {{ stage: string, call?: unknown }} */ s) => s.stage === "draft" && s.call).length, 2, "both draft calls recorded");

    const again = routedFetch([borrowingDraft], { modelStages: true });
    const rerun = await runPipeline(base({ fetchImpl: again.fetchImpl, payload: { ...base().payload, feature: "resume" }, runId: "run-qa-2" }));
    assert.equal(rerun.outcome, "published", "a FAILed run is re-run, not served");
    assert.ok(again.calls.length > 0);
  });

  it("P-8 x P-16b: a run that repaired to a non-FAIL verdict is cached by choice", async () => {
    const first = routedFetch([borrowingDraft, goodDraft], { modelStages: true });
    const out = await runPipeline(base({ fetchImpl: first.fetchImpl, payload: { ...base().payload, feature: "resume" } }));
    assert.equal(out.qa.repaired, true);
    assert.notEqual(out.qa.status, "fail");
    assert.equal(out.degraded.length, 0);
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    assert.match(String(run.cacheKey), /\|resume\|local:stub$/);
    assert.deepEqual(run.repairs.map((/** @type {{ code: string }} */ r) => r.code), ["auto_repair"]);

    let calls = 0;
    const cached = await runPipeline(base({
      payload: { ...base().payload, feature: "resume" },
      runId: "run-qa-2",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    }));
    assert.equal(cached.outcome, "cached");
    assert.equal(calls, 0);
  });

  it("K6: a later letter run leaves the resume's FAIL verdict intact", async () => {
    /* Resume run: the repair repeats the borrowing, so it stays FAIL. */
    const first = routedFetch([borrowingDraft]);
    await runPipeline(base({ fetchImpl: first.fetchImpl, payload: { ...base().payload, feature: "resume" }, runId: "run-resume" }));
    assert.equal(first.calls.filter((c) => c.stage === "draft").length, 2, "one repair, never two");
    const resumeBefore = await readFile(join(dir, "qa.resume.json"), "utf8");
    assert.equal(JSON.parse(resumeBefore).disposition, "FAIL");

    const second = routedFetch([goodDraft]);
    await runPipeline(base({ fetchImpl: second.fetchImpl, payload: { ...base().payload, feature: "cover_letter" }, runId: "run-letter" }));
    assert.equal(await readFile(join(dir, "qa.resume.json"), "utf8"), resumeBefore, "resume verdict untouched");
    const letter = JSON.parse(await readFile(join(dir, "qa.letter.json"), "utf8"));
    assert.equal(letter.runId, "run-letter");
    assert.notEqual(letter.disposition, "FAIL", JSON.stringify(letter.checks));

    const report = await readFile(join(dir, "qa-report.md"), "utf8");
    assert.match(report, /## Resume: FAIL/);
    assert.match(report, /## Cover letter: /);

    /* The manifest exposes both verdicts for the UI (Wave 2). */
    const manifest = await buildManifest("acme-role", { root });
    const resumeQa = manifest.quality.documents.resume.qa;
    assert.equal(manifest.quality.documents.resume.status, "fail");
    assert.equal(resumeQa.disposition, "FAIL");
    assert.match(resumeQa.dispositionReason, /belongs to a different claim/);
    assert.ok(resumeQa.rubric.rows.some((/** @type {{ id: string }} */ r) => r.id === "underfill"));
    assert.ok(Array.isArray(resumeQa.degraded));
    assert.equal(resumeQa.repair.attempted, true);
    assert.equal(manifest.quality.documents.cover_letter.qa.runId, "run-letter");
    assert.ok(manifest.quality.documents.resume.issues.some((/** @type {{ code: string }} */ i) => i.code === "metric_borrowed"), "QA issues reach the manual repair path");
  });

  it("P-4 / P-5: resume.txt carries every role's dates, the degree and the candidate's own headline", async () => {
    const { fetchImpl } = routedFetch([goodDraft]);
    const out = await runPipeline(base({ fetchImpl, payload: { ...base().payload, feature: "resume" } }));
    const txt = await readFile(join(dir, "resume.txt"), "utf8");
    assert.match(txt, /2021 – 2026/);
    assert.match(txt, /2024 – [Pp]resent/);
    assert.match(txt, /EDUCATION\nBachelor of Arts, Economics \| Example College 2015/);
    assert.equal(out.model.identity.target, "Revenue Operations Leader • Analytics Builder");
    assert.notEqual(out.model.identity.target, "Revenue Operations Director", "never the posting title");
    assert.match(txt, /^Jordan Rivera\nRevenue Operations Leader • Analytics Builder\n/);
  });
});
