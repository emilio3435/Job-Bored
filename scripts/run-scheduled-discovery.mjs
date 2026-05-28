#!/usr/bin/env node
/**
 * Build the current discovery webhook payload at fire time and POST it to the
 * local browser-use-discovery worker. Used by launchd/systemd/cron/Task
 * Scheduler so scheduled runs use the same payload builder as #discoveryBtn.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, openSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseDotEnv } from "./lib/env.mjs";
import {
  envPath,
  normalizeSheetIdCandidate,
  readScheduleBreadcrumb,
  readWorkerConfigSheetId,
  workerConfigPath,
} from "./lib/schedule.mjs";

const require = createRequire(import.meta.url);
const payloadBuilder = require("../discovery-payload.js");
const FAIL_PREFIX = "scheduled-discovery";

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Posts one scheduled discovery run to the local worker webhook.

Usage:
  node scripts/run-scheduled-discovery.mjs --trigger scheduled-local
  node scripts/run-scheduled-discovery.mjs --sheet-id YOUR_SHEET_ID --dry-run

Options:
  --trigger NAME  scheduled-local, scheduled-github, scheduled-appsscript, or cli.
                  Default: scheduled-local.
  --sheet-id ID   Sheet ID to pin into the discovery webhook payload.
  --port N        Worker port. Default: BROWSER_USE_DISCOVERY_PORT in .env or 8644.
  --dry-run       Print the payload JSON instead of POSTing it.
  --help, -h      Show this message.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    trigger: "scheduled-local",
    sheetId: "",
    port: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--trigger" || arg === "--sheet-id" || arg === "--port") {
      if (next === undefined || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--trigger") {
        out.trigger = String(next).trim() || "scheduled-local";
      } else if (arg === "--sheet-id") {
        out.sheetId = String(next).trim();
      } else {
        const port = Number(next);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          fail("--port must be an integer from 1 to 65535");
        }
        out.port = port;
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function readJson(pathname) {
  if (!existsSync(pathname)) return {};
  try {
    const parsed = JSON.parse(readFileSync(pathname, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function joinStoredList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pull role hints from atsCompanies[*].roleTags so refresh has non-blank
 * intent even when the user has not filled in `targetRoles`/`includeKeywords`.
 * Keeps the implicit intent local to the cron path; the webhook handler
 * preflight is untouched.
 */
function deriveIntentFromAtsCompanies(workerConfig) {
  const ats = Array.isArray(workerConfig.atsCompanies)
    ? workerConfig.atsCompanies
    : [];
  const tagSet = new Set();
  for (const company of ats) {
    if (!company || typeof company !== "object") continue;
    const tags = Array.isArray(company.roleTags) ? company.roleTags : [];
    for (const tag of tags) {
      const trimmed = String(tag || "").trim();
      if (trimmed) tagSet.add(trimmed);
    }
  }
  return Array.from(tagSet);
}

function buildDiscoveryProfile(workerConfig, env) {
  const envProfile = parseJsonObject(env.COMMAND_CENTER_DISCOVERY_PROFILE_JSON);
  if (Object.keys(envProfile).length) return envProfile;
  const storedProfile =
    workerConfig.discoveryProfile &&
    typeof workerConfig.discoveryProfile === "object"
      ? workerConfig.discoveryProfile
      : {};
  let targetRoles = joinStoredList(workerConfig.targetRoles);
  let keywordsInclude = joinStoredList(workerConfig.includeKeywords);
  // Intent fallback: when neither targetRoles nor includeKeywords are set,
  // borrow role hints from atsCompanies so the preflight's blank-intent guard
  // does not trip. Without this, an unconfigured worker config trips a 400.
  if (!targetRoles && !keywordsInclude) {
    const derived = deriveIntentFromAtsCompanies(workerConfig);
    if (derived.length) {
      targetRoles = derived.join(", ");
    }
  }
  return {
    targetRoles,
    locations: joinStoredList(workerConfig.locations),
    remotePolicy: String(workerConfig.remotePolicy || "").trim(),
    seniority: String(workerConfig.seniority || "").trim(),
    keywordsInclude,
    keywordsExclude: joinStoredList(workerConfig.excludeKeywords),
    maxLeadsPerRun:
      workerConfig.maxLeadsPerRun != null
        ? String(workerConfig.maxLeadsPerRun)
        : "",
    sourcePreset:
      typeof storedProfile.sourcePreset === "string"
        ? storedProfile.sourcePreset
        : "",
  };
}

function buildResumeContext(workerConfig, env) {
  const envResumeText = String(env.COMMAND_CENTER_DISCOVERY_RESUME_TEXT || "");
  if (envResumeText.trim()) {
    return {
      text: envResumeText,
      updatedAt: String(env.COMMAND_CENTER_DISCOVERY_RESUME_UPDATED_AT || ""),
    };
  }
  const candidate =
    workerConfig.candidateProfile &&
    typeof workerConfig.candidateProfile === "object"
      ? workerConfig.candidateProfile
      : {};
  return {
    text: String(candidate.resumeText || ""),
    updatedAt: String(candidate.updatedAt || ""),
  };
}

function buildScheduleContext(workerConfig) {
  const schedule =
    workerConfig.schedule && typeof workerConfig.schedule === "object"
      ? workerConfig.schedule
      : {};
  const breadcrumb = readScheduleBreadcrumb();
  return {
    local: {
      enabled: schedule.enabled === true,
      hour:
        typeof schedule.hour === "number"
          ? schedule.hour
          : typeof breadcrumb?.hour === "number"
            ? breadcrumb.hour
            : undefined,
      minute:
        typeof schedule.minute === "number"
          ? schedule.minute
          : typeof breadcrumb?.minute === "number"
            ? breadcrumb.minute
            : undefined,
    },
    github: schedule.mode === "github" ? schedule : {},
  };
}

function buildPreferencesContext(env) {
  return parseJsonObject(env.COMMAND_CENTER_DISCOVERY_PREFERENCES_JSON);
}

function resolveSheetId(args, env, workerConfig) {
  return (
    normalizeSheetIdCandidate(args.sheetId) ||
    normalizeSheetIdCandidate(env.BROWSER_USE_DISCOVERY_SHEET_ID) ||
    normalizeSheetIdCandidate(env.JOBBORED_SHEET_ID) ||
    normalizeSheetIdCandidate(env.SHEET_ID) ||
    normalizeSheetIdCandidate(workerConfig.sheetId) ||
    readWorkerConfigSheetId()
  );
}

function resolvePort(args, env) {
  const port = Number(args.port || env.BROWSER_USE_DISCOVERY_PORT || 8644);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`resolved port is invalid: ${port}`);
  }
  return port;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_BOOT_LOG = resolve(
  REPO_ROOT,
  "integrations/browser-use-discovery/state/local-worker.log",
);

/**
 * Probe `/health` on the local worker. Resolves true on HTTP 200, false on
 * any error or non-2xx. Uses a 1s timeout so a hung worker does not stall
 * the cron probe.
 */
async function isWorkerHealthy(port) {
  const url = `http://127.0.0.1:${port}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spawn the local discovery worker in a detached child process so launchd
 * can complete and the worker keeps serving across cron invocations.
 * Returns once the worker's /health endpoint reports OK or the deadline
 * expires (fails the cron with a clear message in the latter case).
 */
async function ensureWorkerRunning(port) {
  if (await isWorkerHealthy(port)) return;
  console.log(
    `${FAIL_PREFIX}: worker not reachable on 127.0.0.1:${port}; starting it…`,
  );
  // Append-mode log file so we never clobber the worker's existing log.
  const logFd = openSync(WORKER_BOOT_LOG, "a");
  const child = spawn(
    "npm",
    ["run", "discovery:worker:start-local", "--silent"],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        BROWSER_USE_DISCOVERY_PORT: String(port),
      },
    },
  );
  child.unref();
  const deadline = Date.now() + 25_000;
  // Poll /health every 500ms until ready or deadline.
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    // eslint-disable-next-line no-await-in-loop
    if (await isWorkerHealthy(port)) {
      console.log(`${FAIL_PREFIX}: worker is healthy on 127.0.0.1:${port}.`);
      return;
    }
  }
  fail(
    `worker did not become healthy on 127.0.0.1:${port} within 25s. Check ${WORKER_BOOT_LOG} for boot errors.`,
  );
}

function hasPayloadIntent(payload) {
  const profile =
    payload.discoveryProfile &&
    typeof payload.discoveryProfile === "object" &&
    !Array.isArray(payload.discoveryProfile)
      ? payload.discoveryProfile
      : {};
  const snapshot =
    profile.profileSnapshot &&
    typeof profile.profileSnapshot === "object" &&
    !Array.isArray(profile.profileSnapshot)
      ? profile.profileSnapshot
      : {};
  const facets =
    profile.searchPlan &&
    typeof profile.searchPlan === "object" &&
    profile.searchPlan.facets &&
    typeof profile.searchPlan.facets === "object"
      ? profile.searchPlan.facets
      : {};
  const query =
    profile.searchPlan &&
    typeof profile.searchPlan === "object" &&
    profile.searchPlan.query &&
    typeof profile.searchPlan.query === "object"
      ? profile.searchPlan.query
      : {};
  const hasSnapshotIntent = ["targetRoles", "keywordsInclude"].some((key) => {
    const value = snapshot[key];
    return Array.isArray(value) && value.some((item) => String(item || "").trim());
  });
  const hasDerivedIntent = ["roles", "skills", "industries"].some((key) => {
    const value = facets[key];
    return Array.isArray(value) && value.some((item) => String(item || "").trim());
  });
  return Boolean(
    String(profile.targetRoles || "").trim() ||
      String(profile.keywordsInclude || "").trim() ||
      hasSnapshotIntent ||
      (hasDerivedIntent &&
        (String(query.targetRoles || "").trim() ||
          String(query.keywordsInclude || "").trim())),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...parseDotEnv(envPath), ...process.env };
  const workerConfig = readJson(workerConfigPath);
  const sheetId = resolveSheetId(args, env, workerConfig);
  if (!sheetId) {
    fail(`sheetId is required. Pass --sheet-id or set it in ${envPath} or ${workerConfigPath}.`);
  }
  const requestedAt = new Date().toISOString();
  const payload = payloadBuilder.buildDiscoveryWebhookPayload({
    sheetId,
    discoveryProfile: buildDiscoveryProfile(workerConfig, env),
    resume: buildResumeContext(workerConfig, env),
    preferences: buildPreferencesContext(env),
    schedule: buildScheduleContext(workerConfig),
    requestedAt,
    trigger: args.trigger,
  });
  if (!hasPayloadIntent(payload)) {
    delete payload.discoveryProfile;
  }

  if (args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const secret = String(env.BROWSER_USE_DISCOVERY_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    fail(`BROWSER_USE_DISCOVERY_WEBHOOK_SECRET is not set in ${envPath}.`);
  }
  const port = resolvePort(args, env);
  // launchd does not keep the worker alive between cron fires; auto-start it
  // when missing so the cron does not race the user's terminal session.
  await ensureWorkerRunning(port);
  const url = `http://127.0.0.1:${port}/webhook`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discovery-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`POST ${url} failed with HTTP ${response.status}: ${text}`);
  }
  console.log(`${FAIL_PREFIX}: accepted HTTP ${response.status}`);
  if (text) console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
