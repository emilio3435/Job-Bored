#!/usr/bin/env node
/**
 * JobBored daily refresh — Linux systemd user timer installer.
 *
 * Writes ~/.config/systemd/user/jobbored-refresh.{service,timer} when
 * `systemctl --user` is available. Falls back to an idempotent crontab block
 * in Docker/WSL environments without a user systemd manager.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { parseDotEnv, sanitizeSecret } from "./lib/env.mjs";
import {
  envPath,
  formatClock,
  refreshRequestBody,
  renderTemplate,
  repoRoot,
  stateDir,
  writeScheduleBreadcrumb,
} from "./lib/schedule.mjs";

const FAIL_PREFIX = "schedule:install-linux";
const TIMER_NAME = "jobbored-refresh.timer";
const SERVICE_NAME = "jobbored-refresh.service";
const CRON_START = "# JobBored daily refresh START";
const CRON_END = "# JobBored daily refresh END";
const systemdUserDir = join(homedir(), ".config", "systemd", "user");
const servicePath = join(systemdUserDir, SERVICE_NAME);
const timerPath = join(systemdUserDir, TIMER_NAME);
const systemdTemplateDir = join(repoRoot, "templates", "systemd");
const cronLogPath = join(stateDir, "cron-refresh.log");

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Writes a systemd user timer, or a crontab fallback when user systemd is unavailable.

Usage:
  node scripts/install-cron-refresh.mjs
  node scripts/install-cron-refresh.mjs --hour 7 --minute 30

Options:
  --hour N      Hour of day to fire (0-23, local time). Default: 8.
  --minute N    Minute of hour to fire (0-59). Default: 0.
  --port N      Worker port. Default: BROWSER_USE_DISCOVERY_PORT in .env or 8644.
  --force       Overwrite an existing timer/crontab block.
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
  return { secret, port };
}

export function renderSystemdFiles({ hour, minute, port, secret }) {
  const serviceTemplate = readFileSync(
    join(systemdTemplateDir, SERVICE_NAME),
    "utf8",
  );
  const timerTemplate = readFileSync(join(systemdTemplateDir, TIMER_NAME), "utf8");
  return {
    service: renderTemplate(serviceTemplate, {
      SECRET: secret,
      PORT: port,
      REPO_ROOT: repoRoot,
    }),
    timer: renderTemplate(timerTemplate, {
      HOUR: String(hour).padStart(2, "0"),
      MINUTE: String(minute).padStart(2, "0"),
    }),
  };
}

function isSystemdUserAvailable() {
  const result = spawnSync("systemctl", ["--user", "list-timers", "--no-pager"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function installSystemd(args, env) {
  if ((existsSync(servicePath) || existsSync(timerPath)) && !args.force) {
    fail(
      `${timerPath} already exists. Re-run with --force to overwrite, or run schedule:uninstall first.`,
    );
  }
  mkdirSync(systemdUserDir, { recursive: true });
  const rendered = renderSystemdFiles({
    hour: args.hour,
    minute: args.minute,
    port: env.port,
    secret: env.secret,
  });
  writeFileSync(servicePath, rendered.service, { encoding: "utf8", mode: 0o600 });
  writeFileSync(timerPath, rendered.timer, { encoding: "utf8", mode: 0o600 });

  const reload = spawnSync("systemctl", ["--user", "daemon-reload"], {
    stdio: "inherit",
  });
  if (reload.status !== 0) {
    fail(`systemctl --user daemon-reload failed (exit ${reload.status})`);
  }
  const enable = spawnSync(
    "systemctl",
    ["--user", "enable", "--now", TIMER_NAME],
    { stdio: "inherit" },
  );
  if (enable.status !== 0) {
    fail(`systemctl --user enable --now ${TIMER_NAME} failed (exit ${enable.status})`);
  }

  writeScheduleBreadcrumb({
    platform: "linux",
    artifactPath: timerPath,
    hour: args.hour,
    minute: args.minute,
    port: env.port,
  });
  printSuccess("systemd timer", timerPath, args, env.port);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function renderCronBlock({ hour, minute, port, secret }) {
  const workerUrl = `http://127.0.0.1:${port}/discovery-profile`;
  const command = [
    "/usr/bin/curl",
    "-sS",
    "--max-time",
    "600",
    "-X",
    "POST",
    "-H",
    shellQuote("content-type: application/json"),
    "-H",
    shellQuote(`x-discovery-secret: ${secret}`),
    "-d",
    shellQuote(refreshRequestBody),
    shellQuote(workerUrl),
    ">>",
    shellQuote(cronLogPath),
    "2>&1",
  ].join(" ");
  return `${CRON_START}
${minute} ${hour} * * * ${command}
${CRON_END}`;
}

function stripCronBlock(crontabText) {
  const start = CRON_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = CRON_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return crontabText
    .replace(new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g"), "\n")
    .trimEnd();
}

function installCron(args, env) {
  const list = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const existing = list.status === 0 ? list.stdout : "";
  if (existing.includes(CRON_START) && !args.force) {
    fail("existing JobBored crontab block found. Re-run with --force to overwrite.");
  }
  const cleaned = stripCronBlock(existing);
  const block = renderCronBlock({
    hour: args.hour,
    minute: args.minute,
    port: env.port,
    secret: env.secret,
  });
  const next = `${cleaned ? `${cleaned}\n\n` : ""}${block}\n`;
  const write = spawnSync("crontab", ["-"], {
    input: next,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (write.status !== 0) {
    fail(`crontab install failed (exit ${write.status})`);
  }
  writeScheduleBreadcrumb({
    platform: "linux",
    artifactPath: "crontab:JobBoredRefresh",
    hour: args.hour,
    minute: args.minute,
    port: env.port,
  });
  printSuccess("crontab fallback", "crontab:JobBoredRefresh", args, env.port);
}

function printSuccess(kind, artifactPath, args, port) {
  console.log(`${FAIL_PREFIX}: OK`);
  console.log(`  Artifact:   ${artifactPath}`);
  console.log(`  Kind:       ${kind}`);
  console.log(`  Fires at:   ${formatClock(args.hour, args.minute)} local`);
  console.log(`  Worker URL: http://127.0.0.1:${port}/discovery-profile`);
  console.log("");
  console.log(
    "Reminder: the local worker (npm run discovery:worker:start-local) must be running when the scheduler fires.",
  );
}

function main() {
  if (platform() !== "linux") {
    fail("schedule:install-linux is Linux-only.");
  }
  const args = parseArgs(process.argv.slice(2));
  const env = resolveEnv(args);
  if (isSystemdUserAvailable()) {
    installSystemd(args, env);
  } else {
    installCron(args, env);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
