import { readQaVerdict, repairInstructionsFromQa } from "./materials-qa.mjs";
/** Build a document-specific repair request from an immutable run source. */
import { usableDraft } from "./materials-history.mjs";

const FEATURES = new Set(["resume", "cover_letter"]);

/** @param {string} message @param {number} statusCode @param {string} [code] */
function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/** @param {unknown} value */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {Record<string, unknown>} issue */
function issueId(issue) {
  return cleanString(issue.id) || cleanString(issue.code);
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {{ feature?: unknown, source?: { feature: string, parentRunId: string, sourceText: string, sourceDraft: Record<string, unknown> | null, qa: Record<string, unknown> | null }, jobUrl?: unknown, instruction?: unknown, issueIds?: unknown, baseDocumentHash?: unknown, requestId?: unknown }} options
 */
export function buildRepairRequestPayload(manifest, options = {}) {
  if (!manifest || typeof manifest !== "object") throw httpError("Application manifest is required", 400);
  if (manifest.pending) throw httpError("A materials request is already pending for this role.", 409, "materials_pending");
  const feature = cleanString(options.feature);
  if (!FEATURES.has(feature)) throw httpError("feature must be resume or cover_letter", 400);
  const source = options.source;
  if (!source || source.feature !== feature || !usableDraft(/** @type {"resume" | "cover_letter"} */ (feature), source.sourceDraft) || !cleanString(source.sourceText)) {
    throw httpError("The selected run has no readable document draft.", 409, "repair_source_missing");
  }
  const instruction = cleanString(options.instruction);
  if (instruction.length > 600) throw httpError("instruction must be at most 600 characters", 400, "repair_instruction_too_long");
  const expectedHash = cleanString(options.baseDocumentHash);
  const parentHash = cleanString(source.qa?.textHash);
  if (expectedHash !== parentHash) {
    throw httpError("The document changed since this repair was requested.", 409, "repair_base_stale");
  }
  const qaIssues = Array.isArray(source.qa?.issues)
    ? source.qa.issues.filter((issue) => issue && typeof issue === "object")
    : Array.isArray(source.qa?.checks)
      ? source.qa.checks.filter((issue) => issue && typeof issue === "object")
      : [];
  const requestedIds = options.issueIds === undefined ? [] : options.issueIds;
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw httpError("issueIds must be an array of issue ids", 400, "invalid_issue_ids");
  }
  const issueIds = [...new Set(requestedIds.map((id) => id.trim()))];
  const byId = new Map(qaIssues.map((issue) => [issueId(issue), issue]));
  for (const id of issueIds) {
    if (!byId.has(id)) throw httpError(`Unknown review issue: ${id}`, 400, "invalid_issue_ids");
  }
  const selected = issueIds.length
    ? issueIds.map((id) => byId.get(id))
    : !instruction
      ? qaIssues.filter((issue) => (issue.severity === "hard" || issue.severity === "fail") && (issue.action === "rewrite" || !issue.action))
      : [];
  if (!instruction && !selected.length) throw httpError("Choose a review issue or enter a repair instruction.", 400, "repair_intent_missing");
  const resolvedIds = selected.map(issueId);
  const view = readQaVerdict(source.qa);
  const targets = view ? repairInstructionsFromQa([view]) : [];
  const targetedIds = new Set([...selected, ...targets].flatMap(issue => Array.isArray(issue?.sentenceIds) ? issue.sentenceIds : []));
  const preserveSentenceIds = view && !targets.some(target => !target.sentenceIds.length) ? view.sentences.filter((/** @type {any} */ sentence) => !targetedIds.has(sentence.id)).map((/** @type {any} */ sentence) => sentence.id) : [];
  const requestId = cleanString(options.requestId);
  /** @type {{ feature: "resume" | "cover_letter", instruction: string, issues: Record<string, unknown>[], targets: Record<string, unknown>[], preserveSentenceIds: string[], issueIds: string[], parentRunId: string, sourceText: string, sourceDraft: Record<string, unknown>, requestId?: string }} */
  const repairInput = {
    feature: /** @type {"resume" | "cover_letter"} */ (feature),
    instruction,
    issues: selected, targets, preserveSentenceIds,
    issueIds: resolvedIds,
    parentRunId: source.parentRunId,
    sourceText: source.sourceText,
    sourceDraft: source.sourceDraft,
    ...(requestId ? { requestId } : {}),
  };
  return {
    payload: {
      slug: cleanString(manifest.slug),
      company: cleanString(manifest.company),
      title: cleanString(manifest.title),
      feature,
      jobUrl: cleanString(options.jobUrl) || cleanString(manifest.jobUrl) || cleanString(manifest.job_url),
      notes: "",
      resumeFrom: /** @type {const} */ ("snapshot"),
      repair: repairInput,
    },
    repair: {
      parentRunId: source.parentRunId,
      instruction,
      issueIds: resolvedIds,
      ...(requestId ? { requestId } : {}),
    },
  };
}
