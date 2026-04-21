#!/usr/bin/env node
/**
 * JobBored daily refresh — cross-platform scheduler uninstaller.
 */
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { deleteScheduleBreadcrumb, repoRoot } from "./lib/schedule.mjs";

const FAIL_PREFIX = "schedule:uninstall";
const LINUX_TIMER = "jobbored-refresh.timer";
const LINUX_SERVICE = "jobbored-refresh.service";
const WINDOWS_TASK = "JobBoredRefresh";
const CRON_START = "# JobBored daily refresh START";
const CRON_END = "# JobBored daily refresh END";

function fail(message, code = 1) {
  console.error(`${FAIL_PREFIX}: ${message}`);
  process.exit(code);
}

function printUsage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`schedule:uninstall

Removes the daily local JobBored discovery refresh for this OS.

Usage:
  npm run schedule:uninstall

Options:
  --help, -h    Show this message.
`);
  process.exit(code);
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") printUsage(0);
  }
}

function uninstallDarwin() {
  const script = join(repoRoot, "scripts", "uninstall-launchd-refresh.mjs");
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  process.exit(result.status === null ? 1 : result.status);
}

function systemctlUserAvailable() {
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

  if (systemctlUserAvailable()) {
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
  if (systemctlUserAvailable()) {
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
    if (write.status !== 0) {
      fail(`crontab update failed (exit ${write.status})`);
    }
  }

  deleteScheduleBreadcrumb();
  console.log(`${FAIL_PREFIX}: removed Linux schedule artifacts`);
  for (const path of removedFiles) {
    console.log(`  Removed: ${path}`);
  }
}

function uninstallWindows() {
  const query = spawnSync("schtasks", ["/Query", "/TN", WINDOWS_TASK], {
    stdio: "ignore",
  });
  if (query.status === 0) {
    const del = spawnSync("schtasks", ["/Delete", "/TN", WINDOWS_TASK, "/F"], {
      stdio: "inherit",
    });
    if (del.status !== 0) {
      fail(`schtasks /Delete failed (exit ${del.status})`);
    }
  }
  deleteScheduleBreadcrumb();
  console.log(`${FAIL_PREFIX}: removed Windows schedule artifact ${WINDOWS_TASK}`);
}

function main() {
  parseArgs(process.argv.slice(2));
  const osPlatform = platform();
  if (osPlatform === "darwin") uninstallDarwin();
  if (osPlatform === "linux") {
    uninstallLinux();
    return;
  }
  if (osPlatform === "win32") {
    uninstallWindows();
    return;
  }
  fail("unsupported OS for local scheduling.");
}

main();
