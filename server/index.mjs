/**
 * Local API for Cheerio job scraping (CORS-enabled for JobBored static app).
 * Usage: npm install && npm start
 * Default: http://127.0.0.1:3847
 */
import "dotenv/config";
import express from "express";
import { normalizeAtsRequestPayload } from "./ats-request-payload.mjs";
import { analyzeAtsScorecard, getAtsConfigStatus } from "./ats-scorecard.mjs";
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";
import {
  normalizeAllowedBrowserOrigins,
  resolveAllowedBrowserOrigin,
  validateScrapeTarget,
} from "./security-boundaries.mjs";

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

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

app.post("/api/scrape-job", async (req, res) => {
  try {
    const raw = req.body && req.body.url;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Body must include { url: string }" });
    }
    const target = validateScrapeTarget(raw);
    if (!target.ok) {
      return res.status(400).json({ error: target.error });
    }
    const result = await scrapeJobPosting(target.url);
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
