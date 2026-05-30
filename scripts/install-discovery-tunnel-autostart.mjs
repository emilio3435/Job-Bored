#!/usr/bin/env node
// Purpose: Install a per-user background service that keeps the JobBored
// Cloudflare tunnel running — started at login/boot and restarted on crash — so
// the local discovery worker stays publicly reachable without a terminal open.
// macOS = launchd plist (RunAtLoad + KeepAlive). Linux = systemd-user .service
// (Type=simple, Restart=on-failure). Windows = unsupported.
//
// Job label: ai.jobbored.discovery.tunnel
// Log path:  ~/.jobbored/logs/discovery-tunnel.log
//
// The service command is derived from the transport bootstrap settled on,
// persisted in discovery-local-bootstrap.json:
//   - cloudflare_quick -> `cloudflared tunnel --url http://127.0.0.1:<localPort>`
//   - cloudflare_named -> `cloudflared tunnel run <transport.tunnelName>`
// ngrok (or no Cloudflare transport) has nothing to autostart here.
//
// Mirrors the structure of scripts/install-discovery-worker-autostart.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildNamedTunnelCommand,
  buildQuickTunnelCommand,
  TRANSPORT_CLOUDFLARE_NAMED,
  TRANSPORT_CLOUDFLARE_QUICK,
} from "./lib/discovery-transport.mjs";
import { resolveConfiguredWorkerPort } from "./install-discovery-worker-autostart.mjs";

export const TUNNEL_AUTOSTART_LABEL = "ai.jobbored.discovery.tunnel";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, "..");

export function getTunnelAutostartPaths({
  homeDir = homedir(),
  repoRoot = defaultRepoRoot,
} = {}) {
  const jobboredDir = join(homeDir, ".jobbored");
  return {
    repoRoot,
    bootstrapStatePath: join(repoRoot, "discovery-local-bootstrap.json"),
    logPath: join(jobboredDir, "logs", "discovery-tunnel.log"),
    launchAgentDir: join(homeDir, "Library", "LaunchAgents"),
    launchAgentPath: join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${TUNNEL_AUTOSTART_LABEL}.plist`,
    ),
    systemdUserDir: join(homeDir, ".config", "systemd", "user"),
    systemdServicePath: join(
      homeDir,
      ".config",
      "systemd",
      "user",
      `${TUNNEL_AUTOSTART_LABEL}.service`,
    ),
  };
}

/**
 * Resolve the `cloudflared` command line for the transport bootstrap settled on.
 * Reads transport.kind from the bootstrap state and rebuilds the same argv the
 * bootstrap used. Returns { ok:false, reason } for ngrok / missing / unreadable
 * state so callers can surface an actionable message instead of installing a
 * broken service.
 */
export function resolveTunnelService(bootstrapStatePath) {
  if (!bootstrapStatePath || !existsSync(bootstrapStatePath)) {
    return { ok: false, reason: "bootstrap_state_missing" };
  }
  let state;
  try {
    state = JSON.parse(readFileSync(bootstrapStatePath, "utf8"));
  } catch (_) {
    return { ok: false, reason: "bootstrap_state_unreadable" };
  }
  const transport =
    state && state.transport && typeof state.transport === "object"
      ? state.transport
      : {};
  const kind = String(transport.kind || "").trim();
  if (kind === TRANSPORT_CLOUDFLARE_QUICK) {
    const port = resolveConfiguredWorkerPort(bootstrapStatePath);
    const { command, args } = buildQuickTunnelCommand(port);
    return { ok: true, kind, command, args, port };
  }
  if (kind === TRANSPORT_CLOUDFLARE_NAMED) {
    const tunnelName = String(transport.tunnelName || "").trim();
    if (!tunnelName) {
      return { ok: false, reason: "named_tunnel_name_missing", kind };
    }
    const { command, args } = buildNamedTunnelCommand(tunnelName);
    return { ok: true, kind, command, args, tunnelName };
  }
  return { ok: false, reason: "not_a_cloudflare_transport", kind };
}

/**
 * Resolve the absolute path to the `cloudflared` binary. launchd (and, for
 * robustness, systemd) want an absolute ExecStart, but buildQuickTunnelCommand
 * yields the bare `cloudflared`. Falls back to the bare name when resolution
 * fails so the service is still installable on a PATH that has it.
 */
export function resolveCloudflaredPath({
  cloudflaredPath = "",
  spawnSyncImpl = spawnSync,
  platform = osPlatform(),
} = {}) {
  if (cloudflaredPath) return cloudflaredPath;
  const finder = platform === "win32" ? "where" : "which";
  const result = spawnSyncImpl(finder, ["cloudflared"], { encoding: "utf8" });
  if (result && !result.error && result.status === 0) {
    const resolved = String(result.stdout || "")
      .trim()
      .split(/\r?\n/)[0]
      .trim();
    if (resolved) return resolved;
  }
  return "cloudflared";
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

export function renderLaunchdPlist({ programArguments, logPath, repoRoot }) {
  const pathEnv =
    process.env.PATH ||
    "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const argsXml = programArguments
    .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(TUNNEL_AUTOSTART_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
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

export function renderSystemdService({ programArguments, logPath, repoRoot }) {
  const execStart = programArguments.map(systemdQuote).join(" ");
  return `[Unit]
Description=JobBored Cloudflare tunnel (autostart)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(repoRoot)}
ExecStart=${execStart}
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

const TRANSPORT_REASON_ACTIONABLE = {
  bootstrap_state_missing:
    "No discovery-local-bootstrap.json found. Run `npm run discovery:bootstrap-local` first so the tunnel transport is recorded.",
  bootstrap_state_unreadable:
    "discovery-local-bootstrap.json could not be parsed. Re-run `npm run discovery:bootstrap-local`.",
  named_tunnel_name_missing:
    "The named Cloudflare tunnel has no tunnel name recorded. Set BROWSER_USE_DISCOVERY_TUNNEL_NAME and re-run `npm run discovery:bootstrap-local -- --tunnel cloudflare-named`.",
  not_a_cloudflare_transport:
    "The active transport is not a Cloudflare tunnel, so there is nothing to autostart. Re-run bootstrap with `--tunnel cloudflare-quick` or `--tunnel cloudflare-named`, or keep ngrok and skip the tunnel autostart.",
};

function tunnelServiceFailure(service) {
  return {
    ok: false,
    reason: service.reason,
    ...(service.kind ? { kind: service.kind } : {}),
    actionable:
      TRANSPORT_REASON_ACTIONABLE[service.reason] ||
      "Could not resolve a Cloudflare tunnel command from the bootstrap state.",
  };
}

function buildProgramArguments(service, options) {
  const cloudflaredPath = resolveCloudflaredPath({
    cloudflaredPath: options.cloudflaredPath,
    spawnSyncImpl: options.spawnSyncImpl,
    platform: options.platform,
  });
  return [cloudflaredPath, ...service.args];
}

function installDarwin(options) {
  const paths = getTunnelAutostartPaths(options);
  const service = resolveTunnelService(paths.bootstrapStatePath);
  if (!service.ok) return tunnelServiceFailure(service);

  ensureWritableDirs(paths);
  mkdirSync(paths.launchAgentDir, { recursive: true });
  writeFileSync(
    paths.launchAgentPath,
    renderLaunchdPlist({
      programArguments: buildProgramArguments(service, options),
      logPath: paths.logPath,
      repoRoot: paths.repoRoot,
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
    ["start", TUNNEL_AUTOSTART_LABEL],
    options,
  );
  if (!start.ok) return start;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: TUNNEL_AUTOSTART_LABEL,
    logPath: paths.logPath,
    kind: service.kind,
    ...(service.port ? { port: service.port } : {}),
    ...(service.tunnelName ? { tunnelName: service.tunnelName } : {}),
  };
}

function installLinux(options) {
  const paths = getTunnelAutostartPaths(options);
  const service = resolveTunnelService(paths.bootstrapStatePath);
  if (!service.ok) return tunnelServiceFailure(service);

  ensureWritableDirs(paths);
  mkdirSync(paths.systemdUserDir, { recursive: true });
  writeFileSync(
    paths.systemdServicePath,
    renderSystemdService({
      programArguments: buildProgramArguments(service, options),
      logPath: paths.logPath,
      repoRoot: paths.repoRoot,
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  const reload = runRequired("systemctl", ["--user", "daemon-reload"], options);
  if (!reload.ok) return reload;
  const enable = runRequired(
    "systemctl",
    ["--user", "enable", "--now", `${TUNNEL_AUTOSTART_LABEL}.service`],
    options,
  );
  if (!enable.ok) return enable;
  return {
    ok: true,
    installedAt: options.nowIso || new Date().toISOString(),
    jobLabel: TUNNEL_AUTOSTART_LABEL,
    logPath: paths.logPath,
    kind: service.kind,
    ...(service.port ? { port: service.port } : {}),
    ...(service.tunnelName ? { tunnelName: service.tunnelName } : {}),
  };
}

export function installDiscoveryTunnelAutostart(options = {}) {
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
        "Tunnel autostart is not supported on Windows yet. Start the tunnel manually with `cloudflared tunnel ...`, or use a Task Scheduler entry.",
    };
  }
  return { ok: false, reason: "unsupported_platform" };
}

export function getDiscoveryTunnelAutostartStatus(options = {}) {
  const platform = options.platform || osPlatform();
  const paths = getTunnelAutostartPaths(options);
  const installed =
    platform === "darwin"
      ? existsSync(paths.launchAgentPath)
      : platform === "linux"
        ? existsSync(paths.systemdServicePath)
        : false;
  const status = { installed };
  if (installed) {
    status.jobLabel = TUNNEL_AUTOSTART_LABEL;
    const service = resolveTunnelService(paths.bootstrapStatePath);
    if (service.ok) {
      status.kind = service.kind;
      if (service.port) status.port = service.port;
      if (service.tunnelName) status.tunnelName = service.tunnelName;
    }
  }
  return status;
}

function main() {
  const result = installDiscoveryTunnelAutostart();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
