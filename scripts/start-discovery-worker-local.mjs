#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const repoRoot = process.cwd();
const envFilePaths = [
  join(repoRoot, "integrations", "browser-use-discovery", ".env"),
  join(repoRoot, "server", ".env"),
];
const bootstrapStatePath = join(repoRoot, "discovery-local-bootstrap.json");

function parseEnvFile(text) {
  const out = {};
  if (typeof text !== "string" || !text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readEnvFiles() {
  const merged = {};
  for (const path of envFilePaths) {
    if (!existsSync(path)) continue;
    try {
      Object.assign(merged, parseEnvFile(readFileSync(path, "utf8")));
    } catch (err) {
      console.warn(
        `[start:discovery-worker] could not read ${path}: ${
          err && err.message ? err.message : String(err)
        }`,
      );
    }
  }
  return merged;
}

function resolveRuntimeEnv() {
  const fromFiles = readEnvFiles();
  const env = { ...fromFiles, ...process.env };
  const fallbackGemini =
    String(env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY || "").trim() ||
    String(env.ATS_GEMINI_API_KEY || "").trim() ||
    String(env.GEMINI_API_KEY || "").trim();
  return {
    ...env,
    BROWSER_USE_DISCOVERY_RUN_MODE:
      String(env.BROWSER_USE_DISCOVERY_RUN_MODE || "").trim() || "local",
    BROWSER_USE_DISCOVERY_HOST:
      String(env.BROWSER_USE_DISCOVERY_HOST || "").trim() || "127.0.0.1",
    BROWSER_USE_DISCOVERY_PORT:
      String(env.BROWSER_USE_DISCOVERY_PORT || "").trim() || "8644",
    BROWSER_USE_DISCOVERY_CONFIG_PATH:
      String(env.BROWSER_USE_DISCOVERY_CONFIG_PATH || "").trim() ||
      join(
        repoRoot,
        "integrations",
        "browser-use-discovery",
        "state",
        "worker-config.json",
      ),
    BROWSER_USE_DISCOVERY_STATE_DB_PATH:
      String(env.BROWSER_USE_DISCOVERY_STATE_DB_PATH || "").trim() ||
      join(
        repoRoot,
        "integrations",
        "browser-use-discovery",
        "state",
        "worker-state.sqlite",
      ),
    BROWSER_USE_DISCOVERY_BROWSER_COMMAND:
      String(env.BROWSER_USE_DISCOVERY_BROWSER_COMMAND || "").trim() ||
      join(
        repoRoot,
        "integrations",
        "browser-use-discovery",
        "bin",
        "browser-use-agent-browser.mjs",
      ),
    BROWSER_USE_DISCOVERY_GEMINI_API_KEY: fallbackGemini,
  };
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
  const payload = {
    ...existing,
    schemaVersion: 1,
    bootstrapVersion: 2,
    generatedAt: nowIso,
    repoRoot,
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

function holdProcessOpenForExistingWorker(host, port) {
  console.info(
    `[start:discovery-worker] browser-use discovery worker already running at http://${host}:${port}; reusing existing process.`,
  );
  const noopInterval = setInterval(() => {}, 60_000);
  const shutdown = () => {
    clearInterval(noopInterval);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
  } catch {
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
    if (existingHealthy) {
      const reuseExisting =
        String(runtimeEnv.BROWSER_USE_DISCOVERY_REUSE_EXISTING || "")
          .trim()
          .toLowerCase() === "true";
      if (reuseExisting) {
        holdProcessOpenForExistingWorker(host, port);
        return;
      }
      console.info(
        `[start:discovery-worker] browser-use discovery worker already running at http://${host}:${port}; restarting to load latest code.`,
      );
      const terminated = await terminateWorkerListenersOnPort(port);
      if (!terminated.terminated) {
        console.warn(
          `[start:discovery-worker] could not terminate listener(s) on port ${port}; keeping existing worker.`,
        );
        holdProcessOpenForExistingWorker(host, port);
        return;
      }
      await sleep(150);
    }
  }

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

  const forwardSignal = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // best effort
      }
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(
    `[start:discovery-worker] failed: ${
      err && err.message ? err.message : String(err)
    }`,
  );
  process.exit(1);
});
