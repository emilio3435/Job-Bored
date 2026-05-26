#!/usr/bin/env node
/**
 * JobBored expired-job cleanup — cross-platform daily scheduler installer.
 *
 * Goal: run cleanup on a sibling daily schedule that sits 45 minutes after the
 * installed discovery refresh so the dashboard, discovery worker, and cleanup
 * pass operate as one chain on the same configured Sheet.
 *
 * Defaults:
 * - daily cadence (every day, not weekly)
 * - hour/minute derived from the installed discovery refresh breadcrumb + 45m
 * - 45-minute scheduled runner timeout matches the post-discovery window
 * - dry-run by default; --write must be explicit on install or run
 *
 * Distinct artifacts keep this schedule independent from discovery:
 *   macOS launchd label  com.jobbored.expired-cleanup
 *   systemd unit         jobbored-expired-cleanup.{service,timer}
 *   Task Scheduler task  JobBoredExpiredCleanup
 *   cron block tag       # JobBored expired cleanup START/END
 *   log file             integrations/browser-use-discovery/state/expired-cleanup-schedule.log
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

import { parseDotEnv } from "./lib/env.mjs";
import {
  envPath,
  formatClock,
  normalizeSheetIdCandidate,
  readExpiredCleanupScheduleBreadcrumb,
  readScheduleBreadcrumb,
  readWorkerConfigSheetId,
  repoRoot,
  stateDir,
  writeExpiredCleanupScheduleBreadcrumb,
} from "./lib/schedule.mjs";

const FAIL_PREFIX = "cleanup:expired-jobs:schedule:install";
const LABEL = "com.jobbored.expired-cleanup";
const LAUNCHD_AGENT_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${LABEL}.plist`,
);
const SYSTEMD_SERVICE = "jobbored-expired-cleanup.service";
const SYSTEMD_TIMER = "jobbored-expired-cleanup.timer";
const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user");
const SYSTEMD_SERVICE_PATH = join(SYSTEMD_USER_DIR, SYSTEMD_SERVICE);
const SYSTEMD_TIMER_PATH = join(SYSTEMD_USER_DIR, SYSTEMD_TIMER);
const WINDOWS_TASK = "JobBoredExpiredCleanup";
const CRON_START = "# JobBored expired cleanup START";
const CRON_END = "# JobBored expired cleanup END";
export const POST_DISCOVERY_OFFSET_MINUTES = 45;
export const SCHEDULED_RUNNER_TIMEOUT_MS = POST_DISCOVERY_OFFSET_MINUTES * 60_000;
const runnerPath = join(repoRoot, "scripts", "run-scheduled-expired-cleanup.mjs");
const windowsHelperPath = join(repoRoot, "scripts", "windows", "expired-cleanup.ps1");
const logPath = join(stateDir, "expired-cleanup-schedule.log");

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Installs a daily local expired-job cleanup scan. Default mode is dry-run.
Cleanup defaults to 45 minutes after the installed discovery refresh.

Usage:
  npm run cleanup:expired-jobs:schedule:install -- --sheet-id YOUR_SHEET_ID
  npm run cleanup:expired-jobs:schedule:install -- --hour 9 --minute 0
  npm run cleanup:expired-jobs:schedule:install -- --sheet-id YOUR_SHEET_ID --write --force
  npm run cleanup:expired-jobs:schedule:status

Options:
  --hour N      Hour of day to fire (0-23, local time). Defaults to discovery hour + 45m, or 9.
  --minute N    Minute of hour to fire (0-59). Defaults to discovery minute + 45m, or 0.
  --sheet-id ID Sheet ID to scan. Defaults to .env or worker-config.json.
  --write       Scheduled job updates confirmed closed rows. Default is dry-run.
  --force       Overwrite an existing scheduler artifact.
  --status      Print installed status and exit 0.
  --help, -h    Show this message.
`);
  process.exit(code);
}

export function deriveDefaultCleanupClock(
  discoveryBreadcrumb,
  offsetMinutes = POST_DISCOVERY_OFFSET_MINUTES,
) {
  const fallback = { hour: 9, minute: 0 };
  if (!discoveryBreadcrumb || typeof discoveryBreadcrumb !== "object") {
    return fallback;
  }
  const hour = Number(discoveryBreadcrumb.hour);
  const minute = Number(discoveryBreadcrumb.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fallback;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return fallback;
  const total = hour * 60 + minute + Math.max(0, Math.floor(offsetMinutes));
  return {
    hour: Math.floor(total / 60) % 24,
    minute: total % 60,
  };
}

export function parseArgs(argv, defaults = { hour: 9, minute: 0 }) {
  const out = {
    hour: defaults.hour,
    minute: defaults.minute,
    sheetId: "",
    writeMode: false,
    force: false,
    status: false,
    hourExplicit: false,
    minuteExplicit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--write") {
      out.writeMode = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.writeMode = false;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--status") {
      out.status = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--hour" || arg === "--minute" || arg === "--sheet-id") {
      if (next === undefined || next.startsWith("--")) {
        fail(`missing value for ${arg}`);
      }
      if (arg === "--sheet-id") {
        out.sheetId = String(next).trim();
        i += 1;
        continue;
      }
      const n = Number(next);
      if (!Number.isInteger(n)) fail(`${arg} must be an integer`);
      if (arg === "--hour") {
        if (n < 0 || n > 23) fail("--hour must be 0-23");
        out.hour = n;
        out.hourExplicit = true;
      } else {
        if (n < 0 || n > 59) fail("--minute must be 0-59");
        out.minute = n;
        out.minuteExplicit = true;
      }
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  return out;
}

function resolveSheetId(args) {
  const env = parseDotEnv(envPath);
  return (
    normalizeSheetIdCandidate(args.sheetId) ||
    normalizeSheetIdCandidate(env.BROWSER_USE_DISCOVERY_SHEET_ID) ||
    normalizeSheetIdCandidate(env.JOBBORED_SHEET_ID) ||
    normalizeSheetIdCandidate(env.SHEET_ID) ||
    readWorkerConfigSheetId()
  );
}

function modeArg(writeMode) {
  return writeMode ? "--write" : "--dry-run";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function quotePowerShellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildRunnerArgs({ sheetId, writeMode }) {
  return [
    "--sheet-id",
    sheetId,
    modeArg(writeMode),
    "--total-timeout-ms",
    String(SCHEDULED_RUNNER_TIMEOUT_MS),
  ];
}

export function renderLaunchdPlist({ hour, minute, sheetId, writeMode }) {
  const runnerArgs = buildRunnerArgs({ sheetId, writeMode })
    .map((value) => `      <string>${value}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${process.execPath}</string>
      <string>${runnerPath}</string>
${runnerArgs}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
  </dict>
</plist>
`;
}

export function renderSystemdFiles({ hour, minute, sheetId, writeMode }) {
  const execArgs = buildRunnerArgs({ sheetId, writeMode }).join(" ");
  const service = `[Unit]
Description=JobBored expired-job cleanup
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${repoRoot}
ExecStart=${process.execPath} ${runnerPath} ${execArgs}
StandardOutput=append:${logPath}
StandardError=append:${logPath}
`;
  const timer = `[Unit]
Description=Run JobBored expired-job cleanup daily

[Timer]
OnCalendar=*-*-* ${formatClock(hour, minute)}:00
Persistent=true
Unit=${SYSTEMD_SERVICE}

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

export function renderCronBlock({ hour, minute, sheetId, writeMode }) {
  const runnerArgs = buildRunnerArgs({ sheetId, writeMode })
    .map((value) =>
      value.startsWith("--") ? value : shellQuote(value),
    );
  const command = [
    shellQuote(process.execPath),
    shellQuote(runnerPath),
    ...runnerArgs,
    ">>",
    shellQuote(logPath),
    "2>&1",
  ].join(" ");
  return `${CRON_START}
${minute} ${hour} * * * ${command}
${CRON_END}`;
}

export function buildSchtasksArgs({ hour, minute, sheetId, writeMode, force }) {
  const taskRun =
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${windowsHelperPath}"` +
    ` -SheetId ${quotePowerShellSingleQuoted(sheetId)}` +
    ` -TimeoutMs ${SCHEDULED_RUNNER_TIMEOUT_MS}` +
    (writeMode ? " -Write" : "");
  const args = [
    "/Create",
    "/SC",
    "DAILY",
    "/TN",
    WINDOWS_TASK,
    "/TR",
    taskRun,
    "/ST",
    formatClock(hour, minute),
  ];
  if (force) args.push("/F");
  return args;
}

function printStatus() {
  const breadcrumb = readExpiredCleanupScheduleBreadcrumb();
  if (!breadcrumb) {
    console.log("installed: false");
    return;
  }
  console.log("installed: true");
  console.log(`platform: ${String(breadcrumb.platform || "")}`);
  console.log(`artifactPath: ${String(breadcrumb.artifactPath || "")}`);
  console.log(`cadence: ${String(breadcrumb.cadence || "daily")}`);
  console.log(`hour: ${String(breadcrumb.hour ?? "")}`);
  console.log(`minute: ${String(breadcrumb.minute ?? "")}`);
  console.log(`mode: ${String(breadcrumb.mode || "dry-run")}`);
  console.log(`sheetId: ${String(breadcrumb.sheetId || "")}`);
  console.log(`installedAt: ${String(breadcrumb.installedAt || "")}`);
}

function writeBreadcrumb(args, platformName, artifactPath, sheetId) {
  writeExpiredCleanupScheduleBreadcrumb({
    platform: platformName,
    artifactPath,
    hour: args.hour,
    minute: args.minute,
    sheetId,
    writeMode: args.writeMode,
    cadence: "daily",
  });
}

function installDarwin(args, sheetId) {
  if (existsSync(LAUNCHD_AGENT_PATH) && !args.force) {
    fail(`${LAUNCHD_AGENT_PATH} already exists. Re-run with --force to overwrite.`);
  }
  mkdirSync(dirname(LAUNCHD_AGENT_PATH), { recursive: true });
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    LAUNCHD_AGENT_PATH,
    renderLaunchdPlist({ ...args, sheetId }),
    { encoding: "utf8", mode: 0o600 },
  );
  spawnSync("launchctl", ["unload", LAUNCHD_AGENT_PATH], { stdio: "ignore" });
  const load = spawnSync("launchctl", ["load", LAUNCHD_AGENT_PATH], {
    stdio: "inherit",
  });
  if (load.status !== 0) {
    fail(`launchctl load failed (exit ${load.status}). Plist left at ${LAUNCHD_AGENT_PATH}.`);
  }
  writeBreadcrumb(args, "darwin", LAUNCHD_AGENT_PATH, sheetId);
  printSuccess("launchd", LAUNCHD_AGENT_PATH, args, sheetId);
}

function systemdUserAvailable() {
  const result = spawnSync("systemctl", ["--user", "list-timers", "--no-pager"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function installSystemd(args, sheetId) {
  if ((existsSync(SYSTEMD_SERVICE_PATH) || existsSync(SYSTEMD_TIMER_PATH)) && !args.force) {
    fail(`${SYSTEMD_TIMER_PATH} already exists. Re-run with --force to overwrite.`);
  }
  mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  mkdirSync(dirname(logPath), { recursive: true });
  const rendered = renderSystemdFiles({ ...args, sheetId });
  writeFileSync(SYSTEMD_SERVICE_PATH, rendered.service, {
    encoding: "utf8",
    mode: 0o600,
  });
  writeFileSync(SYSTEMD_TIMER_PATH, rendered.timer, {
    encoding: "utf8",
    mode: 0o600,
  });
  const reload = spawnSync("systemctl", ["--user", "daemon-reload"], {
    stdio: "inherit",
  });
  if (reload.status !== 0) fail(`systemctl --user daemon-reload failed (exit ${reload.status})`);
  const enable = spawnSync("systemctl", ["--user", "enable", "--now", SYSTEMD_TIMER], {
    stdio: "inherit",
  });
  if (enable.status !== 0) fail(`systemctl --user enable --now ${SYSTEMD_TIMER} failed (exit ${enable.status})`);
  writeBreadcrumb(args, "linux", SYSTEMD_TIMER_PATH, sheetId);
  printSuccess("systemd timer", SYSTEMD_TIMER_PATH, args, sheetId);
}

function stripCronBlock(crontabText) {
  const start = CRON_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = CRON_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return crontabText
    .replace(new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g"), "\n")
    .trimEnd();
}

function installCron(args, sheetId) {
  const list = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const existing = list.status === 0 ? list.stdout : "";
  if (existing.includes(CRON_START) && !args.force) {
    fail("existing JobBored expired cleanup crontab block found. Re-run with --force.");
  }
  const cleaned = stripCronBlock(existing);
  const block = renderCronBlock({ ...args, sheetId });
  const next = `${cleaned ? `${cleaned}\n\n` : ""}${block}\n`;
  const write = spawnSync("crontab", ["-"], {
    input: next,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (write.status !== 0) fail(`crontab install failed (exit ${write.status})`);
  writeBreadcrumb(args, "linux", "crontab:JobBoredExpiredCleanup", sheetId);
  printSuccess("crontab fallback", "crontab:JobBoredExpiredCleanup", args, sheetId);
}

function installLinux(args, sheetId) {
  if (systemdUserAvailable()) installSystemd(args, sheetId);
  else installCron(args, sheetId);
}

function installWindows(args, sheetId) {
  const query = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK], {
    stdio: "ignore",
  });
  if (query.status === 0 && !args.force) {
    fail(`${WINDOWS_TASK} already exists. Re-run with --force to overwrite.`);
  }
  const create = spawnSync("schtasks", buildSchtasksArgs({ ...args, sheetId }), {
    stdio: "inherit",
  });
  if (create.status !== 0) fail(`schtasks /Create failed (exit ${create.status})`);
  writeBreadcrumb(args, "win32", WINDOWS_TASK, sheetId);
  printSuccess("Task Scheduler", WINDOWS_TASK, args, sheetId);
}

function printSuccess(kind, artifactPath, args, sheetId) {
  console.log(`${FAIL_PREFIX}: OK`);
  console.log(`  Artifact: ${artifactPath}`);
  console.log(`  Kind:     ${kind}`);
  console.log(`  Fires:    daily ${formatClock(args.hour, args.minute)} local`);
  console.log(`  Mode:     ${args.writeMode ? "write" : "dry-run"}`);
  console.log(`  Sheet:    ${sheetId}`);
  console.log(`  Log:      ${logPath}`);
  console.log(`  Timeout:  ${SCHEDULED_RUNNER_TIMEOUT_MS}ms (${POST_DISCOVERY_OFFSET_MINUTES} min)`);
}

function main() {
  const discoveryBreadcrumb = readScheduleBreadcrumb();
  const defaults = deriveDefaultCleanupClock(discoveryBreadcrumb);
  const args = parseArgs(process.argv.slice(2), defaults);
  if (args.status) {
    printStatus();
    return;
  }
  const sheetId = resolveSheetId(args);
  if (!sheetId) {
    fail("sheetId is required. Pass --sheet-id or set it in .env/worker-config.json.");
  }
  const os = platform();
  if (os === "darwin") installDarwin(args, sheetId);
  else if (os === "linux") installLinux(args, sheetId);
  else if (os === "win32") installWindows(args, sheetId);
  else fail("unsupported OS for local scheduling.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
