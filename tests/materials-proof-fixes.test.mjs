/**
 * Proof-run fixes (2026-09-27): the live Northwind run showed a one-employer,
 * three-bullet resume, a letter proof without a number, unsupported
 * letter sentences, a "1 coaching" readout, near-zero noun fidelity and
 * stale PDFs behind a render "ok". Each design call has a test here.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resumeText as atsResumeText } from "../server/materials-ats-text.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { delint, loadVoicePack } from "../server/materials-delint.mjs";
import { deterministicExtract } from "../server/materials-jd-extract.mjs";
import { numerals } from "../server/materials-metric-tag.mjs";
import { planResume } from "../server/materials-outline.mjs";
import { ensureBrowsersPath } from "../server/materials-pdf.mjs";
import { runPipeline, redactRawReply, writeRawReply } from "../server/materials-pipeline.mjs";
import { renderDocument } from "../server/materials-render.mjs";
import { buildRenderModelFromDraft } from "../server/materials-render-model-adapter.mjs";
import { letterSentenceGrounding, scoreRubric } from "../server/materials-rubric.mjs";
import { KEPT_MAX, selectClaims } from "../server/materials-select.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";

const fixture = (/** @type {string} */ path) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const NORTHWIND_JD = fixture("jobs/northwind-director-digital-sales.txt");
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };
const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

/* An employer-bound ledger in L1's shape: Contoso with three nested,
 * dated roles; a current founder role; two earlier employers. */
const LEDGER = {
  contract: "materials.claim-ledger.v1",
  ledgerHash: "sha256:0badc0de",
  employers: [
    {
      id: "contoso", name: "Contoso (formerly Fabrikam)", title: "Digital Sales Manager", start: "Oct 2018", end: "2026",
      roles: [
        { id: "contoso-r1", title: "Regional Growth Lead", start: "Jun 2022", end: "2026" },
        { id: "contoso-r2", title: "Client Strategy Lead → Senior Client Strategy Lead", start: "Feb 2020", end: "Jun 2022" },
        { id: "contoso-r3", title: "Campaign Operations Lead", start: "Oct 2018", end: "Jan 2020" },
      ],
    },
    { id: "meridian", name: "Meridian Insights Group", title: "Founder & AI Engineer", start: "2024", end: null, roles: [{ id: "meridian-r1", title: "Founder & AI Engineer", start: "2024", end: null }] },
    { id: "cedar", name: "Cedar Lantern & JobBored", title: "Founder", start: "2024", end: null },
    { id: "pipeworks", name: "Pipeworks", title: "Cofounder", start: "2016", end: "2017" },
  ],
  claims: [
    { id: "b1", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Led digital media plan for a $12M+ yearly online portfolio across home services, healthcare and retail clients.", metrics: [{ token: "$12M+" }], verified: true },
    { id: "b2", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Drove Austin to a steady top-4 placement in Online Growth Offerings income across the national footprint.", metrics: [{ token: "top-4" }], verified: true },
    { id: "b3", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Led the market's digital transformation to approximately 60% of total revenue in digital.", metrics: [{ token: "60%" }], verified: true },
    { id: "b4", employerId: "contoso", roleId: "contoso-r1", kind: "operations", text: "Supported 12 AE desks through 24+ tracked pitches a month, 1:1 coaching and enablement sessions on OTT, SEM and programmatic.", metrics: [{ token: "12" }, { token: "24+" }], verified: true },
    { id: "b5", employerId: "contoso", roleId: "contoso-r1", kind: "achievement", text: "Delivered 125% YoY paid-search conversion growth on a strategic financial-services account.", metrics: [{ token: "125%" }], verified: true },
    { id: "b6", employerId: "contoso", roleId: "contoso-r1", kind: "operations", text: "Managed a group of up to 3 Online Program Leads on programs tied to client KPIs and booked revenue.", metrics: [{ token: "3" }], verified: true },
    { id: "b7", employerId: "contoso", roleId: "contoso-r2", kind: "operations", text: "Managed strategic Austin-market accounts, working with sellers to expand budgets for search, social, connected TV, and streaming audio.", metrics: [], verified: true },
    { id: "e1", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Released an SEM Income Projection application on Gemini running 24+ forecasts against $3.1M of pipeline data.", metrics: [{ token: "24+" }, { token: "$3.1M" }], verified: true },
    { id: "e2", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Deployed a multi-engine AI platform on GCP Cloud Run directing across Claude, GPT and Gemini.", metrics: [], verified: true },
    { id: "e3", employerId: "meridian", roleId: "meridian-r1", kind: "system", text: "Stood up agentic scheduled workflows for client-pulse briefings across 8–10 API keys.", metrics: [{ token: "8–10" }], verified: true },
    { id: "h1", employerId: "cedar", kind: "system", text: "Authored an 18-idea automation playbook for SMB marketing and ops workflows.", metrics: [{ token: "18" }], verified: true },
    { id: "k1", employerId: "pipeworks", kind: "system", text: "Automated focus-group recruitment for research agencies using paid social and search campaigns.", metrics: [], verified: true },
    { id: "p1", employerId: null, kind: "achievement", text: "Guided online plan for a $12M+ yearly portfolio at Contoso, driving the Austin market to a top-4 national ranking.", metrics: [{ token: "$12M+" }, { token: "top-4" }], verified: true },
  ],
  toolInventory: [
    { tool: "OTT/CTV", level: "owned" },
    { tool: "Streaming Audio", level: "owned" },
    { tool: "Programmatic Display", level: "owned" },
    { tool: "Gemini", level: "adjacent" },
  ],
};

const extract = () =>
  deterministicExtract({ jdText: NORTHWIND_JD, company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", gate: GATE });

/** @param {string[]} replies */
function stubFetch(replies) {
  const calls = [];
  const fetchImpl = async (/** @type {string} */ _url, /** @type {{ body: string }} */ init) => {
    calls.push(JSON.parse(init.body));
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  return { fetchImpl, calls };
}

describe("numerals: ratios are not metrics (design 6)", () => {
  it("should never read 1:1 or 24/7 as a number", () => {
    assert.deepEqual(numerals("Supported 12 AE desks with 1:1 coaching, 24/7 support and a $3.1M pipeline"), ["12", "$3.1M"]);
  });
});

describe("resume budget and nested roles (design calls 1 and 2)", () => {
  it("should keep up to 14 claims across at least two employers and drop a restated profile line", async () => {
    const ex = extract();
    const shortlist = scoreClaims({ extract: ex, ledger: LEDGER, limit: 20 });
    const { selection } = await selectClaims({ extract: ex, shortlist, ledger: LEDGER, pin: null });
    const kept = selection.kept.map((k) => k.claimId);
    assert.ok(kept.length >= 8 && kept.length <= KEPT_MAX, `${kept.length} kept`);
    const employers = new Set(kept.map((id) => LEDGER.claims.find((c) => c.id === id)?.employerId).filter(Boolean));
    assert.ok(employers.size >= 2, [...employers].join(", "));
    assert.ok(!(kept.includes("p1") && kept.includes("b1")), "the profile line restating b1 is dropped");
  });

  it("should give the first employer 5 bullets, the next 4, sub-rows per role, and keep Earlier for other employers", () => {
    const kept = ["b4", "b2", "b1", "b6", "b3", "b5", "b7", "e1", "e2", "e3", "h1"];
    const plan = planResume({ ledger: LEDGER, kept, featuredMax: 3, perFeaturedMax: 5, earlierMax: 2 });
    assert.deepEqual(plan.featured.map((f) => f.employerId), ["contoso", "meridian"], "most recent first; a one-claim employer goes to Earlier");
    assert.equal(plan.featured[0].claimIds.length, 5);
    assert.equal(plan.featured[1].claimIds.length, 3);
    const roles = plan.featured[0].roles || [];
    assert.deepEqual(roles.map((r) => r.roleId), ["contoso-r1", "contoso-r2", "contoso-r3"]);
    assert.deepEqual(roles.map((r) => `${r.start} – ${r.end}`), ["Jun 2022 – 2026", "Feb 2020 – Jun 2022", "Oct 2018 – Jan 2020"]);
    const earlierEmployers = plan.earlier.map((id) => LEDGER.claims.find((c) => c.id === id)?.employerId);
    assert.deepEqual(earlierEmployers, ["cedar", "pipeworks"]);
    assert.ok(plan.dropped.every((d) => LEDGER.claims.find((c) => c.id === d.claimId)?.employerId !== "cedar"));
  });

  it("should render every role at a company as a dated sub-row in all three families and in resume.txt", () => {
    const kept = ["b4", "b2", "b1", "b6", "b7", "e1", "e2"];
    const plan = planResume({ ledger: LEDGER, kept, featuredMax: 3, perFeaturedMax: 5, earlierMax: 2 });
    const outline = { featured: plan.featured, earlier: plan.earlier, toolsLine: ["OTT/CTV"] };
    const draft = { bullets: kept.map((claimId) => ({ claimId, text: LEDGER.claims.find((c) => c.id === claimId)?.text })), earlier: [] };
    for (const family of ["signal", "dossier", "editorial"]) {
      const model = buildRenderModelFromDraft({
        draft, outline, ledger: LEDGER, resumeText: "Example Candidate\nDigital Sales Leader\nuser@example.com",
        request: { company: "NorthwindMedia", title: "Director, Digital Sales" }, family: resolveFamily(family), marks: [], nowIso: "2026-09-27T00:00:00Z",
      });
      const html = renderDocument(model, "resume");
      for (const text of ["Client Strategy Lead", "Feb 2020 – Jun 2022", "Campaign Operations Lead", "Oct 2018 – Jan 2020", "Jun 2022 – 2026"]) {
        assert.ok(html.includes(text.replace("→", "&rarr;")) || html.includes(text), `${family}: ${text}`);
      }
      const txt = atsResumeText(model);
      assert.match(txt, /Client Strategy Lead → Senior Client Strategy Lead \| Feb 2020 – Jun 2022/);
      assert.doesNotMatch(txt, /\n1 coaching/);
    }
  });
});

describe("letter proofs carry a metric even when the model picks (design 3)", () => {
  it("should swap a model proof without a number for the best metric-bearing claim", async () => {
    const ex = extract();
    const shortlist = scoreClaims({ extract: ex, ledger: LEDGER, limit: 20 });
    const top = [...ex.outcomes].sort((a, b) => b.weight - a.weight).slice(0, 3).map((o) => o.id);
    const reply = JSON.stringify({
      kept: shortlist.slice(0, 10).map((s, i) => ({ claimId: s.claimId, slot: `s${i}`, reason: "ok" })).concat([{ claimId: "b7", slot: "x", reason: "ok" }]),
      dropped: [],
      transfers: [],
      letter: { proof1: { claimId: "b1", painId: top[0] }, proof2: { claimId: "b7", painId: "not-a-pain" } },
    });
    const { fetchImpl } = stubFetch([reply]);
    const { selection } = await selectClaims({ extract: ex, shortlist, ledger: LEDGER, pin: PIN, fetchImpl });
    assert.equal(selection.letter.proof1, "b1");
    assert.notEqual(selection.letter.proof2, "b7", "b7 has no number");
    const proof2 = LEDGER.claims.find((c) => c.id === selection.letter.proof2);
    assert.ok(proof2 && proof2.metrics.length, `proof2 ${selection.letter.proof2} carries a metric`);
    assert.ok(top.includes(selection.letter.proof2Pain), "proof2 answers one of the three heaviest outcomes");
    assert.notEqual(selection.letter.proof1Pain, selection.letter.proof2Pain);
  });
});

describe("grounding and company facts (design calls 4 and 5)", () => {
  const letter = {
    hook: "NorthwindMedia reaches 88% of residents every month, and this role turns that reach into digital revenue.",
    companyInsight: "The posting asks for integrated campaigns across Streaming Audio, Podcasts and CTV.",
    proof1: "At Contoso I led digital media strategy for a $12M+ annual digital book. By aligning sellers, we secured long-term client commitments and outpaced peer markets across competitive categories.",
    proof2: "I supported 12 AE desks through 24+ tracked pitches a month.",
    ask: "I would like to walk your East Region team through one integrated campaign plan for an NorthwindMedia account.",
  };

  it("should quote every unsupported sentence and fail letter_ungrounded", () => {
    const judged = letterSentenceGrounding({ draft: { letter }, ledger: LEDGER, postingText: NORTHWIND_JD, company: "NorthwindMedia, Inc." });
    const bad = judged.filter((j) => j.factual && !j.grounded).map((j) => j.sentence);
    assert.deepEqual(bad, ["By aligning sellers, we secured long-term client commitments and outpaced peer markets across competitive categories."]);
    const rows = scoreRubric({ document: "letter", extract: extract(), selection: { kept: [] }, ledger: LEDGER, draft: { letter }, company: "NorthwindMedia, Inc.", postingText: NORTHWIND_JD }).rows;
    const row = rows.find((r) => r.id === "letter_ungrounded");
    assert.equal(row?.score, 0);
    assert.match(String(row?.note), /secured long-term client commitments/);
    const traced = rows.find((r) => r.id === "metric_in_letter");
    assert.equal(traced?.score, 2, "the posting's own 88% is not an untraced numeral");
  });

  it("should flag (not rewrite) a hook fact the posting does not support (voice v6: checks flag, the repair rewrites)", () => {
    const hook = "NorthwindMedia leads the top radio markets, outpacing its two largest competitors combined.";
    const judged = letterSentenceGrounding({ draft: { letter: { hook } }, ledger: { claims: [] }, postingText: NORTHWIND_JD, company: "NorthwindMedia, Inc." });
    assert.equal(judged[0].grounded, false, judged[0].reason);
    const faithful = letterSentenceGrounding({ draft: { letter: { hook: letter.hook } }, ledger: LEDGER, postingText: NORTHWIND_JD, company: "NorthwindMedia, Inc." });
    assert.ok(faithful.every((j) => !j.factual || j.grounded));
  });

  it("should flag variants of the banned closers", async () => {
    const pack = await loadVoicePack();
    const { spans } = delint({ fields: { "letter.ask": "I would welcome the opportunity to talk. Here's to continued success and strategic priorities." }, pack });
    assert.deepEqual(spans.filter((s) => s.code === "banned_filler").map((s) => s.text), ["I would welcome the opportunity", "continued success", "strategic priorities"]);
  });

  it("should match posting nouns in the resume with stemming, synonyms and the skills line (design 7)", () => {
    const ex = { outcomes: [], nouns: [{ term: "podcasts" }, { term: "ctv" }, { term: "streaming audio" }, { term: "training" }] };
    const rows = scoreRubric({
      document: "resume", extract: ex, selection: { kept: [] }, ledger: LEDGER,
      draft: { statement: "Digital sales leader for podcast and OTT campaigns.", bullets: [{ claimId: "b4", text: "Coached 12 AE desks." }] },
      skills: ["Streaming Audio"], fill: { ratio: 1, basis: "measured" },
    }).rows;
    assert.match(String(rows.find((r) => r.id === "noun_fidelity")?.note), /^4\/4/);
  });
});

describe("render and diagnosis harness (design 8, raw replies)", () => {
  it("should fail the render loudly and remove stale PDFs when no browser opens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-proof-render-"));
    try {
      writeFileSync(join(dir, "resume.pdf"), "stale");
      const resumeText = "Example Candidate\nDigital Sales Leader\nuser@example.com";
      const out = await runPipeline({
        dir,
        payload: { slug: "acme", company: "Acme", title: "Ops", feature: "resume", jobUrl: "", notes: "", resume: { source: "upload", filename: "r.txt", addedAt: "2026-09-27T00:00:00.000Z", text: resumeText } },
        pin: null,
        fetchImpl: async () => { throw new Error("no calls"); },
        jdText: NORTHWIND_JD,
        jdSource: "paste",
        gate: GATE,
        ledger: LEDGER,
        resumeText,
        now: new Date("2026-09-27T00:00:00.000Z"),
        runId: "run-proof-render",
        openSession: async () => null,
        requirePdf: true,
      });
      const render = out.stages.find((s) => s.stage === "render");
      assert.equal(render?.status, "failed");
      assert.match(String(render?.detail), /no headless browser/);
      assert.equal(existsSync(join(dir, "resume.pdf")), false, "the stale PDF is gone");
      const qa = JSON.parse(await readFile(join(dir, "qa.resume.json"), "utf8"));
      assert.ok(qa.checks.some((c) => c.code === "pdf_unrendered" && c.severity === "fail"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should point Playwright at the real browser cache when HOME is overridden", () => {
    const env = {};
    const found = ensureBrowsersPath(/** @type {NodeJS.ProcessEnv} */ (env));
    /* Only when HOME differs from the account home and a cache exists. */
    if (found) assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, found);
    const preset = { PLAYWRIGHT_BROWSERS_PATH: "/custom" };
    assert.equal(ensureBrowsersPath(/** @type {NodeJS.ProcessEnv} */ (preset)), "/custom");
  });

  it("should keep a model extract valid when the gate carries a string signal (the proof run's schema failure)", async () => {
    const reply = JSON.stringify({ outcomes: [{ id: "o1", text: "Sell integrated streaming audio, podcast and CTV campaigns", weight: 0.9 }], nounWeights: {} });
    const { fetchImpl } = stubFetch([reply]);
    const { extractJd } = await import("../server/materials-jd-extract.mjs");
    const out = await extractJd({
      jdText: NORTHWIND_JD, company: "NorthwindMedia, Inc.", title: "Director, Digital Sales",
      gate: { verdict: "usable", confidence: 0.95, signals: { words: 900, source: "cache" } }, pin: PIN, fetchImpl,
    });
    assert.equal(out.degraded, false, JSON.stringify(out.call));
    assert.deepEqual(out.extract.gate.signals, { words: 900 });
  });

  it("should save a schema-invalid reply beside run.json, redacted and capped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-proof-raw-"));
    try {
      const ex = extract();
      const shortlist = scoreClaims({ extract: ex, ledger: LEDGER, limit: 20 });
      const { fetchImpl } = stubFetch([JSON.stringify({ kept: [{ claimId: "b1", slot: "s", reason: "mail user@example.com" }], letter: {} })]);
      /* A one-number letter band fails the selection schema (minItems 2). */
      const out = await selectClaims({ extract: ex, shortlist, ledger: LEDGER, letterWords: [180], pin: PIN, fetchImpl });
      assert.equal(out.degraded, true);
      assert.equal(out.rawReply?.stage, "claims.select");
      const [name] = await writeRawReply(dir, out.rawReply);
      assert.equal(name, "raw-reply.claims.select.json");
      const raw = await readFile(join(dir, name), "utf8");
      assert.match(raw, /"errors"/);
      assert.doesNotMatch(raw, /user@example\.com/);
      assert.ok(raw.length <= 16_100);
      assert.equal(redactRawReply('{"k":"AIzaSyA1234567890abcdefghijklmnop","e":"user@example.com"}'), '{"k":"[redacted-key]","e":"[redacted-email]"}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
