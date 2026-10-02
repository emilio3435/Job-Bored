/** Frozen GRADE A3 fixtures. Fictional Acme Robotics data only. */
const copy = (value) => structuredClone(value);
const HASH = "sha256:" + "a".repeat(64);
const dims = ["role_relevance", "evidence_quality", "voice", "coherence", "economy"];
const base = {
  contract: "materials.qa.v3", document: "letter", runId: "mr_20261002090000_acme_a1", passId: "pass-1", textHash: HASH,
  state: "graded", disposition: "READY", reasons: [], checks: [],
  sentences: [{ id: "L1", text: "I built a dispatch forecast at Acme Robotics.", status: "supported", reason: "Source supports the work.", citations: [{ sourceId: "claim:1", quote: "built a dispatch forecast" }] }],
  issues: [], ratings: dims.map(dimension => ({ dimension, score: 4, reason: "Clear, grounded writing.", sentenceIds: ["L1"] })),
  coverage: null, reviews: [{ role: "first", provider: "openai_compatible", model: "writer-example", promptVersion: "materials-judge-v3", status: "ok", disposition: "READY", flagged: [] }],
  gates: [], qualificationGaps: [], degraded: [],
  repair: { attempted: false, parentRunId: null, changed: null, adopted: null, before: null, after: null },
  versions: { schema: "materials.qa.v3", judgePrompt: "materials-judge-v3", pipeline: "materials.pipeline.grade.v3" },
};
export const V3_READY = copy(base);
export const V3_GATE_FAIL_PERFECT = { ...copy(base), disposition: "FAIL", reasons: [{ checkId: "tool_support", text: "Unknown tool." }],
  checks: [{ id: "tool_support", kind: "gate", status: "fail", label: "Tool support", detail: "Unknown tool.", sentenceIds: ["L1"] }],
  gates: [{ id: "tool_support", kind: "hard", pass: false, reason: "Unknown tool.", sentenceIds: ["L1"] }],
  reviews: [{ ...base.reviews[0], disposition: "FAIL" }],
  issues: [{ id: "i1", code: "i1", kind: "fact", severity: "hard", sentenceIds: ["L1"], reason: "Unknown tool.", action: "rewrite", origin: "gate" }],
};
export const V3_UNSUPPORTED = { ...copy(base), disposition: "FAIL", reasons: [{ checkId: "sentence:L1", text: "1 claim needs a source" }],
  checks: [{ id: "sentence:L1", kind: "sentence", status: "fail", label: "Claim needs a source", detail: "No source for this result.", sentenceIds: ["L1"] }],
  sentences: [{ ...base.sentences[0], status: "unsupported", reason: "No source for this result.", citations: [] }],
  reviews: [{ ...base.reviews[0], disposition: "FAIL", flagged: [{ sentenceId: "L1", status: "unsupported", reason: "No source for this result." }] }],
  issues: [{ id: "i1", code: "i1", kind: "fact", severity: "hard", sentenceIds: ["L1"], reason: "No source for this result.", action: "rewrite", origin: "judge" }],
};
export const V3_SECOND_DISAGREEMENT = { ...copy(V3_UNSUPPORTED), disposition: "REVIEW",
  reasons: [{ checkId: "review:disagreement", text: "Reviewers disagree" }],
  checks: [{ id: "review:disagreement", kind: "review", status: "review", label: "Reviewers disagree", detail: "First review FAIL; second review READY.", sentenceIds: [] }],
  reviews: [...copy(V3_UNSUPPORTED.reviews), { ...base.reviews[0], role: "second", model: "judge-example" }],
};
export const V3_SECOND_OUTAGE = { ...copy(base), reviews: [...copy(base.reviews), { role: "second", provider: "openai_compatible", model: "judge-example", promptVersion: "materials-judge-v3", status: "unavailable", disposition: null, flagged: [], errorCode: "timeout", error: "judge_timeout" }],
  checks: [{ id: "review:second", kind: "review", status: "skipped", label: "Second review unavailable", detail: "Try again", sentenceIds: [] }],
};
export const V3_REPAIRED_READY = { ...copy(base), passId: "pass-2", repair: { attempted: true, parentRunId: base.runId, changed: true, adopted: true,
  before: { runId: base.runId, disposition: "FAIL", failedCheckIds: ["sentence:L1"] }, after: { runId: base.runId, disposition: "READY", failedCheckIds: [] } } };
export const V3_REPAIR_STILL_FAILING = { ...copy(V3_UNSUPPORTED), passId: "pass-2", repair: { ...copy(V3_REPAIRED_READY.repair), adopted: false, after: { runId: base.runId, disposition: "FAIL", failedCheckIds: ["sentence:L1"] } } };
export const V3_CARRIED_OVER = { ...copy(base), state: "carried_over", carriedFrom: { runId: base.runId, date: "2026-10-02T09:00:00.000Z" } };
export const V3_NOT_RESCORED = { ...copy(base), state: "not_rescored", disposition: null, ratings: [], sentences: [], reviews: [],
  checks: [{ id: "rescore", kind: "rescore", status: "skipped", label: "Not rescored", detail: "Rescore", sentenceIds: [] }], reasons: [{ checkId: "rescore", text: "Not rescored — Rescore" }] };
export const V3_LOW_DIMENSION = { ...copy(base), disposition: "REVIEW", ratings: base.ratings.map(r => ({ ...r, score: r.dimension === "evidence_quality" ? 2 : 4 })),
  checks: [{ id: "dimension:evidence_quality", kind: "dimension", status: "review", label: "Evidence", detail: "Evidence rated 2 of 4", sentenceIds: ["L1"] }],
  reasons: [{ checkId: "dimension:evidence_quality", text: "Evidence rated 2 of 4" }], reviews: [{ ...base.reviews[0], disposition: "REVIEW" }] };
export const V3_COVERAGE_MISSES = { ...copy(base), coverage: { requirements: [
  { id: "req:1", text: "Dispatch forecasting", status: "covered", sentenceIds: ["L1"] },
  { id: "req:2", text: "Team mentoring", status: "missing", sentenceIds: [] },
  { id: "req:3", text: "Planning", status: "partial", sentenceIds: ["L1"] },
], covered: 1, total: 3 } };
export const LEGACY_V2 = { contract: "materials.qa.v2", document: "letter", runId: base.runId, disposition: "FAIL", dispositionReason: "Quality score 100 is below 80.", textHash: HASH,
  quality: { score: 100, ratings: base.ratings.map(r => ({ ...r, weight: 20 })) }, gates: copy(V3_GATE_FAIL_PERFECT.gates), sentences: copy(base.sentences), issues: copy(V3_GATE_FAIL_PERFECT.issues), qualificationGaps: [], degraded: [], repair: copy(base.repair), judge: { status: "ok", provider: "example", model: "old-example", independent: false, promptVersion: "materials-judge-v2", latencyMs: 0 } };
export const LEGACY_V1 = { contract: "materials.qa.v1", document: "resume", runId: base.runId, disposition: "FAIL", status: "fail", dispositionReason: "6/16", rubric: { score: 6, max: 16 }, checks: [{ code: "resume_experience_missing", severity: "fail", message: "Resume is missing experience." }], degraded: [] };
export const V3_LEGACY_V2_VIEW = { ...copy(V3_GATE_FAIL_PERFECT), legacy: "old_checker", passId: null, reviews: [], ratings: [] };
export const V3_LEGACY_V1_VIEW = { ...copy(base), document: "resume", legacy: "old_checker", passId: null, disposition: "FAIL", ratings: [], reviews: [], sentences: [],
  checks: [{ id: "resume_experience_missing", kind: "gate", status: "fail", label: "Resume experience missing", detail: "Resume is missing experience.", sentenceIds: [] }], reasons: [{ checkId: "resume_experience_missing", text: "Resume is missing experience." }] };
export const RECORD_FIXTURES = { V3_READY, V3_GATE_FAIL_PERFECT, V3_UNSUPPORTED, V3_SECOND_DISAGREEMENT, V3_SECOND_OUTAGE, V3_REPAIRED_READY, V3_REPAIR_STILL_FAILING, V3_CARRIED_OVER, V3_NOT_RESCORED, V3_LOW_DIMENSION, V3_COVERAGE_MISSES, V3_LEGACY_V2_VIEW, V3_LEGACY_V1_VIEW };
const summary = (id, record, extra = {}) => ({ runId: id, date: "2026-10-02T09:00:00.000Z", feature: "cover_letter", template: "signal", source: "request", documents: ["cover_letter"], active: [], kind: "run",
  verdicts: { cover_letter: { disposition: record.disposition, state: record.state, reason: record.reasons[0]?.text || "", failedChecks: record.checks.filter(c => c.status === "fail").map(c => c.id), ...(record.legacy ? { legacy: record.legacy } : {}) } },
  held: record.disposition === "FAIL" ? { reason: record.reasons[0].text } : null, isDefault: false,
  files: { cover_letter: { pdf: `/api/applications/acme/runs/${id}/files/cover-letter.pdf`, html: `/api/applications/acme/runs/${id}/files/cover-letter.html`, txt: `/api/applications/acme/runs/${id}/files/cover-letter.txt` } }, ...extra });
export const RUNS_REPAIR_PASSED = [
  summary("passing-repair-pass-1", V3_UNSUPPORTED, { kind: "pass", parentRunId: "passing-repair", label: "Original draft" }),
  summary("passing-repair", V3_REPAIRED_READY, { label: "Repaired", active: ["cover_letter"], isDefault: true, repair: V3_REPAIRED_READY.repair }),
];
export const RUNS_REPAIR_HELD = [
  summary("failing-repair", V3_UNSUPPORTED, { label: "Original draft" }),
  summary("failing-repair-pass-2", V3_REPAIR_STILL_FAILING, { kind: "pass", parentRunId: "failing-repair", label: "Repaired", repair: V3_REPAIR_STILL_FAILING.repair }),
  summary("previous-good", V3_READY, { active: ["cover_letter"], isDefault: true }),
];
export const RUNS_MANUAL_REPAIR = [
  summary("manual-parent", V3_UNSUPPORTED),
  summary("manual-repair", V3_REPAIRED_READY, { active: ["cover_letter"], isDefault: true, source: "repair", repair: { ...copy(V3_REPAIRED_READY.repair), parentRunId: "manual-parent", before: { runId: "manual-parent", disposition: "FAIL", failedCheckIds: ["sentence:L1"] } } }),
];
export const RUNS_EDITS = [
  summary("edit-parent", V3_READY),
  summary("edit-carried", V3_CARRIED_OVER, { source: "manual", regeneratedFrom: "edit-parent" }),
  summary("edit-not-rescored", V3_NOT_RESCORED, { active: ["cover_letter"], isDefault: true, source: "manual", regeneratedFrom: "edit-carried" }),
];
export const RUNS_LEGACY = [
  summary("legacy-v1", V3_LEGACY_V1_VIEW, { feature: "resume", documents: ["resume"], verdicts: { resume: { disposition: "FAIL", state: "graded", reason: "Resume is missing experience.", failedChecks: ["resume_experience_missing"], legacy: "old_checker" } }, files: { resume: { txt: "/api/applications/acme/runs/legacy-v1/files/resume.txt" } } }),
  summary("legacy-v2", V3_LEGACY_V2_VIEW, { active: ["cover_letter"] }),
];
export const RUN_SUMMARIES = [...RUNS_REPAIR_PASSED, ...RUNS_REPAIR_HELD, ...RUNS_MANUAL_REPAIR, ...RUNS_EDITS, ...RUNS_LEGACY];
