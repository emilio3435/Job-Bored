#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { applyAtsProviderAliases } from "./lib/llm-env.mjs";
import { spawnNpm } from "./lib/spawn-npm.mjs";

const repoRoot = process.cwd();
const envFilePaths = [
  join(repoRoot, "server", ".env"),
  join(repoRoot, "integrations", "browser-use-discovery", ".env"),
];

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
        `[start:scraper] could not read ${path}: ${
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
  const fallbackGemini = String(
    env.ATS_GEMINI_API_KEY ||
      env.GEMINI_API_KEY ||
      env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY ||
      env.DISCOVERY_GEMINI_API_KEY ||
      "",
  ).trim();
  const runtimeEnv = { ...env };
  if (!String(runtimeEnv.ATS_GEMINI_API_KEY || "").trim() && fallbackGemini) {
    runtimeEnv.ATS_GEMINI_API_KEY = fallbackGemini;
  }
  if (!String(runtimeEnv.GEMINI_API_KEY || "").trim() && fallbackGemini) {
    runtimeEnv.GEMINI_API_KEY = fallbackGemini;
  }
  return applyAtsProviderAliases(runtimeEnv);
}

function resolveProbeHost(host) {
  const value = String(host || "").trim();
  if (!value || value === "0.0.0.0" || value === "::") return "127.0.0.1";
  return value;
}

async function probeExistingScraper(host, port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const payload = await res.json();
    return (
      payload &&
      payload.ok === true &&
      String(payload.service || "") === "command-center-job-scraper"
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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
    if (err && err.code === "ENOENT") {
      console.warn(
        `[start:scraper] port inspection unavailable (lsof not found on this system); cannot detect stale listeners on port ${port}.`,
      );
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

async function waitForPidExit(pid, timeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function terminateScraperListenersOnPort(port) {
  const pids = listListeningPids(port);
  if (!pids.length) {
    return [];
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

  return stillAliveAfterTerm.filter((pid) => isProcessAlive(pid));
}

async function main() {
  const runtimeEnv = resolveRuntimeEnv();
  const port = Number.parseInt(String(runtimeEnv.PORT || "3847"), 10);
  const host = resolveProbeHost(runtimeEnv.LISTEN_HOST || "127.0.0.1");

  if (Number.isFinite(port) && port > 0) {
    const existingHealthy = await probeExistingScraper(host, port);
    if (existingHealthy) {
      console.info(
        `[start:scraper] job scraper already running at http://${host}:${port}; restarting to load latest code.`,
      );
      const survivors = await terminateScraperListenersOnPort(port);
      if (survivors.length) {
        throw new Error(
          `could not terminate listener(s) on port ${port}: ${survivors.join(
            ", ",
          )}`,
        );
      }
      await sleep(150);
    }
  }

  const child = spawnNpm("npm", ["run", "start", "--prefix", "server"], {
    cwd: repoRoot,
    env: runtimeEnv,
    stdio: "inherit",
  });

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
    `[start:scraper] failed: ${err && err.message ? err.message : String(err)}`,
  );
  process.exit(1);
});
