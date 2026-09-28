/**
 * Materials v3 — per-document QA records (Wave 1 L4: K6, P-10, P-16b).
 *
 * Each run writes one verdict per document it produced — qa.resume.json
 * and qa.letter.json — so a later letter run never overwrites the
 * resume's verdict. A record carries every rubric row, the disposition
 * (READY / REVIEW / FAIL) with its reason, and the degraded stages, which
 * is what the manifest exposes to the UI.
 *
 * The report lists every rubric row below max: "Issues: None" only ever
 * appears on a full-marks document with no issues (rule 10).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const QA_CONTRACT = "materials.qa.v1";

/** @typedef {"resume" | "letter"} QaDocument */
/** @typedef {{ code: string, message: string, severity: "review" | "fail" }} QaIssue */
/** @typedef {{ id: string, score: number, max: number, note: string }} QaRow */

/**
 * @typedef {object} QaRecord
 * @property {"materials.qa.v1"} contract
 * @property {QaDocument} document
 * @property {string} runId
 * @property {"pass" | "review" | "fail"} status
 * @property {"READY" | "REVIEW" | "FAIL"} disposition
 * @property {string} [dispositionReason]
 * @property {string[]} degraded
 * @property {Record<string, unknown>} measurements
 * @property {{ score: number, max: number, threshold: number, rows: QaRow[] }} rubric
 * @property {Array<{ code: string, severity: "pass" | "note" | "review" | "fail", stage: string, message: string }>} checks
 * @property {{ attempted: boolean, before?: { status: string, score: number, max: number, codes: string[] } }} [repair]
 */

/** @param {QaDocument} document */
export function qaFileName(document) {
  return document === "letter" ? "qa.letter.json" : "qa.resume.json";
}

/**
 * Which document a pipeline issue belongs to: tag-metric issues by their
 * draft field, critic issues by their code.
 * @param {{ code?: unknown, field?: unknown }} issue
 * @returns {QaDocument | "both"}
 */
export function issueDocument(issue) {
  const field = typeof issue.field === "string" ? issue.field : "";
  if (field) return field.startsWith("letter") ? "letter" : "resume";
  const code = typeof issue.code === "string" ? issue.code : "";
  if (code.startsWith("resume_") || code === "frozen_fact_broken" || code === "invented_employer") return "resume";
  if (code.startsWith("cover_letter_") || code === "jd_echo" || code === "banned_filler") return "letter";
  return "both";
}

/**
 * Rubric rows that are gates, not just points: a zero here names the
 * failure in the issue list.
 * @param {QaDocument} document
 * @param {{ rows: QaRow[] }} rubric
 * @returns {QaIssue[]}
 */
export function rubricIssues(document, rubric) {
  /** @type {Record<string, { code: string, severity: "review" | "fail" }>} */
  const gates = document === "letter"
    ? {
      transfer_honesty: { code: "transfer_overclaim", severity: "fail" },
      company_specificity: { code: "company_unnamed", severity: "fail" },
      letter_ungrounded: { code: "letter_ungrounded", severity: "fail" },
      metric_in_letter: { code: "metric_in_letter", severity: "review" },
    }
    : {
      transfer_honesty: { code: "transfer_overclaim", severity: "fail" },
      omission_record: { code: "omission_justified", severity: "fail" },
      metric_dropped: { code: "metric_dropped", severity: "review" },
      underfill: { code: "underfill", severity: "review" },
    };
  /** @type {QaIssue[]} */
  const out = [];
  for (const row of rubric.rows) {
    const gate = gates[row.id];
    if (gate && row.score === 0) out.push({ code: gate.code, message: row.note, severity: gate.severity });
    /* READY needs a letter that sounds human: a hard tell fails (and
     * earns the one automatic repair), a single soft tell is REVIEW. */
    if (document === "letter" && row.id === "sounds_human" && row.score < row.max) {
      out.push({ code: "sounds_machine", message: row.note, severity: row.score === 0 ? "fail" : "review" });
    }
  }
  return out;
}

/**
 * @param {object} input
 * @param {QaDocument} input.document
 * @param {string} input.runId
 * @param {QaIssue[]} input.issues
 * @param {{ rows: QaRow[], total: number, max: number, threshold: number }} input.rubric
 * @param {string[]} [input.degraded]
 * @param {Record<string, unknown>} [input.measurements]
 * @param {QaRecord["repair"]} [input.repair]
 * @returns {QaRecord}
 */
export function buildQaRecord({ document, runId, issues, rubric, degraded = [], measurements = {}, repair }) {
  const hasFail = issues.some((i) => i.severity === "fail");
  /** @type {QaRecord["status"]} */
  const status = hasFail
    ? "fail"
    : issues.length || rubric.total < rubric.threshold || degraded.length ? "review" : "pass";
  /** @type {QaRecord["disposition"]} */
  const disposition = status === "pass" ? "READY" : status === "fail" ? "FAIL" : "REVIEW";
  const firstFail = issues.find((i) => i.severity === "fail");
  const reason = firstFail?.message
    || issues[0]?.message
    || (rubric.total < rubric.threshold ? `rubric ${rubric.total}/${rubric.max} below ${rubric.threshold}` : "")
    || (degraded[0] ? `degraded: ${degraded[0]}` : "");
  const belowMax = rubric.rows.filter((row) => row.score < row.max);
  /** @type {QaRecord["checks"]} */
  const checks = [
    ...issues.map((i) => ({ code: i.code, severity: i.severity, stage: "qa", message: i.message })),
    /* Every row below max is listed; one an issue already names is not
     * repeated as a note. */
    ...belowMax.filter((row) => !issues.some((i) => i.message === row.note)).map((row) => ({
      code: `rubric.${row.id}`,
      severity: /** @type {const} */ ("note"),
      stage: "qa",
      message: `${row.id} ${row.score}/${row.max}: ${row.note}`,
    })),
  ];
  if (!checks.length) {
    checks.push({ code: "qa_clean", severity: "pass", stage: "qa", message: `rubric ${rubric.total}/${rubric.max}, no issues` });
  }
  return {
    contract: QA_CONTRACT,
    document,
    runId,
    status,
    disposition,
    ...(status === "pass" ? {} : { dispositionReason: reason }),
    degraded: [...degraded],
    measurements,
    rubric: { score: rubric.total, max: rubric.max, threshold: rubric.threshold, rows: rubric.rows },
    checks,
    ...(repair ? { repair } : {}),
  };
}

/**
 * The run's combined verdict (qa.json): the worst document wins.
 * @param {QaRecord[]} records
 */
export function combinedStatus(records) {
  if (records.some((r) => r.status === "fail")) return "fail";
  if (records.some((r) => r.status === "review")) return "review";
  return "pass";
}

/**
 * Read the current per-document verdicts in a package dir.
 * @param {string} dir
 * @returns {Promise<Partial<Record<QaDocument, QaRecord>>>}
 */
export async function readDocumentQa(dir) {
  /** @type {Partial<Record<QaDocument, QaRecord>>} */
  const out = {};
  for (const document of /** @type {QaDocument[]} */ (["resume", "letter"])) {
    const path = join(dir, qaFileName(document));
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.contract === QA_CONTRACT) out[document] = parsed;
    } catch {
      /* A torn file is the same as none; the next run rewrites it. */
    }
  }
  return out;
}

/** @param {QaDocument} document */
function label(document) {
  return document === "letter" ? "Cover letter" : "Resume";
}

/**
 * qa-report.md over every document's current verdict. Every rubric row
 * below max is listed; "None." appears only at full marks with no issues.
 * @param {{ records: QaRecord[], notes?: string[] }} input
 */
export function formatDocumentQaReport({ records, notes = [] }) {
  const worst = records.some((r) => r.disposition === "FAIL")
    ? "FAIL"
    : records.some((r) => r.disposition === "REVIEW") ? "REVIEW" : "READY";
  const lines = ["# QA report", "", `Status: ${records.length ? worst : "REVIEW"}`];
  if (notes.length) lines.push("", ...notes);
  for (const record of records) {
    const { rubric } = record;
    lines.push("", `## ${label(record.document)}: ${record.disposition} · ${rubric.score}/${rubric.max}`, "");
    lines.push(`Run: ${record.runId}`);
    if (record.dispositionReason) lines.push(`Reason: ${record.dispositionReason}`);
    if (record.repair?.attempted) {
      const before = record.repair.before;
      lines.push(`Automatic repair: ran once${before ? ` (before: ${before.status}, ${before.score}/${before.max})` : ""}`);
    }
    for (const d of record.degraded || []) lines.push(`degraded: ${d}`);
    const below = rubric.rows.filter((row) => row.score < row.max);
    lines.push("", "### Rubric rows below max", "");
    if (below.length) {
      for (const row of below) lines.push(`- \`${row.id}\` ${row.score}/${row.max}: ${row.note}`);
    } else {
      lines.push("None.");
    }
    const issues = record.checks.filter((c) => c.severity === "fail" || c.severity === "review");
    lines.push("", "### Issues", "");
    if (issues.length) {
      for (const issue of issues) lines.push(`- \`${issue.code}\` (${issue.severity}): ${issue.message}`);
    } else if (below.length) {
      lines.push(`No blocking issues; ${below.length} rubric row(s) below max are listed above.`);
    } else {
      lines.push("None.");
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * P-16b: the QA verdicts become editor instructions for the one
 * automatic repair pass (the F8 path: current draft + instructions).
 * @param {QaRecord[]} records
 */
export function repairInstructionsFromQa(records) {
  const failing = records.filter((r) => r.status === "fail");
  const lines = [
    "Goal: fix every QA failure below by editing the current draft.",
    "Success means: each listed issue is gone; every number still traces to its own claim; no new facts, tools, employers or metrics.",
    "Stop when: the draft addresses every issue, or an issue cannot be fixed from the given claims (leave that slot as close to its claim text as possible).",
  ];
  for (const record of failing) {
    lines.push("", `${label(record.document)} QA (${record.rubric.score}/${record.rubric.max}):`);
    const issueMessages = record.checks.filter((c) => c.severity === "fail" || c.severity === "review").map((c) => c.message);
    for (const check of record.checks) {
      if (check.severity === "pass") continue;
      /* A below-max row already named by an issue is not repeated. */
      if (check.severity === "note" && issueMessages.some((m) => check.message.endsWith(m))) continue;
      lines.push(`- ${check.code}: ${check.message}`);
    }
  }
  return lines.join("\n");
}
