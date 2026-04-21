#!/usr/bin/env node
/**
 * JobBored daily refresh — macOS launchd installer.
 *
 * Path B of the three-cadence-path ladder. Writes a launchd plist that fires
 * /usr/bin/curl POST http://127.0.0.1:<PORT>/discovery-profile with
 * {mode:"refresh"} at the configured local time. Requires the local worker
 * to be running (npm run discovery:worker:start-local) for the refresh to
 * land.
 *
 * Usage (from repo root):
 *   npm run schedule:install-local
 *   npm run schedule:install-local -- --hour 7 --minute 30
 *
 * Removes with:
 *   npm run schedule:uninstall-local
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir, platform } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parseDotEnv, sanitizeSecret } from "./lib/env.mjs";
import { writeScheduleBreadcrumb } from "./lib/schedule.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const templatePath = join(
  repoRoot,
  "templates",
  "launchd",
  "com.jobbored.refresh.plist",
);
const envPath = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  ".env",
);
const agentDir = join(homedir(), "Library", "LaunchAgents");
const agentPath = join(agentDir, "com.jobbored.refresh.plist");
const logPath = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  "state",
  "launchd-refresh.log",
);
const LABEL = "com.jobbored.refresh";

function fail(message, code = 1) {
  console.error(`schedule:install-local: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`schedule:install-local

Writes ~/Library/LaunchAgents/${LABEL}.plist and loads it.

Usage:
  npm run schedule:install-local
  npm run schedule:install-local -- --hour 7 --minute 30

Options:
  --hour N      Hour of day to fire (0-23, local time). Default: 8.
  --minute N    Minute of hour to fire (0-59). Default: 0.
  --port N      Worker port. Default: BROWSER_USE_DISCOVERY_PORT in .env or 8644.
  --force       Overwrite an existing agent plist without prompting.
  --help        Show this message.

Removes via:
  npm run schedule:uninstall-local
`);
  process.exit(code);
}

function parseArgs(argv) {
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
      } else if (arg === "--port") {
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

export function renderTemplate(template, replacements) {
  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

function main() {
  if (platform() !== "darwin") {
    fail(
      "schedule:install-local is macOS-only (uses launchd). On Linux, add a cron entry — see README 'Daily refresh: pick one cadence path'.",
    );
  }
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(templatePath)) {
    fail(`template not found: ${templatePath}`);
  }
  const env = parseDotEnv(envPath);
  const secret = String(
    env.BROWSER_USE_DISCOVERY_WEBHOOK_SECRET || "",
  ).trim();
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

  const port = Number(
    args.port || env.BROWSER_USE_DISCOVERY_PORT || 8644,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`resolved port is invalid: ${port}`);
  }
  const workerUrl = `http://127.0.0.1:${port}/discovery-profile`;

  if (existsSync(agentPath) && !args.force) {
    fail(
      `${agentPath} already exists. Re-run with --force to overwrite, or run schedule:uninstall-local first.`,
    );
  }
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }
  mkdirSync(dirname(logPath), { recursive: true });

  const template = readFileSync(templatePath, "utf8");
  const rendered = renderTemplate(template, {
    SECRET: secret,
    WORKER_URL: workerUrl,
    LOG_PATH: logPath,
    HOUR: args.hour,
    MINUTE: args.minute,
  });
  writeFileSync(agentPath, rendered, { encoding: "utf8", mode: 0o600 });

  // Unload first (idempotent) so re-installs pick up edits.
  spawnSync("launchctl", ["unload", agentPath], {
    stdio: "ignore",
  });
  const load = spawnSync("launchctl", ["load", agentPath], {
    stdio: "inherit",
  });
  if (load.status !== 0) {
    fail(`launchctl load failed (exit ${load.status}). Plist left at ${agentPath}.`);
  }
  writeScheduleBreadcrumb({
    platform: "darwin",
    artifactPath: agentPath,
    hour: args.hour,
    minute: args.minute,
    port,
  });

  console.log("schedule:install-local: OK");
  console.log(`  Plist:      ${agentPath}`);
  console.log(`  Fires at:   ${String(args.hour).padStart(2, "0")}:${String(args.minute).padStart(2, "0")} local`);
  console.log(`  Worker URL: ${workerUrl}`);
  console.log(`  Log:        ${logPath}`);
  console.log("");
  console.log("Verify loaded:  launchctl list | grep jobbored");
  console.log("Fire manually:  launchctl start com.jobbored.refresh");
  console.log("Tail log:       tail -f \"" + logPath + "\"");
  console.log("");
  console.log(
    "Reminder: the local worker (npm run discovery:worker:start-local) must be running when the agent fires, or the curl will fail.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
