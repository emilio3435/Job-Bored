import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { draftPromptLines, positioningLines, voiceProfileLines } from "../server/materials-draft.mjs";
import { isAiClaim, isAiRole, namedClientProofs, positioningFor, positioningKind, positioningPhrase } from "../server/materials-positioning.mjs";
import { parseVoiceProfile } from "../server/materials-voice-profile.mjs";

const VOICE_MD = readFileSync(new URL("./fixtures/materials-voice/voice.md", import.meta.url), "utf8");
const PROFILE = parseVoiceProfile(VOICE_MD, "/fixture/voice.md");
/* A profile whose words match the three positioning phrases. */
const WORDS = { facts: ["Digital marketing consultant and AI product builder.", "My work as a performance marketer spans acquisition programs.", "Digital marketing consultant / strategist: named client portfolio."], guideText: "" };

const AGENCY_POSTING = "Harbor Circle is a DTC agency. You will lead performance media for our clients and grow client accounts across the agency.";
const SALES_POSTING = "The Director of Digital Sales partners with sellers to build integrated campaigns for clients.";
const INHOUSE_POSTING = "Own paid acquisition for our app: CAC, payback and ROAS across Meta and Google. Report to the VP Growth.";
const AI_POSTING = "Mobilize the AI Acceleration team and own enterprise AI ROI.";

describe("positioning kind per role", () => {
  it("should put agency, consulting and client-services roles on the consultant lead", () => {
    assert.equal(positioningKind({ role: { title: "Director of Performance Media", family: "marketing" } }, AGENCY_POSTING).kind, "consultant");
    assert.equal(positioningKind({ role: { title: "Director, Digital Sales", family: "sales" } }, SALES_POSTING).kind, "consultant");
    assert.equal(positioningKind({ role: { title: "Client Partner", family: "customer-success" } }, "").kind, "consultant");
  });

  it("should put in-house growth, performance and marketing roles on the performance lead", () => {
    assert.equal(positioningKind({ role: { title: "Head of Growth", family: "marketing" } }, INHOUSE_POSTING).kind, "performance");
    assert.equal(positioningKind({ role: { title: "Performance Marketing Manager", family: "general" } }, INHOUSE_POSTING).kind, "performance");
  });

  it("should put AI, product and strategy roles on the AI-builder lead", () => {
    assert.equal(positioningKind({ role: { title: "VP, AI Strategy & Acceleration", family: "operations" } }, AI_POSTING).kind, "ai");
    assert.equal(positioningKind({ role: { title: "Senior Product Manager", family: "product" } }, "").kind, "ai");
    assert.equal(positioningKind({ role: { title: "Head of Marketing Strategy", family: "marketing" } }, AGENCY_POSTING).kind, "ai", "strategy in the title wins");
  });

  it("should word each lead from the user's own voice guide", () => {
    assert.equal(positioningPhrase("consultant", WORDS), "digital marketing consultant and AI product builder");
    assert.equal(positioningPhrase("performance", WORDS), "performance marketer and AI product builder");
    assert.equal(positioningPhrase("ai", WORDS), "AI product builder and digital marketing strategist");
    assert.equal(positioningPhrase("consultant", null), "", "no guide, no borrowed words");
  });

  it("should offer supported positioning context without prescribing the opener", () => {
    const positioning = positioningFor({ role: { title: "Director of Performance Media", family: "marketing" } }, AGENCY_POSTING, WORDS);
    const text = positioningLines(positioning).join("\n");
    assert.match(text, /choose the strongest supported consultant evidence and describe it in the candidate's own words/);
    const ai = positioningLines(positioningFor({ role: { title: "VP, AI Strategy", family: "operations" } }, AI_POSTING, WORDS)).join("\n");
    assert.match(ai, /choose the strongest supported ai evidence and describe it in the candidate's own words/);
  });
});

describe("AI cues", () => {
  it("should recognise AI roles and AI-builder claims, not AI-adjacent coaching", () => {
    assert.equal(isAiRole({ role: { title: "VP, AI Strategy & Acceleration" }, outcomes: [] }), true);
    assert.equal(isAiRole({ role: { title: "Director, Digital Sales" }, outcomes: [{ text: "Sell CTV and podcasts." }] }), false);
    assert.equal(isAiClaim("Built a Gemini-based search revenue predictor and ran 24+ forecasts against $3.1M of pipeline."), true);
    assert.equal(isAiClaim("Supported 12 AE desks with sessions on OTT, SEM, attribution, and AI-search."), false);
  });
});

describe("named-client proofs and few-shot examples from voice.md", () => {
  it("should find the approved named-client proofs (a listed client with a number)", () => {
    const proofs = namedClientProofs(PROFILE);
    assert.ok(proofs.includes("Lumen Grocers, 40 stores."), proofs.join(" | "));
    assert.ok(!proofs.some((p) => /^Clients include /.test(p)), "the client list itself is not a proof");
  });

  it("should parse the Example rewrites, why bullets included", () => {
    assert.equal(PROFILE.examples.length, 2);
    const letter = PROFILE.examples.find((e) => /Cover letter/.test(e.title));
    assert.match(letter?.generic || "", /^I'm writing to express/);
    assert.match(letter?.better || "", /^I spent six years at Cascade Logistics/);
    assert.deepEqual(letter?.why, ["No throat-clearing."]);
  });

  it("should give a client role one cover-letter example and approved named-client proofs", () => {
    const positioning = positioningFor({ role: { title: "Fleet Director", family: "sales" } }, SALES_POSTING, PROFILE);
    const text = voiceProfileLines(PROFILE, { positioning }).join("\n");
    assert.match(text, /Named-client proof: this role rewards scale and client work, so the evidence paragraph uses ONE of these approved named-client proofs/);
    assert.match(text, /- Lumen Grocers, 40 stores\./);
    assert.match(text, /### Example 2 — Cover letter opening/);
    assert.doesNotMatch(text, /### Example 1 — Resume bullet/);
    assert.match(text, /Candidate version: I spent six years at Cascade Logistics/);
  });

  it("should not force a named client on an AI role", () => {
    const positioning = positioningFor({ role: { title: "VP, AI Strategy", family: "operations" } }, AI_POSTING, PROFILE);
    assert.doesNotMatch(voiceProfileLines(PROFILE, { positioning }).join("\n"), /Named-client proof/);
  });
});

describe("the draft plan asks for one voice and three paragraphs", () => {
  it("should ask for three paragraphs without a sentence quota", () => {
    const lines = draftPromptLines({
      outline: { featured: [], earlier: [], letterBeats: { hook: "o1", proof1: "c1", proof1Pain: "o1", proof2: "c2", proof2Pain: "o1" } },
      extract: { role: { company: "Lumen Parcel", title: "Fleet Analyst", family: "analytics" }, outcomes: [{ id: "o1", text: "Own route forecasting." }], nouns: [], companyFacts: [] },
      ledger: { employers: [], claims: [{ id: "c1", text: "Rebuilt the route forecaster for 620 vans." }, { id: "c2", text: "Ran a Monday readout for 14 dispatch leads." }] },
      feature: "cover_letter",
      featuredIds: [],
      earlierIds: [],
    }).join("\n");
    assert.match(lines, /Letter word band: 120-200 words across the three paragraphs/);
    assert.match(lines, /build the middle from the strongest supported evidence/);
    assert.doesNotMatch(lines, /3-4 sentences/);
  });
});

describe("voice v6 prompt order and hook patterns", () => {
  it("should parse the hook patterns: signature, philosophy and 'because I' lines, not resume-voice ones", () => {
    assert.ok(PROFILE.hookPatterns.includes("620 vans, one forecaster."), PROFILE.hookPatterns.join(" | "));
    assert.ok(PROFILE.hookPatterns.includes("I know what dispatchers need because I sat in the chair."));
    assert.ok(PROFILE.hookPatterns.includes("Routes are promises with wheels on them."));
    assert.ok(!PROFILE.hookPatterns.includes("Lumen Grocers, 40 stores."));
  });

  it("should put one cover-letter rewrite before the voice guide and hook patterns", () => {
    const text = voiceProfileLines(PROFILE, { positioning: null }).join("\n");
    const pattern = text.indexOf("THE PATTERN TO IMITATE");
    assert.ok(pattern >= 0 && pattern < text.indexOf("THE CANDIDATE'S OWN VOICE GUIDE"));
    assert.match(text, /Match its rhythm and concrete nouns while writing new sentences for this role/);
    assert.match(text, /Candidate version: I spent six years at Cascade Logistics owning the route forecaster for 620 vans, and Lumen Grocers' 40 stores ran on it\./);
    assert.match(text, /### Example 2 — Cover letter opening/);
    assert.doesNotMatch(text, /### Example 1 — Resume bullet/);
    assert.match(text, /Hook pattern: when it fits the role, build one hook sentence on one of these lines of his, quoted EXACTLY/);
    assert.ok(text.indexOf("Hook pattern:") < text.indexOf("THE CANDIDATE'S OWN VOICE GUIDE"));
  });
});
