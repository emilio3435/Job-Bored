/**
 * Local API for Cheerio job scraping (CORS-enabled for JobBored static app).
 * Usage: npm install && npm start
 * Default: http://127.0.0.1:3847
 */
import "./net-defaults.mjs";
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
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeRequestBody,
  spawnMaterialsRequest,
  withRepairIdempotency,
} from "./materials-request.mjs";
import {
  assertAllowedUploadName,
  listLogos,
  parseMultipartFile,
  runResolver,
  saveUpload,
} from "./brand-logos.mjs";
import { refreshLogosFromLedger } from "./materials-logos.mjs";
import { reconcileOrphanedPending } from "./materials-drafter.mjs";
import { buildRepairRequestPayload } from "./materials-repair.mjs";
import { regeneratePackage, templateRegenerateResponse } from "./materials-regenerate.mjs";
import { registerMaterialsEditRoutes } from "./materials-versions.mjs";
import { diffRuns, listRuns, loadRepairSource, promoteRun } from "./materials-history.mjs";
import { loadChecklist, setChecklistItem } from "./materials-checklist.mjs";
import { buildDocx, DOCX_CONTENT_TYPE, EXPORTS, isExportName, linkedinText, servedRenderModel } from "./materials-export.mjs";
import { listFamilies } from "./materials-templates.mjs";
import {
  buildStarterTemplate,
  listStarterTemplateIds,
  readProfile,
  writeProfileAtomic,
} from "./user-profile.mjs";
import { migrateLegacyProfileIfPresent } from "./legacy-profile-migrator.mjs";
import {
  carryForwardContact,
  contactOf,
  normalizeContact,
  withContact,
} from "./profile-identity.mjs";
import { isVoiceError, readVoice, removeVoice, saveVoice } from "./profile-voice.mjs";
import { readLedger, resolveLedgerPath } from "./materials-ledger.mjs";
import { mountProfileResume, suggestContactFromSources } from "./profile-resume-sync.mjs";
import { commitBarrier, createProfileCommitService, mountProfileCommit } from "./profile-commit.mjs";
import { ensureLedger } from "./materials-ledger-build.mjs";
import {
  createProfileFromResumeHandler,
  createProfileFromResumeJsonParser,
  getStoredResumeText,
} from "./profile-from-resume.mjs";
import {
  endRouteRescore,
  getProfileRescoreProviderConfigFromEnv,
  getProfileRescoreProviderStatus,
  loadWorkerConfig,
  rescoreAllPipelineRows,
  tryBeginRouteRescore,
} from "./profile-rescore-worker.mjs";
import { handleGetLlmConfig, handleJudgeTest, handlePostLlmConfig, loadLlmConfig, resolveActivePin } from "./llm-config.mjs";
import { handlePostJudgeModels } from "./judge-models.mjs";
import { readLastDraft } from "./materials-last-draft.mjs";
import { codeForStatus } from "./api-error-codes.mjs";
import { leadsChatHandler } from "./leads-chat.mjs";

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
// The status-to-code map lives in api-error-codes.mjs (W2SQ-E) so the
// convention test sees every generic code in one exported place.

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
    codeForStatus(status);
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

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * BEAUDIT E5: hosted error details must never carry container/host fs paths.
 * Redacts the server dir, the home dir, and any remaining quoted or bare
 * absolute-path-looking token. URLs are never touched.
 * @param {unknown} text
 * @returns {string}
 */
function redactFsPaths(text) {
  let out = String(text ?? "");
  for (const root of [SERVER_DIR, homedir()].filter(Boolean)) {
    out = out.split(root).join("[redacted]");
  }
  out = out.replace(/['"]((?:\/[^'"]*)|[A-Za-z]:\\[^'"]*)['"]/g, "'[redacted]'");
  out = out.replace(
    /(?<![\w/:.-])\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g,
    "[redacted]",
  );
  return out;
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

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
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
const profileFromResumeJsonParser = createProfileFromResumeJsonParser((options) => express.json(options));
app.use((req, res, next) => {
  if (req.path === "/profile/from-resume") {
    return profileFromResumeJsonParser(req, res, next);
  }
  return express.json({ limit: "2mb" })(req, res, next);
});

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

app.get("/api/llm-config", (req, res) =>
  handleGetLlmConfig(req, res, process.env, { readLastDraft: () => readLastDraft() }),
);
app.post("/api/llm-config", (req, res) => handlePostLlmConfig(req, res));
app.post("/api/llm-config/judge-models", (req, res) => handlePostJudgeModels(req, res));
app.post("/api/llm-config/judge-test", (req, res) => handleJudgeTest(req, res));

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
      code: status === 400 ? "invalid_request" : "upstream_error",
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

app.post("/api/leads/chat", leadsChatHandler);

/* JOBQA: onboarding's one explicit save (server/profile-commit.mjs). An
 * interrupted save is finished before the first request, and the editors'
 * saves below (each wrapped in guardSave) never interleave with a commit or
 * its rollback. */
const profileCommit = createProfileCommitService({ postCommit: refreshDerivedAfterCommit });
const guardSave = commitBarrier(profileCommit);
mountProfileCommit(app, profileCommit);
profileCommit.recover().catch((err) => {
  console.warn("[profile-commit] could not finish an interrupted save:", errorMessage(err, "recover failed"));
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
      detail: redactFsPaths(errorMessage(err, "read failed")),
    });
  }
});

app.post("/profile", guardSave(async (req, res) => {
  const body = req.body;
  if (!isRecord(body)) {
    return res.status(400).json({
      ok: false,
      reason: "invalid_profile",
      errors: [{ message: "Request body must be a JSON object" }],
    });
  }
  /* "Your details" backcompat: an editor that predates the contact fields
   * sends identity without them; keep the saved ones so saving the fit
   * profile never erases the user's name (profile-identity.mjs). */
  let candidate = body;
  try {
    const prior = await readProfile();
    candidate = carryForwardContact(body, prior.ok ? prior.profile : null);
  } catch {
    candidate = body;
  }
  try {
    const { updatedAt } = await writeProfileAtomic(candidate);
    /* F21: rebuild the claim ledger from the saved profile + the stored
     * resume. Best-effort like the logo refresh: a ledger failure must
     * never fail the save (claims.load rebuilds on demand anyway). */
    /** @type {{ ok: boolean, claims?: number, ledgerHash?: string, error?: string, ingest?: unknown }} */
    let ledger = { ok: false };
    try {
      const stored = await getStoredResumeText().catch(() => null);
      const config = loadLlmConfig();
      const built = await ensureLedger({
        profile: candidate,
        resumeText: stored ? stored.text : "",
        resumeSource: stored ? stored.source : "upload",
        pin: config ? await resolveActivePin(config) : null,
        fetchImpl: globalThis.fetch,
      });
      ledger = { ok: true, claims: built.claims.length, ledgerHash: built.ledgerHash, ingest: built.ingest };
    } catch (ledgerErr) {
      const code = /** @type {{ code?: unknown }} */ (ledgerErr)?.code;
      ledger = {
        ok: false,
        error: typeof code === "string" && code ? code : "ledger_build_failed",
      };
    }
    try {
      await refreshLogosFromLedger();
    } catch (logoErr) {
      const logoError = /** @type {{ message?: unknown } | null | undefined} */ (logoErr);
      console.warn(
        "[brand-logos] profile save succeeded but logo refresh failed:",
        logoError && logoError.message ? logoError.message : logoErr,
      );
      return res.json({
        ok: true,
        updatedAt,
        ledger,
        logoRefresh: {
          ok: false,
          error: redactFsPaths(errorMessage(logoErr, "logo refresh failed")),
        },
      });
    }
    return res.json({ ok: true, updatedAt, ledger, logoRefresh: { ok: true } });
  } catch (err) {
    const error = /** @type {Record<string, unknown> | null | undefined} */ (err);
    if (error && error.code === "invalid_profile") {
      return res.status(400).json({
        ok: false,
        reason: "invalid_profile",
        errors: error.errors || [],
      });
    }
    return res.status(500).json({
      ok: false,
      reason: "write_failed",
      detail: redactFsPaths(errorMessage(err, "write failed")),
    });
  }
}));

/* ----- "Your details" (profile contact identity) -----
 * POST /profile/contact          → replace the contact half of identity
 *                                  (fullName, headline, email, phone,
 *                                  location, links). A key left out is
 *                                  cleared. 409 no_profile before the fit
 *                                  profile exists — onboarding carries the
 *                                  details in its draft until then.
 * POST /profile/contact/suggest  → { resumeText? } → suggestions with a
 *                                  confidence per field, parsed from the
 *                                  given text and/or the stored resume
 *                                  (source: request | stored | merged |
 *                                  none). Never saves, never caches.
 */
app.post("/profile/contact", guardSave(async (req, res) => {
  const body = isRecord(req.body) ? req.body : null;
  if (!body) {
    return res.status(400).json({
      ok: false,
      reason: "invalid_profile",
      errors: [{ message: "Request body must be a JSON object" }],
    });
  }
  const contact = normalizeContact(isRecord(body.identity) ? body.identity : body);
  try {
    const current = await readProfile();
    if (!current.ok) {
      return res.status(409).json({
        ok: false,
        reason: current.reason === "no_profile" ? "no_profile" : "profile_unreadable",
        message:
          current.reason === "no_profile"
            ? "Save your fit profile first, then your details."
            : "Your saved profile can't be read. Open Settings → Fit Profile and save it again.",
        contact,
      });
    }
    const next = withContact(/** @type {Record<string, unknown>} */ (current.profile), contact);
    const { updatedAt } = await writeProfileAtomic(next);
    return res.json({ ok: true, updatedAt, contact: contactOf(next.identity) });
  } catch (err) {
    const error = /** @type {Record<string, unknown> | null | undefined} */ (err);
    if (error && error.code === "invalid_profile") {
      return res.status(400).json({
        ok: false,
        reason: "invalid_profile",
        errors: error.errors || [],
      });
    }
    return res.status(500).json({
      ok: false,
      reason: "write_failed",
      detail: redactFsPaths(errorMessage(err, "write failed")),
    });
  }
}));

/* RESJ K1: PUT /profile/resume writes the canonical resume.txt (profile-resume-sync.mjs). */
mountProfileResume(app, { guard: guardSave });

/* RESJ K2: garbled or empty request text falls back to the saved resume;
 * when both are usable each field comes from whichever has it. */
app.post("/profile/contact/suggest", async (req, res) => {
  return res.json(await suggestContactFromSources(isRecord(req.body) ? req.body : {}));
});

/* ----- "Your voice" (the voice guide drafts follow) -----
 * GET    /profile/voice  → { ok, exists, text, updatedAt, words }
 * PUT    /profile/voice  ← { text, ifUpdatedAt? } Markdown, ≤ 64 KB, not
 *                          empty, not binary. Atomic write; any previous
 *                          guide is kept as voice.md.bak.<timestamp>.
 *                          `ifUpdatedAt` (what the caller read; null for
 *                          "none") makes a stale save a 409, never a
 *                          silent overwrite.
 * DELETE /profile/voice  → moves the guide to a backup; 404 when none.
 * Stored at ~/.jobbored/profile/voice.md, the file the materials pipeline
 * reads (server/profile-voice.mjs). Same Host/Origin/token gates as every
 * /profile route (the app-wide middleware above).
 */
/**
 * @param {import("express").Response} res
 * @param {unknown} err
 */
function sendVoiceError(res, err) {
  if (isVoiceError(err)) {
    return res.status(err.status).json({
      ok: false,
      reason: err.reason,
      message: err.message,
      ...err.extra,
    });
  }
  return res.status(500).json({
    ok: false,
    reason: "write_failed",
    detail: redactFsPaths(errorMessage(err, "voice guide write failed")),
  });
}

app.get("/profile/voice", async (_req, res) => {
  try {
    const voice = await readVoice();
    return res.json({ ok: true, ...voice });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "read_failed",
      detail: redactFsPaths(errorMessage(err, "voice guide read failed")),
    });
  }
});

app.put("/profile/voice", guardSave(async (req, res) => {
  const body = isRecord(req.body) ? req.body : null;
  if (!body || typeof body.text !== "string") {
    return res.status(400).json({
      ok: false,
      reason: "invalid_body",
      message: "Send the guide as JSON: { \"text\": \"…Markdown…\" }.",
    });
  }
  /** @type {{ ifUpdatedAt?: string | null }} */
  const options = {};
  if (Object.prototype.hasOwnProperty.call(body, "ifUpdatedAt")) {
    options.ifUpdatedAt = typeof body.ifUpdatedAt === "string" ? body.ifUpdatedAt : null;
  }
  try {
    const saved = await saveVoice(body.text, options);
    return res.json({ ok: true, ...saved });
  } catch (err) {
    return sendVoiceError(res, err);
  }
}));

app.delete("/profile/voice", guardSave(async (_req, res) => {
  try {
    const removed = await removeVoice();
    return res.json({ ok: true, ...removed });
  } catch (err) {
    return sendVoiceError(res, err);
  }
}));

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

/* F21: the claim ledger, built from resume.txt + profile.json on each
 * profile save (see POST /profile) and read by the materials pipeline.
 * Saved in: the ledger path. Used by: materials drafts today; rescore
 * and interview prep are future consumers of the same store. */
app.get("/profile/ledger", async (_req, res) => {
  try {
    const result = await readLedger();
    if (!result.ok) {
      return res.status(404).json({ ok: false, reason: result.reason });
    }
    return res.json({
      ok: true,
      ledger: result.ledger,
      savedIn: result.path || resolveLedgerPath(),
      usedBy: ["materials"],
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "read_failed",
      detail: errorMessage(err, "read failed"),
    });
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
 * POST /profile/from-resume: a draft v1 UserProfile for review, read-only
 * (JOBQA). The staged resume is analyzed as a preview and never cached; a
 * stored resume is read only on an explicit `source: "saved"`. Contract and
 * statuses: createProfileFromResumeHandler in server/profile-from-resume.mjs.
 */
app.post("/profile/from-resume", createProfileFromResumeHandler());

/**
 * After onboarding's commit: rebuild the claim ledger and refresh logos the
 * way POST /profile does, from the committed resume text. Best-effort: a
 * failure here never undoes the commit (claims.load rebuilds on demand).
 * @param {{ profile: Record<string, unknown>, resumeText: string | null }} committed
 */
async function refreshDerivedAfterCommit(committed) {
  /** @type {{ ok: boolean, claims?: number, ledgerHash?: string, error?: string }} */
  let ledger = { ok: false };
  try {
    const config = loadLlmConfig();
    const built = await ensureLedger({
      profile: committed.profile,
      resumeText: committed.resumeText || "",
      resumeSource: "upload",
      pin: config ? await resolveActivePin(config) : null,
      fetchImpl: globalThis.fetch,
    });
    ledger = { ok: true, claims: built.claims.length, ledgerHash: built.ledgerHash };
  } catch (ledgerErr) {
    const code = /** @type {{ code?: unknown }} */ (ledgerErr)?.code;
    ledger = { ok: false, error: typeof code === "string" && code ? code : "ledger_build_failed" };
  }
  /** @type {{ ok: boolean, error?: string }} */
  let logoRefresh = { ok: true };
  try {
    await refreshLogosFromLedger();
  } catch (logoErr) {
    logoRefresh = { ok: false, error: redactFsPaths(errorMessage(logoErr, "logo refresh failed")) };
  }
  return { ledger, logoRefresh };
}



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
  const error = /** @type {{ statusCode?: unknown, code?: unknown, retryable?: unknown } | null | undefined} */ (err);
  const status = Number(error && error.statusCode);
  const message = errorMessage(err, "Application materials error");
  /** @type {{ error: string, code?: string, retryable?: boolean, validTemplates?: string[] }} */
  const body = { error: message };
  if (error && typeof error.code === "string" && error.code) {
    body.code = error.code;
  }
  if (error && typeof error.retryable === "boolean") {
    body.retryable = error.retryable;
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
    if (body.requestId !== undefined && typeof body.requestId !== "string") {
      throw Object.assign(new Error("Invalid requestId"), { statusCode: 400, code: "invalid_request_id" });
    }
    const result = await withRepairIdempotency(req.params.slug, body.requestId, async () => {
      const manifest = await buildManifest(req.params.slug);
      const feature = String(body.feature || "");
      const source = await loadRepairSource(req.params.slug, /** @type {"resume" | "cover_letter"} */ (feature), typeof body.parentRunId === "string" ? body.parentRunId : undefined);
      const { payload: rawPayload, repair } = buildRepairRequestPayload(manifest, {
        feature,
        source,
        jobUrl: body.jobUrl || body.job_url,
        instruction: body.instruction ?? body.notes,
        issueIds: body.issueIds,
        baseDocumentHash: body.baseDocumentHash,
        requestId: body.requestId,
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
      payload.repair = rawPayload.repair;
      const accepted = await spawnMaterialsRequest(payload);
      return { ...accepted, repair };
    });
    res.json(result);
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Re-renders the published package in another template family from its
 * stored render model: fit → render → qa only, no LLM call. Body:
 * { template: "<family>", from?: "<runId>", header?: "<variant>" }. Unknown
 * family → 400; an unknown header variant falls back to the family default. */
app.post("/api/applications/:slug/regenerate", async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const result = await regeneratePackage({
      slug: req.params.slug,
      template: body.template,
      from: typeof body.from === "string" ? body.from : undefined,
      header: typeof body.header === "string" ? body.header : undefined,
    }, {
      profileIdentityLoader: async () => {
        const saved = await readProfile();
        return saved.ok && isRecord(saved.profile) ? saved.profile.identity : null;
      },
    });
    res.json(templateRegenerateResponse(result));
  } catch (e) {
    sendAppError(res, e);
  }
});

/* Scribe v2 edits and immutable version history share the materials guards. */
registerMaterialsEditRoutes(app, { sendError: sendAppError });

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

/* ----- Wave 2 (U-3, U-6): version history and exports -----
 * GET  /api/applications/:slug/runs                    every run under runs/,
 *                                                      newest first
 * POST /api/applications/:slug/runs/:runId/promote     serve that run again
 * GET  /api/applications/:slug/runs-diff?a=&b=&doc=    line diff of two runs'
 *                                                      resume.txt / cover-letter.txt
 * GET  /api/applications/:slug/export/:name            resume.docx,
 *                                                      cover-letter.docx (Word,
 *                                                      from the render model) or
 *                                                      linkedin.json
 * Read-only except promote, which copies files inside the role's folder. */
app.get("/api/applications/:slug/runs", async (req, res) => {
  try {
    res.json(await listRuns(req.params.slug));
  } catch (e) {
    sendAppError(res, e);
  }
});

app.post("/api/applications/:slug/runs/:runId/promote", async (req, res) => {
  try {
    res.json(await promoteRun(req.params.slug, req.params.runId));
  } catch (e) {
    sendAppError(res, e);
  }
});

app.get("/api/applications/:slug/runs-diff", async (req, res) => {
  try {
    const q = req.query;
    res.json(await diffRuns(req.params.slug, String(q.from || q.a || ""), String(q.to || q.b || ""), String(q.doc || "")));
  } catch (e) {
    sendAppError(res, e);
  }
});

app.get("/api/applications/:slug/export/:name", async (req, res) => {
  try {
    const name = req.params.name;
    if (!isExportName(name)) {
      res.status(400).json({ error: "Unknown export", code: "unknown_export", valid: Object.keys(EXPORTS) });
      return;
    }
    const spec = EXPORTS[name];
    const model = await servedRenderModel(req.params.slug, spec.doc);
    res.setHeader("Cache-Control", "no-store");
    if (spec.kind === "linkedin") {
      res.json(linkedinText(model));
      return;
    }
    const bytes = buildDocx(model, spec.doc);
    res.setHeader("Content-Type", DOCX_CONTENT_TYPE);
    res.setHeader("Content-Length", String(bytes.length));
    if (String(req.query.download || "") === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    }
    res.end(bytes);
  } catch (e) {
    sendAppError(res, e);
  }
});

/* ----- Wave 2: the manual-apply checklist -----
 * GET /api/applications/:slug/checklist?contact=   build (no model call),
 *                                                  keep saved ticks, store
 *                                                  checklist.json, return it
 * PUT /api/applications/:slug/checklist            { id, done } ticks one item */
app.get("/api/applications/:slug/checklist", async (req, res) => {
  try {
    const contact = typeof req.query.contact === "string" ? req.query.contact : "";
    res.json(await loadChecklist(req.params.slug, { contact }));
  } catch (e) {
    sendAppError(res, e);
  }
});

app.put("/api/applications/:slug/checklist", async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const contact = typeof body.contact === "string" ? body.contact : "";
    res.json(await setChecklistItem(req.params.slug, body.id, body.done, { contact }));
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

app.use(/** @type {import("express").ErrorRequestHandler} */ ((err, req, res, next) => {
  if (!err) return next();
  const error = /** @type {{ type?: unknown, status?: unknown, statusCode?: unknown }} */ (err);
  if (error.type === "entity.too.large") {
    if (req.path === "/profile/from-resume") {
      return res.status(413).json({
        ok: false,
        reason: "resume_file_too_large",
        message: "This file is over the 10 MB limit. Choose a smaller file or paste the text instead.",
      });
    }
    return res.status(413).json({
      error: "Request body is too large.",
      code: "payload_too_large",
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
      code: "invalid_json",
    });
  }
  // BEAUDIT E7: any other thrown error answers JSON, never Express's HTML page.
  const failureStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  console.error("[job-scraper] unhandled route error:", errorMessage(err, "error"));
  if (res.headersSent) return next(err);
  return res.status(failureStatus).json({
    error: failureStatus >= 500 ? "Internal error." : "The request could not be completed.",
    code: codeForStatus(failureStatus),
  });
}));

// BEAUDIT E7: an unknown route is a JSON 404 (it used to be Express's HTML).
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    code: "not_found",
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
