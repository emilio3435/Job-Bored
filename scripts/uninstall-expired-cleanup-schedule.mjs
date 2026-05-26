#!/usr/bin/env node
/**
 * JobBored expired-job cleanup — cross-platform scheduler uninstaller.
 */
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";

import { deleteExpiredCleanupScheduleBreadcrumb } from "./lib/schedule.mjs";

const FAIL_PREFIX = "cleanup:expired-jobs:schedule:uninstall";
const LABEL = "com.jobbored.expired-cleanup";
const LINUX_TIMER = "jobbored-expired-cleanup.timer";
const LINUX_SERVICE = "jobbored-expired-cleanup.service";
const WINDOWS_TASK = "JobBoredExpiredCleanup";
const CRON_START = "# JobBored expired cleanup START";
const CRON_END = "# JobBored expired cleanup END";

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`${FAIL_PREFIX}

Removes the weekly local JobBored expired-job cleanup schedule for this OS.

Usage:
  npm run cleanup:expired-jobs:schedule:uninstall

Options:
  --help, -h    Show this message.
`);
  process.exit(code);
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") printUsage(0);
    fail(`unknown argument: ${arg}`);
  }
}

function uninstallDarwin() {
  const agentPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  let removed = false;
  if (existsSync(agentPath)) {
    spawnSync("launchctl", ["unload", agentPath], { stdio: "ignore" });
    rmSync(agentPath, { force: true });
    removed = true;
  }
  spawnSync("launchctl", ["remove", LABEL], { stdio: "ignore" });
  deleteExpiredCleanupScheduleBreadcrumb();
  console.log(
    removed
      ? `${FAIL_PREFIX}: removed ${agentPath}`
      : `${FAIL_PREFIX}: nothing to remove (${agentPath} not found)`,
  );
}

function systemdUserAvailable() {
  const result = spawnSync("systemctl", ["--user", "list-timers", "--no-pager"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function stripCronBlock(crontabText) {
  const start = CRON_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = CRON_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return crontabText
    .replace(new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g"), "\n")
    .trimEnd();
}

function uninstallLinux() {
  const systemdUserDir = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(systemdUserDir, LINUX_SERVICE);
  const timerPath = join(systemdUserDir, LINUX_TIMER);

  if (systemdUserAvailable()) {
    spawnSync("systemctl", ["--user", "disable", "--now", LINUX_TIMER], {
      stdio: "ignore",
    });
  }

  const removedFiles = [];
  for (const path of [servicePath, timerPath]) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
      removedFiles.push(path);
    }
  }
  if (systemdUserAvailable()) {
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  }

  const list = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (list.status === 0 && list.stdout.includes(CRON_START)) {
    const next = `${stripCronBlock(list.stdout)}\n`;
    const write = spawnSync("crontab", ["-"], {
      input: next.trim() ? next : "",
      encoding: "utf8",
      stdio: ["pipe", "ignore", "inherit"],
    });
    if (write.status !== 0) fail(`crontab update failed (exit ${write.status})`);
  }

  deleteExpiredCleanupScheduleBreadcrumb();
  console.log(`${FAIL_PREFIX}: removed Linux expired cleanup schedule artifacts`);
  for (const path of removedFiles) console.log(`  Removed: ${path}`);
}

function uninstallWindows() {
  const query = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK], {
    stdio: "ignore",
  });
  if (query.status === 0) {
    const del = spawnSync("schtasks", ["/Delete", "/TN", WINDOWS_TASK, "/F"], {
      stdio: "inherit",
    });
    if (del.status !== 0) fail(`schtasks /Delete failed (exit ${del.status})`);
  }
  deleteExpiredCleanupScheduleBreadcrumb();
  console.log(`${FAIL_PREFIX}: removed Windows schedule artifact ${WINDOWS_TASK}`);
}

function main() {
  parseArgs(process.argv.slice(2));
  const os = platform();
  if (os === "darwin") uninstallDarwin();
  else if (os === "linux") uninstallLinux();
  else if (os === "win32") uninstallWindows();
  else fail("unsupported OS for local scheduling.");
}

main();
