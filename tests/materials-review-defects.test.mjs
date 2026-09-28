/**
 * Defects from the review of Jordan's own Northwind run (2026-09-28, runs
 * _ec0d resume and _849e letter), in the orchestrator's priority order:
 *   5  wording never upgrades scope, scale, seniority, team size or tech
 *      depth past its source (letter, resume bullets, statement);
 *   2  (tests/materials-text-layer.test.mjs) resume figures extract whole;
 *   1  signature_mid_evidence watches signature/philosophy lines only,
 *      never approved facts;
 *   4  a headline-style, verbless letter opener is a soft tell;
 *   3  the readout strip shows achievements, not context ranks.
 * No live model calls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRenderModelFromDraft } from "../server/materials-render-model-adapter.mjs";
import { isContextRank, isReadoutMetric } from "../server/materials-numerals.mjs";
import { advisoryEvidence } from "../server/materials-rubric.mjs";
import { resumeScopeUpgrades, scopeUpgrades } from "../server/materials-scope.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { parseVoiceProfile } from "../server/materials-voice-profile.mjs";
import { isVerblessOpener, soundsHumanRow } from "../server/materials-voice-tells.mjs";

/* Source lines in the shape of the real run's ledger (text as written in
 * the candidate's resume). */
const ACCOUNTS = "Managed a group of Austin advertisers as their digital specialist, working with sellers on search, paid social, connected TV, and streaming audio plans.";
const FORECAST = "Released an SEM Income Projection application on Gemini with current Web Lookup validation, executing 24+ projections against sample $3.1M opportunity data for pitches and planning cycles.";
const PLATFORM = "Built and released a hosted AI service on Cloud Run, choosing among Claude, GPT, Gemini, Grok, and Llama for each request.";
const FULLSTACK = "Built every layer of the product: cloud setup, API, interface, sign-in, release flow, and monitoring. The work had no engineering team or handoffs.";
const BOOK = "Directed a $12M+ yearly online media P&L; drove Austin to a steady top-4 placement in Online Growth Offerings income (Austin = #17 U.S. market).";
const COACH = "Supported 12 AE desks through 24+ tracked pitches/month via SampleCRM, 1:1 coaching, and seller enablement sessions.";
const SOURCES = [ACCOUNTS, FORECAST, PLATFORM, FULLSTACK, BOOK, COACH];

const LEDGER = {
  employers: [
    { id: "contoso", name: "Contoso (formerly Fabrikam)", title: "Digital Sales Manager" },
    { id: "meridian", name: "Meridian Insights Group", title: "Founder & AI Engineer" },
  ],
  claims: [
    { id: "b7", employerId: "contoso", kind: "operations", text: ACCOUNTS, metrics: [], verified: true },
    { id: "b11", employerId: "meridian", kind: "system", text: FORECAST, metrics: [{ token: "24+" }, { token: "$3.1M" }], verified: true },
    { id: "b12", employerId: "meridian", kind: "system", text: PLATFORM, metrics: [], verified: true },
    { id: "b13", employerId: "meridian", kind: "system", text: FULLSTACK, metrics: [], verified: true },
    { id: "b2", employerId: "contoso", kind: "achievement", text: BOOK, metrics: [{ token: "$12M+" }, { token: "top-4" }, { token: "#17" }], verified: true },
    { id: "v1", employerId: null, kind: "achievement", text: COACH, metrics: [{ token: "12" }, { token: "24+" }], verified: true },
  ],
};

describe("5. no scope or scale upgrades", () => {
  it("should flag 'enterprise accounts' when the source says 'strategic Austin accounts'", () => {
    const hits = scopeUpgrades("Served as planning online SME paired with AEs to proposal, retain, and expand enterprise accounts across SEM and OTT/CTV.", [ACCOUNTS]);
    assert.deepEqual(hits.map((h) => h.id), ["enterprise"]);
  });

  it("should flag 'engineering production forecasting models on GCP' against 'a forecast tool on Gemini'", () => {
    const hits = scopeUpgrades(
      "Online growth advisor and AI platform developer who scaled a $12M+ media portfolio to top-4 nationally at Contoso while engineering production forecasting models on GCP.",
      SOURCES,
    );
    const ids = hits.map((h) => h.id);
    assert.ok(ids.includes("production") && ids.includes("engineering"), JSON.stringify(hits));
  });

  it("should flag 'hands-on seller development' framing", () => {
    const hits = scopeUpgrades("I plan to contribute hands-on seller development to NorthwindMedia's East Region digital sales team.", SOURCES);
    assert.deepEqual(hits.map((h) => h.id), ["development"]);
  });

  it("should not flag a word the source uses for the same thing", () => {
    assert.deepEqual(scopeUpgrades("Deployed a deployed multi-engine AI platform on GCP Cloud Run.", SOURCES), []);
    assert.deepEqual(scopeUpgrades("Wrote the full stack with no engineering team.", SOURCES), []);
    assert.deepEqual(
      scopeUpgrades("Guided clients on AI search to expand enterprise accounts.", ["Guided clients on emerging AI search readiness and multi-touch attribution to expand enterprise accounts."]),
      [],
    );
  });

  it("should check resume bullets against their own claim and the statement against every source", () => {
    const draft = {
      statement: "Online growth advisor and AI platform developer who scaled a $12M+ media portfolio to top-4 nationally at Contoso while engineering production forecasting models on GCP.",
      bullets: [
        { claimId: "b7", text: "Served as planning online SME paired with AEs to proposal, retain, and expand enterprise accounts across SEM, Sponsored Social, OTT/CTV, and Streaming Broadcast." },
        { claimId: "b11", text: "Released an SEM Income Projection application on Gemini with current Web Lookup validation, executing 24+ projections against $3.1M of live opportunity data." },
      ],
      earlier: [],
    };
    const hits = resumeScopeUpgrades({ draft, ledger: LEDGER });
    assert.deepEqual(hits.map((h) => h.field), ["statement", "bullet:b7"]);
  });

  it("feeds scope matches to the judge as advisory evidence", () => {
    const hits = advisoryEvidence({ document: "letter", finalText: "I expanded enterprise accounts.", ledger: { claims: [{ id: "c1", text: ACCOUNTS }] } });
    assert.ok(hits.some((item) => item.kind === "scope" && item.sentenceIds.includes("L1")));
  });

});

/* A voice guide in the shape of Jordan's: philosophy lines under "Voice
 * samples", approved facts (with numbers) under "Preferred phrasing". */
const VOICE_MD = [
  "# Example Candidate — Voice Guide",
  "",
  "## Voice samples — own words",
  "",
  "**Philosophy / identity:**",
  "- *\"The best marketers aren't just troubleshooters — they're problem-finders.\"*",
  "- *\"A bias toward building over talking.\"*",
  "",
  "## Preferred phrasing patterns",
  "",
  "- \"Western Dental, 200+ DSO locations.\"",
  "- \"A national Arbor Motors co-op across 500+ dealers.\"",
  "- \"I sell and ship.\"",
  "",
].join("\n");

describe("1. signature_mid_evidence watches signature lines, never facts", () => {
  const profile = parseVoiceProfile(VOICE_MD);

  it("should keep only digit-free lines of six or more words", () => {
    assert.ok(profile.signatureTellLines.includes("The best marketers aren't just troubleshooters — they're problem-finders."));
    assert.equal(profile.signatureTellLines.some((l) => /Arbor Motors|Western Dental/.test(l)), false);
    assert.equal(profile.signatureTellLines.includes("I sell and ship."), false, "under six words");
  });

  it("should not fire on the Arbor Motors fact restated in the evidence", () => {
    const paragraphs = [
      "I spent eight years at Contoso Austin, where I coached 12 AE desks. I aim toward apply that to NorthwindMedia.",
      "At Contoso, I directed a $12M+ yearly online media P&L for accounts like Western Dental's 224+ CLINIC sites and a countrywide Arbor Motors partnership across 600+ retailers.",
      "I would like toward map a sample Regional Region pitch for NorthwindMedia. Worth a quick call this week?",
    ];
    const row = soundsHumanRow(paragraphs, { company: "NorthwindMedia", signatureLines: profile.signatureLines, signatureTellLines: profile.signatureTellLines });
    assert.equal(row.tells.some((t) => t.code === "signature_mid_evidence"), false, row.note);
  });

  it("should still fire on a philosophy line in the evidence", () => {
    const paragraphs = [
      "I spent eight years at Contoso Austin. I want to bring that to NorthwindMedia.",
      "At Contoso, I owned a $12M+ annual digital media P&L. The best marketers aren't just troubleshooters — they're problem-finders.",
      "Worth a quick call this week?",
    ];
    const row = soundsHumanRow(paragraphs, { company: "NorthwindMedia", signatureLines: profile.signatureLines, signatureTellLines: profile.signatureTellLines });
    assert.ok(row.tells.some((t) => t.code === "signature_mid_evidence" && t.weight === "soft"));
  });
});

describe("4. a verbless, headline-style opener is a soft tell", () => {
  it("should flag the real run's opener and pass a first-person one", () => {
    const real = "Digital growth consultant and AI platform builder with nine years at Contoso Austin, where I mentored 12 AE desks across 24+ pitches/month.";
    assert.equal(isVerblessOpener(real), true);
    assert.equal(isVerblessOpener("I spent eight years at Contoso Austin, where I coached 12 AE desks."), false);
    assert.equal(isVerblessOpener("Lumen Parcel's posting mentions 1,400 vans and a routing model."), false);
    const row = soundsHumanRow([`${real} I want to bring that to NorthwindMedia.`, "At Contoso, I owned a $12M+ book.", "Worth a quick call this week?"], { company: "NorthwindMedia" });
    const tell = row.tells.find((t) => t.code === "verbless_opener");
    assert.ok(tell && tell.weight === "soft", row.note);
    assert.equal(row.score, 1, "REVIEW, never FAIL");
  });
});

describe("3. readouts show achievements, not context ranks", () => {
  it("should treat '#17 market' as context and keep top-4 and money", () => {
    assert.equal(isContextRank("#17", "market to a top-4 national ranking"), true);
    assert.equal(isReadoutMetric("#17", "U.S. market by size"), false);
    assert.equal(isReadoutMetric("#1", "rated podcast network"), true);
    assert.equal(isReadoutMetric("top-4", "national ranking"), true);
  });

  it("should leave '#17 market' out of the readouts built from a real bullet", () => {
    const draft = {
      statement: "",
      bullets: [
        { claimId: "b2", text: "Directed a $12M+ yearly online media P&L across Austin customers, guiding the #17 region to a top-4 national placement in Online Growth Offerings income." },
        { claimId: "b7", text: ACCOUNTS },
        { claimId: "b11", text: "Built a Gemini-based search revenue predictor and ran 24+ projections against $3.1M of live opportunity data." },
        { claimId: "b12", text: PLATFORM },
      ],
      earlier: [],
    };
    const outline = { featured: [{ employerId: "contoso", claimIds: ["b2", "b7"] }, { employerId: "meridian", claimIds: ["b11", "b12"] }], earlier: [], toolsLine: [] };
    const model = buildRenderModelFromDraft({
      draft, outline, ledger: LEDGER, resumeText: "Example Candidate\nDigital Sales Leader\nuser@example.com",
      request: { company: "NorthwindMedia", title: "Director, Digital Sales" }, family: resolveFamily("signal"), marks: [], nowIso: "2026-09-28T00:00:00Z",
    });
    const readouts = model.documents.resume.sections.flatMap((s) => s.readouts || []);
    const figures = readouts.map((r) => r.n);
    assert.equal(figures.includes("#17"), false, JSON.stringify(figures));
    assert.ok(figures.includes("$12M+") && figures.includes("top-4"), JSON.stringify(figures));
  });
});

describe("5. a bullet rewording its own claim's scope word is fine", () => {
  it("should not flag 'without external engineering resources' against 'No engineering team'", () => {
    const draft = { statement: "", bullets: [{ claimId: "b13", text: "Engineered end-to-end systems, server services, client screens, identity, and observability without external engineering resources." }], earlier: [] };
    assert.deepEqual(resumeScopeUpgrades({ draft, ledger: LEDGER }), []);
  });
});
