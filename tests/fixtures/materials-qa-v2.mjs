/**
 * MREV lane C fixtures: the manifest's quality.documents[type] as the
 * scorecard reads it, one K3 `materials.qa.v2` record per verdict shape and
 * one `materials.qa.v1` (rubric) record for "old runs still render".
 *
 * Fictional people, employers and postings only (Jordan Rivera applying to
 * Meridian Labs, past employer Contoso). Shapes follow SPEC K3 / G6.
 */

const RATINGS_64 = [
  { dimension: "role_relevance", score: 3, weight: 30, reason: "Ties pricing work to the roadmap the posting describes.", sentenceIds: ["L1"] },
  { dimension: "evidence_quality", score: 2, weight: 25, reason: "One result has no source in your background.", sentenceIds: ["L2"] },
  { dimension: "voice", score: 2, weight: 20, reason: "The close reads like a template line.", sentenceIds: ["L4"] },
  { dimension: "coherence", score: 3, weight: 15, reason: "A clear argument from past work to this role.", sentenceIds: [] },
  { dimension: "economy", score: 3, weight: 10, reason: "Every sentence carries a point.", sentenceIds: [] },
];

/* FAIL: one unsupported sentence, one uncertain fact, one voice note. */
export const V2_LETTER_FAIL = {
  status: "fail",
  issues: [{ code: "i1", message: "The 40% churn cut is not in your background.", severity: "fail" }],
  qa: {
    contract: "materials.qa.v2",
    document: "letter",
    runId: "mr_20260928090000_meridian_c3",
    disposition: "FAIL",
    dispositionReason: "One sentence claims a result your background doesn't support.",
    textHash: "9f2c4e1ab07d53e8c6a1f0b2d4e6a8c0e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1",
    quality: { score: 64, ratings: RATINGS_64 },
    gates: [
      { id: "tool_support", kind: "hard", pass: true, reason: "Every tool named appears in one of your claims.", sentenceIds: [] },
      { id: "scope_words", kind: "advisory", pass: false, reason: "“led” may overstate your part.", sentenceIds: ["L2"] },
    ],
    sentences: [
      { id: "L1", text: "Six years turning pricing data into roadmaps product teams actually ship.", status: "supported", reason: "Matches your pricing claims.", citations: [{ sourceId: "claim:c1", quote: "pricing roadmap" }] },
      { id: "L2", text: "At Contoso I cut churn by 40% across the enterprise book.", status: "unsupported", reason: "No claim mentions a churn figure.", citations: [] },
      { id: "L3", text: "Meridian's move to usage-based pricing is the work I want next.", status: "uncertain", reason: "The posting mentions pricing, not usage-based pricing.", citations: [] },
      { id: "L4", text: "Worth a quick call this week?", status: "nonfactual", reason: "A request, not a claim.", citations: [] },
    ],
    issues: [
      { id: "i1", code: "i1", kind: "fact", severity: "hard", sentenceIds: ["L2"], reason: "The 40% churn cut is not in your background.", action: "rewrite", origin: "judge" },
      { id: "i2", code: "i2", kind: "fact", severity: "review", sentenceIds: ["L3"], reason: "The posting doesn't say usage-based pricing.", action: "needs_evidence", origin: "judge" },
      { id: "i3", code: "i3", kind: "voice", severity: "review", sentenceIds: ["L4"], reason: "The close is a stock line; end on something specific to them.", action: "rewrite", origin: "judge" },
    ],
    qualificationGaps: [
      "The posting asks for managing a team of 10 or more; your background shows teams of 4.",
      "No marketplace experience on file.",
    ],
    judge: { status: "ok", provider: "openai_compatible", model: "grok-judge-1", independent: true, promptVersion: "judge.v1", latencyMs: 4200 },
    degraded: [],
    repair: { attempted: false, parentRunId: null, changed: null, adopted: null, before: null, after: null },
  },
};

/* READY, judged by the writer's own model (MREV-4). */
export const V2_RESUME_READY_SAME_MODEL = {
  status: "pass",
  issues: [],
  qa: {
    contract: "materials.qa.v2",
    document: "resume",
    runId: "mr_20260928091000_meridian_d4",
    disposition: "READY",
    dispositionReason: "Every claim is backed by your background and the writing clears the bar.",
    textHash: "1a3c5e7f9b2d4f6a8c0e2a4c6e8f0b2d4f6a8c0e2a4c6e8f0b2d4f6a8c0e2a4c",
    quality: {
      score: 86,
      ratings: [
        { dimension: "role_relevance", score: 4, weight: 30, reason: "Leads with the pricing work this role centres on.", sentenceIds: ["R1"] },
        { dimension: "evidence_quality", score: 3, weight: 25, reason: "Specific, attributed results.", sentenceIds: ["R2"] },
        { dimension: "voice", score: 3, weight: 20, reason: "Plain and direct, like your samples.", sentenceIds: [] },
        { dimension: "coherence", score: 4, weight: 15, reason: "Clear order from most to least relevant.", sentenceIds: [] },
        { dimension: "economy", score: 3, weight: 10, reason: "One bullet repeats another.", sentenceIds: ["R4"] },
      ],
    },
    gates: [{ id: "text_parity", kind: "hard", pass: true, reason: "The judged text is the rendered text.", sentenceIds: [] }],
    sentences: [
      { id: "R1", text: "Product manager who owns pricing from research to launch.", status: "supported", reason: "Summary of your claims.", citations: [] },
      { id: "R2", text: "Shipped a usage-based plan that lifted expansion revenue 18%.", status: "supported", reason: "Claim c4.", citations: [{ sourceId: "claim:c4", quote: "lifted expansion revenue 18%" }] },
    ],
    issues: [
      { id: "i1", code: "i1", kind: "clarity", severity: "note", sentenceIds: ["R4"], reason: "Two bullets say the same thing about onboarding.", action: "rewrite", origin: "judge" },
    ],
    qualificationGaps: [],
    judge: { status: "ok", provider: "gemini", model: "gemini-writer-1", independent: false, promptVersion: "judge.v1", latencyMs: 3100 },
    degraded: [],
    repair: { attempted: false, parentRunId: null, changed: null, adopted: null, before: null, after: null },
  },
};

/* REVIEW because the judge could not answer: no score, gates still ran. */
export const V2_LETTER_JUDGE_DOWN = {
  status: "review",
  issues: [],
  qa: {
    contract: "materials.qa.v2",
    document: "letter",
    runId: "mr_20260928092000_meridian_e5",
    disposition: "REVIEW",
    dispositionReason: "The judge didn't answer, so nobody has graded the writing yet.",
    textHash: "2b4d6f8a0c2e4a6c8e0a2c4e6a8c0e2b4d6f8a0c2e4a6c8e0a2c4e6a8c0e2b4d",
    quality: { score: null, ratings: [] },
    gates: [{ id: "tool_support", kind: "hard", pass: true, reason: "Every tool named appears in one of your claims.", sentenceIds: [] }],
    sentences: [],
    issues: [],
    qualificationGaps: [],
    judge: { status: "unavailable", provider: "openai_compatible", model: "grok-judge-1", independent: true, promptVersion: "judge.v1", latencyMs: 30000 },
    degraded: [],
    repair: { attempted: false, parentRunId: null, changed: null, adopted: null, before: null, after: null },
  },
};

/* An old run: graded by the 16-point rubric (materials.qa.v1). */
export const V1_RESUME_FAIL = {
  status: "fail",
  issues: [{ code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" }],
  qa: {
    runId: "mr_20260927090000_meridian_a1",
    status: "fail",
    disposition: "FAIL",
    dispositionReason: "Resume is missing an experience section.",
    degraded: [],
    rubric: {
      score: 6, max: 12, threshold: 10,
      rows: [
        { id: "outcome_coverage", score: 0, max: 2, note: "0/3 outcomes mapped by kept claims" },
        { id: "noun_fidelity", score: 0, max: 2, note: "0/24 role nouns appear in the resume" },
        { id: "proof_density", score: 1, max: 2, note: "1/4 kept claims carry metrics" },
        { id: "transfer_honesty", score: 2, max: 2, note: "every tool is evidenced" },
        { id: "delint_clean", score: 2, max: 2, note: "clean" },
        { id: "underfill", score: 1, max: 2, note: "page 48% full; 0 experience bullets" },
      ],
    },
  },
};

/* Letter text before and after a repair, as runs/<id>/cover-letter.txt. */
export const LETTER_BEFORE = [
  "Dear Meridian Labs team,",
  "Six years turning pricing data into roadmaps product teams actually ship.",
  "At Contoso I cut churn by 40% across the enterprise book.",
  "Worth a quick call this week?",
  "Jordan Rivera",
].join("\n");

export const LETTER_AFTER = [
  "Dear Meridian Labs team,",
  "Six years turning pricing data into roadmaps product teams actually ship.",
  "At Contoso I rebuilt the renewal pricing review that the enterprise team still runs.",
  "I'd like to hear how Meridian plans to price its next platform tier.",
  "Jordan Rivera",
].join("\n");
