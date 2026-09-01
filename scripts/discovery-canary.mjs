#!/usr/bin/env node
/**
 * discovery-canary — one read-only command that answers "is local discovery
 * actually working right now?" (claim CANARY-1).
 *
 * It classifies two facts and nothing else:
 *   1. is the local browser-use discovery worker up and is it really OUR worker;
 *   2. how long ago the newest SUCCESSFUL discovery run finished.
 *
 * It performs no mutation: one GET of the worker's `/health` and a read-only
 * listing of the run-state snapshot directory. Google Sheets is never read —
 * reading it would need a credential, and a canary that needs a credential is
 * a canary nobody runs.
 *
 * Output carries only a status, fixed-enum reasons, a runId, ISO timestamps,
 * ages, and the health URL origin. Never headers, sheet ids, run error strings,
 * or job/source content.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isBrowserUseDiscoveryHealth } from "./bootstrap-local-discovery.mjs";
import {
  DEFAULT_LOCAL_PORT,
  buildLocalHealthUrl,
} from "./discovery-shared-helpers.mjs";
import { listRunStatusSnapshots } from "../integrations/browser-use-discovery/src/state/run-status-store.ts";

const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_WORKER_URL = `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`;
const DEFAULT_STATE_DIR = join(
  homedir(),
  ".jobbored",
  "browser-use-discovery",
  "run-state",
);
const INGEST_RUN_ID_PREFIX = "ingest_";
const SUCCESS_RUN_STATUSES = new Set(["completed", "partial", "empty"]);

/** Every reason the canary may ever print. Nothing else reaches the output. */
const CANARY_REASONS = Object.freeze({
  worker_healthy: "healthy",
  successful_run_fresh: "healthy",
  no_successful_run: "stale",
  successful_run_stale: "stale",
  worker_unreachable: "unavailable",
  worker_unhealthy: "unavailable",
  run_state_unreadable: "unavailable",
  worker_not_discovery_service: "misconfigured",
  worker_url_invalid: "misconfigured",
  unknown_argument: "misconfigured",
  invalid_max_age_hours: "misconfigured",
  sheets_credential_not_available: "unavailable",
});

const CANARY_EXIT_CODES = Object.freeze({
  healthy: 0,
  stale: 1,
  unavailable: 2,
  misconfigured: 3,
});
const INTERNAL_ERROR_EXIT_CODE = 4;

/** Worst-first; `classifyCanary` picks the first status that any reason claims. */
const STATUS_PRECEDENCE = ["misconfigured", "unavailable", "stale", "healthy"];

const USAGE = `discovery-canary (read-only)

Usage:
  node scripts/discovery-canary.mjs
  node scripts/discovery-canary.mjs --max-age-hours 24 --json
  node scripts/discovery-canary.mjs --state-dir <dir> --worker-url <origin>

Flags:
  --max-age-hours <n>   How fresh the newest successful run must be (integer >= 1, default ${DEFAULT_MAX_AGE_HOURS}).
  --json                Emit the machine-readable report instead of text.
  --state-dir <dir>     Run-state snapshot directory (default ~/.jobbored/browser-use-discovery/run-state).
  --worker-url <origin> Local worker origin (default ${DEFAULT_WORKER_URL}).
  --help, -h            Show this help.

Exit codes: 0 healthy, 1 stale, 2 unavailable, 3 misconfigured, 4 internal error.
`;

function argumentError(message, reason) {
  return Object.assign(new Error(message), { canaryReason: reason });
}

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    stateDir: "",
    workerUrl: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--max-age-hours") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw argumentError(
          "--max-age-hours must be an integer >= 1",
          "invalid_max_age_hours",
        );
      }
      args.maxAgeHours = value;
      i += 1;
      continue;
    }
    if (arg === "--state-dir" || arg === "--worker-url") {
      const value = String(argv[i + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw argumentError(`${arg} requires a value`, "unknown_argument");
      }
      if (arg === "--state-dir") args.stateDir = value;
      else args.workerUrl = value;
      i += 1;
      continue;
    }
    throw argumentError(`unknown argument: ${arg}`, "unknown_argument");
  }
  return args;
}

/**
 * Pure classifier. Takes already-reduced, already-redacted facts and returns
 * the status plus the fixed-enum reasons that produced it.
 */
function classifyCanary(input = {}) {
  const health = input.health || {};
  const runHistory = input.runHistory || {};
  const reasons = [];

  for (const configError of input.configErrors || []) {
    if (CANARY_REASONS[configError]) reasons.push(configError);
  }

  if (!health.reachable) {
    reasons.push("worker_unreachable");
  } else if (!health.ok) {
    reasons.push("worker_unhealthy");
  } else if (!health.isDiscoveryWorker) {
    reasons.push("worker_not_discovery_service");
  } else {
    reasons.push("worker_healthy");
  }

  if (!runHistory.available) {
    reasons.push(
      CANARY_REASONS[runHistory.reason] ? runHistory.reason : "run_state_unreadable",
    );
  } else if (!runHistory.newestSuccess) {
    reasons.push("no_successful_run");
  } else if (runHistory.newestSuccess.ageHours > Number(input.maxAgeHours)) {
    reasons.push("successful_run_stale");
  } else {
    reasons.push("successful_run_fresh");
  }

  const claimed = new Set(reasons.map((reason) => CANARY_REASONS[reason]));
  const status =
    STATUS_PRECEDENCE.find((candidate) => claimed.has(candidate)) || "healthy";
  return { status, reasons };
}

/**
 * Build the same probe shape `bootstrap-local-discovery.mjs::probeHealth`
 * builds, but through an injected fetch so tests never touch the network.
 * `probeHealth` itself is not exported.
 */
async function probeWorkerHealth(fetchImpl, healthUrl) {
  try {
    const res = await fetchImpl(healthUrl, {
      method: "GET",
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const data = await res.json().catch(() => ({}));
    const body = data && typeof data === "object" ? data : {};
    return {
      ok: !!res.ok && String(body.status || "").toLowerCase() === "ok",
      reachable: true,
      statusCode: res.status || 0,
      serviceName: String(body.service || "").trim(),
      workerStatus: String(body.status || "").trim(),
      mode: String(body.mode || "").trim(),
      platform: String(body.platform || "").trim(),
      body,
    };
  } catch (_) {
    // The error message can carry a hostname or a proxy URL; it is dropped on
    // purpose — `reachable: false` is the whole finding.
    return {
      ok: false,
      reachable: false,
      statusCode: 0,
      serviceName: "",
      workerStatus: "",
      mode: "",
      platform: "",
      body: null,
    };
  }
}

/**
 * Default run-history reader: a read-only listing of the run-state snapshot
 * directory. Never opens `createDiscoveryRunStatusStore` — merely opening that
 * store sweeps `.tmp-` leftovers and rewrites corrupt snapshots.
 */
function readRunHistoryFromDisk({ stateDir } = {}) {
  const directory = String(stateDir || "").trim();
  if (!directory) {
    return { available: false, reason: "run_state_unreadable", runs: [] };
  }
  try {
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      return { available: false, reason: "run_state_unreadable", runs: [] };
    }
    return {
      available: true,
      reason: "",
      runs: listRunStatusSnapshots(directory).map((snapshot) => ({
        runId: snapshot.runId,
        status: snapshot.status.status,
        completedAt: snapshot.status.completedAt || snapshot.status.updatedAt || "",
      })),
    };
  } catch (_) {
    return { available: false, reason: "run_state_unreadable", runs: [] };
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return "";
  }
}

function ageHoursBetween(from, to) {
  const fromMs = Date.parse(from);
  if (!Number.isFinite(fromMs)) return null;
  return Math.round(((to.getTime() - fromMs) / 3_600_000) * 100) / 100;
}

/**
 * Pick the newest SUCCESSFUL discovery run. `ingest_` runs are single-URL
 * ingests, not discovery sweeps, so they never count as discovery freshness.
 */
function pickNewestSuccess(runs, now) {
  let newest = null;
  for (const run of runs || []) {
    const runId = String((run && run.runId) || "").trim();
    if (!runId || runId.startsWith(INGEST_RUN_ID_PREFIX)) continue;
    const status = String((run && run.status) || "").trim();
    if (!SUCCESS_RUN_STATUSES.has(status)) continue;
    const completedAt = String((run && run.completedAt) || "").trim();
    const ageHours = ageHoursBetween(completedAt, now);
    if (ageHours === null) continue;
    if (!newest || ageHours < newest.ageHours) {
      newest = { runId, status, completedAt, ageHours };
    }
  }
  return newest;
}

async function runCanary(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const readRunHistory = options.readRunHistory || readRunHistoryFromDisk;
  const maxAgeHours = Number(options.maxAgeHours) || DEFAULT_MAX_AGE_HOURS;
  const stateDir = String(options.stateDir || DEFAULT_STATE_DIR);
  const workerUrl = String(options.workerUrl || DEFAULT_WORKER_URL);

  const configErrors = [...(options.configErrors || [])];
  const healthUrl = buildLocalHealthUrl(workerUrl);
  if (!healthUrl) configErrors.push("worker_url_invalid");

  const probe = healthUrl
    ? await probeWorkerHealth(fetchImpl, healthUrl)
    : { ok: false, reachable: false, statusCode: 0 };
  const health = {
    reachable: !!probe.reachable,
    ok: !!probe.ok,
    statusCode: Number(probe.statusCode) || 0,
    isDiscoveryWorker: isBrowserUseDiscoveryHealth(probe),
  };

  const history = readRunHistory({ stateDir }) || {};
  const newestSuccess = history.available
    ? pickNewestSuccess(history.runs, now)
    : null;
  const runHistory = {
    available: !!history.available,
    reason: String(history.reason || ""),
    newestSuccess,
  };

  const { status, reasons } = classifyCanary({
    maxAgeHours,
    configErrors,
    health,
    runHistory,
  });

  return {
    status,
    reasons,
    exitCode: CANARY_EXIT_CODES[status],
    checkedAt: now.toISOString(),
    maxAgeHours,
    worker: {
      healthUrlOrigin: originOf(healthUrl),
      reachable: health.reachable,
      statusCode: health.statusCode,
      isDiscoveryWorker: health.isDiscoveryWorker,
    },
    run: newestSuccess
      ? {
          runId: newestSuccess.runId,
          status: newestSuccess.status,
          completedAt: newestSuccess.completedAt,
          ageHours: newestSuccess.ageHours,
        }
      : null,
    sheets: {
      status: "unavailable",
      reason: "sheets_credential_not_available",
    },
  };
}

function formatCanaryReport(report) {
  const lines = ["discovery canary (read-only)"];
  lines.push(`status: ${report.status}`);
  lines.push(`checked at: ${report.checkedAt}`);
  lines.push(
    `worker: ${report.worker.healthUrlOrigin || "(no usable worker url)"} ` +
      `reachable=${report.worker.reachable} http=${report.worker.statusCode} ` +
      `discoveryWorker=${report.worker.isDiscoveryWorker}`,
  );
  lines.push(
    report.run
      ? `newest successful run: ${report.run.runId} (${report.run.status}) ` +
          `finished ${report.run.completedAt}, ${report.run.ageHours}h ago ` +
          `(threshold ${report.maxAgeHours}h)`
      : `newest successful run: none within the readable run history (threshold ${report.maxAgeHours}h)`,
  );
  lines.push(`sheets: ${report.sheets.status} (${report.sheets.reason})`);
  for (const reason of report.reasons) lines.push(`reason: ${reason}`);
  lines.push(`exit code: ${report.exitCode}`);
  return `${lines.join("\n")}\n`;
}

function buildArgumentErrorReport(reason, now = new Date()) {
  const { status, reasons } = classifyCanary({
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    configErrors: [reason],
    health: { reachable: false, ok: false, statusCode: 0, isDiscoveryWorker: false },
    runHistory: { available: false, reason: "run_state_unreadable", newestSuccess: null },
  });
  return {
    status,
    reasons,
    exitCode: CANARY_EXIT_CODES[status],
    checkedAt: now.toISOString(),
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    worker: {
      healthUrlOrigin: "",
      reachable: false,
      statusCode: 0,
      isDiscoveryWorker: false,
    },
    run: null,
    sheets: { status: "unavailable", reason: "sheets_credential_not_available" },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let args = null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const report = buildArgumentErrorReport(
      error && error.canaryReason ? error.canaryReason : "unknown_argument",
    );
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatCanaryReport(report),
    );
    process.exitCode = report.exitCode;
  }
  if (args && args.help) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
  } else if (args) {
    try {
      const report = await runCanary(args);
      process.stdout.write(
        args.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : formatCanaryReport(report),
      );
      process.exitCode = report.exitCode;
    } catch (error) {
      console.error(
        `[discovery-canary] ${error && error.message ? error.message : error}`,
      );
      process.exitCode = INTERNAL_ERROR_EXIT_CODE;
    }
  }
}

export {
  CANARY_EXIT_CODES,
  classifyCanary,
  formatCanaryReport,
  parseArgs,
  runCanary,
};
