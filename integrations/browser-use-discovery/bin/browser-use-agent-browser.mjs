#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_AGENT_BROWSER_PATH = path.join(
  os.homedir(),
  ".factory",
  "tools",
  "agent-browser",
  "bin",
  "agent-browser",
);

const DEFAULT_SOCKET_DIR = path.join(os.tmpdir(), "job-bored-agent-browser");
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main() {
  const request = await readRequest();
  const executable = await resolveAgentBrowserExecutable();
  const socketDir = resolveSocketDir();
  const timeoutMs = normalizeTimeoutMs(request.timeoutMs);
  const waitMs = computeWaitMs(timeoutMs);
  const sessionName = `job-bored-${process.pid}-${randomUUID().slice(0, 8)}`;

  await mkdir(socketDir, { recursive: true });

  const commandEnv = {
    ...process.env,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_DEFAULT_TIMEOUT: String(timeoutMs),
  };

  let openResult = null;
  let htmlResult = null;
  let textResult = null;

  try {
    openResult = await runAgentBrowserCommand(executable, [
      "--json",
      "--session",
      sessionName,
      "open",
      request.url,
    ], commandEnv, {
      timeoutMs,
      operation: "open",
    });

    try {
      await runAgentBrowserCommand(executable, [
        "--json",
        "--session",
        sessionName,
        "wait",
        String(waitMs),
      ], commandEnv, {
        timeoutMs: Math.max(1_000, Math.min(5_000, waitMs + 1_000)),
        operation: "wait",
      });
    } catch {
      // Keep going. We can still attempt to read the rendered DOM.
    }

    try {
      htmlResult = await runAgentBrowserCommand(executable, [
        "--json",
        "--session",
        sessionName,
        "get",
        "html",
        "body",
      ], commandEnv, {
        timeoutMs: Math.max(1_000, Math.min(10_000, timeoutMs)),
        operation: "get html body",
      });
    } catch {
      htmlResult = null;
    }

    const htmlText = readNestedString(htmlResult, ["data", "html"]);
    if (!htmlText) {
      textResult = await runAgentBrowserCommand(executable, [
        "--json",
        "--session",
        sessionName,
        "get",
        "text",
        "body",
      ], commandEnv, {
        timeoutMs: Math.max(1_000, Math.min(10_000, timeoutMs)),
        operation: "get text body",
      });
    }

    const text = htmlText || readNestedString(textResult, ["data", "text"]);
    if (!text) {
      throw new Error(
        `agent-browser returned no page content for ${request.url}`,
      );
    }

    const response = {
      url: readNestedString(openResult, ["data", "url"]) || request.url,
      text,
      metadata: {
        adapter: "agent-browser",
        sessionName,
        requestedInstruction: request.instruction,
        contentMode: htmlText ? "rendered_html" : "rendered_text",
        title: readNestedString(openResult, ["data", "title"]),
        origin:
          readNestedString(htmlResult, ["data", "origin"]) ||
          readNestedString(textResult, ["data", "origin"]),
      },
    };

    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    await closeSession(executable, sessionName, commandEnv);
  }
}

async function readRequest() {
  const input = await readStdin();
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("browser-use-agent-browser: stdin must be valid JSON");
  }

  const url = typeof parsed?.url === "string" ? parsed.url.trim() : "";
  if (!url) {
    throw new Error("browser-use-agent-browser: request.url is required");
  }

  const instruction =
    typeof parsed?.instruction === "string" ? parsed.instruction.trim() : "";
  const timeoutMs =
    typeof parsed?.timeoutMs === "number" ? parsed.timeoutMs : undefined;

  return { url, instruction, timeoutMs };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      chunks.push(String(chunk));
    });
    process.stdin.once("error", reject);
    process.stdin.once("end", () => {
      resolve(chunks.join("").trim());
    });
  });
}

async function resolveAgentBrowserExecutable() {
  const candidates = [
    cleanString(process.env.BROWSER_USE_DISCOVERY_AGENT_BROWSER_PATH),
    cleanString(process.env.AGENT_BROWSER_PATH),
    DEFAULT_AGENT_BROWSER_PATH,
    "agent-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "agent-browser") {
      return candidate;
    }
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    [
      "browser-use-agent-browser: local agent-browser executable was not found.",
      `Looked for ${DEFAULT_AGENT_BROWSER_PATH} and AGENT_BROWSER_PATH overrides.`,
    ].join(" "),
  );
}

function resolveSocketDir() {
  return (
    cleanString(process.env.BROWSER_USE_DISCOVERY_AGENT_BROWSER_SOCKET_DIR) ||
    cleanString(process.env.AGENT_BROWSER_SOCKET_DIR) ||
    DEFAULT_SOCKET_DIR
  );
}

function normalizeTimeoutMs(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.floor(value));
}

function computeWaitMs(timeoutMs) {
  return Math.min(3_000, Math.max(750, Math.floor(timeoutMs * 0.08)));
}

async function runAgentBrowserCommand(executable, args, env, options) {
  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
  const operation = cleanString(options?.operation) || args.join(" ");
  const output = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `agent-browser timed out after ${timeoutMs}ms during ${operation}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdoutChunks.push(String(chunk));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderrChunks.push(String(chunk));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = stdoutChunks.join("").trim();
      const stderr = stderrChunks.join("").trim();
      if (code && code !== 0) {
        reject(
          new Error(
            `agent-browser exited ${code}: ${stderr || stdout || args.join(" ")}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });

  const parsed = parseJsonLine(output.stdout);
  if (!parsed) {
    throw new Error(
      `agent-browser returned non-JSON output for ${args.join(" ")}`,
    );
  }
  if (parsed.success === false) {
    throw new Error(
      `agent-browser reported an error for ${args.join(" ")}: ${stringifyJsonValue(parsed.error)}`,
    );
  }
  return parsed;
}

async function closeSession(executable, sessionName, env) {
  try {
    await runAgentBrowserCommand(executable, [
      "--json",
      "--session",
      sessionName,
      "close",
    ], env, {
      timeoutMs: 5_000,
      operation: "close",
    });
  } catch {
    // Ignore cleanup failures.
  }
}

function parseJsonLine(input) {
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning in case debug lines were emitted before the JSON payload.
    }
  }
  return null;
}

function readNestedString(record, pathParts) {
  let current = record;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return "";
    }
    current = current[part];
  }
  return typeof current === "string" ? current : "";
}

function stringifyJsonValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}
