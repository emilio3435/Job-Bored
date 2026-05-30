#!/usr/bin/env node
// Purpose: Install a per-user background service that keeps the JobBored
// browser-use discovery worker running — started at login/boot and restarted
// on crash — by launching scripts/start-discovery-worker-local.mjs.
// macOS = launchd plist (RunAtLoad + KeepAlive). Linux = systemd-user .service
// (Type=simple, Restart=on-failure). Windows = unsupported.
//
// Job label: ai.jobbored.discovery.worker
// Log path:  ~/.jobbored/logs/discovery-worker.log
//
// The worker port is read from discovery-local-bootstrap.json (localPort) so
// the autostart honors the port the bootstrap settled on — including the
// free-port that coexistence picked when something else (e.g. a Hermes
// gateway) already holds 8644. Falls back to 8644 when no bootstrap state.
//
// Mirrors the structure of scripts/install-keep-alive.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WORKER_AUTOSTART_LABEL = "ai.jobbored.discovery.worker";
export const DEFAULT_WORKER_PORT = "8644";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, "..");

export function getWorkerAutostartPaths({
  homeDir = homedir(),
  repoRoot = defaultRepoRoot,
} = {}) {
  const jobboredDir = join(homeDir, ".jobbored");
  return {
    repoRoot,
    scriptPath: join(repoRoot, "scripts", "start-discovery-worker-local.mjs"),
    bootstrapStatePath: join(repoRoot, "discovery-local-bootstrap.json"),
    logPath: join(jobboredDir, "logs", "discovery-worker.log"),
    launchAgentDir: join(homeDir, "Library", "LaunchAgents"),
    launchAgentPath: join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${WORKER_AUTOSTART_LABEL}.plist`,
    ),
    systemdUserDir: join(homeDir, ".config", "systemd", "user"),
    systemdServicePath: join(
      homeDir,
      ".config",
      "systemd",
      "user",
      `${WORKER_AUTOSTART_LABEL}.service`,
    ),
  };
}

/**
 * Resolve the port the worker should bind. Reads localPort from the bootstrap
 * state so the autostart matches the port the bootstrap settled on (8644, or
 * the free port coexistence picked). Returns DEFAULT_WORKER_PORT otherwise.
 */
export function resolveConfiguredWorkerPort(bootstrapStatePath) {
  if (!bootstrapStatePath || !existsSync(bootstrapStatePath)) {
    return DEFAULT_WORKER_PORT;
  }
  try {
    const state = JSON.parse(readFileSync(bootstrapStatePath, "utf8"));
    const port = Number.parseInt(String(state && state.localPort), 10);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      return String(port);
    }
  } catch (_) {
    // fall through to default
  }
  return DEFAULT_WORKER_PORT;
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
  repoRoot,
  port = DEFAULT_WORKER_PORT,
}) {
  const pathEnv =
    process.env.PATH ||
    "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(WORKER_AUTOSTART_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
    <key>BROWSER_USE_DISCOVERY_HOST</key>
    <string>127.0.0.1</string>
    <key>BROWSER_USE_DISCOVERY_PORT</key>
    <string>${xmlEscape(port)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdService({
  nodePath = process.execPath,
  scriptPath,
  logPath,
  repoRoot,
  port = DEFAULT_WORKER_PORT,
}) {
  return `[Unit]
Description=JobBored browser-use discovery worker (autostart)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(repoRoot)}
Environment=BROWSER_USE_DISCOVERY_HOST=127.0.0.1
Environment=BROWSER_USE_DISCOVERY_PORT=${systemdQuote(port)}
ExecStart=${systemdQuote(nodePath)} ${systemdQuote(scriptPath)}
Restart=on-failure
RestartSec=3
StandardOutput=append:${systemdQuote(logPath)}
StandardError=append:${systemdQuote(logPath)}

[Install]
WantedBy=default.target
`;
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
      message: result.error
        ? result.error.message || String(result.error)
        : String(result.stderr || result.stdout || "").trim(),
    };
  }
  return { ok: true };
}

function ensureWritableDirs(paths) {
  mkdirSync(dirname(paths.logPath), { recursive: true });
}

function installDarwin(options) {
  const paths = getWorkerAutostartPaths(options);
  ensureWritableDirs(paths);
  mkdirSync(paths.launchAgentDir, { recursive: true });
  const port = resolveConfiguredWorkerPort(paths.bootstrapStatePath);
  writeFileSync(
    paths.launchAgentPath,
    renderLaunchdPlist({
      nodePath: options.nodePath,
      scriptPath: paths.scriptPath,
      logPath: paths.logPath,
      repoRoot: paths.repoRoot,
      port,
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  run("launchctl", ["unload", paths.launchAgentPath], options);
  const load = runRequired(
    "launchctl",
    ["load", "-w", paths.launchAgentPath],
    options,
  );
  if (!load.ok) return load;
  const start = runRequired(
    "launchctl",
    ["start", WORKER_AUTOSTART_LABEL],
    options,
  );
  if (!start.ok) return start;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: WORKER_AUTOSTART_LABEL,
    logPath: paths.logPath,
    port,
  };
}

function installLinux(options) {
  const paths = getWorkerAutostartPaths(options);
  ensureWritableDirs(paths);
  mkdirSync(paths.systemdUserDir, { recursive: true });
  const port = resolveConfiguredWorkerPort(paths.bootstrapStatePath);
  writeFileSync(
    paths.systemdServicePath,
    renderSystemdService({
      nodePath: options.nodePath,
      scriptPath: paths.scriptPath,
      logPath: paths.logPath,
      repoRoot: paths.repoRoot,
      port,
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  const reload = runRequired("systemctl", ["--user", "daemon-reload"], options);
  if (!reload.ok) return reload;
  const enable = runRequired(
    "systemctl",
    ["--user", "enable", "--now", `${WORKER_AUTOSTART_LABEL}.service`],
    options,
  );
  if (!enable.ok) return enable;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: WORKER_AUTOSTART_LABEL,
    logPath: paths.logPath,
    port,
  };
}

export function installDiscoveryWorkerAutostart(options = {}) {
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
        "Worker autostart is not supported on Windows yet. Start the worker manually with `npm run discovery:worker:start-local`, or use a Task Scheduler entry.",
    };
  }
  return { ok: false, reason: "unsupported_platform" };
}

export function getDiscoveryWorkerAutostartStatus(options = {}) {
  const platform = options.platform || osPlatform();
  const paths = getWorkerAutostartPaths(options);
  const installed =
    platform === "darwin"
      ? existsSync(paths.launchAgentPath)
      : platform === "linux"
        ? existsSync(paths.systemdServicePath)
        : false;
  const status = { installed };
  if (installed) {
    status.jobLabel = WORKER_AUTOSTART_LABEL;
    status.port = resolveConfiguredWorkerPort(paths.bootstrapStatePath);
  }
  return status;
}

function main() {
  const result = installDiscoveryWorkerAutostart();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
