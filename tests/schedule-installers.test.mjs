import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { renderTemplate } from "../scripts/install-launchd-refresh.mjs";
import {
  renderCronBlock,
  renderSystemdFiles,
} from "../scripts/install-cron-refresh.mjs";
import { buildSchtasksArgs } from "../scripts/install-taskscheduler-refresh.mjs";
import {
  buildSchtasksArgs as buildExpiredCleanupSchtasksArgs,
  deriveDefaultCleanupClock,
  parseArgs as parseExpiredCleanupArgs,
  renderCronBlock as renderExpiredCleanupCronBlock,
  renderLaunchdPlist as renderExpiredCleanupLaunchdPlist,
  renderSystemdFiles as renderExpiredCleanupSystemdFiles,
  POST_DISCOVERY_OFFSET_MINUTES,
  SCHEDULED_RUNNER_TIMEOUT_MS,
} from "../scripts/install-expired-cleanup-schedule.mjs";
import { parseScheduledExpiredCleanupArgs } from "../scripts/run-scheduled-expired-cleanup.mjs";
import { repoRoot } from "../scripts/lib/schedule.mjs";

test("macOS launchd template renders the scheduled refresh request", () => {
  const template = readFileSync(
    join(repoRoot, "templates", "launchd", "com.jobbored.refresh.plist"),
    "utf8",
  );
  const rendered = renderTemplate(template, {
    NODE_PATH: process.execPath,
    SCRIPT_PATH: join(repoRoot, "scripts", "run-scheduled-discovery.mjs"),
    PORT: 8644,
    SHEET_ID: "sheet_1234567890",
    LOG_PATH: join(repoRoot, "integrations", "browser-use-discovery", "state", "launchd-refresh.log"),
    HOUR: 8,
    MINUTE: 5,
  });

  assert.match(rendered, /run-scheduled-discovery\.mjs/);
  assert.match(rendered, /<string>scheduled-local<\/string>/);
  assert.match(rendered, /<string>8644<\/string>/);
  assert.match(rendered, /<string>sheet_1234567890<\/string>/);
  assert.match(rendered, /<integer>8<\/integer>/);
  assert.match(rendered, /<integer>5<\/integer>/);
});

test("Linux systemd templates render a persistent daily timer", () => {
  const rendered = renderSystemdFiles({
    hour: 8,
    minute: 5,
    port: 8644,
    secret: "secret-xyz",
    sheetId: "sheet_1234567890",
  });

  assert.match(rendered.service, /^Type=oneshot$/m);
  assert.match(rendered.service, /ExecStart=.*run-scheduled-discovery\.mjs/);
  assert.match(rendered.service, /--trigger scheduled-local/);
  assert.match(rendered.service, /--port 8644/);
  assert.match(rendered.service, /--sheet-id sheet_1234567890/);
  assert.match(rendered.timer, /^OnCalendar=\*-\*-\* 08:05:00$/m);
  assert.match(rendered.timer, /^Persistent=true$/m);
});

test("Linux crontab fallback renders a daily scheduled discovery block", () => {
  const rendered = renderCronBlock({
    hour: 8,
    minute: 5,
    port: 8644,
    secret: "secret-xyz",
    sheetId: "sheet_1234567890",
  });

  assert.match(rendered, /# JobBored daily refresh START/);
  assert.match(rendered, /^5 8 \* \* \* '.+node'/m);
  assert.match(rendered, /run-scheduled-discovery\.mjs/);
  assert.match(rendered, /--trigger scheduled-local/);
  assert.match(rendered, /--port 8644/);
  assert.match(rendered, /--sheet-id 'sheet_1234567890'/);
});

test("Windows Task Scheduler arguments create the daily refresh task", () => {
  const args = buildSchtasksArgs({
    hour: 8,
    minute: 5,
    sheetId: "sheet_1234567890",
    force: true,
  });

  assert.deepEqual(args.slice(0, 10), [
    "/Create",
    "/SC",
    "DAILY",
    "/TN",
    "JobBoredRefresh",
    "/TR",
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(repoRoot, "scripts", "windows", "refresh.ps1")}" -SheetId 'sheet_1234567890'`,
    "/ST",
    "08:05",
    "/F",
  ]);
});

test("expired cleanup launchd template renders a distinct daily dry-run schedule", () => {
  const rendered = renderExpiredCleanupLaunchdPlist({
    hour: 9,
    minute: 0,
    sheetId: "sheet_1234567890",
    writeMode: false,
  });

  assert.match(rendered, /com\.jobbored\.expired-cleanup/);
  assert.match(rendered, /run-scheduled-expired-cleanup\.mjs/);
  assert.match(rendered, /<string>--dry-run<\/string>/);
  assert.doesNotMatch(rendered, /<key>Weekday<\/key>/);
  assert.match(rendered, /<key>Hour<\/key>\s*<integer>9<\/integer>/);
  assert.match(rendered, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
  assert.match(rendered, /expired-cleanup-schedule\.log/);
  assert.match(
    rendered,
    new RegExp(`<string>--total-timeout-ms</string>\\s*<string>${SCHEDULED_RUNNER_TIMEOUT_MS}</string>`),
  );
});

test("expired cleanup systemd and cron render daily dry-run commands with 45-minute timeout", () => {
  const systemd = renderExpiredCleanupSystemdFiles({
    hour: 9,
    minute: 0,
    sheetId: "sheet_1234567890",
    writeMode: false,
  });
  assert.match(systemd.service, /Description=JobBored expired-job cleanup/);
  assert.match(systemd.service, /run-scheduled-expired-cleanup\.mjs/);
  assert.match(systemd.service, /--dry-run/);
  assert.match(
    systemd.service,
    new RegExp(`--total-timeout-ms ${SCHEDULED_RUNNER_TIMEOUT_MS}`),
  );
  assert.match(systemd.service, /StandardOutput=append:.+expired-cleanup-schedule\.log/);
  assert.match(systemd.timer, /^OnCalendar=\*-\*-\* 09:00:00$/m);
  assert.doesNotMatch(systemd.timer, /^OnCalendar=Sun/m);

  const cron = renderExpiredCleanupCronBlock({
    hour: 9,
    minute: 0,
    sheetId: "sheet_1234567890",
    writeMode: false,
  });
  assert.match(cron, /# JobBored expired cleanup START/);
  assert.match(cron, /^0 9 \* \* \* '.+node'/m);
  assert.match(cron, /run-scheduled-expired-cleanup\.mjs/);
  assert.match(cron, /--dry-run/);
  assert.match(cron, new RegExp(`--total-timeout-ms '${SCHEDULED_RUNNER_TIMEOUT_MS}'`));
  assert.match(cron, /expired-cleanup-schedule\.log/);
});

test("expired cleanup scheduler keeps write mode explicit on install", () => {
  const cron = renderExpiredCleanupCronBlock({
    hour: 6,
    minute: 30,
    sheetId: "sheet_1234567890",
    writeMode: true,
  });
  assert.match(cron, /^30 6 \* \* \* /m);
  assert.match(cron, /--write/);
  assert.doesNotMatch(cron, /--dry-run/);

  const args = buildExpiredCleanupSchtasksArgs({
    hour: 6,
    minute: 30,
    sheetId: "sheet_1234567890",
    writeMode: true,
    force: true,
  });
  assert.deepEqual(args.slice(0, 9), [
    "/Create",
    "/SC",
    "DAILY",
    "/TN",
    "JobBoredExpiredCleanup",
    "/TR",
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(repoRoot, "scripts", "windows", "expired-cleanup.ps1")}" -SheetId 'sheet_1234567890' -TimeoutMs ${SCHEDULED_RUNNER_TIMEOUT_MS} -Write`,
    "/ST",
    "06:30",
  ]);
  assert.equal(args.at(-1), "/F");
});

test("expired cleanup defaults derive from discovery breadcrumb + 45 minutes", () => {
  assert.equal(POST_DISCOVERY_OFFSET_MINUTES, 45);
  assert.equal(SCHEDULED_RUNNER_TIMEOUT_MS, 45 * 60_000);

  assert.deepEqual(deriveDefaultCleanupClock({ hour: 8, minute: 15 }), {
    hour: 9,
    minute: 0,
  });
  assert.deepEqual(deriveDefaultCleanupClock({ hour: 23, minute: 30 }), {
    hour: 0,
    minute: 15,
  });
  assert.deepEqual(deriveDefaultCleanupClock(null), { hour: 9, minute: 0 });
  assert.deepEqual(deriveDefaultCleanupClock({ hour: "x" }), {
    hour: 9,
    minute: 0,
  });
});

test("expired cleanup CLI defaults to dry-run and stays daily without --weekday", () => {
  const defaults = { hour: 9, minute: 0 };
  const argsDefault = parseExpiredCleanupArgs([], defaults);
  assert.equal(argsDefault.writeMode, false);
  assert.equal(argsDefault.hour, 9);
  assert.equal(argsDefault.minute, 0);

  const argsExplicit = parseExpiredCleanupArgs(
    ["--write", "--hour", "9", "--minute", "0"],
    defaults,
  );
  assert.equal(argsExplicit.writeMode, true);
  assert.equal(argsExplicit.hourExplicit, true);
});

test("scheduled expired cleanup runner accepts --total-timeout-ms and --write", () => {
  const args = parseScheduledExpiredCleanupArgs([
    "--sheet-id",
    "sheet_1234567890",
    "--write",
    "--total-timeout-ms",
    String(SCHEDULED_RUNNER_TIMEOUT_MS),
  ]);
  assert.equal(args.sheetId, "sheet_1234567890");
  assert.equal(args.dryRun, false);
  assert.equal(args.totalTimeoutMs, SCHEDULED_RUNNER_TIMEOUT_MS);
});
