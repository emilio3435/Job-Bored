#!/usr/bin/env node
// Purpose: cross-platform `npm run restart` — stop only JobBored-owned
// listeners on the service ports, then start `npm run dev`.
//
// BEAUDIT G12: scripts/restart-dev-services.sh is bash+lsof and kills with
// `kill -9` whatever owns 8080/3847/8644 — Hermes included — and cannot run
// on Windows at all. This script identifies each listener's process command
// first (lsof+ps on posix, netstat+PowerShell on Windows) and stops only
// JobBored service commands, reporting every skipped foreign owner. When
// port inspection is unavailable it stops nothing and says so.
//
// Usage: node scripts/restart-dev-services.mjs [--stop-only] [--ports 8080,3847,8644]
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { spawnNpm } from "./lib/spawn-npm.mjs";

const DEFAULT_PORTS = [8080, 3847, 8644];

// Substrings that identify a JobBored dev-stack process command. Same
// vocabulary as the dev-server's worker-command check, extended to the web
// server and the scraper. Matched case-insensitively against the full
// command line (Windows backslash paths included).
const JOBBORED_COMMAND_MARKERS = [
  "dev-server.mjs",
  "start-scraper-local",
  "browser-use-discovery",
  "start-discovery-worker-local",
];

export function isJobBoredServiceCommand(command) {
  const text = String(command || "").toLowerCase();
  if (!text) return false;
  return JOBBORED_COMMAND_MARKERS.some((marker) => text.includes(marker));
}

function normalizePort(value) {
  const port = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

export function resolveServicePorts(env = process.env) {
  if (env.JOBBORED_SERVICE_PORTS) {
    return String(env.JOBBORED_SERVICE_PORTS)
      .split(/[\s,]+/)
      .map(normalizePort)
      .filter((port) => port !== null);
  }
  const ports = [
    normalizePort(env.JOBBORED_WEB_PORT) ?? DEFAULT_PORTS[0],
    normalizePort(env.JOBBORED_SCRAPER_PORT) ?? DEFAULT_PORTS[1],
    normalizePort(env.BROWSER_USE_DISCOVERY_PORT) ?? DEFAULT_PORTS[2],
  ];
  return [...new Set(ports)];
}

/** Parse `lsof -t` output (one pid per line) into pids. PURE. */
export function parseLsofPids(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Parse `netstat -ano -p TCP` output into the pids LISTENING on one port.
 * PURE. Windows lines look like:
 *   TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    4242
 */
export function parseNetstatListeningPids(text, port) {
  const wanted = String(port);
  const pids = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Proto Local Foreign State PID — require all five columns.
    if (parts.length < 5) continue;
    if (parts[0].toUpperCase() !== "TCP") continue;
    if (parts[3].toUpperCase() !== "LISTENING") continue;
    const local = parts[1];
    const localPort = local.slice(local.lastIndexOf(":") + 1).replace(/\]$/, "");
    if (localPort !== wanted) continue;
    const pid = Number.parseInt(parts[4], 10);
    if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) {
      pids.push(pid);
    }
  }
  return pids;
}

/**
 * PURE: split a port's listeners into JobBored-owned (kill) and foreign
 * (skip). An empty command is unidentifiable — and unidentifiable is never
 * killed.
 */
export function decidePortActions(port, listeners) {
  const kill = [];
  const skip = [];
  for (const listener of listeners || []) {
    const entry = {
      port,
      pid: listener && listener.pid,
      command: String((listener && listener.command) || ""),
    };
    if (isJobBoredServiceCommand(entry.command)) {
      kill.push(entry);
    } else {
      skip.push(entry);
    }
  }
  return { kill, skip };
}

function runCapture(spawnSyncImpl, command, args) {
  try {
    const result = spawnSyncImpl(command, args, { encoding: "utf8" });
    if (result && result.error) return { ok: false, error: result.error, result };
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error, result: null };
  }
}

function isMissingBinary(outcome) {
  const code = outcome && outcome.error && outcome.error.code;
  return code === "ENOENT";
}

/**
 * Resolve listener pids for one port. Returns { pids } or
 * { unavailable: true } when the platform has no inspection tool.
 */
export function resolveListenerPids(
  port,
  { platform = process.platform, spawnSyncImpl = spawnSync } = {},
) {
  if (platform === "win32") {
    const outcome = runCapture(spawnSyncImpl, "netstat", ["-ano", "-p", "TCP"]);
    if (!outcome.ok) {
      return isMissingBinary(outcome) ? { unavailable: true } : { pids: [] };
    }
    return { pids: parseNetstatListeningPids(outcome.result.stdout, port) };
  }
  const outcome = runCapture(spawnSyncImpl, "lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  if (!outcome.ok) {
    // lsof exits non-zero with no listeners; only a missing binary is fatal.
    // Tell them apart: ENOENT means the tool is absent, anything else means
    // "nothing listens" (stdout empty either way).
    return isMissingBinary(outcome) ? { unavailable: true } : { pids: [] };
  }
  return { pids: parseLsofPids(outcome.result.stdout) };
}

/**
 * Resolve a pid's full command line ("" when unknown). ps on posix,
 * PowerShell Get-CimInstance on Windows.
 */
export function resolveProcessCommand(
  pid,
  { platform = process.platform, spawnSyncImpl = spawnSync } = {},
) {
  if (platform === "win32") {
    const outcome = runCapture(spawnSyncImpl, "powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}").CommandLine`,
    ]);
    if (!outcome.ok) return "";
    return String(outcome.result.stdout || "").trim();
  }
  const outcome = runCapture(spawnSyncImpl, "ps", ["-p", String(pid), "-o", "command="]);
  if (!outcome.ok) return "";
  return String(outcome.result.stdout || "").trim();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopPid(pid, { killImpl = (target, signal) => process.kill(target, signal) } = {}) {
  try {
    killImpl(pid, "SIGTERM");
  } catch {
    return !isAlive(pid);
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  try {
    killImpl(pid, "SIGKILL");
  } catch {
    return !isAlive(pid);
  }
  const forceDeadline = Date.now() + 2000;
  while (Date.now() < forceDeadline) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
}

function parseArgs(argv) {
  const args = { stopOnly: false, ports: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stop-only") {
      args.stopOnly = true;
    } else if (token === "--ports" && argv[index + 1]) {
      args.ports = argv[index + 1]
        .split(",")
        .map(normalizePort)
        .filter((port) => port !== null);
      index += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }
  return args;
}

async function stopServices(ports, deps = {}) {
  let inspectionUnavailable = false;
  let stopped = 0;
  for (const port of ports) {
    const resolved = resolveListenerPids(port, deps);
    if (resolved.unavailable) {
      inspectionUnavailable = true;
      console.warn(
        `[restart] port ${port}: port inspection unavailable (lsof/netstat not found); stopping nothing on this port.`,
      );
      continue;
    }
    if (!resolved.pids.length) {
      console.log(`[restart] port ${port}: no listener`);
      continue;
    }
    const listeners = resolved.pids
      .filter((pid) => pid !== process.pid)
      .map((pid) => ({ pid, command: resolveProcessCommand(pid, deps) }));
    const { kill, skip } = decidePortActions(port, listeners);
    for (const entry of skip) {
      console.log(
        `[restart] port ${port}: skipped foreign listener pid ${entry.pid}${entry.command ? `: ${entry.command}` : " (command unknown)"}`,
      );
    }
    for (const entry of kill) {
      const gone = await stopPid(entry.pid, deps);
      if (gone) {
        stopped += 1;
        console.log(`[restart] port ${port}: stopped JobBored listener pid ${entry.pid}: ${entry.command}`);
      } else {
        console.warn(`[restart] port ${port}: could not stop pid ${entry.pid}: ${entry.command}`);
      }
    }
  }
  return { stopped, inspectionUnavailable };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/restart-dev-services.mjs [--stop-only] [--ports 8080,3847,8644]\n\nStops only JobBored-owned listeners on the service ports, then starts `npm run dev`.",
    );
    return;
  }
  const ports = args.ports || resolveServicePorts();
  await stopServices(ports);
  if (args.stopOnly) return;
  console.log("\nStarting JobBored services with npm run dev...\n");
  const child = spawnNpm("npm", ["run", "dev"], { stdio: "inherit" });
  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode));
    child.on("error", () => resolve(1));
  });
  process.exit(code === null ? 1 : code);
}

const invokedAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) {
  main().catch((err) => {
    console.error(`[restart] failed: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
}
