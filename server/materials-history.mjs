import { readQaVerdict, verdictSnapshot } from "./materials-qa.mjs";
/**
 * Materials version history (Wave 2 · U-6).
 *
 * Every draft already leaves an immutable copy of its package under
 * <slug>/runs/<runId>/ (materials-package.mjs writePackageRecords). This
 * module reads those folders back:
 *
 *   listRuns(slug)            each run: id, date, template, feature, per-document
 *                             verdict (disposition + rubric score) and whether
 *                             it is the version the dashboard serves now
 *   promoteRun(slug, runId)   copy a run's package back to the top level so
 *                             Preview / Download serve it again
 *   diffRuns(slug, a, b, doc) a line diff of two runs' ATS text twins
 *                             (resume.txt / cover-letter.txt)
 *
 * Nothing here calls a model or renders anything. Every path is validated
 * against the slug pattern, a run-id pattern and a realpath check, the same
 * way application-materials.mjs guards the file routes.
 */

import { copyFile, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { resolveApplicationDir, resolveContainedFile } from "./application-materials.mjs";
import { RUNS_DIR } from "./materials-package.mjs";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const MAX_RUNS = 50;
const MAX_DIFF_LINES = 2000;

/** @typedef {"resume" | "cover_letter"} HistoryDoc */

/** @type {Record<HistoryDoc, { txt: string, html: string, pdf: string, qa: string, draft: string }>} */
const DOC_FILES = {
  resume: { txt: "resume.txt", html: "resume.html", pdf: "resume.pdf", qa: "qa.resume.json", draft: "draft.resume.json" },
  cover_letter: { txt: "cover-letter.txt", html: "cover-letter.html", pdf: "cover-letter.pdf", qa: "qa.letter.json", draft: "draft.cover_letter.json" },
};

/* The run-level records a promote carries back with the documents, so
 * run.json, the render model and the report describe the promoted run. */
const RUN_LEVEL_FILES = [
  "render-model.json",
  "run.json",
  "qa.json",
  "qa-report.md",
  "jd-extract.json",
  "selection.json",
  "outline.json",
];

/**
 * @param {string} message
 * @param {number} statusCode
 * @param {string} [code]
 */
function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/** @param {unknown} runId */
export function isValidRunId(runId) {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId) && !runId.includes("..");
}

/** @param {unknown} doc @returns {doc is HistoryDoc} */
export function isHistoryDoc(doc) {
  return doc === "resume" || doc === "cover_letter";
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function readText(path) {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The run folder for a run id, proven to sit inside <app>/runs/.
 * @param {string} appDir
 * @param {string} runId
 */
export async function resolveRunDir(appDir, runId) {
  if (!isValidRunId(runId)) throw httpError("Invalid run id", 400, "invalid_run_id");
  const runsRoot = join(appDir, RUNS_DIR);
  const dir = join(runsRoot, runId);
  if (!existsSync(dir)) throw httpError("Run not found", 404, "run_not_found");
  let real;
  try {
    real = await realpath(dir);
  } catch {
    throw httpError("Run not found", 404, "run_not_found");
  }
  const realRoot = await realpath(runsRoot);
  if (!realRoot.startsWith(appDir + sep)) throw httpError("Path escape detected", 400);
  if (!real.startsWith(realRoot + sep)) throw httpError("Path escape detected", 400);
  const st = await stat(real);
  if (!st.isDirectory()) throw httpError("Run not found", 404, "run_not_found");
  return real;
}

/** @param {Record<string, unknown> | null} qa */
export function verdictOf(qa) {
  const view = readQaVerdict(qa);
  return view ? { disposition: view.disposition, state: view.state, reason: view.reasons[0]?.text || "", failedChecks: verdictSnapshot(view)?.failedCheckIds || [], checks: view.checks.filter((/** @type {any} */ c) => ["fail", "review"].includes(c.status)).map((/** @type {any} */ c) => ({ id: c.id, kind: c.kind, status: c.status, label: c.label })), ...(view.legacy ? { legacy: view.legacy } : {}) } : null;
}

/**
 * Which documents a run produced: its feature, confirmed by the files.
 * @param {string} runDir
 * @returns {HistoryDoc[]}
 */
function docsInRun(runDir) {
  return /** @type {HistoryDoc[]} */ (["resume", "cover_letter"]).filter((doc) => {
    const files = DOC_FILES[doc];
    return existsSync(join(runDir, files.txt)) || existsSync(join(runDir, files.html));
  });
}

/**
 * The comparison key for "is this the version the dashboard serves": the
 * HTML (it differs per template family, where the ATS twin does not) plus
 * the text twin.
 * @param {string} dir
 * @param {HistoryDoc} doc
 */
async function docFingerprint(dir, doc) {
  const files = DOC_FILES[doc];
  const html = await readText(join(dir, files.html));
  const txt = await readText(join(dir, files.txt));
  if (html == null && txt == null) return null;
  return `html:${html ?? ""}\u0000txt:${txt ?? ""}`;
}

/**
 * @typedef {object} RunSummary
 * @property {string} runId
 * @property {string} date ISO finishedAt (else requestedAt, else folder mtime)
 * @property {string} feature
 * @property {string} template family id, "" when unknown
 * @property {string} source "request" | "preference" | "regenerate" | …
 * @property {string} [regeneratedFrom]
 * @property {Record<string, unknown>} [repair]
 * @property {HistoryDoc[]} documents
 * @property {Partial<Record<HistoryDoc, { disposition: string | null, state: string, reason: string, failedChecks: string[], checks: Array<{id:string,kind:string,status:string,label:string}>, legacy?: string }>>} verdicts
 * @property {"run"|"pass"} kind
 * @property {string} [parentRunId]
 * @property {string} [label]
 * @property {{reason:string}|null} held
 * @property {boolean} isDefault
 * @property {Partial<Record<HistoryDoc, Record<string,string>>>} files
 * @property {HistoryDoc[]} active documents whose served copy is this run's
 */

/**
 * @param {string} slug
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ slug: string, runs: RunSummary[] }>}
 */
export async function listRuns(slug, { root } = {}) {
  const appDir = await resolveApplicationDir(slug, { root });
  const runsRoot = join(appDir, RUNS_DIR);
  if (!existsSync(runsRoot)) return { slug, runs: [] };
  /** @type {string[]} */
  let names = [];
  try {
    names = (await readdir(runsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && isValidRunId(d.name))
      .map((d) => d.name);
  } catch {
    names = [];
  }
  /** @type {Partial<Record<HistoryDoc, string | null>>} */
  const served = {};
  for (const doc of /** @type {HistoryDoc[]} */ (["resume", "cover_letter"])) {
    served[doc] = await docFingerprint(appDir, doc);
  }
  /** @type {RunSummary[]} */
  const runs = [];
  for (const runId of names) {
    const runDir = join(runsRoot, runId);
    const run = await readJson(join(runDir, "run.json"));
    let date = "";
    if (run && typeof run.finishedAt === "string") date = run.finishedAt;
    else if (run && typeof run.requestedAt === "string") date = run.requestedAt;
    else {
      try {
        date = (await stat(runDir)).mtime.toISOString();
      } catch {
        date = "";
      }
    }
    const template = run && run.template && typeof run.template === "object"
      ? /** @type {Record<string, unknown>} */ (run.template)
      : null;
    const documents = docsInRun(runDir);
    /** @type {RunSummary["verdicts"]} */
    const verdicts = {};
    /** @type {HistoryDoc[]} */
    const active = [];
    for (const doc of documents) {
      const verdict = verdictOf(await readJson(join(runDir, DOC_FILES[doc].qa)));
      if (verdict) verdicts[doc] = verdict;
      const print = await docFingerprint(runDir, doc);
      if (run?.kind !== "pass" && print != null && print === served[doc]) active.push(doc);
    }
    /** @type {RunSummary} */
    const summary = {
      runId, kind: run?.kind === "pass" ? "pass" : "run", held: null, isDefault: false, files: {},
      date,
      feature: run && typeof run.feature === "string" ? run.feature : documents.length === 2 ? "both" : documents[0] || "",
      template: template && typeof template.family === "string" ? template.family : "",
      source: template && typeof template.source === "string" ? template.source : "",
      documents,
      verdicts,
      active,
    };
    if (typeof run?.parentRunId === "string") summary.parentRunId = run.parentRunId;
    if (typeof run?.label === "string") summary.label = run.label;
    const fail = Object.values(verdicts).find(v => v.disposition === "FAIL");
    summary.held = fail ? { reason: fail.reason || "Document fails checks" } : null;
    for (const doc of documents) {
      const hrefs = {};
      for (const ext of ["pdf", "html", "txt"]) {
        const filename = DOC_FILES[doc][/** @type {"pdf"|"html"|"txt"} */ (ext)];
        if (existsSync(join(runDir, filename))) /** @type {Record<string,string>} */ (hrefs)[ext] = `/api/applications/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/files/${filename}`;
      }
      summary.files[doc] = hrefs;
    }
    if (template && typeof template.regeneratedFrom === "string") summary.regeneratedFrom = template.regeneratedFrom;
    if (run && run.repair && typeof run.repair === "object") summary.repair = /** @type {Record<string, unknown>} */ (run.repair);
    runs.push(summary);
  }
  runs.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.runId.localeCompare(a.runId));
  /* Two runs can hold identical files; only one is "in use": the run the
   * manifest names when it is among them, else the newest. */
  const manifest = await readJson(join(appDir, "manifest.json"));
  const manifestRun = manifest && typeof manifest.runId === "string" ? manifest.runId : "";
  for (const doc of /** @type {HistoryDoc[]} */ (["resume", "cover_letter"])) {
    const holders = runs.filter((r) => r.active.includes(doc));
    if (holders.length < 2) continue;
    const keep = holders.find((r) => r.runId === manifestRun) || holders[0];
    for (const run of holders) if (run !== keep) run.active = run.active.filter((d) => d !== doc);
  }
  const defaultRun = runs.find(r => r.kind !== "pass" && r.runId === manifestRun && !r.held) || runs.find(r => r.kind !== "pass" && r.active.length && !r.held);
  if (defaultRun) defaultRun.isDefault = true;
  return { slug, runs: runs.slice(0, MAX_RUNS) };
}

/**
 * Copy a run's package back to the top level. Only the documents the run
 * produced are replaced; the other document keeps whatever version it has.
 * Refuses while a draft is in flight for this role (409 draft_in_flight).
 *
 * @param {string} slug
 * @param {string} runId
 * @param {{ root?: string, now?: () => Date }} [options]
 */
export async function promoteRun(slug, runId, { root, now = () => new Date() } = {}) {
  const appDir = await resolveApplicationDir(slug, { root });
  const runDir = await resolveRunDir(appDir, runId);
  const names = [...new Set([...Object.values(DOC_FILES).flatMap(files => Object.values(files)), ...RUN_LEVEL_FILES, "judge-context.resume.json", "judge-context.letter.json", "writer-sources.json", "draft.json", "manifest.json", "pending.json"])];
  // Reject an unsafe source or destination before replacing any published file.
  for (const dir of [runDir, appDir]) for (const name of names) await resolveContainedFile(dir, name, { optional: true });
  const sourcePath = (/** @type {string} */ name) => resolveContainedFile(runDir, name, { optional: true });
  const destinationPath = (/** @type {string} */ name) => resolveContainedFile(appDir, name, { optional: true });
  const pending = await readJson(await destinationPath("pending.json"));
  const phase = pending && pending.progress && typeof pending.progress === "object"
    ? String(/** @type {Record<string, unknown>} */ (pending.progress).phase || "")
    : "";
  if (pending && !/^(failed|complete|done)$/i.test(phase)) {
    throw httpError("A draft is running for this role. Wait for it to finish, then try again.", 409, "draft_in_flight");
  }
  const storedRun = await readJson(await sourcePath("run.json"));
  if (storedRun?.kind === "pass") throw httpError("Restore a document version through the editor", 409, "pass_not_promotable");
  const documents = docsInRun(runDir);
  if (!documents.length) throw httpError("This version has no documents to restore.", 404, "run_empty");
  /** @type {string[]} */
  const copied = [];
  for (const doc of documents) {
    const files = DOC_FILES[doc];
    for (const name of [files.html, files.pdf, files.txt, files.qa, files.draft]) {
      const source = await sourcePath(name);
      if (!existsSync(source)) continue;
      await copyFile(source, await destinationPath(name));
      copied.push(name);
    }
    const context = `judge-context.${doc === "cover_letter" ? "letter" : "resume"}.json`;
    const source = await sourcePath(context);
    if (existsSync(source)) {
      await copyFile(source, await destinationPath(context)); copied.push(context);
    } else await rm(await destinationPath(context), { force: true });
  }
  const writerSources = await readJson(await sourcePath("writer-sources.json"));
  if (writerSources) {
    const merged = await readJson(await destinationPath("writer-sources.json")) || {};
    let changed = false;
    for (const doc of documents) if (Array.isArray(writerSources[doc])) { merged[doc] = writerSources[doc]; changed = true; }
    if (changed) {
      await writeFile(await destinationPath("writer-sources.json"), `${JSON.stringify(merged, null, 2)}\n`);
      copied.push("writer-sources.json");
    }
  }
  for (const name of RUN_LEVEL_FILES) {
    const source = await sourcePath(name);
    if (!existsSync(source)) continue;
    await copyFile(source, await destinationPath(name));
    copied.push(name);
  }
  if (documents.length === 2 && existsSync(await sourcePath("draft.json"))) {
    await copyFile(await sourcePath("draft.json"), await destinationPath("draft.json"));
    copied.push("draft.json");
  }
  const run = storedRun;
  const manifest = (await readJson(await destinationPath("manifest.json"))) || {};
  /** @type {Record<string, unknown>} */
  const next = { ...manifest, runId, updated_at: now().toISOString(), promotedFrom: runId };
  if (run && run.template && typeof run.template === "object") next.template = run.template;
  await writeFile(await destinationPath("manifest.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { ok: true, slug, runId, documents, copied };
}

/** @param {HistoryDoc} feature @param {Record<string, unknown> | null} draft @returns {draft is Record<string, unknown>} */
export function usableDraft(feature, draft) {
  if (!draft) return false;
  const hasText = (/** @type {unknown} */ value) => typeof value === "string" && Boolean(value.trim());
  const partHasText = (/** @type {unknown} */ value) => hasText(value)
    || Boolean(value && typeof value === "object" && hasText(/** @type {{ text?: unknown }} */ (value).text));
  if (feature === "resume") {
    return hasText(draft.statement)
      || (Array.isArray(draft.bullets) && draft.bullets.some(partHasText));
  }
  const letter = draft.letter && typeof draft.letter === "object"
    ? /** @type {Record<string, unknown>} */ (draft.letter) : {};
  const beats = ["hook", "companyInsight", "proof1", "proof2", "ask", "thesis", "whyThem", "whyMe", "whyNow", "closing", "nextStep"];
  const paragraphs = Array.isArray(draft.paragraphs) ? draft.paragraphs : letter.paragraphs;
  return beats.some((key) => hasText(letter[key]))
    || (Array.isArray(paragraphs) && paragraphs.some(partHasText));
}

/** @param {string} appDir @param {HistoryDoc} feature */
async function newestFeatureRunId(appDir, feature) {
  const runsRoot = join(appDir, RUNS_DIR);
  if (!existsSync(runsRoot)) return undefined;
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  /** @type {{ runId: string, date: string } | undefined} */
  let newest;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidRunId(entry.name)) continue;
    const dir = join(runsRoot, entry.name);
    const run = await readJson(join(dir, "run.json"));
    if (!run || run.kind === "pass" || (run.feature !== feature && run.feature !== "both")) continue;
    let date = typeof run.finishedAt === "string" ? run.finishedAt
      : typeof run.requestedAt === "string" ? run.requestedAt : "";
    if (!date) {
      try {
        date = (await stat(dir)).mtime.toISOString();
      } catch {
        continue;
      }
    }
    if (!newest || date > newest.date || (date === newest.date && entry.name > newest.runId)) {
      newest = { runId: entry.name, date };
    }
  }
  return newest?.runId;
}

/**
 * Load one immutable document source. The newest run of this feature wins
 * even when its file is missing; an older draft cannot silently replace it.
 * @param {string} slug
 * @param {HistoryDoc} feature
 * @param {string | undefined} parentRunId
 * @param {{ root?: string }} [options]
 */
export async function loadRepairSource(slug, feature, parentRunId, { root } = {}) {
  if (!isHistoryDoc(feature)) throw httpError("feature must be resume or cover_letter", 400, "invalid_doc");
  const appDir = await resolveApplicationDir(slug, { root });
  const selected = parentRunId || await newestFeatureRunId(appDir, feature);
  if (!selected) throw httpError("No run of this document is available to repair.", 409, "repair_source_missing");
  const runDir = await resolveRunDir(appDir, selected);
  const run = await readJson(join(runDir, "run.json"));
  const files = DOC_FILES[feature];
  const sourceDraft = await readJson(join(runDir, files.draft));
  const sourceText = await readText(join(runDir, files.txt));
  if (!run || (run.feature !== feature && run.feature !== "both") || !usableDraft(feature, sourceDraft) || !sourceText?.trim()) {
    throw httpError("The selected run has no readable document draft.", 409, "repair_source_missing");
  }
  const qa = await readJson(join(runDir, files.qa));
  return { parentRunId: selected, feature, sourceDraft, sourceText, qa };
}

/** @param {string} value */
function normalizedText(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Add the repair result to the child run after the pipeline has saved it.
 * The pipeline owns adoption; this function only records its decision.
 * @param {{ root?: string, slug: string, runId: string, repair: { feature: HistoryDoc, parentRunId: string, sourceText: string, instruction: string, issueIds: string[] }, pipelineResult: Record<string, unknown> }} input
 */
export async function recordRepairOutcome({ root, slug, runId, repair, pipelineResult }) {
  const appDir = await resolveApplicationDir(slug, { root });
  const runDir = await resolveRunDir(appDir, runId);
  const files = DOC_FILES[repair.feature];
  const childText = await readText(join(runDir, files.txt));
  const run = await readJson(join(runDir, "run.json"));
  if (childText == null || !run) throw httpError("The repair run has no saved document.", 500, "repair_result_missing");
  const pipelineRepair = pipelineResult.repair && typeof pipelineResult.repair === "object"
    ? /** @type {Record<string, unknown>} */ (pipelineResult.repair)
    : {};
  const savedRepair = run.repair && typeof run.repair === "object"
    ? /** @type {Record<string, unknown>} */ (run.repair)
    : {};
  const adopted = typeof pipelineRepair.adopted === "boolean" ? pipelineRepair.adopted
    : typeof savedRepair.adopted === "boolean" ? savedRepair.adopted
      : pipelineResult.outcome === "published";
  const result = {
    parentRunId: repair.parentRunId,
    instruction: repair.instruction,
    issueIds: repair.issueIds,
    changed: normalizedText(childText) !== normalizedText(repair.sourceText),
    adopted,
    before: savedRepair.before || pipelineRepair.before || verdictSnapshot({ ...await readJson(join(appDir, RUNS_DIR, repair.parentRunId, files.qa)), runId: repair.parentRunId }),
    reason: String(pipelineRepair.reason || savedRepair.reason || (adopted ? "candidate adopted" : "candidate retained for review")),
  };
  await writeFile(join(runDir, "run.json"), `${JSON.stringify({ ...run, repair: result }, null, 2)}\n`, "utf8");
  const served = await readJson(join(appDir, "run.json"));
  if (served && served.runId === runId) {
    await writeFile(join(appDir, "run.json"), `${JSON.stringify({ ...served, repair: result }, null, 2)}\n`, "utf8");
  }
  return result;
}

/**
 * Line diff (longest common subsequence) of two texts.
 * @param {string} a
 * @param {string} b
 * @returns {{ op: "same" | "add" | "del", text: string }[]}
 */
export function diffLines(a, b) {
  const left = String(a || "").replace(/\r\n/g, "\n").split("\n").slice(0, MAX_DIFF_LINES);
  const right = String(b || "").replace(/\r\n/g, "\n").split("\n").slice(0, MAX_DIFF_LINES);
  if (left.length && left[left.length - 1] === "") left.pop();
  if (right.length && right[right.length - 1] === "") right.pop();
  const n = left.length;
  const m = right.length;
  /* lcs[i][j] = LCS length of left[i..] and right[j..]. */
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  /** @type {{ op: "same" | "add" | "del", text: string }[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ op: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "del", text: left[i] });
      i += 1;
    } else {
      out.push({ op: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ op: "del", text: left[i++] });
  while (j < m) out.push({ op: "add", text: right[j++] });
  return out;
}

/**
 * @param {string} slug
 * @param {string} a older run id (the "from" side)
 * @param {string} b newer run id (the "to" side)
 * @param {string} doc "resume" | "cover_letter"
 * @param {{ root?: string }} [options]
 */
export async function diffRuns(slug, a, b, doc, { root } = {}) {
  if (!isHistoryDoc(doc)) throw httpError("doc must be resume or cover_letter", 400, "invalid_doc");
  const appDir = await resolveApplicationDir(slug, { root });
  const dirA = await resolveRunDir(appDir, a);
  const dirB = await resolveRunDir(appDir, b);
  const name = DOC_FILES[doc].txt;
  const textA = await readText(join(dirA, name));
  const textB = await readText(join(dirB, name));
  if (textA == null || textB == null) {
    throw httpError(`Both versions need a ${name} to compare.`, 404, "text_missing");
  }
  const lines = diffLines(textA, textB);
  return {
    slug,
    doc,
    a,
    b,
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "del").length,
    lines,
  };
}
