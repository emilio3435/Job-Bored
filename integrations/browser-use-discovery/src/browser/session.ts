import { spawn } from "node:child_process";

import type {
  BrowserUseSessionRequest,
  BrowserUseSessionResult,
} from "../contracts.ts";
import type { WorkerRuntimeConfig } from "../config.ts";

export type BrowserUseSessionManager = {
  run(request: BrowserUseSessionRequest): Promise<BrowserUseSessionResult>;
};

const DEFAULT_BROWSER_COMMAND_TIMEOUT_MS = 30_000;

export function createBrowserUseSessionManager(
  runtimeConfig: WorkerRuntimeConfig,
): BrowserUseSessionManager {
  return {
    async run(request) {
      const command = String(runtimeConfig.browserUseCommand || "").trim();
      if (command) {
        try {
          return await runCommandSession(command, request);
        } catch (error) {
          const fallback = await runFetchSession(request);
          return {
            ...fallback,
            metadata: {
              ...fallback.metadata,
              mode: "fetch_fallback",
              browserUseCommand: command,
              browserUseCommandError: stringifyError(error),
            },
          };
        }
      }
      return runFetchSession(request);
    },
  };
}

async function runCommandSession(
  command: string,
  request: BrowserUseSessionRequest,
): Promise<BrowserUseSessionResult> {
  const payload = JSON.stringify({
    url: request.url,
    instruction: request.instruction,
    timeoutMs: request.timeoutMs,
  });
  const timeoutMs = normalizeBrowserCommandTimeoutMs(request.timeoutMs);
  const output = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      if (request.abortSignal?.aborted) {
        reject(createAbortError());
        return;
      }
      const child = spawn(command, [], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let settled = false;
      let stdout = "";
      let stderr = "";
      const abortHandler = () => {
        const message = "Browser Use command aborted";
        stderr = stderr ? `${stderr}\n${message}` : message;
        child.kill("SIGKILL");
        if (settled) return;
        settled = true;
        reject(createAbortError());
      };
      const timer = setTimeout(() => {
        const message = `Browser Use command timed out after ${timeoutMs}ms`;
        stderr = stderr ? `${stderr}\n${message}` : message;
        child.kill("SIGKILL");
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        request.abortSignal?.removeEventListener("abort", abortHandler);
      };
      request.abortSignal?.addEventListener("abort", abortHandler, {
        once: true,
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.once("error", (error) => {
        cleanup();
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once("close", (code) => {
        cleanup();
        if (settled) return;
        settled = true;
        if (code && code !== 0) {
          reject(new Error(`Browser Use command exited ${code}: ${stderr || stdout}`));
          return;
        }
        resolve({ stdout, stderr });
      });
      child.stdin.end(`${payload}\n`);
    },
  );

  const parsed = tryParseJson(output.stdout);
  if (parsed && typeof parsed === "object") {
    const result = parsed as Record<string, unknown>;
    const url = stringOr(result.url, request.url);
    const text = stringOr(result.text, output.stdout.trim());
    const metadata =
      result.metadata && typeof result.metadata === "object"
        ? (result.metadata as Record<string, unknown>)
        : {};
    return {
      url,
      text,
      metadata: {
        ...metadata,
        mode: "browser_use_command",
        stderr: output.stderr.trim(),
      },
    };
  }

  return {
    url: request.url,
    text: output.stdout.trim(),
    metadata: {
      mode: "browser_use_command",
      stderr: output.stderr.trim(),
    },
  };
}

async function runFetchSession(
  request: BrowserUseSessionRequest,
): Promise<BrowserUseSessionResult> {
  const response = await fetch(request.url, {
    headers: {
      accept: "application/json,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    },
    signal: request.abortSignal,
  });
  const text = await response.text();
  return {
    url: request.url,
    text,
    metadata: {
      mode: "fetch",
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      title: extractTitle(text),
    },
  };
}

function extractTitle(text: string): string {
  const match = String(text || "").match(/<title>([^<]+)<\/title>/i);
  return match && match[1] ? match[1].trim() : "";
}

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeBrowserCommandTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_BROWSER_COMMAND_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.floor(value));
}

function createAbortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}
