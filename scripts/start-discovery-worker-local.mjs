#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  decideAfterChildExit,
  decideExistingWorkerAction,
  decideHeldWorkerAction,
  parseStarterOptions,
} from "./lib/discovery-worker-policy.mjs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { resolveJobBoredPaths } from "./lib/paths.mjs";
import { mergeEnvFileValues, parseEnvFileText } from "./lib/env-file-merge.mjs";
import { applyDiscoveryWorkerLlmAliases } from "./lib/llm-env.mjs";

const repoRoot = process.cwd();
const initialPaths = resolveJobBoredPaths({ env: process.env, repoRoot });
const envFilePaths = [
  join(repoRoot, "integrations", "browser-use-discovery", ".env"),
  join(repoRoot, "server", ".env"),
  initialPaths.workerEnv,
].filter((path, index, all) => path && all.indexOf(path) === index);
const bootstrapStatePath = join(repoRoot, "discovery-local-bootstrap.json");
const browserCommandEnvKeys = [
  "BROWSER_USE_DISCOVERY_BROWSER_COMMAND",
  "BROWSER_USE_COMMAND",
  "DISCOVERY_BROWSER_COMMAND",
];
const bundledBrowserUseCommandPath = join(
  repoRoot,
  "integrations",
  "browser-use-discovery",
  "bin",
  "browser-use-agent-browser.mjs",
);


function readEnvFiles() {
  // Later files override earlier ones, but a present-but-EMPTY value never
  // erases a configured one — see scripts/lib/env-file-merge.mjs.
  const layers = [];
  for (const path of envFilePaths) {
    if (!existsSync(path)) continue;
    try {
      layers.push(parseEnvFileText(readFileSync(path, "utf8")));
    } catch (err) {
      console.warn(
        `[start:discovery-worker] could not read ${path}: ${
          err && err.message ? err.message : String(err)
        }`,
      );
    }
  }
  return mergeEnvFileValues(layers);
}

function readFirstEnvValue(source, keys) {
  for (const key of keys) {
    const value = String(source[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function isPathLikeCommand(command) {
  return (
    String(command || "").includes("/") || String(command || "").includes("\\")
  );
}

function commandPathExists(command) {
  if (!isPathLikeCommand(command)) return true;
  return existsSync(resolve(repoRoot, command));
}

function resolveBrowserUseCommand(fromFiles) {
  const processCommand = readFirstEnvValue(process.env, browserCommandEnvKeys);
  if (processCommand) return processCommand;

  const fileCommand = readFirstEnvValue(fromFiles, browserCommandEnvKeys);
  if (fileCommand && commandPathExists(fileCommand)) return fileCommand;

  if (fileCommand) {
    console.warn(
      `[start:discovery-worker] ignoring stale browser command from env file because it does not exist: ${fileCommand}`,
    );
  }
  return bundledBrowserUseCommandPath;
}

function resolveRuntimeEnv() {
  const fromFiles = readEnvFiles();
  const env = { ...fromFiles, ...process.env };
  const paths = resolveJobBoredPaths({ env, repoRoot });
  const fallbackGemini =
    String(env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY || "").trim() ||
    String(env.ATS_GEMINI_API_KEY || "").trim() ||
    String(env.GEMINI_API_KEY || "").trim();
  const runtimeEnv = {
    ...env,
    BROWSER_USE_DISCOVERY_RUN_MODE:
      String(env.BROWSER_USE_DISCOVERY_RUN_MODE || "").trim() || "local",
    BROWSER_USE_DISCOVERY_HOST:
      String(env.BROWSER_USE_DISCOVERY_HOST || "").trim() || "127.0.0.1",
    BROWSER_USE_DISCOVERY_PORT:
      String(env.BROWSER_USE_DISCOVERY_PORT || "").trim() || "8644",
    BROWSER_USE_DISCOVERY_CONFIG_PATH:
      String(env.BROWSER_USE_DISCOVERY_CONFIG_PATH || "").trim() ||
      String(env.BROWSER_USE_DISCOVERY_WORKER_CONFIG || "").trim() ||
      paths.workerConfig,
    BROWSER_USE_DISCOVERY_WORKER_CONFIG:
      String(env.BROWSER_USE_DISCOVERY_WORKER_CONFIG || "").trim() ||
      String(env.BROWSER_USE_DISCOVERY_CONFIG_PATH || "").trim() ||
      paths.workerConfig,
    BROWSER_USE_DISCOVERY_ENV_FILE:
      String(env.BROWSER_USE_DISCOVERY_ENV_FILE || "").trim() ||
      String(env.BROWSER_USE_DISCOVERY_WORKER_ENV || "").trim() ||
      paths.workerEnv,
    BROWSER_USE_DISCOVERY_WORKER_ENV:
      String(env.BROWSER_USE_DISCOVERY_WORKER_ENV || "").trim() ||
      String(env.BROWSER_USE_DISCOVERY_ENV_FILE || "").trim() ||
      paths.workerEnv,
    BROWSER_USE_DISCOVERY_STATE_DB_PATH:
      String(env.BROWSER_USE_DISCOVERY_STATE_DB_PATH || "").trim() ||
      paths.workerStateDb,
    BROWSER_USE_DISCOVERY_BROWSER_COMMAND: resolveBrowserUseCommand(fromFiles),
    BROWSER_USE_DISCOVERY_GEMINI_API_KEY: fallbackGemini,
  };
  return applyDiscoveryWorkerLlmAliases(runtimeEnv);
}

function createTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  return null;
}

function readBootstrapStateFile() {
  if (!existsSync(bootstrapStatePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(bootstrapStatePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolveWebhookSecret(runtimeEnv) {
  return String(
    runtimeEnv.BROWSER_USE_DISCOVERY_WEBHOOK_SECRET ||
      runtimeEnv.DISCOVERY_WEBHOOK_SECRET ||
      runtimeEnv.WEBHOOK_SECRET ||
      "",
  ).trim();
}

function writeLocalBootstrapState(runtimeEnv, host, port) {
  const existing = readBootstrapStateFile();
  const secret = resolveWebhookSecret(runtimeEnv);
  const existingSecret =
    typeof existing.webhookSecret === "string" ? existing.webhookSecret.trim() : "";
  const resolvedSecret = secret || existingSecret;
  const localWebhookUrl = `http://${host}:${port}/webhook`;
  const localHealthUrl = `http://${host}:${port}/health`;
  const nowIso = new Date().toISOString();
  const diagnostics =
    existing && existing.diagnostics && typeof existing.diagnostics === "object"
      ? { ...existing.diagnostics }
      : {};
  // Sync the recorded PID to the LIVE listener owner on every boot: a PID left
  // behind by a previous boot is stale the moment another process owns the
  // port, and acting on it (or on no PID at all) is the stale-PID/EADDRINUSE
  // confusion this ends. null means "nothing listens (yet)" — honest, not stale.
  const pidRecord = resolveWorkerPidRecord({
    liveOwnerPid: resolveLiveListenerOwnerPid(port),
    existingPid: existing.workerPid,
  });
  const payload = {
    ...existing,
    schemaVersion: 1,
    bootstrapVersion: 2,
    generatedAt: nowIso,
    repoRoot,
    workerPid: pidRecord.workerPid,
    routeName:
      typeof existing.routeName === "string" && existing.routeName.trim()
        ? existing.routeName.trim()
        : "browser-use-discovery",
    localWebhookUrl,
    localHealthUrl,
    localPort: port,
    webhookSecret: resolvedSecret,
    webhookSecretSource:
      resolvedSecret
        ? secret
          ? "env"
          : typeof existing.webhookSecretSource === "string"
            ? existing.webhookSecretSource.trim()
            : "bootstrap"
        : "",
    diagnostics: {
      ...diagnostics,
      engineKind: "browser_use_worker",
      engineLabel: "Browser-use worker",
      localService: "browser-use-discovery-worker",
      localMode:
        String(runtimeEnv.BROWSER_USE_DISCOVERY_RUN_MODE || "").trim() ||
        "local",
      localPlatform: process.platform,
    },
  };
  try {
    writeFileSync(bootstrapStatePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      `[start:discovery-worker] could not write discovery-local-bootstrap.json: ${
        err && err.message ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Re-sync the recorded workerPid after (re)spawning the supervised child: the
 * boot-time sync above captured whoever owned the port BEFORE this spawn (on a
 * restart boot, the worker we just terminated), so without this the file would
 * point at a PID we killed. Only called with a live child PID.
 */
function updateBootstrapWorkerPid(pid) {
  const existing = readBootstrapStateFile();
  const record = resolveWorkerPidRecord({
    liveOwnerPid: pid,
    existingPid: existing.workerPid,
  });
  if (!record.changed) return record.workerPid;
  try {
    writeFileSync(
      bootstrapStatePath,
      `${JSON.stringify({ ...existing, workerPid: record.workerPid }, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    console.warn(
      `[start:discovery-worker] could not sync workerPid in discovery-local-bootstrap.json: ${
        err && err.message ? err.message : String(err)
      }`,
    );
  }
  return record.workerPid;
}

async function probeExistingWorker(host, port) {
  const signal = createTimeoutSignal(1000);
  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      method: "GET",
      signal: signal || undefined,
    });
    if (!res.ok) return false;
    const payload = await res.json().catch(() => null);
    return (
      !!payload &&
      String(payload.status || "").toLowerCase() === "ok" &&
      String(payload.service || "").toLowerCase() === "browser-use-discovery-worker"
    );
  } catch {
    return false;
  }
}

const DEFAULT_HOLD_PROBE_MS = 5_000;

/**
 * Keep this concurrently child alive while someone else owns :8644, but
 * re-probe health. A dead held worker must not leave a zombie noop holder
 * (2026-09-16: starter PID alive for hours, no child, connection refused).
 *
 * @param {string} host
 * @param {number} port
 * @param {{ onWorkerGone?: () => void, probeIntervalMs?: number }} [options]
 */
function holdProcessOpenForExistingWorker(host, port, options = {}) {
  console.info(
    `[start:discovery-worker] browser-use discovery worker already running at http://${host}:${port}; reusing existing process (will respawn if it dies).`,
  );
  const probeIntervalMs = Number(options.probeIntervalMs);
  const intervalMs =
    Number.isFinite(probeIntervalMs) && probeIntervalMs > 0
      ? probeIntervalMs
      : DEFAULT_HOLD_PROBE_MS;
  let shuttingDown = false;
  let finished = false;
  let inFlight = false;

  const finish = (next) => {
    if (finished) return;
    finished = true;
    clearInterval(interval);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (typeof next === "function") next();
  };

  const onSignal = () => {
    shuttingDown = true;
    finish(() => process.exit(0));
  };

  const tick = async () => {
    if (finished || inFlight) return;
    inFlight = true;
    try {
      const healthy = await probeExistingWorker(host, port);
      const action = decideHeldWorkerAction({
        heldWorkerHealthy: healthy,
        shuttingDown,
      });
      if (action === "exit") {
        finish(() => process.exit(0));
        return;
      }
      if (action === "respawn") {
        console.warn(
          `[start:discovery-worker] reused worker at http://${host}:${port} is no longer healthy; respawning.`,
        );
        finish(() => {
          if (typeof options.onWorkerGone === "function") {
            options.onWorkerGone();
            return;
          }
          process.exit(1);
        });
      }
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listListeningPids(port) {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return String(output || "")
      .split(/\r?\n/)
      .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch (err) {
    // Be honest when the tool itself is missing (Windows, minimal Linux):
    // returning [] makes the restart path "succeed" and then die with
    // EADDRINUSE. Return null so the caller reuses the existing worker. lsof
    // exiting non-zero with no listeners still lands in the [] fallthrough.
    if (err && err.code === "ENOENT") {
      console.warn(
        `[start:discovery-worker] port inspection unavailable (lsof not found on this system); cannot detect stale listeners on port ${port}.`,
      );
      return null;
    }
    return [];
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the PID that currently owns the worker port listener: the first
 * live listener PID, 0 when nothing listens, or null when the port cannot be
 * inspected at all (lsof missing) so the caller keeps the recorded value
 * instead of claiming knowledge it doesn't have.
 */
function resolveLiveListenerOwnerPid(port, { listPids = listListeningPids } = {}) {
  const pids = listPids(port);
  if (pids === null || pids === undefined) return null;
  return pids.length ? pids[0] : 0;
}

/**
 * PURE: decide which workerPid to record in discovery-local-bootstrap.json.
 * The recorded PID always tracks the LIVE listener owner: a dead recorded PID
 * is replaced (or cleared to null when nothing listens), and an uninspectable
 * port keeps the existing value because staleness can't be proven.
 * Returns { workerPid, changed }.
 */
function resolveWorkerPidRecord({ liveOwnerPid, existingPid }) {
  const previous =
    typeof existingPid === "number" &&
    Number.isInteger(existingPid) &&
    existingPid > 0
      ? existingPid
      : null;
  if (liveOwnerPid === null || liveOwnerPid === undefined) {
    return { workerPid: previous, changed: false };
  }
  const next =
    typeof liveOwnerPid === "number" &&
    Number.isInteger(liveOwnerPid) &&
    liveOwnerPid > 0
      ? liveOwnerPid
      : null;
  return { workerPid: next, changed: next !== previous };
}

async function waitForPidExit(pid, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function terminateWorkerListenersOnPort(port) {
  const pids = listListeningPids(port);
  if (pids === null) {
    // Couldn't inspect the port (lsof missing) — report not-terminated so the
    // caller keeps the existing worker instead of racing EADDRINUSE.
    return { attempted: false, terminated: false, pids: [], survivors: [] };
  }
  if (!pids.length) {
    return { attempted: false, terminated: true, pids: [] };
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // best effort
    }
  }

  const stillAliveAfterTerm = [];
  for (const pid of pids) {
    const exited = await waitForPidExit(pid, 2500);
    if (!exited) stillAliveAfterTerm.push(pid);
  }

  for (const pid of stillAliveAfterTerm) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // best effort
    }
  }

  const survivors = stillAliveAfterTerm.filter((pid) => isProcessAlive(pid));
  return {
    attempted: true,
    terminated: survivors.length === 0,
    pids,
    survivors,
  };
}

async function main() {
  const runtimeEnv = resolveRuntimeEnv();
  const host = String(runtimeEnv.BROWSER_USE_DISCOVERY_HOST || "127.0.0.1");
  const port = Number.parseInt(
    String(runtimeEnv.BROWSER_USE_DISCOVERY_PORT || "8644"),
    10,
  );
  if (Number.isFinite(port) && port > 0) {
    writeLocalBootstrapState(runtimeEnv, host, port);
  }

  if (Number.isFinite(port) && port > 0) {
    const existingHealthy = await probeExistingWorker(host, port);
    const { restartExisting } = parseStarterOptions(process.argv.slice(2), runtimeEnv);
    const action = decideExistingWorkerAction({ existingHealthy, restartExisting });
    if (action === "reuse") {
      holdProcessOpenForExistingWorker(host, port, {
        onWorkerGone: () => superviseWorker(runtimeEnv, host, port),
      });
      return;
    }
    if (action === "restart") {
      console.info(
        `[start:discovery-worker] browser-use discovery worker already running at http://${host}:${port}; restarting to load latest code.`,
      );
      const terminated = await terminateWorkerListenersOnPort(port);
      if (!terminated.terminated) {
        console.warn(
          `[start:discovery-worker] could not terminate listener(s) on port ${port}; keeping existing worker.`,
        );
        holdProcessOpenForExistingWorker(host, port, {
          onWorkerGone: () => superviseWorker(runtimeEnv, host, port),
        });
        return;
      }
      await sleep(150);
    }
  }

  superviseWorker(runtimeEnv, host, port);
}

/** Poll /health until a worker answers or the deadline passes. */
async function waitForHealthyWorker(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeExistingWorker(host, port)) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Run the worker as a supervised child. When something ELSE terminates it
 * (the dashboard's full-boot after an env-key write, a keep-alive, an
 * autostart), this process must not exit — under `npm run dev` it is a
 * `concurrently -k` child and its exit tears web + scraper down (2026-09-02).
 * Policy: scripts/lib/discovery-worker-policy.mjs decideAfterChildExit.
 */
function superviseWorker(runtimeEnv, host, port) {
  const MAX_RESPAWNS = 3;
  let current = null;
  let shuttingDown = false;
  let respawns = 0;

  const forwardSignal = (signal) => {
    shuttingDown = true;
    if (current && !current.killed) {
      try {
        current.kill(signal);
      } catch {
        // best effort
      }
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  const spawnOnce = () => {
    const child = spawn(
      "node",
      [
        "--experimental-strip-types",
        "integrations/browser-use-discovery/src/server.ts",
      ],
      {
        cwd: repoRoot,
        env: runtimeEnv,
        stdio: "inherit",
      },
    );
    current = child;
    if (child.pid) updateBootstrapWorkerPid(child.pid);
    child.on("exit", async (code, signal) => {
      console.warn(
        `[start:discovery-worker] worker exited (code=${code === null ? "null" : code}, signal=${signal || "none"})${shuttingDown ? "" : " — something else terminated the listener on port " + port + "."}`,
      );
      const replacementHealthy = shuttingDown || !signal
        ? false
        : await waitForHealthyWorker(host, port, 8000);
      const action = decideAfterChildExit({
        signal,
        code,
        initiatedByUs: shuttingDown,
        replacementHealthy,
      });
      const resumeSupervising = () => {
        if (shuttingDown) return;
        // The held replacement was healthy when we started watching; its later
        // death is a new event, not another immediate SIGTERM storm.
        respawns = 0;
        spawnOnce();
      };
      if (action === "hold") {
        console.info(
          `[start:discovery-worker] a replacement worker is healthy on port ${port}; keeping the dev stack up on its behalf.`,
        );
        holdProcessOpenForExistingWorker(host, port, {
          onWorkerGone: resumeSupervising,
        });
        return;
      }
      if (action === "respawn") {
        if (respawns >= MAX_RESPAWNS) {
          console.error(
            `[start:discovery-worker] worker was terminated ${respawns} times with no replacement; giving up.`,
          );
          process.exit(1);
          return;
        }
        respawns += 1;
        console.info(
          `[start:discovery-worker] no replacement worker appeared; respawning (${respawns}/${MAX_RESPAWNS}).`,
        );
        await sleep(1000);
        if (await probeExistingWorker(host, port)) {
          holdProcessOpenForExistingWorker(host, port, {
            onWorkerGone: resumeSupervising,
          });
          return;
        }
        spawnOnce();
        return;
      }
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code || 0);
    });
  };
  spawnOnce();
}

// Only run the starter entry point when this file is invoked directly
// (`node scripts/start-discovery-worker-local.mjs`). When imported from a
// test, the helpers below should be testable without the side effects of
// main() — mirrors scripts/bootstrap-local-discovery.mjs.
const __invokedAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (__invokedAsCli) {
  main().catch((err) => {
    console.error(
      `[start:discovery-worker] failed: ${
        err && err.message ? err.message : String(err)
      }`,
    );
    process.exit(1);
  });
}

// Test-only exports. Keep the surface narrow — these are not a stable public
// API; they exist so tests can exercise the PID-sync path without running the
// starter pipeline.
export { resolveLiveListenerOwnerPid, resolveWorkerPidRecord };
