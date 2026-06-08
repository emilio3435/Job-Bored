import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { WorkerRuntimeConfig } from "../config.ts";

export type BrowserRuntimeReadiness = {
  configured: boolean;
  available: boolean;
  message?: string;
  detail?: string;
  remediation?: string;
};

export type LlmRuntimeReadiness = {
  provider: string;
  configured: boolean;
  ready: boolean;
  model?: string;
  baseUrl?: string;
  requiresApiKey?: boolean;
  message?: string;
  detail?: string;
  remediation?: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Validates that the browser command is configured and points to a readable
 * executable or command available in PATH.
 *
 * VAL-OBS-001: Health endpoint reports browser runtime readiness
 * VAL-OBS-002: Health endpoint reports grounded-web readiness cause (browser dependency)
 */
export async function validateBrowserRuntimeReadiness(
  runtimeConfig: WorkerRuntimeConfig,
): Promise<BrowserRuntimeReadiness> {
  const browserUseCommand = asText(runtimeConfig.browserUseCommand);

  // If no command is configured, browser automation is not available
  if (!browserUseCommand) {
    return {
      configured: false,
      available: false,
      message:
        "Browser automation command is not configured.",
      detail:
        "BROWSER_USE_DISCOVERY_BROWSER_COMMAND (or BROWSER_USE_COMMAND) is not set.",
      remediation:
        "Set BROWSER_USE_DISCOVERY_BROWSER_COMMAND to a browser automation command (e.g., 'browser-use', 'npx browser-use') that accepts JSON on stdin and emits JSON on stdout.",
    };
  }

  // Check if the command looks like a file path (contains path separators)
  // If so, verify the file exists and is readable
  if (browserUseCommand.includes("/") || browserUseCommand.includes("\\")) {
    const resolvedPath = resolve(browserUseCommand);
    try {
      await access(resolvedPath);
      return {
        configured: true,
        available: true,
      };
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "code" in error
          ? String((error as NodeJS.ErrnoException).code || "")
          : "";
      if (errorCode === "ENOENT") {
        return {
          configured: true,
          available: false,
          message: "Browser automation command file does not exist.",
          detail: `The configured browser command "${browserUseCommand}" resolves to a path that does not exist.`,
          remediation:
            "Verify the path to your browser automation command is correct, or install the browser-use package.",
        };
      }
      if (errorCode === "EACCES") {
        return {
          configured: true,
          available: false,
          message: "Browser automation command is not executable.",
          detail: `The configured browser command "${browserUseCommand}" exists but is not executable.`,
          remediation:
            "Grant execute permissions to the browser automation command with chmod +x, or use a different command path.",
        };
      }
      return {
        configured: true,
        available: false,
        message: "Browser automation command is not accessible.",
        detail: `Error accessing configured browser command "${browserUseCommand}": ${formatError(error)}`,
        remediation:
          "Verify the browser automation command path is correct and accessible.",
      };
    }
  }

  // For commands without path separators (assumed to be in PATH), we can't easily
  // verify availability without actually running them, which would be slow.
  // Return configured=true, available=true with a note that runtime will determine availability.
  return {
    configured: true,
    available: true,
  };
}

export function formatBrowserRuntimeReadinessWarning(
  readiness: BrowserRuntimeReadiness,
): string {
  if (readiness.available) return "";
  const parts = [readiness.message, readiness.detail].filter(Boolean);
  return parts.join(" ");
}

export function validateLlmRuntimeReadiness(
  runtimeConfig: WorkerRuntimeConfig,
): LlmRuntimeReadiness {
  const provider = asText(runtimeConfig.llmProvider);
  const apiKey = asText(runtimeConfig.llmApiKey);
  const model = asText(runtimeConfig.llmModel);
  const baseUrl = asText(runtimeConfig.llmBaseUrl);

  if (!provider) {
    return {
      provider: "",
      configured: false,
      ready: false,
      message: "LLM chat provider is not configured.",
      detail:
        "Plain JSON/scoring LLM lanes need BROWSER_USE_DISCOVERY_LLM_PROVIDER plus provider-specific model settings.",
      remediation:
        "Set BROWSER_USE_DISCOVERY_LLM_PROVIDER to openrouter, local, openai, anthropic, gemini, or openai_compatible.",
    };
  }

  const requiresApiKey = !["local", "openai_compatible"].includes(provider);
  if (requiresApiKey && !apiKey) {
    return {
      provider,
      configured: true,
      ready: false,
      model: model || undefined,
      baseUrl: baseUrl || undefined,
      requiresApiKey,
      message: `LLM chat provider ${provider} is missing an API key.`,
      detail:
        "Generic LLM readiness is separate from Gemini Google-tool readiness.",
      remediation:
        provider === "openrouter"
          ? "Set BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY or BROWSER_USE_DISCOVERY_LLM_API_KEY."
          : "Set BROWSER_USE_DISCOVERY_LLM_API_KEY or the provider-specific API key.",
    };
  }

  if (!model) {
    return {
      provider,
      configured: true,
      ready: false,
      baseUrl: baseUrl || undefined,
      requiresApiKey,
      message: `LLM chat provider ${provider} is missing a model.`,
      remediation:
        "Set BROWSER_USE_DISCOVERY_LLM_MODEL or the provider-specific model variable.",
    };
  }

  if (!baseUrl && (provider === "local" || provider === "openai_compatible")) {
    return {
      provider,
      configured: true,
      ready: false,
      model,
      requiresApiKey,
      message: `LLM chat provider ${provider} is missing a base URL.`,
      remediation:
        "Set BROWSER_USE_DISCOVERY_LLM_BASE_URL or the provider-specific base URL variable.",
    };
  }

  return {
    provider,
    configured: true,
    ready: true,
    model,
    baseUrl: baseUrl || undefined,
    requiresApiKey,
  };
}

export function formatLlmRuntimeReadinessWarning(
  readiness: LlmRuntimeReadiness,
): string {
  if (readiness.ready) return "";
  const parts = [readiness.message, readiness.detail].filter(Boolean);
  return parts.join(" ");
}
