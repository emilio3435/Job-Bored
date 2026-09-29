/** Per-document QA v2: hard gates plus a validated independent judgment. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashRenderedText, splitSentences } from "./materials-judge.mjs";

export const QA_CONTRACT = "materials.qa.v2";
export const QA_CONTRACT_V1 = "materials.qa.v1";
export const QUALITY_WEIGHTS = Object.freeze({ role_relevance: 30, evidence_quality: 25, voice: 20, coherence: 15, economy: 10 });

/** @param {"letter" | "resume"} document */
export function qaFileName(document) { return document === "letter" ? "qa.letter.json" : "qa.resume.json"; }

/** Retained while B1 moves its old pipeline issue routing to gates. */
export function issueDocument(/** @type {{ code?: string, field?: string }} */ issue) {
  const field = issue.field || "";
  if (field) return field.startsWith("letter") ? "letter" : "resume";
  const code = issue.code || "";
  if (code.startsWith("resume_") || code === "frozen_fact_broken" || code === "invented_employer") return "resume";
  if (code.startsWith("cover_letter_") || code === "jd_echo" || code === "banned_filler") return "letter";
  return "both";
}

/**
 * @param {object} input
 * @param {"letter" | "resume"} input.document
 * @param {string} input.runId
 * @param {string} input.finalText
 * @param {string} input.textHash
 * @param {Array<{ id: string, kind: "hard" | "advisory" | "constraint", pass: boolean, reason: string, sentenceIds: string[], action?: "rewrite" | "needs_evidence" | "none" }>} [input.gates]
 * @param {{ status: "ok" | "unavailable" | "invalid", judgment?: { documents?: any[] }, meta?: Record<string, any> }} [input.judge]
 * @param {Array<{ id: string, pass: boolean, reason: string, sentenceIds: string[], action?: "rewrite" | "needs_evidence" | "none" }>} [input.constraints]
 * @param {string[]} [input.degraded]
 * @param {{ attempted?: boolean, parentRunId?: string, changed?: boolean, adopted?: boolean, before?: string, after?: string }} [input.repair]
 */
export function buildQaRecord({ document, runId, finalText, textHash, gates = [], judge = { status: "invalid" }, constraints = [], degraded = [], repair }) {
  const expectedHash = hashRenderedText(finalText);
  const judgedDocument = judge.status === "ok" && Array.isArray(judge.judgment?.documents)
    ? judge.judgment.documents.find((/** @type {any} */ item) => item.document === document && item.textHash === textHash)
    : null;
  const judgeStatus = judge.status === "ok" && !judgedDocument ? "invalid" : judge.status;
  const sourceSentences = splitSentences(finalText, document);
  const judgedSentences = new Map((judgedDocument?.sentences || []).map((/** @type {any} */ item) => [item.id, item]));
  const sentences = sourceSentences.map(({ id, text }) => {
    const judged = judgedSentences.get(id);
    return { id, text, status: judged?.status || "uncertain", reason: judged?.reason || "The grading model did not assess this sentence.", citations: judged?.citations || [] };
  });
  const ratings = (judgedDocument?.ratings || []).map((/** @type {any} */ rating) => ({
    dimension: rating.dimension, score: rating.score, weight: QUALITY_WEIGHTS[/** @type {keyof typeof QUALITY_WEIGHTS} */ (rating.dimension)],
    reason: rating.reason, sentenceIds: rating.sentenceIds,
  }));
  const score = judgeStatus === "ok" && ratings.length === 5
    ? Math.round(ratings.reduce((/** @type {number} */ sum, /** @type {any} */ rating) => sum + rating.score / 4 * rating.weight, 0)) : null;
  const normalizedGates = [
    ...gates.map((gate) => ({ id: gate.id, kind: gate.kind, pass: Boolean(gate.pass), reason: gate.reason, sentenceIds: gate.sentenceIds || [] })),
    ...constraints.map((gate) => ({ id: gate.id, kind: "constraint", pass: Boolean(gate.pass), reason: gate.reason, sentenceIds: gate.sentenceIds || [] })),
  ];
  const autoParity = textHash !== expectedHash
    ? { id: "text_parity", kind: "hard", pass: false, reason: "The judged hash differs from the rendered body.", sentenceIds: [] }
    : null;
  if (autoParity) normalizedGates.unshift(autoParity);
  const unsupported = new Set(sentences.filter((sentence) => sentence.status === "unsupported").map((sentence) => sentence.id));
  /** @type {Array<{ id: string, code: string, kind: string, severity: string, sentenceIds: string[], reason: string, action: string, origin: string }>} */
  const issues = [];
  /** @param {string} kind @param {string} severity @param {string[]} sentenceIds @param {string} reason @param {string} action @param {string} origin */
  const addIssue = (kind, severity, sentenceIds, reason, action, origin) => {
    const id = `i${issues.length + 1}`;
    issues.push({ id, code: id, kind, severity, sentenceIds, reason, action, origin });
  };
  for (const item of judgedDocument?.issues || []) {
    const citedUnsupported = ["fact", "scope"].includes(item.kind) && item.sentenceIds.some((/** @type {string} */ id) => {
      const sentence = judgedSentences.get(id);
      return unsupported.has(id) && sentence?.citations?.length;
    });
    const severity = citedUnsupported ? "hard" : item.kind === "scope" || item.action === "none" ? "note" : "review";
    addIssue(item.kind, severity, item.sentenceIds, item.reason, item.action, "judge");
  }
  for (const sentence of sentences.filter((item) => item.status === "unsupported")) {
    if (issues.some((issue) => issue.severity === "hard" && issue.sentenceIds.includes(sentence.id))) continue;
    addIssue("fact", "hard", [sentence.id], sentence.reason, "rewrite", "judge");
  }
  for (const gate of [...(autoParity ? [autoParity] : []), ...gates, ...constraints.map((item) => ({ ...item, kind: "constraint" }))]) {
    if (gate.pass || gate.kind === "advisory") continue;
    const kind = /(?:tool|metric|fact|employer|claim|identity)/.test(gate.id) ? "fact" : "format";
    addIssue(kind, gate.kind === "hard" ? "hard" : "review", gate.sentenceIds || [], gate.reason || "Gate failed.", (/** @type {any} */ (gate)).action || (gate.kind === "hard" ? "rewrite" : "none"), gate.kind === "constraint" ? "constraint" : "gate");
  }
  const failedHard = normalizedGates.find((gate) => gate.kind === "hard" && !gate.pass);
  const uncertain = sentences.find((sentence) => sentence.status === "uncertain");
  const failedConstraint = normalizedGates.find((gate) => gate.kind === "constraint" && !gate.pass);
  const lowDimension = ratings.find((/** @type {any} */ rating) => rating.score < 2 || (["role_relevance", "voice"].includes(rating.dimension) && rating.score < 3));
  let disposition = "READY";
  let dispositionReason = "Hard gates pass and the grading model found supported, strong materials.";
  if (failedHard) { disposition = "FAIL"; dispositionReason = failedHard.reason || `Hard gate ${failedHard.id} failed.`; }
  else if (unsupported.size) { disposition = "FAIL"; dispositionReason = sentences.find((sentence) => sentence.status === "unsupported")?.reason || "The grading model found an unsupported sentence."; }
  else if (judgeStatus !== "ok") { disposition = "REVIEW"; dispositionReason = `Grading model ${judgeStatus}; review the document manually.`; }
  else if (uncertain) { disposition = "REVIEW"; dispositionReason = uncertain.reason; }
  else if (failedConstraint) { disposition = "REVIEW"; dispositionReason = failedConstraint.reason || `Constraint ${failedConstraint.id} is unmet.`; }
  else if (score === null || score < 80) { disposition = "REVIEW"; dispositionReason = `Quality score ${score ?? "unavailable"} is below 80.`; }
  else if (lowDimension) { disposition = "REVIEW"; dispositionReason = `${lowDimension.dimension} scored ${lowDimension.score}/4.`; }
  const meta = judge.meta || {};
  return {
    contract: QA_CONTRACT, document, runId, disposition, dispositionReason, textHash: expectedHash,
    quality: { score, ratings }, gates: normalizedGates, sentences, issues,
    qualificationGaps: judgedDocument?.qualificationGaps || [],
    judge: {
      status: judgeStatus, provider: String(meta.provider || ""), model: String(meta.model || ""),
      independent: meta.independent === true, promptVersion: String(meta.promptVersion || ""),
      latencyMs: Number.isFinite(meta.latencyMs) ? meta.latencyMs : 0,
      ...(Number.isInteger(meta.tokensIn) ? { tokensIn: meta.tokensIn } : {}),
      ...(Number.isInteger(meta.tokensOut) ? { tokensOut: meta.tokensOut } : {}),
      ...(typeof meta.error === "string" ? { error: meta.error } : {}),
      ...(["timeout", "auth", "rate_limited", "unconfigured", "invalid_json", "invalid_judgment", "unexpected"].includes(meta.errorCode)
        ? { errorCode: meta.errorCode } : {}),
    },
    degraded: [...degraded],
    repair: { attempted: repair?.attempted === true, parentRunId: repair?.parentRunId || null,
      changed: typeof repair?.changed === "boolean" ? repair.changed : null,
      adopted: typeof repair?.adopted === "boolean" ? repair.adopted : null,
      before: typeof repair?.before === "string" ? repair.before : null,
      after: typeof repair?.after === "string" ? repair.after : null },
  };
}

/** Worst document wins; the combined run retains the existing lower-case status. */
export function combinedStatus(/** @type {Array<{ disposition?: string, status?: string }>} */ records) {
  if (records.some((record) => record.disposition === "FAIL" || record.status === "fail")) return "fail";
  if (records.some((record) => record.disposition === "REVIEW" || record.status === "review")) return "review";
  return "pass";
}

/** Read both contract generations; existing v1 packages remain intact. */
export async function readDocumentQa(/** @type {string} */ dir) {
  /** @type {Partial<Record<"letter" | "resume", any>>} */
  const out = {};
  for (const document of /** @type {const} */ (["resume", "letter"])) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, qaFileName(document)), "utf8"));
      if (parsed && typeof parsed === "object" && [QA_CONTRACT, QA_CONTRACT_V1].includes(parsed.contract)) out[document] = parsed;
    } catch { /* missing or torn file: a later run may replace it */ }
  }
  return out;
}

/** Human-readable run report for either contract generation. */
export function formatDocumentQaReport(/** @type {{ records: any[], notes?: string[] }} */ { records, notes = [] }) {
  const worst = records.some((record) => record.disposition === "FAIL") ? "FAIL"
    : records.some((record) => record.disposition === "REVIEW") ? "REVIEW" : "READY";
  const lines = ["# QA report", "", `Status: ${records.length ? worst : "REVIEW"}`, ...notes];
  for (const record of records) {
    const name = record.document === "letter" ? "Cover letter" : "Resume";
    const score = record.contract === QA_CONTRACT ? `${record.quality?.score ?? "unscored"}/100` : `${record.rubric?.score ?? "unscored"}/${record.rubric?.max ?? "?"}`;
    lines.push("", `## ${name}: ${record.disposition} · ${score}`, "", `Run: ${record.runId}`);
    if (record.dispositionReason) lines.push(`Reason: ${record.dispositionReason}`);
    if (record.contract === QA_CONTRACT) {
      for (const item of record.issues || []) lines.push(`- ${item.id} (${item.severity}): ${item.reason}`);
      if (!record.issues?.length) lines.push("No issues.");
    } else {
      for (const item of record.checks || []) if (["fail", "review"].includes(item.severity)) lines.push(`- ${item.code}: ${item.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Only hard rewrite issues may drive the automatic repair pass. */
export function repairInstructionsFromQa(/** @type {Array<{ issues?: Array<{ id: string, kind: string, severity: string, action: string, reason: string, sentenceIds: string[] }> }>} */ records) {
  return records.flatMap((record) => (record.issues || [])
    .filter((issue) => issue.severity === "hard" && issue.action === "rewrite")
    .map((issue) => ({ id: issue.id, kind: issue.kind, reason: issue.reason, sentenceIds: issue.sentenceIds, text: issue.reason })));
}
