import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRuntimeConfig } from "../src/config.ts";

test("llm.json wins over BROWSER_USE_DISCOVERY_GEMINI_MODEL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-disc-pin-"));
  const path = join(dir, "llm.json");
  await writeFile(
    path,
    JSON.stringify({
      provider: "gemini",
      model: "gemini-3.7-flash",
      apiKey: "pin-key",
      baseUrl: "",
      updatedAt: "2026-08-31T00:00:00Z",
    }),
  );
  try {
    const cfg = loadRuntimeConfig({
      JOBBORED_LLM_CONFIG_PATH: path,
      BROWSER_USE_DISCOVERY_GEMINI_MODEL: "gemini-3.5-flash",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "env-key",
    });
    assert.equal(cfg.geminiModel, "gemini-3.7-flash");
    assert.equal(cfg.geminiApiKey, "pin-key");
    assert.equal(cfg.llmProvider, "gemini");
    assert.equal(cfg.llmModel, "gemini-3.7-flash");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-Gemini pin leaves google_search key empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-disc-pin-"));
  const path = join(dir, "llm.json");
  await writeFile(
    path,
    JSON.stringify({
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-test",
      baseUrl: "",
      updatedAt: "2026-08-31T00:00:00Z",
    }),
  );
  try {
    const cfg = loadRuntimeConfig({
      JOBBORED_LLM_CONFIG_PATH: path,
      BROWSER_USE_DISCOVERY_GEMINI_MODEL: "gemini-3.5-flash",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "env-gemini",
    });
    assert.equal(cfg.llmProvider, "openai");
    assert.equal(cfg.llmModel, "gpt-5.6-terra");
    assert.equal(cfg.geminiApiKey, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty env without llm.json defaults geminiModel to gemini-3.7-flash", () => {
  const cfg = loadRuntimeConfig({
    JOBBORED_LLM_CONFIG_PATH: join(tmpdir(), "jb-missing-llm.json"),
  });
  assert.equal(cfg.geminiModel, "gemini-3.7-flash");
});

test("gemini-flash pin resolves to GEMINI_FLASH_FALLBACK without a live list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-disc-pin-"));
  const path = join(dir, "llm.json");
  await writeFile(
    path,
    JSON.stringify({
      provider: "gemini",
      model: "gemini-flash",
      apiKey: "pin-key",
      baseUrl: "",
      updatedAt: "2026-08-31T00:00:00Z",
    }),
  );
  try {
    const cfg = loadRuntimeConfig({
      JOBBORED_LLM_CONFIG_PATH: path,
      BROWSER_USE_DISCOVERY_GEMINI_MODEL: "gemini-3.5-flash",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "env-key",
    });
    assert.equal(cfg.geminiModel, "gemini-3.7-flash");
    assert.equal(cfg.llmModel, "gemini-3.7-flash");
    assert.equal(cfg.geminiApiKey, "pin-key");
    assert.equal(cfg.llmApiKey, "pin-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
