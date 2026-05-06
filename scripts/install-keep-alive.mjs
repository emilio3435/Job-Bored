#!/usr/bin/env node
// Owner: Backend Worker B
// Purpose: Install a per-user background job that runs
// scripts/discovery-keep-alive.mjs every 30s. macOS = launchd plist;
// Linux = systemd-user .service + .timer. Windows = unsupported.
//
// Job label: ai.jobbored.discovery.keepalive
// Log path:  ~/.jobbored/logs/keep-alive.log
// State:     ~/.jobbored/keep-alive-state.json
//
// Locked contract - see dev-server.mjs handleInstallKeepAlive header.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KEEP_ALIVE_LABEL = "ai.jobbored.discovery.keepalive";
export const DEFAULT_INTERVAL_SECONDS = 30;

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, "..");

export function getKeepAlivePaths({
  homeDir = homedir(),
  repoRoot = defaultRepoRoot,
} = {}) {
  const jobboredDir = join(homeDir, ".jobbored");
  return {
    repoRoot,
    scriptPath: join(repoRoot, "scripts", "discovery-keep-alive.mjs"),
    logPath: join(jobboredDir, "logs", "keep-alive.log"),
    statePath: join(jobboredDir, "keep-alive-state.json"),
    launchAgentDir: join(homeDir, "Library", "LaunchAgents"),
    launchAgentPath: join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${KEEP_ALIVE_LABEL}.plist`,
    ),
    systemdUserDir: join(homeDir, ".config", "systemd", "user"),
    systemdServicePath: join(
      homeDir,
      ".config",
      "systemd",
      "user",
      `${KEEP_ALIVE_LABEL}.service`,
    ),
    systemdTimerPath: join(
      homeDir,
      ".config",
      "systemd",
      "user",
      `${KEEP_ALIVE_LABEL}.timer`,
    ),
  };
}

function xmlEscape(raw) {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function systemdQuote(raw) {
  const value = String(raw);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderLaunchdPlist({
  nodePath = process.execPath,
  scriptPath,
  logPath,
  statePath,
  repoRoot,
}) {
  const pathEnv = process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(KEEP_ALIVE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
    <string>--once</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
    <key>JOBBORED_KEEP_ALIVE_STATE_PATH</key>
    <string>${xmlEscape(statePath)}</string>
    <key>JOBBORED_KEEP_ALIVE_LOG_PATH</key>
    <string>${xmlEscape(logPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${DEFAULT_INTERVAL_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdFiles({
  nodePath = process.execPath,
  scriptPath,
  logPath,
  statePath,
  repoRoot,
}) {
  return {
    service: `[Unit]
Description=JobBored discovery keep-alive check

[Service]
Type=oneshot
WorkingDirectory=${systemdQuote(repoRoot)}
Environment=JOBBORED_KEEP_ALIVE_STATE_PATH=${systemdQuote(statePath)}
Environment=JOBBORED_KEEP_ALIVE_LOG_PATH=${systemdQuote(logPath)}
ExecStart=${systemdQuote(nodePath)} ${systemdQuote(scriptPath)} --once
StandardOutput=append:${systemdQuote(logPath)}
StandardError=append:${systemdQuote(logPath)}
`,
    timer: `[Unit]
Description=Run JobBored discovery keep-alive every 30 seconds

[Timer]
OnBootSec=15s
OnUnitActiveSec=${DEFAULT_INTERVAL_SECONDS}s
AccuracySec=5s
Unit=${KEEP_ALIVE_LABEL}.service

[Install]
WantedBy=timers.target
`,
  };
}

function run(command, args, { spawnSyncImpl = spawnSync } = {}) {
  return spawnSyncImpl(command, args, {
    encoding: "utf8",
    env: process.env,
  });
}

function runRequired(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: `${command}_failed`,
      status: result.status,
      message: result.error ? result.error.message || String(result.error) : String(result.stderr || result.stdout || "").trim(),
    };
  }
  return { ok: true };
}

function ensureWritableDirs(paths) {
  mkdirSync(dirname(paths.logPath), { recursive: true });
  mkdirSync(dirname(paths.statePath), { recursive: true });
}

function installDarwin(options) {
  const paths = getKeepAlivePaths(options);
  ensureWritableDirs(paths);
  mkdirSync(paths.launchAgentDir, { recursive: true });
  writeFileSync(
    paths.launchAgentPath,
    renderLaunchdPlist({
      nodePath: options.nodePath,
      scriptPath: paths.scriptPath,
      logPath: paths.logPath,
      statePath: paths.statePath,
      repoRoot: paths.repoRoot,
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  run("launchctl", ["unload", paths.launchAgentPath], options);
  const load = runRequired("launchctl", ["load", "-w", paths.launchAgentPath], options);
  if (!load.ok) return load;
  const start = runRequired("launchctl", ["start", KEEP_ALIVE_LABEL], options);
  if (!start.ok) return start;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: KEEP_ALIVE_LABEL,
    logPath: paths.logPath,
  };
}

function installLinux(options) {
  const paths = getKeepAlivePaths(options);
  ensureWritableDirs(paths);
  mkdirSync(paths.systemdUserDir, { recursive: true });
  const rendered = renderSystemdFiles({
    nodePath: options.nodePath,
    scriptPath: paths.scriptPath,
    logPath: paths.logPath,
    statePath: paths.statePath,
    repoRoot: paths.repoRoot,
  });
  writeFileSync(paths.systemdServicePath, rendered.service, {
    encoding: "utf8",
    mode: 0o600,
  });
  writeFileSync(paths.systemdTimerPath, rendered.timer, {
    encoding: "utf8",
    mode: 0o600,
  });

  const reload = runRequired("systemctl", ["--user", "daemon-reload"], options);
  if (!reload.ok) return reload;
  const enable = runRequired(
    "systemctl",
    ["--user", "enable", "--now", `${KEEP_ALIVE_LABEL}.timer`],
    options,
  );
  if (!enable.ok) return enable;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: KEEP_ALIVE_LABEL,
    logPath: paths.logPath,
  };
}

export function installKeepAlive(options = {}) {
  const platform = options.platform || osPlatform();
  if (options.schedule && options.schedule !== "auto") {
    if (options.schedule === "macos_launchd" && platform !== "darwin") {
      return { ok: false, reason: "unsupported_platform" };
    }
    if (options.schedule === "linux_systemd_user" && platform !== "linux") {
      return { ok: false, reason: "unsupported_platform" };
    }
  }
  if (platform === "darwin") return installDarwin(options);
  if (platform === "linux") return installLinux(options);
  if (platform === "win32") {
    return {
      ok: false,
      reason: "unsupported_platform",
      actionable:
        "Windows keep-alive install is not supported yet. Keep ngrok running manually and redeploy the relay after tunnel changes.",
    };
  }
  return { ok: false, reason: "unsupported_platform" };
}

function readState(statePath) {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (_) {
    return null;
  }
}

export function getKeepAliveStatus(options = {}) {
  const platform = options.platform || osPlatform();
  const paths = getKeepAlivePaths(options);
  const installed =
    platform === "darwin"
      ? existsSync(paths.launchAgentPath)
      : platform === "linux"
        ? existsSync(paths.systemdServicePath) && existsSync(paths.systemdTimerPath)
        : false;
  const state = readState(paths.statePath) || {};
  const status = { installed };
  if (installed) status.jobLabel = KEEP_ALIVE_LABEL;
  if (state.lastRunAt) status.lastRunAt = state.lastRunAt;
  if (state.lastNgrokUrl) status.lastNgrokUrl = state.lastNgrokUrl;
  return status;
}

function main() {
  const result = installKeepAlive();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
