/**
 * Local API for Cheerio job scraping (CORS-enabled for JobBored static app).
 * Usage: npm install && npm start
 * Default: http://127.0.0.1:3847
 */
import "dotenv/config";
import express from "express";
import { createReadStream } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { normalizeAtsRequestPayload } from "./ats-request-payload.mjs";
import { analyzeAtsScorecard, getAtsConfigStatus } from "./ats-scorecard.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";
import {
  normalizeAllowedBrowserOrigins,
  resolveAllowedBrowserOrigin,
  validateScrapeTargetWithDns,
} from "./security-boundaries.mjs";
import {
  buildManifest,
  dismissPending,
  listApplications,
  listPendingQueue,
  resolveFile,
  writeJobDescription,
  getApplicationsRoot,
  isValidSlug,
} from "./application-materials.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeRequestBody,
  spawnMaterialsRequest,
} from "./materials-request.mjs";
import {
  assertAllowedUploadName,
  listLogos,
  parseMultipartFile,
  refreshLogosFromProfile,
  runResolver,
  saveUpload,
} from "./brand-logos.mjs";
import { buildRepairRequestPayload } from "./materials-repair.mjs";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  readProfile,
  writeProfileAtomic,
} from "./user-profile.mjs";
import { migrateLegacyProfileIfPresent } from "./legacy-profile-migrator.mjs";
import {
  analyzeResumeToProfile,
  getStoredResumeText,
} from "./profile-from-resume.mjs";
import {
  getProfileRescoreProviderConfigFromEnv,
  getProfileRescoreProviderStatus,
  loadWorkerConfig,
  rescoreAllPipelineRows,
} from "./profile-rescore-worker.mjs";

const PORT = Number(process.env.PORT) || 3847;
/** 127.0.0.1 for local dev; set LISTEN_HOST=0.0.0.0 on Render/Fly/Docker so the service accepts external traffic. */
const HOST = process.env.LISTEN_HOST || "127.0.0.1";
const ALLOWED_BROWSER_ORIGINS = normalizeAllowedBrowserOrigins(
  process.env.COMMAND_CENTER_ALLOWED_ORIGINS ||
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    "",
  {
    listenHost: HOST,
  },
);
const app = express();

// When the service binds to a non-loopback host (Render/Fly/Docker), every
// non-health endpoint can expose or mutate local user data: require a shared
// token. Loopback local dev remains open so the static dashboard works with no
// extra setup.
const LOOPBACK_LISTEN_HOSTS = new Set(["", "127.0.0.1", "localhost", "::1"]);
const REQUIRE_API_AUTH = !LOOPBACK_LISTEN_HOSTS.has(String(HOST).toLowerCase());
const API_ACCESS_TOKEN = String(
  process.env.JOBBORED_API_TOKEN || process.env.API_ACCESS_TOKEN || "",
).trim();

function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireApiAuth(req, res, next) {
  if (!REQUIRE_API_AUTH) return next();
  if (!API_ACCESS_TOKEN) {
    return res.status(503).json({
      error:
        "This endpoint requires JOBBORED_API_TOKEN to be set when the server is bound to a non-loopback host.",
    });
  }
  const provided = String(req.get("x-api-token") || req.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!tokensMatch(provided, API_ACCESS_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

function getAtsProviderErrorMetadata(error) {
  if (!error || typeof error !== "object") return null;
  const provider = typeof error.provider === "string" ? error.provider : "";
  const upstreamStatus = Number.isInteger(error.upstreamStatus)
    ? error.upstreamStatus
    : null;
  const retryable =
    typeof error.retryable === "boolean" ? error.retryable : null;
  const classification =
    typeof error.classification === "string" ? error.classification : "";
  const providerCode =
    typeof error.providerCode === "string" ? error.providerCode : "";
  if (
    !provider &&
    upstreamStatus == null &&
    retryable == null &&
    !classification &&
    !providerCode
  ) {
    return null;
  }
  return {
    provider: provider || null,
    upstreamStatus,
    retryable,
    classification: classification || null,
    providerCode: providerCode || null,
  };
}

app.use((req, res, next) => {
  const requestOrigin = String(req.get("origin") || "").trim();
  const requestHost = String(
    req.get("x-forwarded-host") || req.get("host") || "",
  ).trim();
  const requestProtocol = String(
    req.get("x-forwarded-proto") || (req.secure ? "https" : req.protocol || "http"),
  )
    .split(",")[0]
    .trim();
  const allowOrigin = resolveAllowedBrowserOrigin(requestOrigin, {
    allowedOrigins: ALLOWED_BROWSER_ORIGINS,
    requestHost,
    requestProtocol,
  });

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Api-Token",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }

  if (requestOrigin && !allowOrigin) {
    return res.status(403).json({
      error: "Origin not allowed for this server.",
    });
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  const ats = getAtsConfigStatus();
  res.json({
    ok: true,
    service: "command-center-job-scraper",
    atsProvider: ats.provider,
    atsConfigured: ats.configured,
    ...(ats.configured ? {} : { atsConfigError: ats.reason }),
  });
});

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  return requireApiAuth(req, res, next);
});

// Opt-in static file serving for local dev and e2e tests. Off by default so
// production deployments don't accidentally expose the repo root.
// Enable with: JOBBORED_SERVE_STATIC=1 or JOBBORED_STATIC_ROOT=/path/to/dir
if (process.env.JOBBORED_SERVE_STATIC || process.env.JOBBORED_STATIC_ROOT) {
  const staticRoot = process.env.JOBBORED_STATIC_ROOT
    ? String(process.env.JOBBORED_STATIC_ROOT)
    : join(import.meta.dirname || ".", "..");
  app.use(express.static(staticRoot, { index: "index.html", extensions: ["html"] }));
}

app.post("/api/scrape-job", async (req, res) => {
  try {
    const raw = req.body && req.body.url;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Body must include { url: string }" });
    }
    const target = await validateScrapeTargetWithDns(raw);
    if (!target.ok) {
      return res.status(400).json({ error: target.error });
    }
    const result = await scrapeJobPosting(target.url, {
      title: typeof req.body.title === "string" ? req.body.title : "",
      company: typeof req.body.company === "string" ? req.body.company : "",
    });
    res.json(result);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Scrape failed";
    res.status(502).json({ error: msg });
  }
});

app.post("/api/ats-scorecard", async (req, res) => {
  const requestId = `ats_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const ats = getAtsConfigStatus();
    if (!ats.configured) {
      return res.status(503).json({
        error: ats.reason,
        requestId,
      });
    }
    const payload = normalizeAtsRequestPayload(req.body);
    const scorecard = await analyzeAtsScorecard(payload);
    res.json(scorecard);
    console.log(
      `[ats-scorecard] requestId=${requestId} ok model=${scorecard.model} overallScore=${scorecard.overallScore}`,
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "ATS scorecard failed";
    const status = /required|invalid|must be/i.test(msg) ? 400 : 502;
    const metadata = getAtsProviderErrorMetadata(e);
    const responseBody = {
      error: msg,
      requestId,
      ...(metadata && metadata.provider ? { provider: metadata.provider } : {}),
      ...(metadata && metadata.upstreamStatus != null
        ? { upstreamStatus: metadata.upstreamStatus }
        : {}),
      ...(metadata && metadata.retryable != null
        ? { retryable: metadata.retryable }
        : {}),
      ...(metadata && metadata.classification
        ? { errorClass: metadata.classification }
        : {}),
      ...(metadata && metadata.providerCode
        ? { providerCode: metadata.providerCode }
        : {}),
    };
    res.status(status).json(responseBody);
    console.warn(`[ats-scorecard] requestId=${requestId} status=${status} error=${msg}`);
  }
});

/* ----- User profile (Task #4) -----
 * GET  /profile                     → returns saved profile or { ok: false, reason: "no_profile" }
 * POST /profile                     → validates against user-profile.schema.json, writes atomically
 * POST /profile/template/:id        → returns a starter template (marketer | engineer | product_manager)
 *
 * Storage: ~/.jobbored/profile.json (override with JOBBORED_PROFILE_PATH).
 * Loopback local dev is open; hosted/non-loopback deployments are protected by
 * the global API token middleware above.
 */
app.get("/profile", async (_req, res) => {
  try {
    const result = await readProfile();
    if (!result.ok) {
      // 200 with ok:false so the wizard can branch cleanly without try/catch
      // on 404s. The "missing profile" state is the expected first-run case.
      return res.status(200).json({ ok: false, reason: result.reason });
    }
    return res.json({ ok: true, profile: result.profile });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "read_failed",
      detail: err && err.message ? String(err.message) : "read failed",
    });
  }
});

app.post("/profile", async (req, res) => {
  const candidate = req.body;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return res.status(400).json({
      ok: false,
      reason: "invalid_profile",
      errors: [{ message: "Request body must be a JSON object" }],
    });
  }
  try {
    const { updatedAt } = await writeProfileAtomic(candidate);
    try {
      await refreshLogosFromProfile(candidate);
    } catch (logoErr) {
      console.warn(
        "[brand-logos] profile save succeeded but logo refresh failed:",
        logoErr && logoErr.message ? logoErr.message : logoErr,
      );
      return res.json({
        ok: true,
        updatedAt,
        logoRefresh: {
          ok: false,
          error: logoErr && logoErr.message ? String(logoErr.message) : "logo refresh failed",
        },
      });
    }
    return res.json({ ok: true, updatedAt, logoRefresh: { ok: true } });
  } catch (err) {
    if (err && err.code === "INVALID_PROFILE") {
      return res.status(400).json({
        ok: false,
        reason: "invalid_profile",
        errors: err.errors || [],
      });
    }
    return res.status(500).json({
      ok: false,
      reason: "write_failed",
      detail: err && err.message ? String(err.message) : "write failed",
    });
  }
});

app.get("/api/brand-logos", async (_req, res) => {
  try {
    const result = await listLogos();
    res.json({ ok: true, ...result });
  } catch (e) {
    sendAppError(res, e);
  }
});

app.post("/api/brand-logos/resolve", async (req, res) => {
  try {
    const result = await runResolver({ force: !!(req.body && req.body.force) });
    res.json({ ok: true, logos: result });
  } catch (e) {
    sendAppError(res, e);
  }
});

app.post("/api/brand-logos/:slug", async (req, res) => {
  try {
    const upload = await parseMultipartFile(req);
    assertAllowedUploadName(upload.filename);
    const result = await saveUpload(req.params.slug, upload.buffer);
    res.json(result);
  } catch (e) {
    sendAppError(res, e);
  }
});

app.post("/profile/template/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const template = buildStarterTemplate(id);
  if (!template) {
    return res.status(404).json({
      ok: false,
      reason: "unknown_template",
      available: listStarterTemplateIds(),
    });
  }
  return res.json({ ok: true, template });
});

/**
 * POST /profile/from-resume
 *
 * Reads the user's stored resume text from a known location (worker config,
 * ~/.jobbored/resume.txt, or legacy hermes), runs it through the configured
 * profile AI provider, and returns a draft v1 UserProfile for the wizard to
 * display. Does NOT save.
 *
 * 200 { ok: true, profile, source }   — got a draft profile
 * 404 { ok: false, reason: "no_resume_stored" }
 * 500 { ok: false, reason: "profile_provider_error", message }
 */
app.post("/profile/from-resume", async (_req, res) => {
  let stored;
  try {
    stored = await getStoredResumeText();
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "resume_lookup_failed",
      message: err && err.message ? String(err.message) : "lookup failed",
    });
  }
  if (!stored) {
    return res.status(404).json({ ok: false, reason: "no_resume_stored" });
  }
  try {
    const profile = await analyzeResumeToProfile(stored.text);
    return res.json({ ok: true, profile, source: stored.source });
  } catch (err) {
    const code = err && err.code ? String(err.code) : "";
    if (code === "GEMINI_NOT_CONFIGURED") {
      return res.status(500).json({
        ok: false,
        reason: "gemini_not_configured",
        message: err.message,
      });
    }
    if (code === "PROFILE_PROVIDER_NOT_CONFIGURED") {
      return res.status(500).json({
        ok: false,
        reason: "profile_provider_not_configured",
        provider: typeof err.provider === "string" ? err.provider : undefined,
        message: err.message,
      });
    }
    const provider = err && typeof err.provider === "string" ? err.provider : "";
    const isGeminiError = provider === "gemini" || code.startsWith("GEMINI_");
    return res.status(500).json({
      ok: false,
      reason: isGeminiError ? "gemini_error" : "profile_provider_error",
      provider: provider || undefined,
      message: err && err.message ? String(err.message) : "profile provider failed",
    });
  }
});

/* ----- Profile backcompat: legacy migration + rescore (Task #6) ----- */

/**
 * POST /profile/migrate
 * Idempotent. Reads ~/.hermes/job-hunt/profile/{job-preferences,profile}.md,
 * parses into a v1 UserProfile, writes ~/.jobbored/profile.json, drops a
 * `.migrated.v1` marker so repeat calls are no-ops.
 */
app.post("/profile/migrate", async (_req, res) => {
  try {
    const result = await migrateLegacyProfileIfPresent();
    if (result.migrated) {
      return res.json({ ok: true, migrated: true, profile: result.profile });
    }
    return res.json({ ok: true, migrated: false, reason: result.reason });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "migration_failed",
      message: String(err && err.message ? err.message : err),
    });
  }
});

/**
 * POST /profile/rescore[?dryRun=true]
 *
 * Walks the Pipeline sheet and re-scores every eligible row against the
 * current saved Fit Profile using the configured server chat provider. Streams per-row progress
 * as Server-Sent Events; the final event carries totals.
 *
 * Query params:
 *   - dryRun=true → returns a JSON summary of how many rows WOULD be rescored
 *                   without calling Gemini or writing back to the sheet.
 *
 * SSE event shapes (one per `data:` line):
 *   { kind: "progress", row, status: "scored"|"skipped"|"failed", reason? }
 *   { kind: "done", rescored, skipped, failed, total }
 *   { kind: "error", message }
 */
app.post("/profile/rescore", async (req, res) => {
  const dryRun = String(req.query.dryRun || "").toLowerCase() === "true";
  const maxRowsRaw = Number.parseInt(String(req.query.maxRows || ""), 10);
  const maxRows = Number.isFinite(maxRowsRaw) && maxRowsRaw > 0 ? maxRowsRaw : undefined;

  // Load current profile
  const profileResult = await readProfile();
  if (!profileResult.ok) {
    return res
      .status(400)
      .json({ ok: false, reason: "no_profile", detail: profileResult.reason });
  }

  // Resolve chat provider config before opening the SSE stream. Dry runs still
  // avoid LLM validation because they only count rows.
  const providerConfig = getProfileRescoreProviderConfigFromEnv();
  const providerStatus = getProfileRescoreProviderStatus(providerConfig);
  if (!providerStatus.configured && !dryRun) {
    return res.status(503).json({
      ok: false,
      reason: "llm_not_configured",
      provider: providerStatus.provider,
      detail: providerStatus.detail,
      ...(providerStatus.requiredEnvVars
        ? { requiredEnvVars: providerStatus.requiredEnvVars }
        : {}),
    });
  }

  // Resolve sheet id from worker-config (same source the discovery worker uses).
  let sheetId = "";
  try {
    const cfg = await loadWorkerConfig();
    sheetId = cfg.sheetId;
  } catch (err) {
    return res.status(503).json({
      ok: false,
      reason: "worker_config_missing",
      detail: String(err && err.message ? err.message : err),
    });
  }

  // Dry run path: short-circuit with JSON (no SSE).
  if (dryRun) {
    try {
      const summary = await rescoreAllPipelineRows({
        profile: profileResult.profile,
        sheetId,
        dryRun: true,
      });
      return res.json({ ok: true, dryRun: true, ...summary });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        reason: "dry_run_failed",
        message: String(err && err.message ? err.message : err),
      });
    }
  }

  // Live path: open SSE.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    const summary = await rescoreAllPipelineRows({
      profile: profileResult.profile,
      sheetId,
      providerConfig,
      onProgress: sendEvent,
      signal: ac.signal,
      maxRows,
    });
    sendEvent({ kind: "done", ...summary });
  } catch (err) {
    sendEvent({
      kind: "error",
      message: String(err && err.message ? err.message : err),
    });
  } finally {
    res.end();
  }
});

/* ----- Application materials (read-only local file surface) -----
 * GET /api/applications                       → list known packages
 * GET /api/applications/:slug/manifest        → JSON manifest (derived
 *                                                from disk when manifest.json
 *                                                is absent)
 * GET /api/applications/:slug/files/:filename → stream allowlisted file
 *
 * These endpoints only ever read from ~/.hermes/job-hunt/applications/
 * (override via HERMES_APPLICATIONS_ROOT). The allowlist + slug pattern +
 * realpath check in application-materials.mjs are what keep this safe.
 */
function sendAppError(res, err) {
  const status = Number(err && err.statusCode);
  const message = err && err.message ? String(err.message) : "Application materials error";
  res.status(Number.isFinite(status) ? status : 500).json({ error: message });
}

app.get("/api/applications", async (_req, res) => {
  try {
    const apps = await listApplications();
    res.json({ applications: apps });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Global queue view: every pending.json across all application slugs,
 * FIFO ordered. Powers the dashboard-level queue strip so the user
 * can see what's lined up regardless of which dossier is open. */
app.get("/api/applications/queue", async (_req, res) => {
  try {
    const queue = await listPendingQueue();
    res.json({ queue, fetchedAt: new Date().toISOString() });
  } catch (e) {
    sendAppError(res, e);
  }
});

app.get("/api/applications/:slug/manifest", async (req, res) => {
  try {
    const manifest = await buildManifest(req.params.slug);
    res.json(manifest);
  } catch (e) {
    sendAppError(res, e);
  }
});

app.post("/api/applications/:slug/request", async (req, res) => {
  try {
    /* The body's slug must agree with the URL slug to keep the
     * contract obvious and avoid accidental cross-slug requests. */
    const body = { ...(req.body || {}), slug: req.params.slug };
    const payload = normalizeRequestBody(body);
    const result = await spawnMaterialsRequest(payload);
    res.json(result);
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Converts a Review-status artifact into a concrete Hermes regeneration
 * request. The quality gate decides which document needs work; this
 * endpoint turns those issue codes into repair notes that ask Hermes to
 * expand sparse drafts or collapse overlong ones automatically. */
app.post("/api/applications/:slug/repair", async (req, res) => {
  try {
    const manifest = await buildManifest(req.params.slug);
    const { payload: rawPayload, repair } = buildRepairRequestPayload(manifest, {
      feature: req.body && req.body.feature,
      jobUrl: req.body && (req.body.jobUrl || req.body.job_url),
      notes: req.body && req.body.notes,
    });
    const payload = normalizeRequestBody(rawPayload);
    const result = await spawnMaterialsRequest(payload);
    res.json({ ...result, repair });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Dismisses a stuck/failed pending.json by archiving it (rename, not
 * delete) so the JobBored UI clears its FAILED card without losing
 * the watcher's last-known state. Intended for the user clicking
 * "Dismiss" on a terminal-phase progress card — Dobby leaves
 * pending.json in place on failure by design. */
app.post("/api/applications/:slug/dismiss", async (req, res) => {
  try {
    const result = await dismissPending(req.params.slug);
    res.json({ ok: true, ...result });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Reports whether job-description.md exists for this slug. Used by
 * the browser as the first step of the JD fallback chain — if it's
 * already present we skip straight to drafting; if not, the browser
 * tries cache → server-scrape → user-paste in that order. */
app.get("/api/applications/:slug/job-description", async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!isValidSlug(slug)) {
      res.status(400).json({ ok: false, error: "Invalid slug" });
      return;
    }
    const filePath = join(getApplicationsRoot(), slug, "job-description.md");
    res.json({ ok: true, exists: existsSync(filePath) });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Writes job-description.md for a slug. Body: { text, source?, jobUrl? }.
 * source is one of "browser-cache" / "server-scrape" / "user-paste" and
 * gets recorded in the file header so downstream graders know how the
 * JD was acquired. Creates the application directory if needed. */
app.put("/api/applications/:slug/job-description", async (req, res) => {
  try {
    const slug = req.params.slug;
    const body = req.body || {};
    const result = await writeJobDescription(slug, body.text, {
      source: body.source,
      jobUrl: body.jobUrl || body.job_url,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Server-side JD scrape fallback. Used by the browser when the
 * job-description.md is missing and the browser cache is empty (e.g.
 * after a page reload). Reuses the existing scrapeJobPosting() so we
 * don't duplicate scraping logic. Returns the scraped description
 * text, which the browser then PUTs back via /job-description. */
app.post("/api/applications/:slug/scrape-job-description", async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!isValidSlug(slug)) {
      res.status(400).json({ ok: false, error: "Invalid slug" });
      return;
    }
    const url = (req.body && typeof req.body.jobUrl === "string") ? req.body.jobUrl.trim()
              : (req.body && typeof req.body.job_url === "string") ? req.body.job_url.trim()
              : "";
    if (!url) {
      res.status(400).json({ ok: false, error: "jobUrl required" });
      return;
    }
    const target = await validateScrapeTargetWithDns(url);
    if (!target.ok) {
      res.status(400).json({ ok: false, error: target.error });
      return;
    }
    const scraped = await scrapeJobPosting(target.url, {
      title: typeof req.body.title === "string" ? req.body.title : "",
      company: typeof req.body.company === "string" ? req.body.company : "",
    });
    const text = (scraped && (scraped.description || scraped.bodyText || ""))
      .toString().trim();
    if (!text) {
      res.status(502).json({ ok: false, error: "Scrape returned no description text" });
      return;
    }
    res.json({
      ok: true,
      text,
      jobUrl: target.url,
      source: scraped.source || scraped.method || "server-scrape",
      title: scraped.title || "",
      company: scraped.company || "",
      scrapedAt: new Date().toISOString(),
    });
  } catch (e) {
    sendAppError(res, e);
  }
});

app.get("/api/applications/:slug/files/:filename", async (req, res) => {
  try {
    const meta = await resolveFile(req.params.slug, req.params.filename);
    res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Content-Length", String(meta.size));
    res.setHeader("Last-Modified", meta.modifiedAt);
    res.setHeader("Cache-Control", "no-store");
    /* PDFs default to inline (browsers know how to preview), HTML renders
     * in a new tab, and Markdown is served as text/markdown so the
     * dashboard can fetch + render it. The "download" intent is the
     * client's call — they pass ?download=1 to force an attachment. */
    if (String(req.query.download || "") === "1") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${req.params.filename.replace(/"/g, "")}"`,
      );
    }
    const stream = createReadStream(meta.absolutePath);
    stream.on("error", (err) => {
      if (!res.headersSent) sendAppError(res, err);
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    sendAppError(res, e);
  }
});

app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error:
        "Request body too large for ATS endpoint. Reduce payload size or raise server JSON limit.",
    });
  }
  return next(err);
});

app.listen(PORT, HOST, () => {
  const ats = getAtsConfigStatus();
  const where =
    HOST === "0.0.0.0" || HOST === "::"
      ? `port ${PORT} (${HOST})`
      : `http://127.0.0.1:${PORT}`;
  console.log(`[job-scraper] listening ${where}  POST /api/scrape-job { "url": "…" }`);
  if (!ats.configured) {
    console.warn(`[ats-scorecard] not configured: ${ats.reason}`);
  }
});
