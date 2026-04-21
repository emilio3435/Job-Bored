#!/usr/bin/env node
/**
 * JobBored daily refresh — Windows Task Scheduler installer.
 *
 * Manual smoke steps for reviewers:
 *   1. In PowerShell, set integrations\browser-use-discovery\.env with
 *      BROWSER_USE_DISCOVERY_WEBHOOK_SECRET and optionally
 *      BROWSER_USE_DISCOVERY_PORT.
 *   2. Run: npm run schedule:install -- --hour 8 --minute 0 --force
 *   3. Verify: schtasks /Query /TN JobBoredRefresh
 *   4. Fire manually: schtasks /Run /TN JobBoredRefresh
 *   5. Remove: npm run schedule:uninstall
 */
import { spawnSync } from "child_process";
import { platform } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { parseDotEnv, sanitizeSecret } from "./lib/env.mjs";
import {
  envPath,
  formatClock,
  repoRoot,
  writeScheduleBreadcrumb,
} from "./lib/schedule.mjs";

const FAIL_PREFIX = "schedule:install-windows";
const TASK_NAME = "JobBoredRefresh";
const refreshScriptPath = join(repoRoot, "scripts", "windows", "refresh.ps1");

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Writes a Windows Task Scheduler daily task.

Usage:
  node scripts/install-taskscheduler-refresh.mjs
  node scripts/install-taskscheduler-refresh.mjs --hour 7 --minute 30

Options:
  --hour N      Hour of day to fire (0-23, local time). Default: 8.
  --minute N    Minute of hour to fire (0-59). Default: 0.
  --port N      Worker port for breadcrumb/status. The task helper reads .env at runtime.
  --force       Overwrite an existing task.
  --help        Show this message.
`);
  process.exit(code);
}

export function parseArgs(argv) {
  const out = {
    hour: 8,
    minute: 0,
    port: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--hour" || arg === "--minute" || arg === "--port") {
      if (next === undefined || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      const n = Number(next);
      if (!Number.isInteger(n)) fail(`${arg} must be an integer`);
      if (arg === "--hour") {
        if (n < 0 || n > 23) fail("--hour must be 0-23");
        out.hour = n;
      } else if (arg === "--minute") {
        if (n < 0 || n > 59) fail("--minute must be 0-59");
        out.minute = n;
      } else {
        if (n < 1 || n > 65535) fail("--port must be 1-65535");
        out.port = n;
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function resolveEnv(args) {
  const env = parseDotEnv(envPath);
  const secret = String(env.BROWSER_USE_DISCOVERY_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    fail(
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET is not set in integrations/browser-use-discovery/.env. Set it and rerun.",
    );
  }
  try {
    sanitizeSecret(secret);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const port = Number(args.port || env.BROWSER_USE_DISCOVERY_PORT || 8644);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`resolved port is invalid: ${port}`);
  }
  return { port };
}

export function buildSchtasksArgs({ hour, minute, force }) {
  const taskRun = `powershell -File "${refreshScriptPath}"`;
  const args = [
    "/Create",
    "/SC",
    "DAILY",
    "/TN",
    TASK_NAME,
    "/TR",
    taskRun,
    "/ST",
    formatClock(hour, minute),
  ];
  if (force) args.push("/F");
  return args;
}

function taskExists() {
  const query = spawnSync("schtasks", ["/Query", "/TN", TASK_NAME], {
    stdio: "ignore",
  });
  return query.status === 0;
}

function main() {
  if (platform() !== "win32") {
    fail("schedule:install-windows is Windows-only.");
  }
  const args = parseArgs(process.argv.slice(2));
  const env = resolveEnv(args);
  if (taskExists() && !args.force) {
    fail("Task Scheduler entry JobBoredRefresh already exists. Re-run with --force to overwrite.");
  }
  const create = spawnSync("schtasks", buildSchtasksArgs(args), {
    stdio: "inherit",
  });
  if (create.status !== 0) {
    fail(`schtasks /Create failed (exit ${create.status})`);
  }
  writeScheduleBreadcrumb({
    platform: "win32",
    artifactPath: TASK_NAME,
    hour: args.hour,
    minute: args.minute,
    port: env.port,
  });
  console.log(`${FAIL_PREFIX}: OK`);
  console.log(`  Task:       ${TASK_NAME}`);
  console.log(`  Fires at:   ${formatClock(args.hour, args.minute)} local`);
  console.log("");
  console.log(
    "Reminder: the local worker (npm run discovery:worker:start-local) must be running when the task fires.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
