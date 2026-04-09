import { spawn } from "node:child_process";

import type {
  BrowserUseSessionRequest,
  BrowserUseSessionResult,
} from "../contracts.ts";
import type { WorkerRuntimeConfig } from "../config.ts";

export type BrowserUseSessionManager = {
  run(request: BrowserUseSessionRequest): Promise<BrowserUseSessionResult>;
};

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
  const payload = JSON.stringify(request);
  const output = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, [], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.once("error", reject);
      child.once("close", (code) => {
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
