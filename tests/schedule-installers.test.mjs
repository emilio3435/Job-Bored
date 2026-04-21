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
import { repoRoot } from "../scripts/lib/schedule.mjs";

test("macOS launchd template renders the scheduled refresh request", () => {
  const template = readFileSync(
    join(repoRoot, "templates", "launchd", "com.jobbored.refresh.plist"),
    "utf8",
  );
  const rendered = renderTemplate(template, {
    SECRET: "secret-xyz",
    WORKER_URL: "http://127.0.0.1:8644/discovery-profile",
    LOG_PATH: join(repoRoot, "integrations", "browser-use-discovery", "state", "launchd-refresh.log"),
    HOUR: 8,
    MINUTE: 5,
  });

  assert.match(rendered, /<string>\/usr\/bin\/curl<\/string>/);
  assert.match(rendered, /x-discovery-secret: secret-xyz/);
  assert.match(rendered, /"mode":"refresh"/);
  assert.match(rendered, /<integer>8<\/integer>/);
  assert.match(rendered, /<integer>5<\/integer>/);
});

test("Linux systemd templates render a persistent daily timer", () => {
  const rendered = renderSystemdFiles({
    hour: 8,
    minute: 5,
    port: 8644,
    secret: "secret-xyz",
  });

  assert.match(rendered.service, /^Type=oneshot$/m);
  assert.match(rendered.service, /ExecStart=\/usr\/bin\/curl/);
  assert.match(rendered.service, /x-discovery-secret: secret-xyz/);
  assert.match(rendered.service, /http:\/\/127\.0\.0\.1:8644\/discovery-profile/);
  assert.match(rendered.timer, /^OnCalendar=\*-\*-\* 08:05:00$/m);
  assert.match(rendered.timer, /^Persistent=true$/m);
});

test("Linux crontab fallback renders a daily curl block", () => {
  const rendered = renderCronBlock({
    hour: 8,
    minute: 5,
    port: 8644,
    secret: "secret-xyz",
  });

  assert.match(rendered, /# JobBored daily refresh START/);
  assert.match(rendered, /^5 8 \* \* \* \/usr\/bin\/curl/m);
  assert.match(rendered, /'x-discovery-secret: secret-xyz'/);
  assert.match(rendered, /'http:\/\/127\.0\.0\.1:8644\/discovery-profile'/);
});

test("Windows Task Scheduler arguments create the daily refresh task", () => {
  const args = buildSchtasksArgs({
    hour: 8,
    minute: 5,
    force: true,
  });

  assert.deepEqual(args.slice(0, 10), [
    "/Create",
    "/SC",
    "DAILY",
    "/TN",
    "JobBoredRefresh",
    "/TR",
    `powershell -File "${join(repoRoot, "scripts", "windows", "refresh.ps1")}"`,
    "/ST",
    "08:05",
    "/F",
  ]);
});
