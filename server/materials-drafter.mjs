/**
 * In-process materials FIFO: JD gate → writer → composer → critic → editor.
 * One draft at a time. Does not talk to Hermes or Telegram.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { composeCoverLetter, composeResume } from "./materials-composer.mjs";
import { critiqueMaterials } from "./materials-critic.mjs";
import { resolveJobDescription } from "./materials-jd-gate.mjs";
import { renderPdfIfPossible } from "./materials-pdf.mjs";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { callEditor, callWriter } from "./materials-writer.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";

const PAGE_COUNT_CODES = new Set([
  "resume_page_count_high",
  "resume_two_page_sparse",
  "resume_second_page_sparse",
  "cover_letter_page_count",
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESUME_TEMPLATE = join(
  __dirname,
  "..",
  "integrations",
  "hermes-job-hunt",
  "resume-template",
  "resume.html",
);
const DEFAULT_LETTER_TEMPLATE = join(
  __dirname,
  "..",
  "integrations",
  "hermes-job-hunt",
  "cover-letter-template",
  "cover-letter.html",
);

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
 */

/**
 * @typedef {object} PendingProgress
 * @property {string} phase
 * @property {string} message
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
  return typeof pin.apiKey === "string" && pin.apiKey.trim().length > 0;
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
    const $keep = $slot.find("[data-slot], .dot").clone();
    $slot.text(value);
    $slot.append($keep);
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

async function defaultReadMasterResume() {
  return readFile(DEFAULT_RESUME_TEMPLATE, "utf8");
}

async function defaultReadMasterLetter() {
  return readFile(DEFAULT_LETTER_TEMPLATE, "utf8");
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
 * @property {() => Promise<string>} [readMasterResume]
 * @property {() => Promise<string>} [readMasterLetter]
 * @property {(input: Record<string, unknown>) => Promise<unknown>} [writer]
 * @property {(input: Record<string, unknown>) => Promise<unknown>} [editor]
 * @property {(input: Record<string, unknown>) => Promise<Scorecard>} [critic]
 * @property {DrafterComposer} [composer]
 * @property {(input?: Record<string, unknown>) => Promise<{ skipped?: boolean, path?: string, note?: string }>} [pdfRenderer]
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
  const readMasterResume =
    typeof deps.readMasterResume === "function" ? deps.readMasterResume : defaultReadMasterResume;
  const readMasterLetter =
    typeof deps.readMasterLetter === "function" ? deps.readMasterLetter : defaultReadMasterLetter;
  const writer =
    typeof deps.writer === "function"
      ? deps.writer
      : (/** @type {Record<string, unknown>} */ input) =>
        callWriter({
          pin: /** @type {import("./materials-writer.mjs").WriterPin} */ (input.pin),
          jdText: String(input.jdText || ""),
          masterResumeHtml: String(input.masterResumeHtml || ""),
          voiceSamples: input.voiceSamples,
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
          voiceSamples: input.voiceSamples,
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
  const composeLetter =
    deps.composer && typeof deps.composer.composeCoverLetter === "function"
      ? deps.composer.composeCoverLetter
      : composeLetterWithNestedSlots;
  const composeResumeHtml =
    deps.composer && typeof deps.composer.composeResume === "function"
      ? deps.composer.composeResume
      : composeResume;
  const pdfRenderer =
    typeof deps.pdfRenderer === "function" ? deps.pdfRenderer : defaultPdfRenderer;
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
   * @param {PendingRecord} record
   * @param {string} phase
   * @param {string} [message]
   */
  function withPhase(record, phase, message) {
    const t = isoNow();
    const started = phase === "drafting"
      ? (record.progress && record.progress.started_at) || t
      : (record.progress && record.progress.started_at) || "";
    return {
      ...record,
      progress: {
        phase,
        message: message || defaultProgressMessage(phase, record.feature),
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
    const error = /** @type {{ message?: unknown }} */ (err);
    const record = withPhase(
      job.record,
      "failed",
      error && error.message ? String(error.message) : "Draft failed before any files were produced.",
    );
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
   */
  async function finishWithFiles(dir, pendingPath, { feature, letterHtml, resumeHtml, scorecard, notes = [] }) {
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
    if (wroteHtml) await rm(pendingPath, { force: true });
  }

  /**
   * @param {{ payload: MaterialsRequestPayload, pin: object, dir: string, pendingPath: string, record: PendingRecord }} job
   */
  async function runJob(job) {
    const { payload, pin, dir, pendingPath } = job;
    job.record = withPhase(job.record, "drafting");
    await writePending(pendingPath, job.record);

    let cachedText = "";
    try {
      cachedText = stripJdComments(await readFile(join(dir, "job-description.md"), "utf8"));
    } catch {
      cachedText = "";
    }

    const jd = await resolveJobDescription({
      cachedText,
      jobUrl: payload.jobUrl,
      scrapeJob,
    });
    if ("error" in jd) {
      const jdIssue = {
        code: "jd_unusable",
        message: "Cached job description is unusable and scraping the job URL failed.",
        severity: "review",
      };
      await writeFile(
        join(dir, "qa-report.md"),
        formatQaReport({ status: "REVIEW", issues: [jdIssue] }),
        "utf8",
      );
      await failJob(job, { message: jdIssue.message });
      return;
    }

    const jdText = jd.text;
    if (jd.source === "scrape") {
      await writeJdFile(dir, jdText, {
        source: "scrape",
        jobUrl: payload.jobUrl,
        nowIso: isoNow(),
      });
    }

    const resolved = await resolvePin(pin);
    const [masterResumeHtml, masterLetterHtml] = await Promise.all([
      readMasterResume(),
      readMasterLetter(),
    ]);

    let writerJson = await writer({
      pin: resolved,
      jdText,
      masterResumeHtml,
      voiceSamples: [],
    });

    /**
     * @param {unknown} json
     */
    function composeBoth(json) {
      const letter = isPlainObject(json) && isPlainObject(json.letter) ? json.letter : {};
      const resume = isPlainObject(json) && isPlainObject(json.resume) ? json.resume : {};
      return {
        letterHtml: composeLetter(masterLetterHtml, letter),
        resumeHtml: composeResumeHtml(masterResumeHtml, resume),
      };
    }

    let composed = composeBoth(writerJson);
    let rawScorecard = await critic({
      letterHtml: composed.letterHtml,
      resumeHtml: composed.resumeHtml,
      jdText,
      masterResumeHtml,
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
        voiceSamples: [],
        current: writerJson,
        scorecard,
      });
      composed = composeBoth(writerJson);
      rawScorecard = await critic({
        letterHtml: composed.letterHtml,
        resumeHtml: composed.resumeHtml,
        jdText,
        masterResumeHtml,
        writerJson,
      });
      scorecard = adjustScorecardForSkippedPdf(rawScorecard, true);
    }

    const resumePdfPath = join(dir, "resume.pdf");
    const coverLetterPdfPath = join(dir, "cover-letter.pdf");
    const pdfResult = await pdfRenderer({
      slug: payload.slug,
      dir,
      resumeHtml: composed.resumeHtml,
      letterHtml: composed.letterHtml,
      resumePdfPath,
      coverLetterPdfPath,
    });
    const pdfSkipped = Boolean(pdfResult?.skipped);
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
    /** @type {string[]} */
    const notes = [];
    if (pdfSkipped) {
      notes.push(typeof pdfResult?.note === "string" && pdfResult.note ? pdfResult.note : "pdf_skipped");
    }

    await finishWithFiles(dir, pendingPath, {
      feature: payload.feature,
      letterHtml: composed.letterHtml,
      resumeHtml: composed.resumeHtml,
      scorecard,
      notes,
    });
  }

  /**
   * @param {MaterialsRequestPayload} payload
   */
  async function enqueue(payload) {
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
        payload,
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
