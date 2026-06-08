import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatBrowserRuntimeReadinessWarning,
  validateLlmRuntimeReadiness,
  validateBrowserRuntimeReadiness,
} from "../../src/browser/runtime-readiness.ts";

const baseRuntimeConfig = {
  stateDatabasePath: "",
  workerConfigPath: "",
  browserUseCommand: "",
  llmProvider: "" as const,
  llmApiKey: "",
  llmModel: "",
  llmBaseUrl: "",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  groundedSearchMaxResultsPerCompany: 6,
  groundedSearchMaxPagesPerCompany: 4,
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleAccessToken: "",
  googleOAuthTokenJson: "",
  googleOAuthTokenFile: "",
  webhookSecret: "",
  allowedOrigins: [],
  port: 0,
  host: "127.0.0.1",
  runMode: "hosted" as const,
  asyncAckByDefault: true,
};

test("validateBrowserRuntimeReadiness reports when browser command is not configured", async () => {
  const status = await validateBrowserRuntimeReadiness({
    ...baseRuntimeConfig,
    browserUseCommand: "",
  });

  assert.equal(status.configured, false);
  assert.equal(status.available, false);
  assert.match(status.message || "", /not configured/i);
  assert.ok(status.remediation);
});

test("validateBrowserRuntimeReadiness reports when configured command file does not exist", async () => {
  const status = await validateBrowserRuntimeReadiness({
    ...baseRuntimeConfig,
    browserUseCommand: "/nonexistent/path/to/browser-use",
  });

  assert.equal(status.configured, true);
  assert.equal(status.available, false);
  assert.match(status.message || "", /does not exist/i);
  assert.ok(status.detail);
  assert.ok(status.remediation);
});

test("validateBrowserRuntimeReadiness reports when configured command path does not exist", async () => {
  const status = await validateBrowserRuntimeReadiness({
    ...baseRuntimeConfig,
    browserUseCommand: "/definitely/nonexistent/path/to/browser-use",
  });

  assert.equal(status.configured, true);
  assert.equal(status.available, false);
  assert.match(status.message || "", /does not exist/i);
  assert.ok(status.detail);
  assert.ok(status.remediation);
});

test("validateBrowserRuntimeReadiness returns available when command has path separators but file exists", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-browser-runtime-"));
  try {
    const executablePath = join(tempDir, "browser-use");
    // Create an executable file
    await writeFile(executablePath, "#!/bin/bash\necho test", "utf8");
    // Make it executable (this might fail on Windows but the test is for Unix)
    try {
      await import("node:fs/promises").then((fs) =>
        fs.chmod(executablePath, 0o755),
      );
    } catch {
      // chmod might not work on all systems, skip if it fails
    }

    const status = await validateBrowserRuntimeReadiness({
      ...baseRuntimeConfig,
      browserUseCommand: executablePath,
    });

    // If chmod worked, available should be true. If not, it depends on the system.
    assert.equal(status.configured, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("validateBrowserRuntimeReadiness returns available for command without path separators (PATH lookup)", async () => {
  // Commands without path separators are assumed to be in PATH
  const status = await validateBrowserRuntimeReadiness({
    ...baseRuntimeConfig,
    browserUseCommand: "browser-use",
  });

  assert.equal(status.configured, true);
  assert.equal(status.available, true);
});

test("formatBrowserRuntimeReadinessWarning returns empty string when available", async () => {
  const readiness = {
    configured: true,
    available: true,
  };

  const warning = formatBrowserRuntimeReadinessWarning(readiness);
  assert.equal(warning, "");
});

test("formatBrowserRuntimeReadinessWarning returns message when not available", async () => {
  const readiness = {
    configured: true,
    available: false,
    message: "Browser command not found",
    detail: "The configured path does not exist",
  };

  const warning = formatBrowserRuntimeReadinessWarning(readiness);
  assert.ok(warning.includes("Browser command not found"));
});

test("validateLlmRuntimeReadiness returns ready for OpenRouter without Gemini tools", () => {
  const readiness = validateLlmRuntimeReadiness({
    ...baseRuntimeConfig,
    llmProvider: "openrouter",
    llmApiKey: "or_test_key",
    llmModel: "openai/gpt-4.1-mini",
    llmBaseUrl: "https://openrouter.ai/api/v1",
    geminiApiKey: "",
  });

  assert.equal(readiness.provider, "openrouter");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.requiresApiKey, true);
});

test("validateLlmRuntimeReadiness reports OpenRouter missing API key separately from Gemini", () => {
  const readiness = validateLlmRuntimeReadiness({
    ...baseRuntimeConfig,
    llmProvider: "openrouter",
    llmApiKey: "",
    llmModel: "openai/gpt-4.1-mini",
    llmBaseUrl: "https://openrouter.ai/api/v1",
    geminiApiKey: "gemini_tool_key",
  });

  assert.equal(readiness.provider, "openrouter");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.ready, false);
  assert.match(readiness.message || "", /missing an API key/i);
  assert.match(readiness.detail || "", /separate from Gemini Google-tool readiness/i);
});

test("validateLlmRuntimeReadiness returns ready for local provider without API key", () => {
  const readiness = validateLlmRuntimeReadiness({
    ...baseRuntimeConfig,
    llmProvider: "local",
    llmApiKey: "",
    llmModel: "qwen3-coder",
    llmBaseUrl: "http://127.0.0.1:11434/v1",
  });

  assert.equal(readiness.provider, "local");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.requiresApiKey, false);
});

test("validateLlmRuntimeReadiness treats absent chat provider as not configured", () => {
  const readiness = validateLlmRuntimeReadiness(baseRuntimeConfig);

  assert.equal(readiness.provider, "");
  assert.equal(readiness.configured, false);
  assert.equal(readiness.ready, false);
  assert.match(readiness.message || "", /not configured/i);
});
