/**
 * In-process materials FIFO: JD resolve → ledger → the v3 stage runner.
 * One draft at a time. Does not talk to Hermes or Telegram.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getApplicationsRoot } from "./application-materials.mjs";
import { loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { resolveJobDescription, isUsableJobDescription } from "./materials-jd-gate.mjs";
import { openPdfSession } from "./materials-pdf.mjs";
import { readResolvedMarks } from "./brand-logos.mjs";
import { newRunId } from "./materials-package.mjs";
import { runPipeline } from "./materials-pipeline.mjs";
import { resolveRunFamily } from "./materials-templates.mjs";
import { ensureLedger } from "./materials-ledger-build.mjs";
import {
  normalizeResumeSource,
  resumeProvenance,
  resumeRequiredError,
  writeResumeSnapshot,
} from "./materials-resume-source.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";
import { readProfile } from "./user-profile.mjs";


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
 * @property {"snapshot"} [resumeFrom] F8: a repair re-enters at the draft
 *   stage with the stored draft JSON plus notes as editor instructions
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
 * @property {(() => Promise<import("./materials-pdf.mjs").PdfSession | null>) | null} [openSession]
 *   Opens the headless browser the pipeline measures fit and prints PDFs
 *   with. Defaults to openPdfSession; null renders unmeasured (tests).
 * @property {() => Promise<import("./materials-render-model-adapter.mjs").ResolvedMark[]>} [logoLoader]
 *   Resolved brand-logo marks (defaults to readResolvedMarks, read-only).
 * @property {() => Date | string | number} [now]
 * @property {number} [heartbeatMs] F14: queued-job heartbeat interval
 *   (default 60s; tests use a shorter one)
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
  const now = typeof deps.now === "function" ? deps.now : () => new Date();

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
    if ((errCode === "jd_unusable" || errCode === "ledger_empty") && typeof error?.message === "string") {
      return { code: errCode, message: error.message };
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
        activeJob = job;
        try {
          await runJob(job);
        } catch (err) {
          await failJob(job, err);
        } finally {
          activeJob = null;
          inFlight.delete(job.payload.slug);
        }
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
    console.error(`[materials] slug=${job.payload.slug} ${failure.code}:`, err);
    const record = withPhase(job.record, "failed", failure.message, failure.code);
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
    if (jd.source === "scrape" || jd.source === "request") {
      await writeJdFile(dir, jdText, {
        source: jd.source,
        jobUrl: payload.jobUrl,
        nowIso: isoNow(),
      });
    }

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
    const resumeSource = normalizeResumeSource(payload.resume);
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
      ledger = await ensureLedger({ profile, resumeText, resumeSource: resumeSource.source });
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

    /* F8 repair: an existing draft plus notes re-enters at the draft
     * stage with the notes as editor instructions. */
    let current;
    let repairInstructions = "";
    if (payload.resumeFrom) {
      try {
        current = JSON.parse(await readFile(join(dir, "draft.json"), "utf8"));
        repairInstructions = typeof payload.notes === "string" ? payload.notes : "";
      } catch {
        current = undefined;
      }
    }
    const voiceSamples = await collectVoiceSamples(current ? { ...payload, notes: "" } : payload);

    const words = jdText.split(/\s+/).filter(Boolean).length;
    const gate = {
      verdict: "usable",
      confidence: Math.min(0.95, Math.round((0.5 + words / 2000) * 100) / 100),
      signals: { words, source: jd.source },
    };
    const runId = newRunId(payload.slug, job.record.requested_at || isoNow());
    await runPipeline({
      dir,
      payload,
      pin: resolved,
      fetchImpl,
      jdText,
      jdSource: jd.source,
      gate,
      ledger,
      resumeText,
      voice: voiceSamples,
      now: now(),
      runId,
      openSession: openSession || (async () => null),
      readMarks: async () => {
        try {
          return await logoLoader();
        } catch {
          return [];
        }
      },
      onStage: (stage, status) => {
        job.record = withPhase(job.record, "drafting", `Drafting… (${stage}: ${status})`);
        void writePending(pendingPath, job.record).catch(() => {});
      },
      current,
      repairInstructions,
    });
    /* The pipeline wrote the package (or returned the cached one) — the
     * spinner comes down either way. */
    await rm(pendingPath, { force: true });
  }

  /**
   * @param {MaterialsRequestPayload} payload
   */
  async function enqueue(payload) {
    const resumeSource = normalizeResumeSource(payload && payload.resume);
    if (!resumeSource) throw resumeRequiredError();
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
