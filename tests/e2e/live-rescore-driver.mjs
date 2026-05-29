/**
 * live-rescore-driver.mjs
 *
 * Drives a LIVE rescore against the user's actual Pipeline sheet.
 * - Writes a sample profile to a temp file (does NOT touch ~/.jobbored)
 * - Spawns server with real Gemini API key
 * - Hits /profile/rescore?dryRun=true to surface the row count
 * - Optionally hits the live SSE rescore (gated by RUN_LIVE=true)
 *
 * Usage:
 *   GEMINI_API_KEY=... node tests/e2e/live-rescore-driver.mjs
 *   GEMINI_API_KEY=... RUN_LIVE=true node tests/e2e/live-rescore-driver.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 38600 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_LIVE = String(process.env.RUN_LIVE || "").toLowerCase() === "true";

const GEMINI_KEY = (
  process.env.ATS_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  ""
).trim();

if (!GEMINI_KEY) {
  console.error("[fatal] Set GEMINI_API_KEY (or ATS_GEMINI_API_KEY) before running.");
  process.exit(2);
}

const SAMPLE_PROFILE = {
  version: 1,
  identity: {
    targetRoles: [
      "Digital Marketing Consultant",
      "AI Solutions Architect",
      "Director of Performance Marketing",
    ],
    targetSeniority: "director",
    yearsRelevantExperience: 10,
    primaryNarrative:
      "I'm a digital marketing consultant and AI product builder — 10+ years in performance marketing, now shipping AI systems that make forecasting, campaign strategy, and workflow execution sharper.",
  },
  strengths: [
    { name: "Performance marketing & paid media", rank: 1, evidence: "$10M+ paid media book at Audacy" },
    { name: "AI product building (LLMs, RAG, agents)", rank: 2, evidence: "Built Elio Intelligence Suite on GCP / Vertex AI Search" },
    { name: "Adtech / martech / measurement", rank: 3 },
    { name: "Analytics and unit economics", rank: 4 },
  ],
  wants: ["AI-forward role", "hands-on building", "strategic scope"],
  avoids: ["pure quota sales", "junior IC"],
  hardConstraints: {
    workMode: "hybrid_ok",
    acceptableLocations: ["Denver", "Philadelphia", "Little Rock", "Remote"],
    workAuth: "us_citizen",
    skipTitles: ["intern", "junior", "sdr", "bdr"],
    salaryRequired: false,
  },
  tieBreakers: {
    salaryTransparencyImportance: "medium",
    companyCredibilityImportance: "high",
    applicationComplexityAversion: "medium",
  },
};

const tmpDir = mkdtempSync(join(tmpdir(), "jobbored-rescore-"));
const profilePath = join(tmpDir, "profile.json");
writeFileSync(profilePath, JSON.stringify(SAMPLE_PROFILE, null, 2));
console.log(`[setup] Sample profile written to ${profilePath}`);

const server = spawn("node", ["index.mjs"], {
  cwd: resolve("server"),
  env: {
    ...process.env,
    PORT: String(PORT),
    LISTEN_HOST: "127.0.0.1",
    JOBBORED_PROFILE_PATH: profilePath,
    GEMINI_API_KEY: GEMINI_KEY,
    ATS_GEMINI_API_KEY: GEMINI_KEY,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverStderr = "";
server.stderr.on("data", (d) => { serverStderr += String(d); });

const cleanup = () => {
  if (server && !server.killed) server.kill();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    await sleep(200);
  }
  throw new Error(`Server not up after 6s. stderr:\n${serverStderr}`);
}

async function dryRun() {
  console.log("[dry-run] POST /profile/rescore?dryRun=true");
  const r = await fetch(`${BASE_URL}/profile/rescore?dryRun=true`, { method: "POST" });
  const data = await r.json();
  console.log(`[dry-run] status=${r.status}  payload=${JSON.stringify(data)}`);
  return { ok: r.ok, data };
}

async function liveRescore() {
  const cap = Number.parseInt(process.env.MAX_ROWS || "5", 10);
  console.log(`[live]  POST /profile/rescore?maxRows=${cap}  (SSE, cap=${cap})`);
  const r = await fetch(`${BASE_URL}/profile/rescore?maxRows=${cap}`, { method: "POST" });
  if (!r.ok || !r.body) {
    const txt = await r.text();
    console.error(`[live] non-OK: status=${r.status} body=${txt}`);
    return { ok: false, status: r.status };
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let events = 0;
  let scored = 0;
  let skipped = 0;
  let failed = 0;
  let done = null;
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!block.startsWith("data:")) continue;
      const json = block.replace(/^data:\s*/, "");
      try {
        const evt = JSON.parse(json);
        events += 1;
        if (evt.kind === "progress") {
          if (evt.status === "scored") scored += 1;
          else if (evt.status === "skipped") skipped += 1;
          else if (evt.status === "failed") failed += 1;
          if (events <= 5 || events % 25 === 0) {
            console.log(`[live] event ${events}: ${JSON.stringify(evt)}`);
          }
        } else if (evt.kind === "done") {
          done = evt;
          console.log(`[live] DONE: ${JSON.stringify(evt)}`);
        } else if (evt.kind === "error") {
          console.error(`[live] ERROR event: ${JSON.stringify(evt)}`);
          return { ok: false, error: evt };
        }
      } catch (e) {
        console.error(`[live] bad SSE chunk: ${json}`);
      }
    }
  }
  return { ok: true, totals: { events, scored, skipped, failed }, done };
}

async function main() {
  await waitForServer();
  const dry = await dryRun();
  if (!dry.ok) {
    console.error("[fatal] dry-run failed; not proceeding to live.");
    process.exit(3);
  }
  if (!RUN_LIVE) {
    console.log("\n[done] Dry-run succeeded.  Set RUN_LIVE=true to do the live rescore (writes to real sheet).");
    return;
  }
  const live = await liveRescore();
  if (!live.ok) {
    process.exit(4);
  }
  console.log(`[done] live totals: ${JSON.stringify(live.totals)}`);
}

main()
  .catch((err) => {
    console.error("[fatal]", err && err.message ? err.message : err);
    if (serverStderr) console.error("[server stderr]\n" + serverStderr);
    process.exit(1);
  })
  .finally(() => cleanup());
