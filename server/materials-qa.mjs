/** One per-document verdict; dimension ratings are advisory, never a total. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashRenderedText, splitSentences, JUDGE_PROMPT_VERSION } from "./materials-judge.mjs";
import { PIPELINE_PROMPT_VERSION } from "./materials-cache.mjs";
export const QA_CONTRACT = "materials.qa.v3";
export const QA_CONTRACT_V1 = "materials.qa.v1";
/** @param {string} id */
const labelOf = id => id.replace(/^(dimension|sentence|review):/, "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
/** Map factual gate details conservatively; an unmapped failure disables preservation.
 * @param {any} check @param {any[]} sentences @returns {string[]} */
function defectSentenceIds(check, sentences) {
  if (check.sentenceIds?.length) return check.sentenceIds;
  if (!/tool_support|metric|invented_fact|invented_employer|protected_fact/.test(check.id)) return [];
  const reason = String(check.detail || check.reason || "");
  const terms = [...(reason.match(/\$?\d[\d,.]*(?:%|[kmb])?/gi) || []),
    ...[...reason.matchAll(/(?:supports:|evidence:|employer:|employers?:)\s*([^.;]+)/gi)].flatMap(m => m[1].split(",")),
    ...[...reason.matchAll(/["“']([^"”']+)["”']/g)].map(m => m[1])].map(t => t.trim().toLowerCase()).filter(Boolean);
  return sentences.filter(s => terms.some(term => String(s.text || "").toLowerCase().includes(term))).map(s => s.id);
}
/** @param {string} text @param {string} fallback */
const legacyText = (text, fallback) => /(?:quality|advisory|overall)\s*score|\d+\s*(?:\/|of)\s*(?:100|16)|\bscore[d]?\s+\d+/i.test(text) ? fallback : text || fallback;
/** Copy legacy display fields without carrying stored total prose into a served view.
 * @param {any} value @returns {any} */
function legacyView(value) {
  if (typeof value === "string") return value ? legacyText(value, "Old checker feedback") : value;
  if (Array.isArray(value)) return value.map(legacyView);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, legacyView(item)]));
  return value;
}
/** Keep legacy repair truth without exposing retired totals. @param {any} value */
function legacyRepairSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "score" && key !== "max"));
}
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


/** @param {Record<string, any>} input */
export function buildQaRecord({ document, runId, finalText = "", textHash, passId = null, gates = [], judge = { status: "invalid" }, constraints = [], degraded = [], repair, state = "graded", carriedFrom, rescore }) {
  const expectedHash = hashRenderedText(finalText);
  const normalizedGates = [...gates, ...constraints.map((/** @type {any} */ g) => ({ ...g, kind: "constraint" }))]
    .map((/** @type {any} */ g) => ({ id: g.id, kind: g.kind, pass: Boolean(g.pass), reason: g.reason || labelOf(g.id), sentenceIds: g.pass ? g.sentenceIds || [] : defectSentenceIds(g, splitSentences(finalText, document)) }));
  if (textHash && textHash !== expectedHash) normalizedGates.unshift({ id: "text_parity", kind: "hard", pass: false, reason: "The judged hash differs from the rendered body.", sentenceIds: [] });
  const failedHard = normalizedGates.some((/** @type {any} */ g) => g.kind === "hard" && !g.pass);
  const constraintFailed = normalizedGates.some((/** @type {any} */ g) => g.kind === "constraint" && !g.pass);
  const rawReviews = Array.isArray(judge.reviews) ? judge.reviews : [{ role: "first", ...judge }];
  const parsed = rawReviews.map((/** @type {any} */ review) => {
    const doc = review.status === "ok" ? review.judgment?.documents?.find((/** @type {any} */ d) => d.document === document && d.textHash === expectedHash) : null;
    const status = review.status === "ok" && !doc ? "invalid" : review.status;
    let disposition = null;
    if (status === "ok") {
      disposition = failedHard || doc.sentences.some((/** @type {any} */ s) => s.status === "unsupported") ? "FAIL"
        : constraintFailed || doc.sentences.some((/** @type {any} */ s) => s.status === "uncertain") || doc.ratings.some((/** @type {any} */ r) => r.score < 3) ? "REVIEW" : "READY";
    }
    const meta = review.meta || {};
    return { doc, view: { role: review.role || "first", provider: String(meta.provider || ""), model: String(meta.model || ""), promptVersion: String(meta.promptVersion || JUDGE_PROMPT_VERSION), status, disposition,
      flagged: (doc?.sentences || []).filter((/** @type {any} */ s) => ["unsupported", "uncertain"].includes(s.status)).map((/** @type {any} */ s) => ({ sentenceId: s.id, status: s.status, reason: s.reason })),
      ...Object.fromEntries(["reason", "errorCode", "error", "latencyMs", "tokensIn", "tokensOut"].filter(k => meta[k] !== undefined).map(k => [k, meta[k]])) } };
  });
  const primary = parsed.find((/** @type {any} */ r) => r.view.status === "ok")?.doc;
  const known = new Map((primary?.sentences || []).map((/** @type {any} */ s) => [s.id, s]));
  const sentences = splitSentences(finalText, document).map(({ id, text }) => {
    const found = /** @type {any} */ (known.get(id));
    return { id, text, status: found?.status || "uncertain", reason: found?.reason || "The review did not assess this sentence.", citations: found?.citations || [] };
  });
  // Retain flags from either reviewer so the modal can inspect disagreement.
  for (const entry of parsed) for (const flag of entry.view.flagged) {
    const sentence = sentences.find(s => s.id === flag.sentenceId);
    if (sentence && (flag.status === "unsupported" || sentence.status === "nonfactual" || sentence.status === "supported")) {
      sentence.status = flag.status; sentence.reason = flag.reason;
      sentence.citations = entry.doc.sentences.find((/** @type {any} */ s) => s.id === flag.sentenceId)?.citations || [];
    }
  }
  const ratings = (primary?.ratings || []).map((/** @type {any} */ r) => ({ dimension: r.dimension, score: r.score, reason: r.reason, sentenceIds: r.sentenceIds || [] }));
  /** @type {any[]} */
  const checks = normalizedGates.map((/** @type {any} */ g) => ({ id: g.id, kind: g.kind === "constraint" ? "constraint" : "gate", status: g.pass ? "pass" : g.kind === "hard" ? "fail" : g.kind === "advisory" ? "skipped" : "review", label: labelOf(g.id), detail: g.reason, sentenceIds: g.sentenceIds }));
  const unsupported = sentences.filter(s => s.status === "unsupported");
  const ok = parsed.filter((/** @type {any} */ r) => r.view.status === "ok");
  const disagree = ok.length === 2 && ok[0].view.disposition !== ok[1].view.disposition;
  for (const sentence of sentences) checks.push({ id: `sentence:${sentence.id}`, kind: "sentence", status: sentence.status === "unsupported" ? "fail" : sentence.status === "uncertain" ? "review" : "pass", label: sentence.status === "unsupported" ? "Claim needs a source" : "Sentence evidence", detail: sentence.reason, sentenceIds: [sentence.id] });
  if (disagree) checks.push({ id: "review:disagreement", kind: "review", status: "review", label: "Reviewers disagree", detail: "Reviewers disagree", sentenceIds: [] });
  if (!ok.length) checks.push({ id: "review:absence", kind: "review", status: "review", label: "Review unavailable", detail: "No review ran; try again", sentenceIds: [] });
  for (const entry of parsed.filter((/** @type {any} */ r) => r.view.status !== "ok")) checks.push({ id: `review:${entry.view.role}`, kind: "review", status: "skipped", label: `${labelOf(entry.view.role)} review ${entry.view.status}`, detail: entry.view.status === "skipped" ? "Same provider and model" : "Try again", sentenceIds: [] });
  for (const r of ratings.filter((/** @type {any} */ r) => r.score < 3)) checks.push({ id: `dimension:${r.dimension}`, kind: "dimension", status: "review", label: labelOf(r.dimension), detail: `${labelOf(r.dimension)} rated ${r.score} of 4`, sentenceIds: r.sentenceIds });
  const disposition = state === "not_rescored" ? null : failedHard ? "FAIL" : disagree || !ok.length ? "REVIEW" : ok[0].view.disposition;
  /** @type {Array<{ checkId: string, text: string }>} */
  const reasons = [];
  for (const g of normalizedGates.filter((/** @type {any} */ g) => g.kind === "hard" && !g.pass)) reasons.push({ checkId: g.id, text: g.reason });
  if (unsupported.length && !disagree) reasons.push({ checkId: `sentence:${unsupported[0].id}`, text: `${unsupported.length} ${unsupported.length === 1 ? "claim needs" : "claims need"} a source` });
  for (const c of checks.filter(c => c.status === "review").sort((a, b) => (/** @type {Record<string, number>} */ ({ review: 0, sentence: 1, constraint: 2, dimension: 3, gate: 4 })[a.kind] ?? 5) - (/** @type {Record<string, number>} */ ({ review: 0, sentence: 1, constraint: 2, dimension: 3, gate: 4 })[b.kind] ?? 5))) reasons.push({ checkId: c.id, text: c.detail });
  /** @type {any[]} */
  const issues = [];
  /** @param {any} item */
  const addIssue = item => { const id = `i${issues.length + 1}`; issues.push({ id, code: id, ...item }); };
  for (const item of primary?.issues || []) addIssue({ kind: item.kind, severity: ["fact", "scope"].includes(item.kind) && item.sentenceIds.some((/** @type {string} */ id) => unsupported.some(s => s.id === id && s.citations.length)) ? "hard" : item.kind === "scope" || item.action === "none" ? "note" : "review", sentenceIds: item.sentenceIds, reason: item.reason, action: item.action, origin: "judge" });
  for (const sentence of unsupported) if (!issues.some(i => i.severity === "hard" && i.sentenceIds.includes(sentence.id))) addIssue({ kind: "fact", severity: "hard", sentenceIds: [sentence.id], reason: sentence.reason, action: "rewrite", origin: "judge" });
  for (const gate of normalizedGates.filter((/** @type {any} */ g) => !g.pass && g.kind !== "advisory")) addIssue({ kind: /tool|metric|fact|employer|claim|identity/.test(gate.id) ? "fact" : "format", severity: gate.kind === "hard" ? "hard" : "review", sentenceIds: gate.sentenceIds, reason: gate.reason, action: gate.kind === "hard" ? "rewrite" : "none", origin: gate.kind === "constraint" ? "constraint" : "gate" });
  const requirements = primary?.coverage?.requirements;
  if (state === "not_rescored") { reasons.splice(0, reasons.length, { checkId: "rescore", text: "Not rescored — Rescore" }); checks.push({ id: "rescore", kind: "rescore", status: "skipped", label: "Not rescored", detail: "Rescore", sentenceIds: [] }); }
  return { contract: QA_CONTRACT, document, runId, passId, textHash: expectedHash, state, disposition, reasons, checks, sentences,
    issues, ratings, coverage: Array.isArray(requirements) ? { requirements, covered: requirements.filter((/** @type {any} */ r) => r.status === "covered").length, total: requirements.length } : null,
    reviews: state === "not_rescored" ? [] : parsed.map((/** @type {any} */ r) => r.view), gates: normalizedGates, qualificationGaps: primary?.qualificationGaps || [], degraded: [...degraded],
    repair: { attempted: repair?.attempted === true, parentRunId: repair?.parentRunId || null, changed: typeof repair?.changed === "boolean" ? repair.changed : null, adopted: typeof repair?.adopted === "boolean" ? repair.adopted : null, before: typeof repair?.before === "object" ? repair.before : null, after: typeof repair?.after === "object" ? repair.after : null },
    ...(carriedFrom ? { carriedFrom } : {}), ...(rescore ? { rescore } : {}), versions: { schema: QA_CONTRACT, judgePrompt: JUDGE_PROMPT_VERSION, pipeline: PIPELINE_PROMPT_VERSION } };
}

/** Adapt old records on read only. Never reuse their numeric verdict prose. @param {any} record */
export function readQaVerdict(record) {
  if (!record || typeof record !== "object") return null;
  if (record.contract === QA_CONTRACT) return record;
  const stub = record.rubric?.rows?.some((/** @type {any} */ r) => r.id === "version_recheck");
  const base = buildQaRecord({ document: record.document || "resume", runId: record.runId || "legacy", finalText: "", state: stub ? "not_rescored" : "graded" });
  /** @type {any[]} */
  const checks = [];
  for (const gate of record.gates || []) checks.push({ id: gate.id, kind: gate.kind === "constraint" ? "constraint" : "gate", status: gate.pass ? "pass" : gate.kind === "hard" ? "fail" : gate.kind === "advisory" ? "skipped" : "review", label: labelOf(gate.id), detail: legacyText(gate.reason || "", labelOf(gate.id)), sentenceIds: gate.sentenceIds || [] });
  for (const check of record.checks || []) if (["fail", "review"].includes(check.severity)) checks.push({ id: check.code || check.id || "legacy_check", kind: "gate", status: check.severity, label: labelOf(check.code || check.id || "legacy_check"), detail: legacyText(check.message || "", "Old checker flagged this check"), sentenceIds: check.sentenceIds || [] });
  for (const sentence of record.sentences || []) if (["unsupported", "uncertain"].includes(sentence.status)) checks.push({ id: `sentence:${sentence.id}`, kind: "sentence", status: sentence.status === "unsupported" ? "fail" : "review", label: "Claim evidence", detail: legacyText(sentence.reason || "", "Claim needs review"), sentenceIds: [sentence.id] });
  for (const issue of record.issues || []) if (issue.severity === "hard" && !checks.some(c => c.status === "fail" && c.sentenceIds.some((/** @type {string} */ id) => issue.sentenceIds?.includes(id)))) checks.push({ id: `issue:${issue.id}`, kind: "sentence", status: "fail", label: "Claim needs a source", detail: legacyText(issue.reason || "", "Claim needs a source"), sentenceIds: issue.sentenceIds || [] });
  const disposition = stub ? null : record.disposition || (record.status === "fail" ? "FAIL" : record.status === "pass" ? "READY" : "REVIEW");
  const decisive = checks.filter(c => c.status === "fail" || c.status === "review");
  return legacyView({ ...base, textHash: /^sha256:[0-9a-f]{64}$/.test(record.textHash || "") ? record.textHash : base.textHash, legacy: "old_checker", disposition,
    reasons: stub ? base.reasons : decisive.map(c => ({ checkId: c.id, text: c.detail })), checks: stub ? base.checks : checks,
    gates: record.gates || [], sentences: record.sentences || [], issues: record.issues || [], ratings: (record.quality?.ratings || []).map((/** @type {any} */ r) => ({ dimension: r.dimension, score: r.score, reason: legacyText(r.reason || "", "Old checker rating"), sentenceIds: r.sentenceIds || [] })),
    reviews: [], qualificationGaps: record.qualificationGaps || [], degraded: record.degraded || [], repair: { ...base.repair, ...record.repair, before: legacyRepairSnapshot(record.repair?.before), after: legacyRepairSnapshot(record.repair?.after) } });
}

/** @param {any[]} records */
export function combinedStatus(records) {
  const views = records.map(readQaVerdict).filter(Boolean);
  return views.some(r => r.disposition === "FAIL") ? "fail" : views.some(r => r.disposition === "REVIEW" || r.disposition === null) ? "review" : "pass";
}
/** @param {string} dir */
export async function readDocumentQa(dir) {
  /** @type {Partial<Record<"letter" | "resume", any>>} */
  const out = {};
  for (const document of /** @type {const} */ (["resume", "letter"])) {
    try { const parsed = JSON.parse(await readFile(join(dir, qaFileName(document)), "utf8"));
      if ([QA_CONTRACT, "materials.qa.v2", QA_CONTRACT_V1].includes(parsed?.contract)) out[document] = readQaVerdict({ ...parsed, document });
    } catch { /* absent or torn QA */ }
  }
  return out;
}
/** @param {{records: any[], notes?: string[]}} input */
export function formatDocumentQaReport({ records, notes = [] }) {
  const views = records.map(readQaVerdict).filter(Boolean);
  const status = combinedStatus(views);
  const lines = ["# QA report", "", `Status: ${status === "pass" ? "READY" : status.toUpperCase()}`, ...notes];
  for (const record of views) {
    lines.push("", `## ${record.document === "letter" ? "Cover letter" : "Resume"}: ${record.disposition || "Not rescored"}`, "", `Run: ${record.runId}`);
    for (const reason of record.reasons) lines.push(`- ${reason.text}`);
    if (record.legacy) lines.push("Graded by the old checker");
  }
  return `${lines.join("\n")}\n`;
}
/** Target every failed check, preserve all unflagged sentences. @param {any[]} records */
export function repairInstructionsFromQa(records) {
  return records.flatMap(readQa => {
    const record = readQaVerdict(readQa);
    const failed = record.checks.filter((/** @type {any} */ c) => c.status === "fail").map((/** @type {any} */ c) => ({ ...c, sentenceIds: defectSentenceIds(c, record.sentences) }));
    const flagged = new Set(failed.flatMap((/** @type {any} */ c) => c.sentenceIds));
    const preserveSentenceIds = failed.some((/** @type {any} */ c) => !c.sentenceIds.length) ? [] : record.sentences.filter((/** @type {any} */ s) => !flagged.has(s.id)).map((/** @type {any} */ s) => s.id);
    return failed.map((/** @type {any} */ c) => ({ id: record.issues.find((/** @type {any} */ i) => i.sentenceIds.some((/** @type {string} */ id) => c.sentenceIds.includes(id)) && i.severity === "hard")?.id || c.id,
      checkId: c.id, kind: c.kind === "sentence" ? "fact" : "format", reason: c.detail, sentenceIds: c.sentenceIds, text: c.detail, preserveSentenceIds }));
  });
}

/** @param {any} record */
export function verdictSnapshot(record) {
  const view = readQaVerdict(record);
  return view ? { runId: view.runId, disposition: view.disposition, failedCheckIds: view.checks.filter((/** @type {any} */ c) => c.status === "fail").map((/** @type {any} */ c) => c.id) } : null;
}
/** Passes or strictly fewer failed checks with no newly failed check. @param {any[]} candidates @param {any[]} previous */
export function passesOrStrictlyBetter(candidates, previous) {
  const next = candidates.map(readQaVerdict).filter(Boolean);
  if (!next.some(r => r.disposition === "FAIL")) return true;
  const failed = (/** @type {any[]} */ records) => new Set(records.flatMap(r => r.checks.filter((/** @type {any} */ c) => c.status === "fail").map((/** @type {any} */ c) => `${r.document}:${c.id}`)));
  const before = failed(previous.map(readQaVerdict).filter(Boolean));
  const after = failed(next);
  return previous.some(r => readQaVerdict(r)?.disposition === "FAIL") && after.size < before.size && [...after].every(id => before.has(id));
}
