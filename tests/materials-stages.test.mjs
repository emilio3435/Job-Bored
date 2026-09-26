import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import {
  deterministicExtract,
  extractJd,
  validateJdExtract,
} from "../server/materials-jd-extract.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { selectClaims, validateSelection } from "../server/materials-select.mjs";
import { buildOutline } from "../server/materials-outline.mjs";

const RESUME_TEXT = [
  "Jordan Rivera",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-3 national ranking on a $10M+ book.",
  "- Drove 130% YoY paid-search conversion growth.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
].join("\n");

const PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "Staff engineer who builds durable distributed systems for people.",
  },
  strengths: [
    {
      name: "Backend systems",
      rank: 1,
      evidence: "Shipped services handling 10k RPS with Postgres and Kafka.",
      keywords: ["Postgres", "Kafka"],
    },
  ],
  hardConstraints: { workMode: "any" },
};

const JD_TEXT = [
  "Data Platform Engineer at Acme Analytics, Austin TX, remote-friendly.",
  "Responsibilities: build warehouse pipelines and streaming ingestion for analytics events;",
  "own observability dashboards and reliability tooling; partner with analysts on pipeline math.",
  "Requirements: five years with warehouse modeling, streaming ingestion, Python, SQL,",
  "orchestration with Airflow, observability, and cloud platforms. Prompting-only is not",
  "sufficient: you must have shipped production data systems.",
].join("\n");

function ledger() {
  return buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT });
}

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: next } }] }),
    };
  };
  return { fetchImpl, calls };
}

const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const GATE = { verdict: "usable", confidence: 0.88, signals: { words: 120 } };

describe("jd.extract", () => {
  it("deterministic pass lifts role, stack and nouns and validates", () => {
    const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme Analytics", title: "Data Platform Engineer", gate: GATE });
    assert.equal(extract.role.title, "Data Platform Engineer");
    assert.ok(extract.stack.required.includes("Airflow"), JSON.stringify(extract.stack));
    assert.ok(extract.nouns.some((n) => n.term === "streaming"), "streaming noun lifted");
    assert.equal(validateJdExtract(extract).ok, true, JSON.stringify(validateJdExtract(extract).errors));
  });

  it("LLM fill merges outcomes/bars/echoBans over the deterministic half", async () => {
    const { fetchImpl, calls } = stubFetch([
      JSON.stringify({
        outcomes: [{ id: "pipe-math", text: "Own pipeline math with analysts", weight: 0.9 }],
        differentiators: [{ id: "d1", text: "Production data systems, not prompting demos" }],
        bars: [{ id: "bar1", text: "Prompting-only is not sufficient" }],
        constraints: [],
        echoBans: ["leverage synergies"],
        nounWeights: { streaming: 1.0, pipeline: 0.8 },
      }),
    ]);
    const { extract, degraded } = await extractJd({
      jdText: JD_TEXT,
      company: "Acme Analytics",
      title: "Data Platform Engineer",
      gate: GATE,
      pin: PIN,
      fetchImpl,
    });
    assert.equal(degraded, false);
    assert.equal(calls.length, 1);
    assert.ok(extract.outcomes.some((o) => o.id === "pipe-math"));
    assert.ok(extract.bars.some((b) => b.id === "bar1"));
    assert.ok(extract.echoBans.includes("leverage synergies"));
    assert.equal(extract.nouns.find((n) => n.term === "streaming").weight, 1.0);
    assert.equal(validateJdExtract(extract).ok, true);
  });

  it("degrades to the deterministic half when the model fails", async () => {
    const { fetchImpl } = stubFetch([new Error("down"), new Error("down")]);
    const { extract, degraded } = await extractJd({
      jdText: JD_TEXT,
      company: "Acme Analytics",
      title: "Data Platform Engineer",
      gate: GATE,
      pin: PIN,
      fetchImpl,
    });
    assert.equal(degraded, true);
    assert.equal(validateJdExtract(extract).ok, true);
  });
});

describe("claims.score", () => {
  it("ranks verified claims with 0..1 component scores", () => {
    const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme", title: "Data Platform Engineer", gate: GATE });
    const shortlist = scoreClaims({ extract, ledger: ledger(), limit: 4 });
    assert.ok(shortlist.length >= 2 && shortlist.length <= 4);
    assert.ok(shortlist[0].score.total >= shortlist[shortlist.length - 1].score.total, "ranked desc");
    for (const item of shortlist) {
      for (const key of ["noun", "outcome", "differentiator", "recency", "proof", "total"]) {
        assert.ok(item.score[key] >= 0 && item.score[key] <= 1, `${key} in range`);
      }
      assert.ok(item.claimId);
    }
    assert.ok(
      shortlist.some((s) => s.claimId === "resume-b4"),
      `streaming claim shortlisted: ${JSON.stringify(shortlist.map((s) => s.claimId))}`,
    );
  });
});

describe("claims.select", () => {
  it("keeps model-chosen ids, enforces hard rules, validates", async () => {
    const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme", title: "Data Platform Engineer", gate: GATE });
    const led = ledger();
    const shortlist = scoreClaims({ extract, ledger: led, limit: 8 });
    const { fetchImpl } = stubFetch([
      JSON.stringify({
        kept: shortlist.slice(0, 5).map((s, i) => ({ claimId: s.claimId, slot: `resume.featured.x.b${i + 1}`, reason: "maps to pipeline nouns" })),
        dropped: [],
        transfers: [],
        letter: { analyticsProof: shortlist[0].claimId, aiOpsProof: shortlist[1].claimId },
      }),
    ]);
    const { selection, degraded } = await selectClaims({ extract, shortlist, ledger: led, pin: PIN, fetchImpl });
    assert.equal(degraded, false);
    assert.ok(selection.kept.length >= 4 && selection.kept.length <= 7, `kept ${selection.kept.length}`);
    assert.equal(validateSelection(selection).ok, true, JSON.stringify(validateSelection(selection).errors));
    assert.ok(selection.jdHash.startsWith("sha256:"));
    assert.equal(selection.ledgerHash, led.ledgerHash);
  });

  it("drops unknown ids and falls back deterministically when the model fails", async () => {
    const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme", title: "Data Platform Engineer", gate: GATE });
    const led = ledger();
    const shortlist = scoreClaims({ extract, ledger: led, limit: 8 });
    const { fetchImpl } = stubFetch([
      JSON.stringify({
        kept: [
          { claimId: "nope-not-a-claim", slot: "resume.featured.x.b1", reason: "hallucinated" },
          ...shortlist.slice(0, 4).map((s, i) => ({ claimId: s.claimId, slot: `resume.featured.x.b${i + 2}`, reason: "ok" })),
        ],
        dropped: [],
        transfers: [],
        letter: { analyticsProof: "nope-not-a-claim", aiOpsProof: shortlist[0].claimId },
      }),
    ]);
    const { selection } = await selectClaims({ extract, shortlist, ledger: led, pin: PIN, fetchImpl });
    assert.equal(selection.kept.some((k) => k.claimId === "nope-not-a-claim"), false);
    assert.notEqual(selection.letter.analyticsProof, "nope-not-a-claim");

    const bad = stubFetch([new Error("down"), new Error("down")]);
    const fallback = await selectClaims({ extract, shortlist, ledger: led, pin: PIN, fetchImpl: bad.fetchImpl });
    assert.equal(fallback.degraded, true);
    assert.equal(validateSelection(fallback.selection).ok, true);
    assert.ok(fallback.selection.kept.length >= 4);
  });
});

describe("outline", () => {
  it("groups featured/earlier, caps the tools line to evidenced tools", async () => {
    const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme", title: "Data Platform Engineer", gate: GATE });
    const led = ledger();
    const shortlist = scoreClaims({ extract, ledger: led, limit: 8 });
    const { fetchImpl } = stubFetch([
      JSON.stringify({
        kept: shortlist.slice(0, 5).map((s, i) => ({ claimId: s.claimId, slot: `s${i}`, reason: "ok" })),
        dropped: [],
        transfers: [],
        letter: { analyticsProof: shortlist[0].claimId, aiOpsProof: shortlist[1].claimId },
      }),
    ]);
    const { selection } = await selectClaims({ extract, shortlist, ledger: led, pin: PIN, fetchImpl });
    const outline = buildOutline({ selection, ledger: led, feature: "both" });
    assert.ok(outline.featured.length >= 1 && outline.featured.length <= 2);
    assert.ok(outline.toolsLine.length <= 13);
    assert.ok(outline.letterBeats.analyticsProof);
    const resumeOnly = buildOutline({ selection, ledger: led, feature: "resume" });
    assert.equal(resumeOnly.letterBeats, null);
    const letterOnly = buildOutline({ selection, ledger: led, feature: "cover_letter" });
    assert.equal(letterOnly.featured.length, 0);
  });
});
