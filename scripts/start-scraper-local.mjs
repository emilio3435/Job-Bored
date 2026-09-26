#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolveScraperEnv } from "./lib/runtime-env.mjs";
import { spawnNpm } from "./lib/spawn-npm.mjs";

const repoRoot = process.cwd();

/**
 * How to spawn the local API: scripts/lib/runtime-env.mjs, the same resolver
 * the desktop supervisor uses, so the two can't drift (GFX R14). It layers
 * server/.env and the discovery .env under the process env.
 */
function resolveScraperSpawnSpec() {
  const desktop = String(process.env.JOBBORED_DESKTOP || "").trim() === "1";
  return resolveScraperEnv({
    appRoot: repoRoot,
    baseEnv: process.env,
    warn: (message) => console.warn(`[start:scraper] ${message}`),
    ...(desktop ? { home: homedir(), execPath: process.execPath } : {}),
  });
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
    // ENOENT = lsof itself is missing (Windows, minimal Linux): we genuinely
    // could NOT check, which differs from "checked, found none". Return null
    // so the caller reuses the existing instance instead of spawning a second
    // one that dies with EADDRINUSE. Any other error (e.g. lsof exit 1 for no
    // matches) means "checked, none found" -> [].
    if (err && err.code === "ENOENT") {
      console.warn(
        `[start:scraper] port inspection unavailable (lsof not found on this system); cannot detect stale listeners on port ${port}.`,
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
  if (pids === null) {
    // Couldn't inspect the port (lsof missing) — report not-terminated so the
    // caller reuses the existing instance rather than racing EADDRINUSE.
    return { terminated: false, survivors: [] };
  }
  if (!pids.length) {
    return { terminated: true, survivors: [] };
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
  return { terminated: survivors.length === 0, survivors };
}

function holdProcessOpenForExistingScraper(host, port) {
  console.info(
    `[start:scraper] job scraper already running at http://${host}:${port}; reusing existing process.`,
  );
  const noopInterval = setInterval(() => {}, 60_000);
  const shutdown = () => {
    clearInterval(noopInterval);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  const spawnSpec = resolveScraperSpawnSpec();
  const runtimeEnv = spawnSpec.env;
  const port = Number.parseInt(String(runtimeEnv.PORT || "3847"), 10);
  const host = resolveProbeHost(runtimeEnv.LISTEN_HOST || "127.0.0.1");

  if (Number.isFinite(port) && port > 0) {
    const existingHealthy = await probeExistingScraper(host, port);
    if (existingHealthy) {
      console.info(
        `[start:scraper] job scraper already running at http://${host}:${port}; restarting to load latest code.`,
      );
      const result = await terminateScraperListenersOnPort(port);
      if (!result.terminated) {
        // Couldn't stop the existing instance (survivors, or lsof unavailable
        // so we can't even find it). Reuse it instead of starting a second
        // process that would die with EADDRINUSE — mirrors the discovery
        // worker's reuse-on-failure behaviour.
        const detail = result.survivors.length
          ? `survivor pid(s): ${result.survivors.join(", ")}`
          : "port could not be inspected";
        console.warn(
          `[start:scraper] could not stop the existing scraper on port ${port} (${detail}); reusing it.`,
        );
        holdProcessOpenForExistingScraper(host, port);
        return;
      }
      await sleep(150);
    }
  }

  const spawnOptions = { cwd: spawnSpec.cwd, env: runtimeEnv, stdio: "inherit" };
  const child =
    spawnSpec.cmd === "npm"
      ? spawnNpm(spawnSpec.cmd, spawnSpec.args, spawnOptions)
      : spawn(spawnSpec.cmd, spawnSpec.args, spawnOptions);

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
