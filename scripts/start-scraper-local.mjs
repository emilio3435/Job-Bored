#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

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
  return runtimeEnv;
}

function main() {
  const runtimeEnv = resolveRuntimeEnv();
  const child = spawn("npm", ["run", "start", "--prefix", "server"], {
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

main();
