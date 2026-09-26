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
import { routeDeadlineSignal } from "./ai/provider.mjs";
import {
  scrapeJobPosting,
  toScrapeFailureResponse,
} from "./shared/job-scraper-core.mjs";
import {
  normalizeAllowedBrowserOrigins,
  redactSecrets,
  resolveAllowedBrowserOrigin,
  trustedRequestOriginParts,
  validateScrapeTargetWithDns,
  checkLoopbackRequestHost,
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
  migrateHermesApplicationsIfNeeded,
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
import { reconcileOrphanedPending } from "./materials-drafter.mjs";
import { buildRepairRequestPayload } from "./materials-repair.mjs";
import { regeneratePackage } from "./materials-regenerate.mjs";
import { listFamilies } from "./materials-templates.mjs";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  readProfile,
  writeProfileAtomic,
} from "./user-profile.mjs";
import { migrateLegacyProfileIfPresent } from "./legacy-profile-migrator.mjs";
import {
  analyzeResumeToProfile,
  parseProfileProviderConfigFromBody,
  resolveResumeTextForAnalysis,
} from "./profile-from-resume.mjs";
import {
  endRouteRescore,
  getProfileRescoreProviderConfigFromEnv,
  getProfileRescoreProviderStatus,
  loadWorkerConfig,
  rescoreAllPipelineRows,
  tryBeginRouteRescore,
} from "./profile-rescore-worker.mjs";
import { handleGetLlmConfig, handlePostLlmConfig } from "./llm-config.mjs";

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

// BEAUDIT E7: the api-error.v1 envelope (schemas/api-error.v1.schema.json).
// Every error response (status >= 400) with a JSON object body gains
// { error, code, detail?, nextStep?, retryable } next to its existing fields,
// so one reader handles every route. Success bodies are left alone.
/** @type {Record<number, string>} */
const API_ERROR_STATUS_CODES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  421: "MISDIRECTED_REQUEST",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "UPSTREAM_ERROR",
  503: "SERVICE_UNAVAILABLE",
  504: "UPSTREAM_TIMEOUT",
};

/** @param {unknown} value */
function apiErrorText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {unknown}
 */
function withApiErrorEnvelope(status, body) {
  if (status < 400 || !body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  const record = /** @type {Record<string, unknown>} */ (body);
  const code =
    apiErrorText(record.code) ||
    apiErrorText(record.reason) ||
    API_ERROR_STATUS_CODES[status] ||
    (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
  const error =
    apiErrorText(record.error) ||
    apiErrorText(record.message) ||
    "The request could not be completed.";
  const detail = apiErrorText(record.detail);
  const nextStep =
    apiErrorText(record.nextStep) ||
    apiErrorText(record.remediation) ||
    apiErrorText(record.hint);
  const retryable =
    typeof record.retryable === "boolean"
      ? record.retryable
      : status >= 500 || status === 429;
  return {
    ...record,
    error,
    code,
    ...(detail ? { detail } : {}),
    ...(nextStep ? { nextStep } : {}),
    retryable,
  };
}

app.use((_req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(withApiErrorEnvelope(res.statusCode, body));
  next();
});

// When the service binds to a non-loopback host (Render/Fly/Docker), every
// non-health endpoint can expose or mutate local user data: require a shared
// token. Loopback local dev remains open so the static dashboard works with no
// extra setup.
const LOOPBACK_LISTEN_HOSTS = new Set(["", "127.0.0.1", "localhost", "::1"]);
const REQUIRE_API_AUTH = !LOOPBACK_LISTEN_HOSTS.has(String(HOST).toLowerCase());
/** Public names this API answers to besides loopback, e.g. api.example.com or *.example.com. */
const API_TRUSTED_HOSTS = String(process.env.JOBBORED_API_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const API_ACCESS_TOKEN = String(
  process.env.JOBBORED_API_TOKEN || process.env.API_ACCESS_TOKEN || "",
).trim();

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} error
 * @param {unknown} fallback
 */
function errorMessage(error, fallback) {
  const errorLike = /** @type {{ message?: unknown } | null | undefined} */ (error);
  return String(errorLike && errorLike.message ? errorLike.message : fallback);
}

/**
 * @param {string} provided
 * @param {string} expected
 */
function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
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

/** @param {unknown} error */
function getAtsProviderErrorMetadata(error) {
  if (!error || typeof error !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (error);
  const provider = typeof record.provider === "string" ? record.provider : "";
  const upstreamStatus =
    typeof record.upstreamStatus === "number" && Number.isInteger(record.upstreamStatus)
    ? record.upstreamStatus
    : null;
  const retryable =
    typeof record.retryable === "boolean" ? record.retryable : null;
  const classification =
    typeof record.classification === "string" ? record.classification : "";
  const providerCode =
    typeof record.providerCode === "string" ? record.providerCode : "";
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

// BEAUDIT E1: a DNS-rebound page reaches this loopback listener with its own
// name in Host. Refuse any Host outside {127.0.0.1, localhost, [::1]}:PORT
// (plus JOBBORED_API_ALLOWED_HOSTS) before CORS, auth or a route can see it.
// A hosted listener (LISTEN_HOST not loopback) sits behind a proxy that may
// connect over 127.0.0.1 with the public Host; the token gate protects it, so
// the Host check applies there only when trusted hosts are configured. Once
// configured, the allowlist binds on every socket, loopback or not.
app.use((req, res, next) => {
  if (REQUIRE_API_AUTH && API_TRUSTED_HOSTS.length === 0) return next();
  const hostCheck = checkLoopbackRequestHost(req, { allowedHosts: API_TRUSTED_HOSTS });
  if (!hostCheck.ok) {
    return res.status(hostCheck.status).json({
      error: hostCheck.error,
      code: hostCheck.code,
    });
  }
  return next();
});

app.use((req, res, next) => {
  const { requestOrigin, requestHost, requestProtocol } = trustedRequestOriginParts(req);
  const allowOrigin = resolveAllowedBrowserOrigin(requestOrigin, {
    allowedOrigins: ALLOWED_BROWSER_ORIGINS,
    requestHost,
    requestProtocol,
    loopbackPort: REQUIRE_API_AUTH ? undefined : req.socket.localPort,
    trustedHosts: API_TRUSTED_HOSTS,
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

app.get("/api/llm-config", (req, res) => handleGetLlmConfig(req, res));
app.post("/api/llm-config", (req, res) => handlePostLlmConfig(req, res));

app.post("/api/scrape-job", async (req, res) => {
  let targetUrl = "";
  try {
    const body = isRecord(req.body) ? req.body : {};
    const raw = body.url;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Body must include { url: string }" });
    }
    const target = await validateScrapeTargetWithDns(raw);
    if (!target.ok) {
      return res.status(400).json({ error: target.error });
    }
    targetUrl = target.url;
    const result = await scrapeJobPosting(target.url, {
      title: typeof body.title === "string" ? body.title : "",
      company: typeof body.company === "string" ? body.company : "",
      // E11: a closed tab aborts the Gemini URL Context call.
      signal: routeDeadlineSignal(req, res),
    });
    res.json(result);
  } catch (e) {
    const failure = toScrapeFailureResponse(e, targetUrl);
    res.status(failure.status).json(failure.body);
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
    // E11: a closed tab aborts the provider call instead of running to its timeout.
    const scorecard = await analyzeAtsScorecard(payload, { signal: routeDeadlineSignal(req, res) });
    res.json(scorecard);
    console.log(
      `[ats-scorecard] requestId=${requestId} ok model=${scorecard.model} overallScore=${scorecard.overallScore}`,
    );
  } catch (e) {
    const metadata = getAtsProviderErrorMetadata(e);
    const rawMsg = errorMessage(e, "ATS scorecard failed");
    const status = metadata
      ? 502
      : /required|invalid|must be/i.test(rawMsg)
        ? 400
        : 502;
    const publicError = metadata
      ? "Upstream provider request failed"
      : redactSecrets(rawMsg);
    const responseBody = {
      error: publicError,
      code: status === 400 ? "INVALID_REQUEST" : "UPSTREAM_ERROR",
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
    console.warn(
      `[ats-scorecard] requestId=${requestId} status=${status} error=${redactSecrets(rawMsg)}`,
    );
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
      // F17: a schema-invalid file reports invalid_profile with the errors.
      return res.status(200).json({
        ok: false,
        reason: result.reason,
        ...(result.reason === "invalid_profile" && result.errors
          ? { errors: result.errors }
          : {}),
      });
    }
    return res.json({ ok: true, profile: result.profile });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "read_failed",
      detail: errorMessage(err, "read failed"),
    });
  }
});

app.post("/profile", async (req, res) => {
  const candidate = req.body;
  if (!isRecord(candidate)) {
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
      const logoError = /** @type {{ message?: unknown } | null | undefined} */ (logoErr);
      console.warn(
        "[brand-logos] profile save succeeded but logo refresh failed:",
        logoError && logoError.message ? logoError.message : logoErr,
      );
      return res.json({
        ok: true,
        updatedAt,
        logoRefresh: {
          ok: false,
          error: errorMessage(logoErr, "logo refresh failed"),
        },
      });
    }
    return res.json({ ok: true, updatedAt, logoRefresh: { ok: true } });
  } catch (err) {
    const error = /** @type {Record<string, unknown> | null | undefined} */ (err);
    if (error && error.code === "INVALID_PROFILE") {
      return res.status(400).json({
        ok: false,
        reason: "invalid_profile",
        errors: error.errors || [],
      });
    }
    return res.status(500).json({
      ok: false,
      reason: "write_failed",
      detail: errorMessage(err, "write failed"),
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
    const body = isRecord(req.body) ? req.body : {};
    const result = await runResolver({ force: !!body.force });
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

/** E11: route deadline for drafting a profile (local models can be slow). */
const PROFILE_ROUTE_DEADLINE_MS = 180_000;

/**
 * POST /profile/from-resume
 *
 * Prefers request-body `resumeText` (browser-staged) and caches it to
 * ~/.jobbored/resume.txt — the server half of the ONE-FLOW resume dual
 * write (spec §5 B3), so the next reader sees the same resume the browser
 * has. Falls back to stored resume text (worker config,
 * ~/.jobbored/resume.txt, or legacy hermes). Runs the provider the request
 * body names — the one the browser verified on Beat 2 — falling back to the
 * server's env config when the body names none, and returns a draft v1
 * UserProfile for review. Does NOT save the profile — the user confirms
 * that on the next screen.
 *
 * 200 { ok: true, profile, source }   — got a draft profile
 * 404 { ok: false, reason: "no_resume_stored" }
 * 500 { ok: false, reason: "profile_provider_error", message }
 */
app.post("/profile/from-resume", async (req, res) => {
  let stored;
  try {
    stored = await resolveResumeTextForAnalysis(req.body);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "resume_lookup_failed",
      message: errorMessage(err, "lookup failed"),
    });
  }
  if (!stored) {
    return res.status(404).json({ ok: false, reason: "no_resume_stored" });
  }
  // The provider the browser verified on Beat 2 wins over the server's env
  // (SIXBEATS2-SPEC locked decision 3). Without this a fresh install that
  // connected OpenRouter was answered "Missing Gemini API key" — NEW-2.
  const requestedConfig = parseProfileProviderConfigFromBody(req.body);
  try {
    // E11: a closed tab aborts the provider call. Drafting a profile from a
    // long resume on a local model can take minutes, hence the long deadline.
    const signal = routeDeadlineSignal(req, res, PROFILE_ROUTE_DEADLINE_MS);
    const profile = await analyzeResumeToProfile(
      stored.text,
      requestedConfig ? { config: requestedConfig, signal } : { signal },
    );
    return res.json({ ok: true, profile, source: stored.source });
  } catch (err) {
    const error = /** @type {Record<string, unknown> | null | undefined} */ (err);
    const code = error && error.code ? String(error.code) : "";
    // A provider with no key is the CLIENT's configuration state, not a
    // server fault: 409, so the dashboard can route the user to the AI step
    // instead of reporting an internal error (walkthrough 2026-09-02, step 12).
    if (code === "GEMINI_NOT_CONFIGURED") {
      return res.status(409).json({
        ok: false,
        reason: "gemini_not_configured",
        message: errorMessage(err, "profile provider failed"),
      });
    }
    if (code === "PROFILE_PROVIDER_NOT_CONFIGURED") {
      return res.status(409).json({
        ok: false,
        reason: "profile_provider_not_configured",
        provider: error && typeof error.provider === "string" ? error.provider : undefined,
        message: errorMessage(err, "profile provider failed"),
      });
    }
    const provider = error && typeof error.provider === "string" ? error.provider : "";
    const isGeminiError = provider === "gemini" || code.startsWith("GEMINI_");
    return res.status(500).json({
      ok: false,
      reason: isGeminiError ? "gemini_error" : "profile_provider_error",
      provider: provider || undefined,
      message: errorMessage(err, "profile provider failed"),
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
      message: errorMessage(err, err),
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
      detail: errorMessage(err, err),
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
        message: errorMessage(err, err),
      });
    }
  }

  // F4: one live rescore at a time; a second click gets 409, not a
  // second run whose stale writes would win. Dry runs bypass the lock.
  if (!tryBeginRouteRescore()) {
    return res.status(409).json({
      ok: false,
      reason: "rescore_in_progress",
      detail: "A rescore is already running; wait for it to finish.",
      retryable: true,
    });
  }

  // Live path: open SSE.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  /** @param {Record<string, unknown>} payload */
  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // E11: the stream ends when the client leaves (response close), with no
  // route deadline; each provider call keeps its own timeout. req "close"
  // fires once the request body is consumed (Node 16+), so it cannot mean
  // "client left".
  const signal = routeDeadlineSignal(req, res, Infinity);

  try {
    const summary = await rescoreAllPipelineRows({
      profile: profileResult.profile,
      sheetId,
      providerConfig,
      onProgress: sendEvent,
      signal,
      maxRows,
      profileUpdatedAt: profileResult.profile?.updatedAt,
    });
    sendEvent({ kind: "done", ...summary });
  } catch (err) {
    sendEvent({
      kind: "error",
      message: errorMessage(err, err),
    });
  } finally {
    endRouteRescore();
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
 * These endpoints only ever read from ~/.jobbored/applications/
 * (override via JOBBORED_APPLICATIONS_ROOT; HERMES_APPLICATIONS_ROOT is
 * a test alias). The allowlist + slug pattern +
 * realpath check in application-materials.mjs are what keep this safe.
 */
/**
 * @param {import("express").Response} res
 * @param {unknown} err
 */
function sendAppError(res, err) {
  const error = /** @type {{ statusCode?: unknown, code?: unknown } | null | undefined} */ (err);
  const status = Number(error && error.statusCode);
  const message = errorMessage(err, "Application materials error");
  /** @type {{ error: string, code?: string, validTemplates?: string[] }} */
  const body = { error: message };
  if (error && typeof error.code === "string" && error.code) {
    body.code = error.code;
  }
  const valid = error && /** @type {{ validTemplates?: unknown }} */ (error).validTemplates;
  if (Array.isArray(valid)) body.validTemplates = valid.map(String);
  res.status(Number.isFinite(status) ? status : 500).json(body);
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

/* Materials template registry (visual spec §9): the families the Profile &
 * Materials select offers. The browser falls back to its bundled list when
 * this server is not running. */
app.get("/api/materials/templates", (_req, res) => {
  try {
    res.json({ templates: listFamilies() });
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
    const requestBody = isRecord(req.body) ? req.body : {};
    const body = { ...requestBody, slug: req.params.slug };
    const payload = normalizeRequestBody(body);
    const result = await spawnMaterialsRequest(payload);
    res.json(result);
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Converts a Review-status artifact into a regeneration request on the
 * in-process drafter FIFO. The quality gate decides which document needs
 * work; this endpoint turns those issue codes into repair notes. */
app.post("/api/applications/:slug/repair", async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const manifest = await buildManifest(req.params.slug);
    const { payload: rawPayload, repair } = buildRepairRequestPayload(manifest, {
      feature: body.feature,
      jobUrl: body.jobUrl || body.job_url,
      notes: body.notes,
    });
    /* A repair keeps the package's family unless the request names one. */
    const manifestTemplate = manifest && manifest.template && typeof manifest.template === "object"
      ? /** @type {{ family?: unknown }} */ (manifest.template).family
      : undefined;
    const payload = normalizeRequestBody({
      ...rawPayload,
      template: body.template,
      preferredTemplate: body.preferredTemplate || manifestTemplate,
    });
    const result = await spawnMaterialsRequest(payload);
    res.json({ ...result, repair });
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Re-renders the published package in another template family from its
 * stored render model: fit → render → qa only, no LLM call. Body:
 * { template: "<family>", from?: "<runId>" }. Unknown family → 400. */
app.post("/api/applications/:slug/regenerate", async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const result = await regeneratePackage({
      slug: req.params.slug,
      template: body.template,
      from: typeof body.from === "string" ? body.from : undefined,
    });
    res.json(result);
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
    const body = isRecord(req.body) ? req.body : {};
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
  let targetUrl = "";
  try {
    const slug = req.params.slug;
    const body = isRecord(req.body) ? req.body : {};
    if (!isValidSlug(slug)) {
      res.status(400).json({ ok: false, error: "Invalid slug" });
      return;
    }
    const url = typeof body.jobUrl === "string" ? body.jobUrl.trim()
              : typeof body.job_url === "string" ? body.job_url.trim()
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
    targetUrl = target.url;
    const scraped = await scrapeJobPosting(target.url, {
      title: typeof body.title === "string" ? body.title : "",
      company: typeof body.company === "string" ? body.company : "",
      signal: routeDeadlineSignal(req, res),
    });
    const scrapeOutput = /** @type {typeof scraped & { bodyText?: unknown }} */ (scraped);
    const text = (scraped && (scraped.description || scrapeOutput.bodyText || ""))
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
    const failure = toScrapeFailureResponse(e, targetUrl);
    res.status(failure.status).json({ ok: false, ...failure.body });
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

app.use(/** @type {import("express").ErrorRequestHandler} */ ((err, _req, res, next) => {
  if (!err) return next();
  const error = /** @type {{ type?: unknown, status?: unknown, statusCode?: unknown }} */ (err);
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request body is too large.",
      code: "PAYLOAD_TOO_LARGE",
      nextStep: "Send a smaller body (the limit is 2 MB).",
      retryable: false,
    });
  }
  const status = Number(error.status || error.statusCode);
  if (
    error.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && status === 400)
  ) {
    return res.status(400).json({
      error: "Malformed JSON body",
      code: "INVALID_JSON",
    });
  }
  // BEAUDIT E7: any other thrown error answers JSON, never Express's HTML page.
  const failureStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  console.error("[job-scraper] unhandled route error:", errorMessage(err, "error"));
  if (res.headersSent) return next(err);
  return res.status(failureStatus).json({
    error: failureStatus >= 500 ? "Internal error." : "The request could not be completed.",
    code: API_ERROR_STATUS_CODES[failureStatus] || "INTERNAL_ERROR",
  });
}));

// BEAUDIT E7: an unknown route is a JSON 404 (it used to be Express's HTML).
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    code: "NOT_FOUND",
    detail: `No API route for ${req.method} ${req.path}.`,
  });
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
  void migrateHermesApplicationsIfNeeded();
  /* F14: pre-restart queued/drafting pending belongs to a dead FIFO. */
  void reconcileOrphanedPending().then(
    (out) => {
      if (out.reconciled) console.log(`[materials] reconciled ${out.reconciled} orphaned pending`);
    },
    (err) => console.warn("[materials] orphan reconcile failed:", err),
  );
});
