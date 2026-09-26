/**
 * In-process materials FIFO: JD gate → writer → composer → critic → editor.
 * One draft at a time. Does not talk to Hermes or Telegram.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { renderCandidateLetter, renderCandidateResume, candidateHeader } from "./materials-candidate-docs.mjs";
import { composeCoverLetter, composeResume } from "./materials-composer.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { resolveJobDescription, isUsableJobDescription } from "./materials-jd-gate.mjs";
import { openPdfSession, renderPdfIfPossible } from "./materials-pdf.mjs";
import { readResolvedMarks } from "./brand-logos.mjs";
import { buildRenderModelFromWriter } from "./materials-render-model-adapter.mjs";
import { renderDocument } from "./materials-render.mjs";
import { materialsCacheKey, newRunId, renderPackage, writePackageRecords } from "./materials-package.mjs";
import { letterWordBand, resolveRunFamily } from "./materials-templates.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import {
  formatProvenanceLine,
  normalizeResumeSource,
  resumeProvenance,
  resumeRequiredError,
  writeResumeSnapshot,
} from "./materials-resume-source.mjs";
import { callEditor, callWriter } from "./materials-writer.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";
import { readProfile } from "./user-profile.mjs";

const PAGE_COUNT_CODES = new Set([
  "resume_page_count_high",
  "resume_two_page_sparse",
  "resume_second_page_sparse",
  "cover_letter_page_count",
]);


const MAX_EDITOR_LOOPS = 2;
const NESTED_LETTER_SLOTS = {
  company: ["company-mention", "company-mention-2", "company-mention-3"],
  role: ["role-keyword"],
  closing: ["closing-hook"],
};
const PARENT_LETTER_SLOTS = [
  ["hook", "hook"],
  ["whyThem", "why-them"],
  ["whyMe", "why-me"],
  ["whyNow", "why-now"],
  ["closing", "closing"],
  ["flourish", "flourish"],
];

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
 * @property {string} [template] a registry family named by this request
 * @property {string} [preferredTemplate] the user's saved materialsTemplate
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
 * @property {PendingProgress} progress
 * @property {{ source: string, filename: string, addedAt: string }} [resume] provenance, no text
 * @property {{ llm?: { provider: string, requestedModel: string, resolvedModel: string } }} [debug]
 */

/**
 * @typedef {object} CriticIssue
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [severity]
 */

/**
 * @typedef {object} Scorecard
 * @property {string} [status]
 * @property {CriticIssue[]} [issues]
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
 * @returns {Promise<unknown[]>}
 */
async function collectVoiceSamples(payload) {
  /** @type {unknown[]} */
  const samples = [];
  try {
    const result = await readProfile();
    if (result.ok && isPlainObject(result.profile)) {
      const extra = result.profile.writingSamples || result.profile.writingSampleExcerpts;
      if (Array.isArray(extra)) samples.push(...extra);
    }
  } catch {
    // no on-disk profile
  }
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  if (notes) samples.push(notes);
  return samples;
}

/**
 * Replace only direct text nodes so nested chrome (`.it`, `.target`,
 * `[data-slot]`, `.dot`) stays in place.
 *
 * @param {import("cheerio").Cheerio<import("domhandler").AnyNode>} $el
 * @param {string} value
 */
function replaceDirectTextNodes($el, value) {
  let replaced = false;
  $el.contents().each((_, node) => {
    if (node.type !== "text") return;
    if (!replaced) {
      node.data = value;
      replaced = true;
    } else {
      node.data = "";
    }
  });
  if (!replaced) $el.prepend(value);
}

function unconfiguredError() {
  return Object.assign(new Error("No LLM pin configured."), {
    statusCode: 409,
    code: "llm_unconfigured",
  });
}

/** @param {unknown} feature */
function wantsResume(feature) {
  return feature === "resume" || feature === "both";
}

/** @param {unknown} feature */
function wantsLetter(feature) {
  return feature === "cover_letter" || feature === "both";
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
 * @param {unknown} letter
 * @param {string} html
 * @returns {string}
 */
export function composeLetterWithNestedSlots(html, letter) {
  if (!isPlainObject(letter)) return composeCoverLetter(html, letter);

  /** @type {Record<string, unknown>} */
  const rest = { ...letter };
  for (const [field] of PARENT_LETTER_SLOTS) delete rest[field];
  const composed = composeCoverLetter(html, rest);
  const $ = cheerio.load(composed);

  for (const [field, slot] of PARENT_LETTER_SLOTS) {
    const value = letter[field];
    if (typeof value !== "string") continue;
    const $slot = $(`[data-slot="${slot}"]`);
    if (!$slot.length) continue;
    replaceDirectTextNodes($slot, value);
  }

  for (const [field, slots] of Object.entries(NESTED_LETTER_SLOTS)) {
    const value = letter[field];
    if (typeof value !== "string") continue;
    for (const slot of slots) {
      $(`[data-slot="${slot}"]`).text(value);
    }
  }
  return $.html();
}

/**
 * HTML `article.page` count is not a real PDF page count. When PDF is skipped,
 * demote a lone resume_page_count_high fail to review so HTML can still land.
 *
 * @param {Scorecard | null | undefined} scorecard
 * @param {boolean} pdfSkipped
 * @returns {Scorecard}
 */
export function adjustScorecardForSkippedPdf(scorecard, pdfSkipped) {
  const rawIssues = scorecard && Array.isArray(scorecard.issues) ? scorecard.issues : [];
  const issues = rawIssues.map((issue) => {
    if (
      pdfSkipped &&
      issue &&
      issue.code === "resume_page_count_high" &&
      issue.severity === "fail"
    ) {
      return { ...issue, severity: "review" };
    }
    return issue;
  });
  if (!pdfSkipped) {
    return { ...(scorecard || {}), issues };
  }
  const blocking = issues.filter((issue) => issue && issue.code !== "resume_page_count_high");
  const hasFail = blocking.some((issue) => issue && issue.severity === "fail");
  /** @type {string} */
  let status;
  if (hasFail) status = "fail";
  else if (blocking.length === 0) {
    status = issues.some((issue) => issue && issue.code === "resume_page_count_high")
      ? "review"
      : "pass";
  } else if (blocking.some((issue) => issue && issue.severity === "review")) status = "review";
  else status = String((scorecard && scorecard.status) || "review");
  return { ...(scorecard || {}), issues, status };
}

/**
 * Replace HTML article.page counts with issues from the rendered PDFs.
 *
 * @param {Scorecard | null | undefined} scorecard
 * @param {object} files
 * @param {string} files.resumeHtml
 * @param {string} files.letterHtml
 * @param {string} files.resumePdfPath
 * @param {string} files.coverLetterPdfPath
 * @returns {Promise<Scorecard>}
 */
async function mergePdfPageCounts(scorecard, files) {
  const tmp = await mkdtemp(join(tmpdir(), "jb-pdf-audit-"));
  try {
    const resumeHtmlPath = join(tmp, "resume.html");
    const letterHtmlPath = join(tmp, "cover-letter.html");
    await writeFile(resumeHtmlPath, files.resumeHtml, "utf8");
    await writeFile(letterHtmlPath, files.letterHtml, "utf8");
    const [resume, letter] = await Promise.all([
      auditResume({ htmlPath: resumeHtmlPath, pdfPath: files.resumePdfPath }),
      auditCoverLetter({ htmlPath: letterHtmlPath, pdfPath: files.coverLetterPdfPath }),
    ]);
    const kept = (scorecard && Array.isArray(scorecard.issues) ? scorecard.issues : []).filter(
      (issue) => issue && !PAGE_COUNT_CODES.has(String(issue.code || "")),
    );
    const fromPdf = [...(resume?.issues || []), ...(letter?.issues || [])].filter(
      (issue) => issue && PAGE_COUNT_CODES.has(String(issue.code || "")),
    );
    const issues = [...kept, ...fromPdf];
    const hasFail = issues.some((issue) => issue && issue.severity === "fail");
    /** @type {string} */
    const status = hasFail ? "fail" : issues.length ? "review" : "pass";
    return { ...(scorecard || {}), issues, status };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** @param {Scorecard | null | undefined} scorecard */
function onlySkippedPdfPageCount(scorecard) {
  const issues = scorecard && Array.isArray(scorecard.issues) ? scorecard.issues : [];
  return issues.length > 0 && issues.every((issue) => issue && issue.code === "resume_page_count_high");
}

/**
 * @param {object} args
 * @param {string} args.status
 * @param {CriticIssue[]} [args.issues]
 * @param {string[]} [args.notes]
 */
function formatQaReport({ status, issues = [], notes = [] }) {
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
 * @param {Record<string, unknown>} [input]
 * @returns {Promise<{ skipped: boolean, path?: string, note?: string }>}
 */
async function defaultPdfRenderer(input = {}) {
  const resumeHtml = typeof input.resumeHtml === "string" ? input.resumeHtml : "";
  const letterHtml = typeof input.letterHtml === "string" ? input.letterHtml : "";
  const resumePdfPath = typeof input.resumePdfPath === "string" ? input.resumePdfPath : "";
  const coverLetterPdfPath =
    typeof input.coverLetterPdfPath === "string" ? input.coverLetterPdfPath : "";

  /** @type {Array<Promise<{ skipped: boolean, path?: string, note?: string }>>} */
  const jobs = [];
  if (resumeHtml && resumePdfPath) {
    jobs.push(renderPdfIfPossible(resumeHtml, resumePdfPath));
  }
  if (letterHtml && coverLetterPdfPath) {
    jobs.push(renderPdfIfPossible(letterHtml, coverLetterPdfPath));
  }
  if (!jobs.length) return { skipped: true, note: "pdf_skipped" };

  const results = await Promise.all(jobs);
  if (results.some((result) => result.skipped)) {
    return {
      skipped: true,
      note: results.find((result) => result.note)?.note || "pdf_skipped",
    };
  }
  const path = results.find((result) => result.path)?.path;
  return path ? { skipped: false, path } : { skipped: false };
}

/**
 * @typedef {object} DrafterComposer
 * @property {(html: unknown, letter: unknown) => string} [composeCoverLetter]
 * @property {(html: unknown, resume: unknown) => string} [composeResume]
 */

/**
 * @typedef {object} DrafterDeps
 * @property {string} [applicationsRoot]
 * @property {() => unknown} [loadPin]
 * @property {(pin: unknown) => unknown} [resolvePin]
 * @property {(url: string) => Promise<{ description?: unknown }>} [scrapeJob]
 * @property {() => Promise<string>} [readMasterResume] TEST-ONLY sample resume layout
 *   (e.g. the repo's resume-template). Omitted in production: the resume is
 *   rendered from the user's resume via materials-candidate-docs.mjs.
 * @property {() => Promise<string>} [readMasterLetter] TEST-ONLY sample letter layout.
 * @property {(input: Record<string, unknown>) => Promise<unknown>} [writer]
 * @property {(input: Record<string, unknown>) => Promise<unknown>} [editor]
 * @property {(input: Record<string, unknown>) => Promise<Scorecard>} [critic]
 * @property {DrafterComposer} [composer]
 * @property {(input?: Record<string, unknown>) => Promise<{ skipped?: boolean, path?: string, note?: string }>} [pdfRenderer]
 *   Legacy/test PDF hook. When set (and no pdfSession is given), the
 *   registry path renders unmeasured and hands its HTML to this hook.
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [pdfSession]
 *   Opens the headless browser the registry path measures fit and prints
 *   PDFs with. Defaults to openPdfSession unless pdfRenderer is injected.
 * @property {() => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [logoLoader]
 *   Resolved brand-logo marks (defaults to readResolvedMarks, read-only).
 * @property {boolean} [legacyRender] render with materials-candidate-docs.mjs
 *   instead of the template registry (one-release fallback; also
 *   JOBBORED_MATERIALS_LEGACY_RENDER=1)
 * @property {() => Date | string | number} [now]
 */

/**
 * @param {DrafterDeps} [deps]
 */
export function createMaterialsDrafter(deps = {}) {
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
  /* Sample-template layouts are test-only (the repo's resume-template and
   * cover-letter-template are the maintainer's, kept as labelled samples).
   * In production both are null and the documents are rendered from the
   * writer's JSON by materials-candidate-docs.mjs. */
  const readSampleResume =
    typeof deps.readMasterResume === "function" ? deps.readMasterResume : null;
  const readSampleLetter =
    typeof deps.readMasterLetter === "function" ? deps.readMasterLetter : null;
  const writer =
    typeof deps.writer === "function"
      ? deps.writer
      : (/** @type {Record<string, unknown>} */ input) =>
        callWriter({
          pin: /** @type {import("./materials-writer.mjs").WriterPin} */ (input.pin),
          jdText: String(input.jdText || ""),
          masterResumeHtml: String(input.masterResumeHtml || ""),
          resumeText: String(input.resumeText || ""),
          voiceSamples: input.voiceSamples,
          letterWords: Array.isArray(input.letterWords) ? /** @type {number[]} */ (input.letterWords) : undefined,
          fetchImpl:
            typeof input.fetchImpl === "function"
              ? /** @type {import("./materials-writer.mjs").WriterInput["fetchImpl"]} */ (input.fetchImpl)
              : globalThis.fetch.bind(globalThis),
        });
  const editor =
    typeof deps.editor === "function"
      ? deps.editor
      : (/** @type {Record<string, unknown>} */ input) =>
        callEditor({
          pin: /** @type {import("./materials-writer.mjs").WriterPin} */ (input.pin),
          jdText: String(input.jdText || ""),
          masterResumeHtml: String(input.masterResumeHtml || ""),
          resumeText: String(input.resumeText || ""),
          voiceSamples: input.voiceSamples,
          letterWords: Array.isArray(input.letterWords) ? /** @type {number[]} */ (input.letterWords) : undefined,
          current: /** @type {import("./materials-writer.mjs").WriterJson} */ (input.current),
          scorecard: input.scorecard || {},
          fetchImpl:
            typeof input.fetchImpl === "function"
              ? /** @type {import("./materials-writer.mjs").WriterInput["fetchImpl"]} */ (input.fetchImpl)
              : globalThis.fetch.bind(globalThis),
        });
  const critic =
    typeof deps.critic === "function"
      ? deps.critic
      : (/** @type {Record<string, unknown>} */ input) => critiqueMaterials(input);
  const composeSampleLetter =
    deps.composer && typeof deps.composer.composeCoverLetter === "function"
      ? deps.composer.composeCoverLetter
      : composeLetterWithNestedSlots;
  const composeSampleResume =
    deps.composer && typeof deps.composer.composeResume === "function"
      ? deps.composer.composeResume
      : composeResume;
  const pdfRenderer =
    typeof deps.pdfRenderer === "function" ? deps.pdfRenderer : defaultPdfRenderer;
  const openSession =
    deps.pdfSession === null
      ? null
      : typeof deps.pdfSession === "function"
        ? deps.pdfSession
        : typeof deps.pdfRenderer === "function"
          ? null
          : () => openPdfSession();
  const logoLoader =
    typeof deps.logoLoader === "function" ? deps.logoLoader : () => readResolvedMarks();
  const legacyRender =
    deps.legacyRender === true || process.env.JOBBORED_MATERIALS_LEGACY_RENDER === "1";
  const now = typeof deps.now === "function" ? deps.now : () => new Date();

  /** @type {Array<{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord }>} */
  const queue = [];
  /** @type {Map<string, { pendingPath: string, record: PendingRecord }>} */
  const inFlight = new Map();
  /** @type {Array<() => void>} */
  const idleWaiters = [];
  let running = false;

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
  async function writePending(path, record) {
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
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
    /* First-class resumable states keep their own neutral message. */
    if (errCode === "jd_unusable" && typeof error?.message === "string") {
      return { code: "jd_unusable", message: error.message };
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
        try {
          await runJob(job);
        } catch (err) {
          await failJob(job, err);
        } finally {
          inFlight.delete(job.payload.slug);
        }
      }
    } finally {
      running = false;
      if (queue.length > 0) kick();
      else flushIdleWaiters();
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
    console.error(`[materials] slug=${job.payload.slug} ${failure.code}:`, err);
    const record = withPhase(job.record, "failed", failure.message, failure.code);
    job.record = record;
    await writePending(job.pendingPath, record);
  }

  /**
   * @param {string} dir
   * @param {string} pendingPath
   * @param {object} args
   * @param {string} args.feature
   * @param {string} [args.letterHtml]
   * @param {string} [args.resumeHtml]
   * @param {Scorecard} args.scorecard
   * @param {string[]} [args.notes]
   * @param {() => Promise<void>} [args.beforeRelease] runs after the files
   *   are written and before pending.json goes away
   */
  async function finishWithFiles(dir, pendingPath, { feature, letterHtml, resumeHtml, scorecard, notes = [], beforeRelease }) {
    let wroteHtml = false;
    if (wantsLetter(feature) && typeof letterHtml === "string") {
      await writeFile(join(dir, "cover-letter.html"), letterHtml, "utf8");
      wroteHtml = true;
    }
    if (wantsResume(feature) && typeof resumeHtml === "string") {
      await writeFile(join(dir, "resume.html"), resumeHtml, "utf8");
      wroteHtml = true;
    }
    const status = scorecard.status === "pass" ? "READY" : "REVIEW";
    await writeFile(
      join(dir, "qa-report.md"),
      formatQaReport({
        status,
        issues: Array.isArray(scorecard.issues) ? scorecard.issues : [],
        notes,
      }),
      "utf8",
    );
    if (beforeRelease) await beforeRelease();
    if (wroteHtml) await rm(pendingPath, { force: true });
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
    if (jd.source === "scrape" || jd.source === "request") {
      await writeJdFile(dir, jdText, {
        source: jd.source,
        jobUrl: payload.jobUrl,
        nowIso: isoNow(),
      });
    }

    /** @type {import("./materials-writer.mjs").WriterPin} */
    const resolved = /** @type {import("./materials-writer.mjs").WriterPin} */ (await resolvePin(pin));
    // Log and persist the exact model used for this draft for dogfood verification.
    try {
      const pinProvider = String((/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (pin))).provider || "");
      const requestedModel = String((/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (pin))).model || "");
      const resolvedModel = String(resolved.resolvedModel || "");
      // Console log for live verification
      // Example: [materials] slug=eab-role provider=gemini requested_model=gemini-flash resolved_model=gemini-3.7-flash
      // No secrets are logged.
      // eslint-disable-next-line no-console
      console.log(
        `[materials] slug=${payload.slug} provider=${String(resolved.provider || pinProvider)} requested_model=${requestedModel} resolved_model=${resolvedModel}`,
      );
      // Include a small debug field in pending.json without changing the UI message.
      /** @type {any} */ (job.record).debug = {
        ...(/** @type {any} */ (job.record).debug),
        llm: {
          provider: String(resolved.provider || pinProvider),
          requestedModel,
          resolvedModel,
        },
      };
      await writePending(pendingPath, job.record);
    } catch {
      // Best-effort only — never fail the draft if logging cannot be written.
    }
    const resumeSource = normalizeResumeSource(payload.resume);
    if (!resumeSource) throw resumeRequiredError();
    const resumeText = resumeSource.text;
    const [sampleResumeHtml, sampleLetterHtml] = await Promise.all([
      readSampleResume ? readSampleResume() : Promise.resolve(null),
      readSampleLetter ? readSampleLetter() : Promise.resolve(null),
    ]);
    /* Only a test-injected sample layout ever reaches the writer as HTML. */
    const masterResumeHtml = typeof sampleResumeHtml === "string" ? sampleResumeHtml : "";
    const voiceSamples = await collectVoiceSamples(payload);
    /* The template registry renders every production draft; the sample
       layouts (test-only) and the legacy flag keep the old composers. */
    const useRegistry = typeof sampleResumeHtml !== "string" && typeof sampleLetterHtml !== "string" && !legacyRender;
    const { family, source: templateSource } = resolveRunFamily({
      template: payload.template,
      preferredTemplate: payload.preferredTemplate,
    });
    /** @type {import("./materials-render-model-adapter.mjs").ResolvedMark[]} */
    let marks = [];
    if (useRegistry) {
      try {
        marks = await logoLoader();
      } catch {
        marks = [];
      }
    }
    const draftStartedAt = Date.now();

    /* Registry drafts ask for the family's letter band (180–260 today). */
    const letterWords = useRegistry ? letterWordBand(family) : undefined;
    let writerJson = await writer({
      pin: resolved,
      jdText,
      masterResumeHtml,
      resumeText,
      voiceSamples,
      ...(letterWords ? { letterWords } : {}),
    });

    /** @param {unknown} json */
    function modelFor(json) {
      return buildRenderModelFromWriter({
        writerJson: json,
        resumeText,
        request: { company: payload.company, title: payload.title },
        family,
        marks,
        nowIso: isoNow(),
      });
    }

    /**
     * @param {unknown} json
     */
    function composeBoth(json) {
      const letter = isPlainObject(json) && isPlainObject(json.letter) ? json.letter : {};
      const resume = isPlainObject(json) && isPlainObject(json.resume) ? json.resume : {};
      if (useRegistry) {
        const model = modelFor(json);
        return {
          letterHtml: renderDocument(model, "coverLetter"),
          resumeHtml: renderDocument(model, "resume"),
        };
      }
      return {
        letterHtml: typeof sampleLetterHtml === "string"
          ? composeSampleLetter(sampleLetterHtml, letter)
          : renderCandidateLetter(letter, candidateHeader(resume, resumeText)),
        resumeHtml: typeof sampleResumeHtml === "string"
          ? composeSampleResume(sampleResumeHtml, resume)
          : renderCandidateResume(resume, { resumeText }),
      };
    }

    let composed = composeBoth(writerJson);
    let rawScorecard = await critic({
      letterHtml: composed.letterHtml,
      resumeHtml: composed.resumeHtml,
      jdText,
      masterResumeHtml,
      sourceResumeText: resumeText,
      writerJson,
    });
    let scorecard = adjustScorecardForSkippedPdf(rawScorecard, true);

    let editorLoops = 0;
    while (
      scorecard.status !== "pass" &&
      !onlySkippedPdfPageCount(scorecard) &&
      editorLoops < MAX_EDITOR_LOOPS
    ) {
      editorLoops += 1;
      writerJson = await editor({
        pin: resolved,
        jdText,
        masterResumeHtml,
        resumeText,
        voiceSamples,
        ...(letterWords ? { letterWords } : {}),
        current: writerJson,
        scorecard,
      });
      composed = composeBoth(writerJson);
      rawScorecard = await critic({
        letterHtml: composed.letterHtml,
        resumeHtml: composed.resumeHtml,
        jdText,
        masterResumeHtml,
        sourceResumeText: resumeText,
        writerJson,
      });
      scorecard = adjustScorecardForSkippedPdf(rawScorecard, true);
    }
    const draftMs = Date.now() - draftStartedAt;

    const resumePdfPath = join(dir, "resume.pdf");
    const coverLetterPdfPath = join(dir, "cover-letter.pdf");
    /** @type {string[]} */
    const notes = [formatProvenanceLine(resumeSource)];
    /** @type {CriticIssue[]} */
    let fitIssues = [];
    /** @type {Awaited<ReturnType<typeof renderPackage>> | null} */
    let rendered = null;
    /** @type {import("./materials-render.mjs").RenderModel | null} */
    let model = null;
    let pdfSkipped = true;
    /** @type {string} */
    let pdfNote = "pdf_skipped";
    const renderStartedAt = Date.now();

    if (useRegistry) {
      model = modelFor(writerJson);
      const session = openSession ? await openSession() : null;
      try {
        rendered = await renderPackage({
          model,
          feature: payload.feature,
          session,
          pdfPaths: { resumePdfPath, coverLetterPdfPath },
        });
      } finally {
        if (session) await session.close();
      }
      composed = {
        resumeHtml: rendered.resumeHtml ?? composed.resumeHtml,
        letterHtml: rendered.letterHtml ?? composed.letterHtml,
      };
      fitIssues = rendered.issues;
      notes.push(...rendered.notes.filter((note) => note !== "pdf_skipped"));
      if (session) {
        pdfSkipped = rendered.notes.includes("pdf_skipped");
      } else {
        const pdfResult = await pdfRenderer({
          slug: payload.slug,
          dir,
          resumeHtml: composed.resumeHtml,
          letterHtml: composed.letterHtml,
          resumePdfPath,
          coverLetterPdfPath,
        });
        pdfSkipped = Boolean(pdfResult?.skipped);
        if (typeof pdfResult?.note === "string" && pdfResult.note) pdfNote = pdfResult.note;
      }
    } else {
      const pdfResult = await pdfRenderer({
        slug: payload.slug,
        dir,
        resumeHtml: composed.resumeHtml,
        letterHtml: composed.letterHtml,
        resumePdfPath,
        coverLetterPdfPath,
      });
      pdfSkipped = Boolean(pdfResult?.skipped);
      if (typeof pdfResult?.note === "string" && pdfResult.note) pdfNote = pdfResult.note;
    }
    if (!pdfSkipped) {
      try {
        rawScorecard = await mergePdfPageCounts(rawScorecard, {
          resumeHtml: composed.resumeHtml,
          letterHtml: composed.letterHtml,
          resumePdfPath,
          coverLetterPdfPath,
        });
      } catch {
        // Keep the pre-merge scorecard. A QA reread must not sink the draft.
      }
    }
    scorecard = adjustScorecardForSkippedPdf(rawScorecard, pdfSkipped);
    if (fitIssues.length) {
      const issues = [...(scorecard.issues || []), ...fitIssues];
      scorecard = { ...scorecard, issues, status: issues.some((i) => i.severity === "fail") ? "fail" : "review" };
    }
    if (pdfSkipped) notes.push(pdfNote);
    const renderMs = Date.now() - renderStartedAt;

    const finalModel = model;
    const finalRendered = rendered;
    await finishWithFiles(dir, pendingPath, {
      feature: payload.feature,
      letterHtml: composed.letterHtml,
      resumeHtml: composed.resumeHtml,
      scorecard,
      notes,
      beforeRelease: finalModel && finalRendered
        ? async () => {
          const finishedAt = isoNow();
          const runId = newRunId(payload.slug, job.record.requested_at || finishedAt);
          const applied = [
            ...(finalRendered.fit.resume?.applied || []).map((s) => `resume:${s}`),
            ...(finalRendered.fit.coverLetter?.applied || []).map((s) => `letter:${s}`),
          ];
          const measured = Boolean(finalRendered.fit.resume?.measured || finalRendered.fit.coverLetter?.measured);
          const overflow = fitIssues.some((i) => i.code === "layout_overflow");
          /** @type {Record<string, number>} */
          const pages = {};
          if (finalRendered.pdf.resume) pages["resume.pdf"] = finalRendered.pdf.resume.pages;
          if (finalRendered.pdf.coverLetter) pages["cover-letter.pdf"] = finalRendered.pdf.coverLetter.pages;
          const debugLlm = /** @type {{ debug?: { llm?: { provider: string, requestedModel: string, resolvedModel: string } } }} */ (job.record).debug?.llm;
          await writePackageRecords({
            dir,
            rendered: finalRendered,
            model: finalModel,
            pages,
            manifestDefaults: { company: payload.company, title: payload.title, job_url: payload.jobUrl || "" },
            run: {
              runId,
              slug: payload.slug,
              feature: payload.feature,
              requestedAt: job.record.requested_at || finishedAt,
              finishedAt,
              source: templateSource,
              pin: debugLlm ? { provider: debugLlm.provider, requestedModel: debugLlm.requestedModel, resolvedModel: debugLlm.resolvedModel } : undefined,
              stages: [
                {
                  stage: "intake",
                  status: "ok",
                  llm: false,
                  detail: `template ${family.id}@${family.version} (${templateSource}); cache key ${materialsCacheKey({ jdText, resumeText, family })}`,
                },
                { stage: "jd.resolve", status: "ok", llm: false, detail: `job description from ${jd.source}` },
                {
                  stage: "draft",
                  status: "ok",
                  ms: draftMs,
                  llm: true,
                  detail: `writer${editorLoops ? ` + ${editorLoops} editor pass(es)` : ""}; adapted to the render model by materials-render-model-adapter.mjs`,
                },
                {
                  stage: "fit",
                  status: overflow ? "failed" : measured ? "ok" : "skipped",
                  llm: false,
                  out: ["render-model.json"],
                  detail: measured
                    ? (applied.length ? `measured; applied ${applied.join(", ")}` : "measured; fits without trims")
                    : "not measured (no headless browser); rendered unclipped",
                },
                {
                  stage: "render",
                  status: "ok",
                  ms: renderMs,
                  llm: false,
                  out: [
                    ...(finalRendered.resumeHtml ? ["resume.html", "resume.txt"] : []),
                    ...(finalRendered.letterHtml ? ["cover-letter.html", "cover-letter.txt"] : []),
                    ...(!pdfSkipped ? Object.keys(pages) : []),
                  ],
                  detail: `${family.id} ${family.version}`,
                },
                {
                  stage: "qa",
                  status: scorecard.status === "pass" ? "ok" : "review",
                  llm: false,
                  out: ["qa-report.md"],
                  detail: `${(scorecard.issues || []).length} issue(s)`,
                },
                { stage: "publish", status: "ok", llm: false, out: ["manifest.json", "run.json"] },
              ],
            },
          });
        }
        : undefined,
    });
  }

  /**
   * @param {MaterialsRequestPayload} payload
   */
  async function enqueue(payload) {
    const resumeSource = normalizeResumeSource(payload && payload.resume);
    if (!resumeSource) throw resumeRequiredError();
    /* An unknown template is a 400 before anything is queued. */
    resolveRunFamily({ template: payload.template, preferredTemplate: payload.preferredTemplate });
    const pin = loadPin();
    if (!pinIsConfigured(pin)) {
      throw unconfiguredError();
    }

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
      resume: resumeProvenance(resumeSource),
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
      await writeResumeSnapshot(dir, resumeSource, requestedAt);
      const providedJd =
        (typeof payload.jobDescription === "string" && payload.jobDescription) ||
        (typeof payload.jdText === "string" && payload.jdText) ||
        "";
      if (providedJd.trim()) {
        await writeJdFile(dir, providedJd, {
          source: "request",
          jobUrl: payload.jobUrl,
          nowIso: isoNow(),
        });
      }

      await writePending(pendingPath, record);
      queue.push({
        payload: { ...payload, resume: resumeSource },
        pin: /** @type {object} */ (pin),
        dir,
        pendingPath,
        record,
      });
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
