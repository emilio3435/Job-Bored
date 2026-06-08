/**
 * Materials request bridge — POST /api/applications/:slug/request.
 *
 * Invokes the Hermes `materials-request.sh` wrapper (which posts to
 * Telegram and writes `pending.json` under
 * ~/.hermes/job-hunt/applications/<slug>/).
 *
 * Safety:
 *   - Slug + feature validated before we spawn anything.
 *   - Bin path is fixed (or overridden by HERMES_MATERIALS_REQUEST_BIN
 *     for tests) so a request body cannot pick what runs.
 *   - We never shell-interpolate user input — everything goes as argv.
 *   - Notes are size-capped to keep the Telegram message reasonable.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const FEATURES = new Set(["resume", "cover_letter", "both"]);
const MAX_NOTES_LEN = 4000;
const DEFAULT_TIMEOUT_MS = 30_000;

function defaultBin() {
  return resolvePath(
    __dirname,
    "..",
    "integrations",
    "hermes-job-hunt",
    "scripts",
    "materials-request.sh",
  );
}

export function getMaterialsRequestBin() {
  return process.env.HERMES_MATERIALS_REQUEST_BIN || defaultBin();
}

function trimString(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\r/g, "").trim();
  if (max && trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

/**
 * Validate and normalise a materials request body. Throws with
 * .statusCode = 400 when the body is unusable.
 */
export function normalizeRequestBody(body) {
  const slug = trimString(body && body.slug);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    const err = new Error("Invalid slug");
    err.statusCode = 400;
    throw err;
  }
  const feature = trimString(body && body.feature);
  if (!FEATURES.has(feature)) {
    const err = new Error("feature must be one of resume, cover_letter, both");
    err.statusCode = 400;
    throw err;
  }
  const company = trimString(body && body.company, 200);
  const title = trimString(body && body.title, 200);
  if (!company) {
    const err = new Error("company is required");
    err.statusCode = 400;
    throw err;
  }
  if (!title) {
    const err = new Error("title is required");
    err.statusCode = 400;
    throw err;
  }
  const jobUrl = trimString(body && body.jobUrl, 1000);
  const notes = trimString(body && body.notes, MAX_NOTES_LEN);
  return { slug, company, title, feature, jobUrl, notes };
}

/**
 * Spawn the Hermes wrapper. Resolves with the parsed JSON output on
 * stdout. Rejects with a tagged Error when the script exits non-zero
 * or output isn't JSON.
 */
export function spawnMaterialsRequest(payload, options = {}) {
  const bin = options.bin || getMaterialsRequestBin();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const args = [
    "--slug", payload.slug,
    "--company", payload.company,
    "--title", payload.title,
    "--feature", payload.feature,
  ];
  if (payload.jobUrl) args.push("--job-url", payload.jobUrl);
  if (payload.notes) args.push("--notes", payload.notes);
  if (options.applicationsRoot) {
    args.push("--applications-root", options.applicationsRoot);
  }
  if (options.skipTelegram) {
    args.push("--no-telegram");
  }

  return new Promise((resolveFn, rejectFn) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      const e = new Error(`Failed to spawn materials-request bin: ${err.message}`);
      e.statusCode = 500;
      return rejectFn(e);
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      const e = new Error(`materials-request timed out after ${timeoutMs}ms`);
      e.statusCode = 504;
      rejectFn(e);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const e = new Error(`materials-request spawn error: ${err.message}`);
      e.statusCode = 500;
      rejectFn(e);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = stdout.trim();
      let parsed = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = null; }
      }
      /* materials_request.py always returns 0 once pending.json is
       * on disk — Telegram delivery is a non-blocking side effect.
       * If telegram_error is present in the payload it's metadata
       * for the UI to show a soft warning; the request itself is
       * still successful. */
      if (code === 0) {
        return resolveFn(parsed || { ok: true });
      }
      /* Legacy: older versions of the Python script could exit 2 *only*
       * when Telegram delivery failed but pending.json was still written.
       * Require both positive signals (a parsed `telegram_error` and a
       * `pending_path`) before treating exit 2 as success, so an exit 2
       * from any other failure surfaces as an error instead of being
       * silently swallowed into ok:true. */
      if (code === 2 && parsed && parsed.telegram_error && parsed.pending_path) {
        parsed.ok = true;
        return resolveFn(parsed);
      }
      const message = parsed && parsed.error
        ? parsed.error
        : (stderr.trim() || `materials-request exited ${code}`);
      const e = new Error(message);
      e.statusCode = code === 1 ? 400 : 502;
      rejectFn(e);
    });
  });
}
