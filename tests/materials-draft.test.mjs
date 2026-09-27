import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { deterministicExtract } from "../server/materials-jd-extract.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { selectClaims } from "../server/materials-select.mjs";
import { buildOutline } from "../server/materials-outline.mjs";
import { draftSlots, validateDraft } from "../server/materials-draft.mjs";
import { delint, loadVoicePack, rewriteFlagged } from "../server/materials-delint.mjs";

const voicePack = await loadVoicePack();
import { tagDraftMetrics } from "../server/materials-metric-tag.mjs";

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
  "Data Platform Engineer at Acme Analytics. Responsibilities: build warehouse pipelines",
  "and streaming ingestion for analytics events; own observability dashboards. Requirements:",
  "five years with streaming ingestion, Python, SQL, Airflow, and cloud platforms.",
].join("\n");

const PIN = { provider: "local", resolvedModel: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return { ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  return { fetchImpl, calls };
}

async function plan() {
  const ledger = buildLedger({ profile: PROFILE, resumeText: RESUME_TEXT });
  const extract = deterministicExtract({ jdText: JD_TEXT, company: "Acme", title: "Data Platform Engineer", gate: GATE });
  const shortlist = scoreClaims({ extract, ledger, limit: 8 });
  const { fetchImpl } = stubFetch([
    JSON.stringify({
      kept: shortlist.slice(0, 5).map((s, i) => ({ claimId: s.claimId, slot: `s${i}`, reason: "ok" })),
      dropped: [],
      transfers: [],
      letter: { analyticsProof: shortlist[0].claimId, aiOpsProof: shortlist[1].claimId },
    }),
  ]);
  const { selection } = await selectClaims({ extract, shortlist, ledger, pin: PIN, fetchImpl });
  const outline = buildOutline({ selection, ledger, feature: "both" });
  return { ledger, extract, selection, outline };
}

describe("draft", () => {
  it("one call produces schema-valid slots keyed to kept claims", async () => {
    const { ledger, extract, selection, outline } = await plan();
    const bullets = outline.featured.flatMap((f) => f.claimIds);
    const { fetchImpl, calls } = stubFetch([
      JSON.stringify({
        statement: "Platform engineer with analytics depth.",
        bullets: bullets.map((claimId) => ({ claimId, text: `Drafted ${claimId} with $10M+ care.` })),
        earlier: outline.earlier.map((claimId) => ({ claimId, text: `Earlier ${claimId}.` })),
        letter: {
          thesis: "I build pipelines.",
          analyticsProof: "Proof one.",
          aiOpsProof: "Proof two.",
          nextStep: "Let's talk.",
        },
      }),
    ]);
    const { draft, degraded } = await draftSlots({
      outline,
      selection,
      ledger,
      extract,
      feature: "both",
      voice: ["Short sentences."],
      pin: PIN,
      fetchImpl,
    });
    assert.equal(degraded, false);
    assert.equal(calls.length, 1, "single draft call");
    assert.equal(validateDraft(draft).ok, true, JSON.stringify(validateDraft(draft).errors));
    assert.deepEqual(
      draft.bullets.map((b) => b.claimId).sort(),
      bullets.sort(),
      "every featured bullet keyed, nothing invented",
    );
  });

  it("repairs unknown ids with claim text and degrades honestly on failure", async () => {
    const { ledger, extract, selection, outline } = await plan();
    const bullets = outline.featured.flatMap((f) => f.claimIds);
    const { fetchImpl } = stubFetch([
      JSON.stringify({
        statement: "s",
        bullets: [{ claimId: "hallucinated", text: "Fake bullet 99%." }],
        earlier: [],
        letter: { thesis: "t", analyticsProof: "a", aiOpsProof: "o", nextStep: "n" },
      }),
    ]);
    const { draft } = await draftSlots({ outline, selection, ledger, extract, feature: "both", voice: [], pin: PIN, fetchImpl });
    assert.equal(draft.bullets.some((b) => b.claimId === "hallucinated"), false);
    assert.deepEqual(draft.bullets.map((b) => b.claimId).sort(), bullets.sort());

    const bad = stubFetch([new Error("down"), new Error("down")]);
    const fallback = await draftSlots({ outline, selection, ledger, extract, feature: "both", voice: [], pin: PIN, fetchImpl: bad.fetchImpl });
    assert.equal(fallback.degraded, true);
    assert.equal(validateDraft(fallback.draft).ok, true);
  });
});

describe("delint rewrite", () => {
  it("rewrites only flagged fields and withholds the JD", async () => {
    const fields = {
      keep: "Plain sentence with concrete nouns.",
      fix: "I leverage best-in-class synergies to drive robust outcomes.",
    };
    const packs = delint({ fields, pack: voicePack });
    assert.ok(packs.spans.some((s) => s.field === "fix"), "prepass flags the field");
    const { fetchImpl, calls } = stubFetch([
      JSON.stringify({ fix: "I ship data pipelines with clear metrics." }),
    ]);
    const out = await rewriteFlagged({
      pack: voicePack,
      fields,
      spans: packs.spans,
      voice: [],
      pin: PIN,
      fetchImpl,
    });
    assert.equal(calls.length, 1);
    assert.equal(out.fields.keep, fields.keep, "clean fields untouched");
    assert.equal(out.fields.fix, "I ship data pipelines with clear metrics.");
    const sent = JSON.stringify(calls[0].init.body);
    assert.doesNotMatch(sent, /job description|responsibilities/i, "JD withheld");
    const again = delint({ fields: out.fields, pack: voicePack });
    assert.equal(again.spans.filter((s) => s.field === "fix").length, 0, "rewrite clears the span");
  });
});

describe("metric tag", () => {
  it("traces draft numerals to ledger metrics, flags the invented", async () => {
    const { ledger, selection } = await plan();
    const bullets = selection.kept.slice(0, 2).map((k) => ({ claimId: k.claimId, text: "Kept text." }));
    const withMetric = {
      contract: "materials.draft.v1",
      jdHash: "sha256:0",
      ledgerHash: ledger.ledgerHash,
      statement: "Grew a $10M+ book and invented 99% of nothing.",
      bullets,
      earlier: [],
      letter: { thesis: "", analyticsProof: "", aiOpsProof: "", nextStep: "" },
    };
    const { issues, matched } = tagDraftMetrics({ draft: withMetric, ledger });
    assert.ok(matched >= 1, "ledger metric matched");
    assert.ok(
      issues.some((i) => i.code === "invented_fact" && i.token === "99%"),
      `invented numeral flagged: ${JSON.stringify(issues)}`,
    );
    assert.equal(issues.some((i) => i.token === "$10M+"), false, "ledger metric not flagged");
  });
});
