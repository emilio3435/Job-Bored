/**
 * In-process materials FIFO: JD resolve → ledger → the v3 stage runner.
 * One draft at a time. Does not talk to Hermes or Telegram.
 */

import { jdEvidence } from "./materials-jd-extract.mjs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { resolveJobDescription, isUsableJobDescription } from "./materials-jd-gate.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { getBrandLogosTemplateRoot, loadEmployerMarks, loadTargetMark, readResolvedMarks, targetSlug } from "./brand-logos.mjs";
import { geminiGroundedSearch, intelRootDir } from "./materials-intel.mjs";
import { newRunId } from "./materials-package.mjs";
import { runPipeline } from "./materials-pipeline.mjs";
import { recordRepairOutcome } from "./materials-history.mjs";
import { resolveRunFamily } from "./materials-templates.mjs";
import { ensureLedger, LEDGER_BUILDER_VERSION } from "./materials-ledger-build.mjs";
import {
  chooseResumeSource,
  normalizeResumeSource,
  resumeProvenance,
  resumeRequiredError,
  writeResumeSnapshot,
} from "./materials-resume-source.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";
import { readProfile, resolveProfilePath } from "./user-profile.mjs";

/* Keep the selected source whole until ensureLedger can refuse its length.
 * The shared upload/snapshot normalizer still has a legacy input cap. */
/** @param {unknown} raw */
function normalizeDraftResume(raw) {
  const resume = normalizeResumeSource(raw);
  if (!resume) return null;
  const text = /** @type {{ text: string }} */ (raw).text.replace(/\r/g, "").trim();
  return { ...resume, text };
}

async function readDraftCanonicalResume() {
  try {
    const path = join(dirname(resolveProfilePath()), "resume.txt");
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return normalizeDraftResume({ source: "saved", filename: "resume.txt", addedAt: info.mtime.toISOString(), text });
  } catch { return null; }
}

/** @param {Record<string, any>} ledger @param {Record<string, any> | null} result @param {string} resumeText @param {unknown} pin */
function draftIngestFailure(ledger, result, resumeText, pin) {
  const ingest = ledger.ingest || {};
  const missingEmployers = Array.isArray(ingest.missingEmployers) && ingest.missingEmployers.length
    ? ingest.missingEmployers : result?.missingEmployers || [];
  if (ingest.code === "resume_too_long") return { code: "resume_too_long", message: "Your résumé is too long to read in one pass. Upload a résumé of 60,000 characters or fewer, then try again." };
  if (ingest.code === "stale_ledger") return { code: "stale_ledger", message: "The saved résumé read is stale. Connect an AI provider to read it again, then retry." };
  if (ingest.status === "needs_model" || result?.status === "needs_model" || ingest.code === "ingest_needs_model" ||
      !ledger.sources?.some((/** @type {any} */ source) => source.kind === "resume") && (ledger.claims?.length || ledger.note === "profile:only" || String(ledger.note || "").startsWith("ingest:failed"))) {
    return { code: "ingest_needs_model", message: "Connect an AI provider so JobBored can read your résumé." };
  }
  if (ingest.status === "failed" || result?.status === "failed" || !result) {
    const provider = String(result?.model?.provider || /** @type {any} */ (pin)?.provider || "configured AI provider");
    return { code: "ingest_failed", message: `JobBored couldn't read your résumé with ${provider}. Check the provider setting, then try again.` };
  }
  const largeLoss = (result.notes || []).filter((/** @type {any} */ note) => note.reason === "bullet_lines_set_aside");
  if (ingest.status === "ready_with_review" || result.status === "ready_with_review" || missingEmployers.length || largeLoss.length) {
    const readCount = Array.isArray(result.employers) ? result.employers.length : ledger.employers?.length || 0;
    const names = missingEmployers.map((/** @type {any} */ item) => String(item.displayName || item.aliasKey));
    const detail = names.length ? `JobBored read ${readCount} of ${readCount + names.length} employers from your résumé and won't draft without the rest: ${names.join(", ")}.`
      : largeLoss.length ? `JobBored couldn't read enough bullet lines under ${largeLoss.map((/** @type {any} */ note) => note.employer || "an employer").join(", ")}.`
        : "JobBored couldn't finish reading all employers and roles from your résumé and won't draft without the rest.";
    return { code: "ingest_incomplete", message: `${detail} Try again, or re-upload the résumé.`, missingEmployers };
  }
  const textSha256 = createHash("sha256").update(resumeText).digest("hex");
  const resumeSource = ledger.sources?.find((/** @type {any} */ source) => source.kind === "resume");
  if (ingest.status !== "ready" || result.status !== "ready" || ledger.ingestSchema !== "ingest/1" ||
      ledger.builderVersion !== LEDGER_BUILDER_VERSION || ledger.structureKind !== "model" ||
      ingest.textSha256 !== textSha256 || result.textSha256 !== textSha256 ||
      resumeSource?.hash !== `sha256:${textSha256}`) {
    return { code: "stale_ledger", message: "The saved résumé read doesn't match your full résumé. Read it again with an AI provider, then retry." };
  }
  return null;
}

/** Counts and names only: never copy source excerpts into a draft notice.
 * @param {Record<string, any>} result */
function draftIngestReview(result) {
  const employers = [...(result.employers || [])].sort((a, b) => a.lines[0] - b.lines[0]);
  const items = [...(result.couldntPlace || []).map((/** @type {any} */ item) => ({ ...item, reviewKind: "couldntPlace" })),
    ...(result.review?.claims || []).map((/** @type {any} */ item) => ({ ...item, reviewKind: item.kind }))];
  /** @type {Record<string, number>} */ const countsByKind = {};
  const names = new Set();
  for (const item of items) {
    countsByKind[item.reviewKind] = (countsByKind[item.reviewKind] || 0) + 1;
    const number = item.lines?.[0];
    const employer = employers.find((entry, index) => number >= entry.lines[0] && number < (employers[index + 1]?.lines[0] || Infinity));
    if (employer) names.add(employer.name);
  }
  const displayNames = [...names];
  return { count: items.length, countsByKind, employers: displayNames,
    ...(items.length ? { notice: `${items.length} résumé ${items.length === 1 ? "item" : "items"} set aside or needing placement review${displayNames.length ? ` under ${displayNames.join(", ")}` : ""} — review in Settings.` } : {}),
  };
}

/** @param {string} dir @param {Record<string, any>} pipelineResult @param {ReturnType<typeof draftIngestReview>} review */
async function recordDraftIngestReview(dir, pipelineResult, review) {
  pipelineResult.ingestReview = review;
  if (pipelineResult.outcome === "cached") return;
  const paths = [];
  if (pipelineResult.adopted !== false) paths.push(dir);
  if (typeof pipelineResult.runId === "string" && /^[A-Za-z0-9._-]+$/u.test(pipelineResult.runId) && ![".", ".."].includes(pipelineResult.runId)) paths.push(join(dir, "runs", pipelineResult.runId));
  for (const base of paths) for (const filename of ["manifest.json"]) {
    const path = join(base, filename);
    let record;
    try { record = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") continue; throw error; }
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ ...record, ingestReview: review }, null, 2)}\n`, "utf8");
    await rename(temp, path);
  }
}

/* A materials pipeline writes up to two documents and judges each serially,
 * across at most two passes (write, then one automatic repair): four judge
 * calls of JUDGE_TIMEOUT_MS (240 s) is 960 s, and the write and repair stages
 * need room on top. */
export const MATERIALS_DRAFT_DEADLINE_MS = 1_500_000;

/* F14: a non-terminal pending with no heartbeat for this long belongs to
 * a dead process (the live drafter heartbeats every minute). */
const ORPHANED_PENDING_MS = 5 * 60 * 1000;
const NON_TERMINAL_PHASES = new Set(["queued", "drafting"]);

/**
 * F14: at boot, the in-process FIFO is empty but pre-restart pending.json
 * files still say queued/drafting. Mark the orphaned ones failed with a
 * retry prompt instead of leaving eternal spinners. Fresh pending (under
 * ORPHANED_PENDING_MS) is left alone — it may belong to another live
 * server sharing the root.
 * @param {{ applicationsRoot?: string, nowMs?: number, orphanMs?: number }} [options]
 * @returns {Promise<{ scanned: number, reconciled: number }>}
 */
export async function reconcileOrphanedPending(options = {}) {
  const root =
    typeof options.applicationsRoot === "string" && options.applicationsRoot
      ? options.applicationsRoot
      : getApplicationsRoot();
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();
  const orphanMs = typeof options.orphanMs === "number" ? options.orphanMs : ORPHANED_PENDING_MS;
  let names;
  try {
    names = await readdir(root);
  } catch {
    return { scanned: 0, reconciled: 0 };
  }
  let scanned = 0;
  let reconciled = 0;
  const finishedAt = new Date(nowMs).toISOString();
  for (const name of names) {
    const pendingPath = join(root, name, "pending.json");
    let raw;
    try {
      raw = await readFile(pendingPath, "utf8");
    } catch {
      continue;
    }
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      continue;
    }
    scanned += 1;
    const progress = record && record.progress && typeof record.progress === "object"
      ? record.progress
      : null;
    if (!progress || !NON_TERMINAL_PHASES.has(String(progress.phase || ""))) continue;
    const heartbeat = Date.parse(String(progress.updated_at || progress.updatedAt || ""));
    if (Number.isFinite(heartbeat) && nowMs - heartbeat <= orphanMs) continue;
    const started = typeof progress.started_at === "string" ? progress.started_at : "";
    await writeFile(
      pendingPath,
      `${JSON.stringify(
        {
          ...record,
          progress: {
            phase: "failed",
            message: "Drafting stopped when the server restarted. Try again.",
            code: "materials_interrupted",
            started_at: started,
            updated_at: finishedAt,
            attempt: typeof progress.attempt === "number" ? progress.attempt : 1,
            elapsed_seconds: elapsedSeconds(started || finishedAt, finishedAt),
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    reconciled += 1;
  }
  return { scanned, reconciled };
}
/**
 * @typedef {object} MaterialsRequestPayload
 * @property {string} slug
 * @property {string} company
 * @property {string} title
 * @property {string} feature
 * @property {string} jobUrl
 * @property {string} notes
 * @property {string} [jobDescription]
 * @property {string} [jdText]
 * @property {import("./materials-resume-source.mjs").ResumeSource | null} [resume]
 *   The user's own resume — the only source of facts. enqueue() refuses
 *   (422 resume_required) without it.
 * @property {import("./materials-resume-source.mjs").ResumeChoice} [resumeChoice]
 *   which resume the draft uses and why (set by enqueue, recorded in run.json)
 * @property {"snapshot"} [resumeFrom] F8: a repair re-enters at the draft
 *   stage with the stored draft JSON plus notes as editor instructions
 * @property {{ feature: "resume" | "cover_letter", instruction: string, issues: Record<string, unknown>[], issueIds: string[], parentRunId: string, sourceText: string, sourceDraft: Record<string, unknown>, requestId?: string }} [repair]
 * @property {string} [template] a registry family named by this request
 * @property {string} [preferredTemplate] the user's saved materialsTemplate
 * @property {"cover_letter"} [then] U-5: the document to queue
 *   as its own run once this one finishes ("Draft both")
 * @property {string[]} [thenExtras] extras for that follow-up run
 * @property {string[]} [extras] Wave 3 extras for this run ("outreach")
 */

/**
 * @typedef {object} PendingProgress
 * @property {string} phase
 * @property {string} message
 * @property {string} [code] neutral failure code (F13); never raw internals
 * @property {string} started_at
 * @property {string} updated_at
 * @property {number} attempt
 * @property {number} elapsed_seconds
 * @property {Array<{ stage: string, status: string, reason?: string }>} [stages]
 *   U-4: every finished pipeline stage, in order
 */

/**
 * @typedef {object} PendingRecord
 * @property {string} slug
 * @property {string} company
 * @property {string} title
 * @property {string} feature
 * @property {string} job_url
 * @property {string} notes
 * @property {string} requested_at
 * @property {string} source
 * @property {string} [next] U-5: the document queued after this one
 * @property {PendingProgress} progress
 * @property {{ source: string, filename: string, addedAt: string, choice?: { used: string, reason: string, message?: string } }} [resume] provenance, no text
 * @property {{ llm?: { provider: string, requestedModel: string, resolvedModel: string } }} [debug]
 */

/**
 * @typedef {object} CriticIssue
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [severity]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} pin */
function pinIsConfigured(pin) {
  if (!isPlainObject(pin)) return false;
  const provider = String(pin.provider || "").trim().toLowerCase();
  if (provider === "webhook" || provider === "local" || provider === "openai_compatible") {
    return typeof pin.baseUrl === "string" && pin.baseUrl.trim().length > 0;
  }
  return typeof pin.apiKey === "string" && pin.apiKey.trim().length > 0;
}

/**
 * IndexedDB writing samples stay in the browser; a server bridge is follow-up.
 * On-disk `~/.jobbored` profile extras (if present) plus payload.notes are
 * the cheap voice signal available to the writer in this wave.
 *
 * @param {MaterialsRequestPayload} payload
 * @returns {Promise<string[]>}
 */
async function collectVoiceSamples(payload) {
  /** @type {string[]} */
  const samples = [];
  try {
    const result = await readProfile();
    if (result.ok && isPlainObject(result.profile)) {
      const extra = result.profile.writingSamples || result.profile.writingSampleExcerpts;
      if (Array.isArray(extra)) {
        for (const item of extra) {
          if (typeof item === "string" && item.trim()) samples.push(item);
        }
      }
    }
  } catch {
    // no on-disk profile
  }
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  if (notes) samples.push(notes);
  return samples;
}

/**
 * @param {string} phase
 * @param {unknown} feature
 */
function defaultProgressMessage(phase, feature) {
  const f = String(feature || "");
  const label =
    f === "resume"
      ? "resume"
      : f === "cover_letter"
        ? "cover letter"
        : f === "both"
          ? "cover letter and tailoring your resume"
          : "materials";
  if (phase === "drafting") {
    return f === "both"
      ? "Writing your cover letter and tailoring your resume…"
      : `Writing your ${label}…`;
  }
  if (phase === "queued") {
    return f === "both"
      ? "Your resume and cover letter are in line. We draft one role at a time and will start this next."
      : `Your ${label} is in line. We draft one role at a time and will start this next.`;
  }
  if (phase === "failed") return "Draft failed before any files were produced.";
  return "";
}

/* Wave 2 U-4: what the user reads while a stage runs. onStage fires as
 * each pipeline stage finishes, so the sentence names the step that comes
 * next. Raw stage ids ("claims.select: running") never reach the message;
 * the ids travel structured in progress.stages for the dashboard timeline. */
/** @type {Record<string, string>} */
const NEXT_STEP_WORDS = {
  intake: "Reading the job…",
  "jd.resolve": "Reading the job…",
  "jd.gate": "Loading your facts…",
  "claims.load": "Loading your facts…",
  "cache.lookup": "Reading the job…",
  "jd.extract": "Picking the facts that fit this job…",
  "claims.score": "Picking the facts that fit this job…",
  "claims.select": "Picking the facts that fit this job…",
  outline: "Writing your {doc}…",
  draft: "Checking the facts…",
  support: "Tidying the wording…",
  delint: "Checking the facts…",
  "tag-metrics": "Rendering the PDF…",
  fit: "Rendering the PDF…",
  prepare: "Writing your {doc}…",
  write: "Checking the facts…",
  validate: "Rendering the PDF…",
  render: "Checking quality…",
  judge: "Finishing up…",
  save: "Finishing up…",
  repair: "Checking the revision…",
  qa: "Checking quality…",
  publish: "Finishing up…",
};

/**
 * @param {string} stage the stage that just finished
 * @param {unknown} feature
 */
export function stageProgressMessage(stage, feature) {
  const f = String(feature || "");
  const doc = f === "resume" ? "resume" : f === "cover_letter" ? "cover letter" : "resume and cover letter";
  return (NEXT_STEP_WORDS[stage] || `Writing your ${doc}…`).replace("{doc}", doc);
}

/* Why a stage finished below "ok", in words. The model stages' own reason
 * (e.g. "output cut off at 4096 tokens") comes from the files the pipeline
 * wrote; the dashboard turns it into plain words. */
/** @type {Record<string, string>} */
const STAGE_REVIEW_REASONS = {
  "jd.extract": "fell back to rules",
  "claims.select": "the AI's picks couldn't be used",
  draft: "the AI's draft couldn't be used, so your own lines were kept",
  support: "some sentences could not be matched to your facts",
  delint: "a few phrases still read like boilerplate",
  "tag-metrics": "some numbers could not be traced to your facts",
  render: "the PDF could not be rendered",
  qa: "needs your review",
};

/**
 * @param {string} dir
 * @param {string} stage
 * @param {string} status
 * @returns {Promise<string>}
 */
async function stageReason(dir, stage, status) {
  if (status === "ok" || status === "skipped") return "";
  if (stage === "qa" && status === "failed") return "failed its quality check";
  if (stage === "jd.extract") {
    try {
      const extract = JSON.parse(await readFile(join(dir, "jd-extract.json"), "utf8"));
      const reason = extract && extract.degraded && typeof extract.degraded.reason === "string" ? extract.degraded.reason : "";
      if (reason) return `fell back to rules: ${reason}`;
    } catch {
      /* the generic reason below */
    }
  }
  return STAGE_REVIEW_REASONS[stage] || "fell back";
}

/**
 * @param {unknown} stamp
 * @param {unknown} nowIso
 */
function elapsedSeconds(stamp, nowIso) {
  const start = Date.parse(String(stamp || ""));
  const end = Date.parse(String(nowIso || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * @param {object} args
 * @param {string} args.status
 * @param {CriticIssue[]} [args.issues]
 * @param {string[]} [args.notes]
 */
export function formatQaReport({ status, issues = [], notes = [] }) {
  const lines = ["# QA report", "", `Status: ${status}`];
  if (notes.length) {
    lines.push("", ...notes);
  }
  lines.push("", "## Issues");
  if (!issues.length) {
    lines.push("", "None.");
  } else {
    lines.push("");
    for (const issue of issues) {
      const code = issue && issue.code ? issue.code : "unknown";
      const severity = issue && issue.severity ? ` (${issue.severity})` : "";
      const message = issue && issue.message ? issue.message : "";
      lines.push(`- \`${code}\`${severity}: ${message}`.trimEnd());
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** @param {string} raw */
function stripJdComments(raw) {
  return String(raw || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

/**
 * @param {string} dir
 * @param {string} text
 * @param {{ source?: string, jobUrl?: string, nowIso?: string }} [meta]
 */
async function writeJdFile(dir, text, meta = {}) {
  const body = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!body) return;
  // Do not poison the cache with fit-score blurbs or too-short text.
  if (!isUsableJobDescription(body)) return;
  const header = [
    "<!-- job-description.md",
    `source: ${meta.source || "unknown"}`,
    `fetched_at: ${meta.nowIso || new Date().toISOString()}`,
    ...(meta.jobUrl ? [`job_url: ${meta.jobUrl}`] : []),
    "-->",
    "",
  ].join("\n");
  await writeFile(join(dir, "job-description.md"), `${header}${body}\n`, "utf8");
}


/**
 * @typedef {object} DrafterDeps
 * @property {string} [applicationsRoot]
 * @property {() => unknown} [loadPin]
 * @property {(pin: unknown) => unknown} [resolvePin]
 * @property {(url: string) => Promise<{ description?: unknown }>} [scrapeJob]
 * @property {(input: string | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 *   Model-call transport for the pipeline stages (defaults to global fetch).
 * @property {Function} [structureCallStage] test seam for a decoded resume structure reply
 * @property {typeof ensureLedger} [ensureLedger] injected ledger reader for gate contract tests
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [openSession]
 *   Opens the headless browser the pipeline measures fit and prints PDFs
 *   with. Defaults to openPdfSession; null renders unmeasured (tests).
 * @property {() => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [logoLoader]
 *   Resolved brand-logo marks (defaults to readResolvedMarks, read-only).
 * @property {(companies: string[]) => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [employerLogoLoader]
 *   Marks for the resume's employers (defaults to loadEmployerMarks: cache,
 *   then one bounded resolver run per company; never fails the draft).
 * @property {boolean} [intel] Wave 3: false turns the company intel stage off
 * @property {string} [intelRoot] Wave 3: the per-domain intel cache dir ("" = no cache)
 * @property {import("./materials-intel.mjs").IntelSearch} [intelSearch] Wave 3: the grounded search (tests stub it)
 * @property {number} [intelBudgetMs] Wave 3: the intel stage's time budget (default 60 s)
 * @property {(company: string) => Promise<import("./materials-render.mjs").Logo | null>} [targetLogoLoader]
 *   The addressed company's mark (defaults to loadTargetMark: cache, then
 *   one bounded resolver run; null means the renderer draws a monogram).
 * @property {() => Promise<import("./materials-resume-source.mjs").ResumeSource | null>} [readSavedResume]
 *   The user's saved resume (defaults to resume.txt beside profile.json).
 *   A draft uses it over the request's copy when that copy is older or
 *   garbled (chooseResumeSource).
 * @property {() => Date | string | number} [now]
 * @property {number} [heartbeatMs] F14: queued-job heartbeat interval
 *   (default 60s; tests use a shorter one)
 * @property {typeof runPipeline} [pipeline] injected for repair contract tests
 */

/**
 * @param {DrafterDeps} [deps]
 */
export function createMaterialsDrafter(deps = {}) {
  const readLedgerForDraft = deps.ensureLedger || ensureLedger;
  const applicationsRoot =
    typeof deps.applicationsRoot === "string" && deps.applicationsRoot
      ? deps.applicationsRoot
      : getApplicationsRoot();
  const loadPin = typeof deps.loadPin === "function" ? deps.loadPin : () => loadLlmConfig();
  const resolvePin =
    typeof deps.resolvePin === "function"
      ? deps.resolvePin
      : (/** @type {unknown} */ pin) => resolveActivePin(/** @type {import("./llm-config.mjs").LlmConfig} */ (pin));
  const scrapeJob =
    typeof deps.scrapeJob === "function"
      ? deps.scrapeJob
      : (/** @type {string} */ url) => scrapeJobPosting(url);
  const fetchImpl =
    typeof deps.fetchImpl === "function" ? deps.fetchImpl : globalThis.fetch.bind(globalThis);
  const openSession =
    deps.openSession === null
      ? null
      : typeof deps.openSession === "function"
        ? deps.openSession
        : () => openPdfSession();
  const logoLoader =
    typeof deps.logoLoader === "function" ? deps.logoLoader : () => readResolvedMarks();
  const employerLogoLoader =
    typeof deps.employerLogoLoader === "function"
      ? deps.employerLogoLoader
      : (/** @type {string[]} */ companies) => loadEmployerMarks(companies);
  const targetLogoLoader =
    typeof deps.targetLogoLoader === "function"
      ? deps.targetLogoLoader
      : (/** @type {string} */ company) => loadTargetMark(company);
  const now = typeof deps.now === "function" ? deps.now : () => new Date();
  /* Wave 3 intel pack (C-6). The grounded search runs only on the real
   * network path: a test that injects fetchImpl gets a posting-only pack
   * unless it passes intelSearch. The per-domain cache lives under
   * $JOBBORED_HOME/intel; a drafter given its own applicationsRoot (tests)
   * caches nothing unless it names intelRoot. `intel: false` turns the
   * stage off. */
  const intelEnabled = deps.intel !== false;
  const intelCacheRoot =
    typeof deps.intelRoot === "string"
      ? deps.intelRoot
      : typeof deps.applicationsRoot === "string" && deps.applicationsRoot
        ? ""
        : intelRootDir();
  /**
   * @param {import("./materials-writer.mjs").WriterPin | null} pin
   * @returns {import("./materials-intel.mjs").IntelSearch | null}
   */
  const intelSearchFor = (pin) => {
    if (typeof deps.intelSearch === "function") return deps.intelSearch;
    if (typeof deps.fetchImpl === "function" || !pin) return null;
    const provider = String(pin.provider || "gemini").toLowerCase();
    const apiKey = String(pin.apiKey || "");
    const model = String(pin.resolvedModel || pin.model || "");
    if (provider !== "gemini" || !apiKey || !model) return null;
    return geminiGroundedSearch({ apiKey, model, fetchImpl });
  };
  /** @type {import("./materials-intel.mjs").BrandResolver} */
  const intelBrand = async (company) => {
    const mark = await targetLogoLoader(company);
    if (!mark) return { logoPath: "", source: "monogram" };
    const injected = typeof deps.targetLogoLoader === "function";
    return {
      logoPath: injected ? "" : join(getBrandLogosTemplateRoot(), "targets", "assets", `logo-${targetSlug(company)}.png`),
      source: typeof (/** @type {{ source?: unknown }} */ (mark)).source === "string" ? String((/** @type {{ source?: unknown }} */ (mark)).source) : "logo_resolver",
    };
  };
  const readSavedResume =
    typeof deps.readSavedResume === "function" ? deps.readSavedResume : () => readDraftCanonicalResume();
  const pipeline = typeof deps.pipeline === "function" ? deps.pipeline : runPipeline;

  /** @type {Array<{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord }>} */
  const queue = [];
  /** @type {Map<string, { pendingPath: string, record: PendingRecord }>} */
  const inFlight = new Map();
  /** @type {Array<() => void>} */
  const idleWaiters = [];
  let running = false;
  /** @type {{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord } | null} */
  let activeJob = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeatTimer = null;
  const heartbeatMs =
    typeof deps.heartbeatMs === "number" && Number.isFinite(deps.heartbeatMs) && deps.heartbeatMs > 0
      ? deps.heartbeatMs
      : 60_000;

  /* F14: touch every queued (and the active) job's pending heartbeat so a
   * long queue never trips the 30-minute stale rule, and so a restart can
   * tell live pending from orphaned pending. Best-effort; never throws. */
  async function heartbeatOnce() {
    const t = isoNow();
    const jobs = activeJob ? [...queue, activeJob] : [...queue];
    await Promise.all(jobs.map(async (job) => {
      try {
        const progress = job.record && job.record.progress ? job.record.progress : null;
        if (!progress || !NON_TERMINAL_PHASES.has(String(progress.phase || ""))) return;
        const started = typeof progress.started_at === "string" ? progress.started_at : "";
        job.record = {
          ...job.record,
          progress: {
            ...progress,
            updated_at: t,
            elapsed_seconds: elapsedSeconds(started || t, t),
          },
        };
        await writePending(job.pendingPath, job.record);
      } catch {
        // ignore — the next heartbeat or phase write covers it
      }
    }));
    if (queue.length === 0 && !activeJob) stopHeartbeat();
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      void heartbeatOnce();
    }, heartbeatMs);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function isoNow() {
    const value = now();
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(/** @type {string | number} */ (value));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  }

  /**
   * @param {string} path
   * @param {PendingRecord} record
   */
  /* Atomic: write a sibling temp file, then rename over pending.json, so a
   * reader (the dashboard poll, a restart scan) never sees a half-written
   * file while the heartbeat and phase writes race. */
  async function writePending(path, record) {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /**
   * F13: map a failure to a neutral user-facing code + message. Raw model
   * and provider internals stay in the server log, never in pending.json.
   * @param {unknown} err
   * @returns {{ code: string, message: string }}
   */
  function failureFor(err) {
    const error = /** @type {{ name?: unknown, code?: unknown, message?: unknown }} */ (
      err && typeof err === "object" ? err : null
    );
    const name = String(error?.name || "");
    const errCode = String(error?.code || "");
    if (["ingest_incomplete", "ingest_needs_model", "ingest_failed", "stale_ledger", "resume_too_long"].includes(errCode) && typeof error?.message === "string") {
      return { code: errCode, message: error.message };
    }
    /* First-class resumable states keep their own neutral message. */
    if ((errCode === "jd_unusable" || errCode === "ledger_empty" || errCode === "resume_source_review") && typeof error?.message === "string") {
      return { code: errCode, message: error.message };
    }
    if (errCode === "resume_ingest_failed") {
      return {
        code: "resume_ingest_failed",
        message: "The resume could not be interpreted. Check your AI model setting and try again.",
      };
    }
    if (name === "WriterJsonError" || errCode === "writer_json_error") {
      return {
        code: "materials_generation_failed",
        message: "The model returned an unusable draft. Try again.",
      };
    }
    if (
      errCode === "llm_http_error" ||
      errCode === "provider_error" ||
      errCode === "schema_violation" ||
      /HTTP \d{3}|fetch failed|provider|timeout|timed out/i.test(String(error?.message || ""))
    ) {
      return {
        code: "materials_provider_error",
        message: "The AI provider failed. Try again.",
      };
    }
    return {
      code: "materials_failed",
      message: "Draft failed before any files were produced.",
    };
  }

  /**
   * @param {PendingRecord} record
   * @param {string} phase
   * @param {string} [message]
   * @param {string} [code]
   */
  function withPhase(record, phase, message, code) {
    const t = isoNow();
    const started = phase === "drafting"
      ? (record.progress && record.progress.started_at) || t
      : (record.progress && record.progress.started_at) || "";
    return {
      ...record,
      progress: {
        phase,
        message: message || defaultProgressMessage(phase, record.feature),
        ...(code ? { code } : {}),
        started_at: started,
        updated_at: t,
        attempt: (record.progress && record.progress.attempt) || 1,
        elapsed_seconds: elapsedSeconds(started || t, t),
        /* U-4: the finished stages survive every phase change, so a failed
         * run's timeline still shows where it stopped. */
        ...(record.progress && Array.isArray(record.progress.stages) ? { stages: record.progress.stages } : {}),
      },
    };
  }

  function flushIdleWaiters() {
    const waiters = idleWaiters.splice(0);
    for (const wait of waiters) wait();
  }

  function kick() {
    void tick();
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        activeJob = job;
        let finished = false;
        try {
          await runJob(job);
          finished = !(job.record && job.record.progress && job.record.progress.phase === "failed");
        } catch (err) {
          await failJob(job, err);
        } finally {
          activeJob = null;
          inFlight.delete(job.payload.slug);
        }
        /* U-5 "Draft both": the resume finished, so its letter goes in line
         * as its own run with its own verdict. A failed first document stops
         * the chain; its failed card offers Try again. */
        if (finished && job.payload.then) await enqueueFollowUp(job);
      }
    } finally {
      running = false;
      if (queue.length > 0) kick();
      else {
        stopHeartbeat();
        flushIdleWaiters();
      }
    }
  }

  /**
   * @param {{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord }} job
   * @param {unknown} err
   */
  async function failJob(job, err) {
    const failure = failureFor(err);
    // Raw detail stays server-side for debugging; pending.json is UI surface.
    // eslint-disable-next-line no-console
    console.error(`[materials] slug=${job.payload.slug} ${failure.code}:`, /^(?:ingest_|stale_ledger|resume_too_long)/u.test(failure.code) ? { code: failure.code } : err);
    const record = withPhase(job.record, "failed", failure.message, failure.code);
    if (failure.code === "ingest_incomplete") {
      /** @type {any} */ (record).missingEmployers = /** @type {any} */ (err)?.missingEmployers || [];
    }
    job.record = record;
    await writePending(job.pendingPath, record);
  }

  /**
   * @param {{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord }} job
   */
  async function runJob(job) {
    const { payload, pin, dir, pendingPath } = job;
    job.record = withPhase(job.record, "drafting");
    await writePending(pendingPath, job.record);

    // Prefer a usable JD provided in the request payload (pasted by the user in the UI)
    // over anything on disk. This allows a quick success path without requiring a scrape.
    const providedJdRaw =
      (typeof payload.jobDescription === "string" && payload.jobDescription) ||
      (typeof payload.jdText === "string" && payload.jdText) ||
      "";

    let cachedText = "";
    try {
      cachedText = stripJdComments(await readFile(join(dir, "job-description.md"), "utf8"));
    } catch {
      cachedText = "";
    }

    /** @type {{ text: string, source: "cache" | "scrape" | "request" } | { error: "jd_unusable" }} */
    let jd;
    if (isUsableJobDescription(providedJdRaw)) {
      jd = { text: providedJdRaw.trim(), source: "request" };
    } else {
      jd = await resolveJobDescription({
        cachedText,
        jobUrl: payload.jobUrl,
        scrapeJob,
      });
    }
    if ("error" in jd) {
      const jdIssue = {
        code: "jd_unusable",
        message:
          "Cached job description is unusable and scraping the job URL failed. " +
          "Paste the full job posting into the Dossier (not a fit blurb), or replace the aggregator/blocked URL with the employer careers page.",
        severity: "review",
      };
      await writeFile(
        join(dir, "qa-report.md"),
        formatQaReport({ status: "REVIEW", issues: [jdIssue] }),
        "utf8",
      );
      await failJob(job, { code: "jd_unusable", message: jdIssue.message });
      return;
    }

    const jdText = jd.text;

    /* Slice 6: a missing pin degrades to a deterministic REVIEW package —
     * it no longer 409s. The dossier renders the llm_unconfigured note. */
    /** @type {import("./materials-writer.mjs").WriterPin | null} */
    let resolved = null;
    try {
      const early = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (pin || {}));
      /** @type {any} */ (job.record).debug = {
        ...(/** @type {any} */ (job.record).debug),
        llm: {
          provider: String(early.provider || ""),
          requestedModel: String(early.model || ""),
          resolvedModel: "",
        },
      };
      resolved = pinIsConfigured(pin)
        ? /** @type {import("./materials-writer.mjs").WriterPin} */ (await resolvePin(pin))
        : null;
    } catch (err) {
      await failJob(job, err);
      return;
    }
    try {
      const pinRecord = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (pin || {}));
      const resolvedRecord = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (resolved || {}));
      const pinProvider = String(pinRecord.provider || "");
      const requestedModel = String(pinRecord.model || "");
      const resolvedModel = String(resolvedRecord.resolvedModel || "");
      // Console log for live verification. No secrets are logged.
      // eslint-disable-next-line no-console
      console.log(
        `[materials] slug=${payload.slug} provider=${String(resolvedRecord.provider || pinProvider || "none")} requested_model=${requestedModel} resolved_model=${resolvedModel || "none"}`,
      );
      // Include a small debug field in pending.json without changing the UI message.
      /** @type {any} */ (job.record).debug = {
        ...(/** @type {any} */ (job.record).debug),
        llm: {
          provider: String(resolvedRecord.provider || pinProvider),
          requestedModel,
          resolvedModel,
        },
      };
      await writePending(pendingPath, job.record);
    } catch {
      // Best-effort only — never fail the draft if logging cannot be written.
    }
    const resumeSource = normalizeDraftResume(payload.resume);
    if (!resumeSource) throw resumeRequiredError();
    const resumeText = resumeSource.text;

    /* The claim ledger: the saved profile plus this request's resume
     * snapshot. No facts, no draft — ledger_empty names the fix. */
    let profile = null;
    try {
      const read = await readProfile();
      if (read.ok) profile = read.profile;
    } catch {
      profile = null;
    }
    let ledger;
    try {
      ledger = await readLedgerForDraft({ profile, resumeText, resumeSource: resumeSource.source, pin: resolved, fetchImpl, callStage: deps.structureCallStage });
    } catch (err) {
      if (err && /** @type {{ code?: unknown }} */ (err).code === "ledger_empty") {
        await failJob(job, {
          code: "ledger_empty",
          message: "Add a résumé in Settings → Profile before drafting.",
        });
        return;
      }
      throw err;
    }

    let ingestResult = null;
    try { ingestResult = JSON.parse(await readFile(ledger.ingest.resultPath, "utf8")); }
    catch { /* A missing or unreadable read cannot authorize a draft. */ }
    const ingestFailure = draftIngestFailure(ledger, ingestResult, resumeText, resolved);
    if (ingestFailure) {
      await failJob(job, ingestFailure);
      return;
    }
    const ingestReview = draftIngestReview(/** @type {Record<string, any>} */ (ingestResult));

    await writeResumeSnapshot(dir, resumeSource, job.record.requested_at || isoNow());
    if (jd.source === "scrape" || jd.source === "request") {
      await writeJdFile(dir, jdText, {
        source: jd.source,
        jobUrl: payload.jobUrl,
        nowIso: isoNow(),
      });
    }

    if (payload.resumeFrom && !payload.repair) {
      throw Object.assign(new Error("The selected run has no readable document draft."), {
        statusCode: 409,
        code: "repair_source_missing",
      });
    }
    const voiceSamples = await collectVoiceSamples(payload.repair ? { ...payload, notes: "" } : payload);

    /* RESJ Q3: confidence from what the posting offers (role sections,
     * duty lines, requirements, company facts), not its length. */
    const evidence = jdEvidence(jdText);
    const gate = {
      verdict: "usable",
      confidence: evidence.confidence,
      signals: {
        words: evidence.words,
        roleSections: evidence.roleSections,
        requirementSections: evidence.requirementSections,
        dutyLines: evidence.dutyLines,
        companyFacts: evidence.companyFacts,
      },
    };
    const runId = newRunId(payload.slug, job.record.requested_at || isoNow());
    /** @type {Promise<void>} */
    let stageWrites = Promise.resolve();
    const pipelineResult = await pipeline({
      dir,
      payload,
      pin: resolved,
      fetchImpl,
      jdText,
      jdSource: jd.source,
      gate,
      ledger,
      resumeText,
      /* "Your details": the confirmed name and contact win over whatever
       * the attached resume text says. */
      profileIdentity: profile && typeof profile === "object" ? /** @type {Record<string, unknown>} */ (profile).identity : undefined,
      voice: voiceSamples,
      now: now(),
      runId,
      openSession: openSession || (async () => null),
      signal: AbortSignal.timeout(MATERIALS_DRAFT_DEADLINE_MS),
      /* The production path must render PDFs; a missing browser fails the
       * render loudly instead of leaving stale PDFs behind an "ok". */
      requirePdf: deps.openSession === undefined,
      readMarks: async () => {
        try {
          return await logoLoader();
        } catch {
          return [];
        }
      },
      readEmployerMarks: async (/** @type {string[]} */ companies) => {
        try {
          return await employerLogoLoader(companies);
        } catch {
          return [];
        }
      },
      readTargetMark: async (/** @type {string} */ company) => {
        try {
          return await targetLogoLoader(company);
        } catch {
          return null;
        }
      },
      ...(intelEnabled
        ? {
          intel: {
            search: intelSearchFor(resolved),
            resolveBrand: intelBrand,
            cacheRoot: intelCacheRoot,
            fetchImpl,
            ...(typeof deps.intelBudgetMs === "number" ? { budgetMs: deps.intelBudgetMs } : {}),
          },
        }
        : {}),
      onStage: (stage, status) => {
        /* U-4: structured stages in pending.json, plain words in the
         * message. Writes are chained so they land in order, and the chain
         * is drained before pending.json is removed below. */
        stageWrites = stageWrites.then(async () => {
          const reason = await stageReason(dir, stage, status);
          const prior = job.record.progress && Array.isArray(job.record.progress.stages) ? job.record.progress.stages : [];
          const entry = reason ? { stage, status, reason } : { stage, status };
          const next = withPhase(job.record, "drafting", stageProgressMessage(stage, payload.feature));
          job.record = { ...next, progress: { ...next.progress, stages: [...prior, entry] } };
          await writePending(pendingPath, job.record);
        }).catch(() => {});
      },
      ...(payload.repair ? { current: payload.repair.sourceDraft } : {}),
      ...(payload.repair ? { repair: payload.repair } : {}),
    });
    if (pipelineResult.runId !== payload.repair?.parentRunId) await recordDraftIngestReview(dir, pipelineResult, ingestReview);
    if (payload.repair && pipelineResult.outcome !== "cached" && pipelineResult.runId !== payload.repair.parentRunId) {
      await recordRepairOutcome({
        root: applicationsRoot,
        slug: payload.slug,
        runId: pipelineResult.runId || runId,
        repair: payload.repair,
        pipelineResult: /** @type {Record<string, unknown>} */ (pipelineResult),
      });
    }
    /* The pipeline wrote the package (or returned the cached one) — the
     * spinner comes down either way. */
    await stageWrites;
    await rm(pendingPath, { force: true });
  }

  /**
   * @param {MaterialsRequestPayload} payload
   */
  async function enqueue(payload) {
    const requestedResume = normalizeDraftResume(payload && payload.resume);
    if (!requestedResume) throw resumeRequiredError();
    /* The draft uses the user's current resume: never garbled text, never
     * an older copy one browser still holds when a newer one is saved. */
    const saved = await readSavedResume().catch(() => null);
    const { resume: resumeSource, choice: resumeChoice } = chooseResumeSource({ requested: requestedResume, saved });
    /* An unknown template is a 400 before anything is queued. */
    resolveRunFamily({ template: payload.template, preferredTemplate: payload.preferredTemplate });
    /* A missing pin no longer rejects: the run degrades to a deterministic
     * REVIEW package with llm_unconfigured (slice 6). */
    const pin = loadPin();

    const slug = payload.slug;
    const dir = join(applicationsRoot, slug);
    const pendingPath = join(dir, "pending.json");

    const existingFlight = inFlight.get(slug);
    if (existingFlight) {
      return {
        ok: true,
        slug,
        pending_path: existingFlight.pendingPath,
        requested_at: existingFlight.record.requested_at,
        accepted: true,
      };
    }

    const requestedAt = isoNow();
    /** @type {PendingRecord} */
    const record = {
      slug,
      company: payload.company,
      title: payload.title,
      feature: payload.feature,
      job_url: payload.jobUrl || "",
      notes: payload.notes || "",
      requested_at: requestedAt,
      source: "jobbored-dossier",
      /* U-5 "Draft both": the document queued after this one. */
      ...(payload.then ? { next: payload.then } : {}),
      /* The choice rides along only when the server had to choose. */
      resume: resumeChoice.message
        ? { ...resumeProvenance(resumeSource), choice: { used: resumeChoice.used, reason: resumeChoice.reason, message: resumeChoice.message } }
        : resumeProvenance(resumeSource),
      progress: {
        phase: "queued",
        message: defaultProgressMessage("queued", payload.feature),
        started_at: "",
        updated_at: requestedAt,
        attempt: 1,
        elapsed_seconds: 0,
      },
    };
    inFlight.set(slug, { pendingPath, record });

    try {
      await mkdir(dir, { recursive: true });
      await writePending(pendingPath, record);
      queue.push({
        payload: { ...payload, resume: resumeSource, resumeChoice },
        pin: /** @type {object} */ (pin),
        dir,
        pendingPath,
        record,
      });
      startHeartbeat();
      kick();
      return {
        ok: true,
        slug,
        pending_path: pendingPath,
        requested_at: requestedAt,
        accepted: true,
      };
    } catch (err) {
      inFlight.delete(slug);
      throw err;
    }
  }

  /**
   * @param {{ payload: MaterialsRequestPayload }} job
   */
  async function enqueueFollowUp(job) {
    const { then, thenExtras, resumeChoice: _choice, ...rest } = /** @type {MaterialsRequestPayload & { resumeChoice?: unknown }} */ (job.payload);
    if (then !== "cover_letter") return;
    try {
      await enqueue({ ...rest, feature: then, ...(Array.isArray(thenExtras) && thenExtras.length ? { extras: [...thenExtras] } : {}) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[materials] slug=${job.payload.slug} follow-up ${then} not queued:`, err);
    }
  }

  function runUntilIdle() {
    if (!running && queue.length === 0) {
      return Promise.resolve();
    }
    return /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        idleWaiters.push(() => {
          resolve(undefined);
        });
        kick();
      })
    );
  }

  return {
    enqueue,
    runUntilIdle,
    runNextForTests: runUntilIdle,
  };
}
