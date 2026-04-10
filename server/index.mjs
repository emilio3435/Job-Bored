/**
 * Local API for Cheerio job scraping (CORS-enabled for JobBored static app).
 * Usage: npm install && npm start
 * Default: http://127.0.0.1:3847
 */
import "dotenv/config";
import cors from "cors";
import express from "express";
import { normalizeAtsRequestPayload } from "./ats-request-payload.mjs";
import { analyzeAtsScorecard, getAtsConfigStatus } from "./ats-scorecard.mjs";
import { scrapeJobPosting } from "./job-scraper.mjs";

const PORT = Number(process.env.PORT) || 3847;
/** 127.0.0.1 for local dev; set LISTEN_HOST=0.0.0.0 on Render/Fly/Docker so the service accepts external traffic. */
const HOST = process.env.LISTEN_HOST || "127.0.0.1";
const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
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
    const url = raw.trim();
    let u;
    try {
      u = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return res.status(400).json({ error: "Only http(s) URLs allowed" });
    }
    const result = await scrapeJobPosting(u.href);
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
    res.status(status).json({ error: msg, requestId });
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
