#!/usr/bin/env node
/**
 * Run the expired-job cleanup with scheduler-friendly env loading.
 *
 * Local schedulers do not inherit the interactive shell environment, so this
 * wrapper loads the packaged worker env file before invoking the
 * same cleanup runner exposed by npm run cleanup:expired-jobs.
 *
 * `--total-timeout-ms` bounds the entire scheduled execution; the scheduler
 * defaults this to 45 minutes so cleanup stays inside its post-discovery
 * window. `--timeout-ms` (forwarded to the cleanup CLI) is the per-posting
 * fetch timeout.
 */
import { spawn } from "child_process";
import { join } from "path";
import { pathToFileURL } from "url";

import { parseDotEnv } from "./lib/env.mjs";
import {
  envPath,
  normalizeSheetIdCandidate,
  readWorkerConfigSheetId,
  repoRoot,
  workerConfigPath,
} from "./lib/schedule.mjs";

const FAIL_PREFIX = "scheduled-expired-cleanup";
const cleanupScriptPath = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  "src",
  "cleanup",
  "expired-job-cleanup.ts",
);

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Runs one expired-job cleanup pass against the configured Pipeline sheet.
Dry-run is the default scheduler mode.

Usage:
  node scripts/run-scheduled-expired-cleanup.mjs --sheet-id YOUR_SHEET_ID
  node scripts/run-scheduled-expired-cleanup.mjs --sheet-id YOUR_SHEET_ID --write

Options:
  --sheet-id ID         Sheet ID to scan. Defaults to .env or worker-config.json.
  --dry-run             Report only; do not update Sheets. Default.
  --write               Move confirmed closed rows to Status = Expired.
  --max-rows N          Limit Pipeline rows scanned.
  --timeout-ms N        Per-posting fetch timeout (forwarded to cleanup CLI).
  --total-timeout-ms N  Total scheduled execution timeout in ms. Default: unbounded.
  --help, -h            Show this message.
`);
  process.exit(code);
}

function readValueArg(argv, index, arg) {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    fail(`missing value for ${arg}`);
  }
  return String(next);
}

function parsePositiveInteger(value, arg) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    fail(`${arg} must be a positive integer`);
  }
  return n;
}

export function parseScheduledExpiredCleanupArgs(argv) {
  const out = {
    sheetId: "",
    dryRun: true,
    maxRows: null,
    timeoutMs: null,
    totalTimeoutMs: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--write") {
      out.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--sheet-id") {
      out.sheetId = readValueArg(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--sheet-id=")) {
      out.sheetId = arg.slice("--sheet-id=".length);
      continue;
    }
    if (arg === "--max-rows") {
      out.maxRows = parsePositiveInteger(readValueArg(argv, i, arg), arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-rows=")) {
      out.maxRows = parsePositiveInteger(arg.slice("--max-rows=".length), "--max-rows");
      continue;
    }
    if (arg === "--timeout-ms") {
      out.timeoutMs = parsePositiveInteger(readValueArg(argv, i, arg), arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      out.timeoutMs = parsePositiveInteger(
        arg.slice("--timeout-ms=".length),
        "--timeout-ms",
      );
      continue;
    }
    if (arg === "--total-timeout-ms") {
      out.totalTimeoutMs = parsePositiveInteger(readValueArg(argv, i, arg), arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--total-timeout-ms=")) {
      out.totalTimeoutMs = parsePositiveInteger(
        arg.slice("--total-timeout-ms=".length),
        "--total-timeout-ms",
      );
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function resolveSheetId(args, env) {
  return (
    normalizeSheetIdCandidate(args.sheetId) ||
    normalizeSheetIdCandidate(env.BROWSER_USE_DISCOVERY_SHEET_ID) ||
    normalizeSheetIdCandidate(env.JOBBORED_SHEET_ID) ||
    normalizeSheetIdCandidate(env.SHEET_ID) ||
    readWorkerConfigSheetId()
  );
}

function buildCleanupArgs(args, sheetId) {
  const out = [
    "--experimental-strip-types",
    cleanupScriptPath,
    `--sheet-id=${sheetId}`,
    args.dryRun ? "--dry-run" : "--write",
  ];
  if (args.maxRows) out.push(`--max-rows=${args.maxRows}`);
  if (args.timeoutMs) out.push(`--timeout-ms=${args.timeoutMs}`);
  return out;
}

export function buildScheduledExpiredCleanupCommand(args, sheetId) {
  return {
    command: process.execPath,
    args: buildCleanupArgs(args, sheetId),
  };
}

function runWithTotalTimeout(child, totalTimeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(child.command, child.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    let timer = null;
    let timedOut = false;
    if (totalTimeoutMs && totalTimeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5_000).unref();
      }, totalTimeoutMs);
      timer.unref();
    }

    proc.on("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        status: code,
        signal,
        timedOut,
      });
    });
  });
}

async function main() {
  const args = parseScheduledExpiredCleanupArgs(process.argv.slice(2));
  const env = { ...parseDotEnv(envPath), ...process.env };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const sheetId = resolveSheetId(args, env);
  if (!sheetId) {
    fail(`sheetId is required. Pass --sheet-id or set it in ${envPath} or ${workerConfigPath}.`);
  }

  const child = buildScheduledExpiredCleanupCommand(args, sheetId);
  console.log(
    `${FAIL_PREFIX}: ${args.dryRun ? "dry-run" : "write"} mode starting for sheet ${sheetId}` +
      (args.totalTimeoutMs ? ` (totalTimeoutMs=${args.totalTimeoutMs})` : ""),
  );
  const result = await runWithTotalTimeout(child, args.totalTimeoutMs);
  if (result.timedOut) {
    fail(
      `cleanup runner exceeded total timeout of ${args.totalTimeoutMs}ms; killed`,
    );
  }
  if (result.status !== 0) {
    fail(`cleanup runner failed (exit ${result.status === null ? 1 : result.status})`);
  }
  console.log(`${FAIL_PREFIX}: complete`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
