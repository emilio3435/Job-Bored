import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLlmConfig,
  writeLlmConfig,
  migrateLlmConfigFromEnv,
  redactLlmConfig,
  resolveActivePin,
} from "../server/llm-config.mjs";

let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-llm-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("llm.json", () => {
  it("returns null when missing", () => {
    assert.equal(loadLlmConfig(env), null);
  });

  it("writes mode 0600 and round-trips without logging the key", async () => {
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "secret-key", baseUrl: "" },
      env,
    );
    const mode = (await stat(env.JOBBORED_LLM_CONFIG_PATH)).mode & 0o777;
    assert.equal(mode, 0o600);
    const loaded = loadLlmConfig(env);
    assert.equal(loaded.apiKey, "secret-key");
    const redacted = redactLlmConfig(loaded);
    assert.equal(redacted.keyPresent, true);
    assert.equal("apiKey" in redacted, false);
    const raw = await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8");
    assert.match(raw, /secret-key/);
  });

  it("migrates ATS env once when llm.json is missing", () => {
    const migrated = migrateLlmConfigFromEnv({
      ...env,
      ATS_PROVIDER: "gemini",
      ATS_GEMINI_API_KEY: "from-env",
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
    });
    assert.equal(migrated.provider, "gemini");
    assert.equal(migrated.model, "gemini-2.5-flash");
    assert.equal(migrated.apiKey, "from-env");
    const again = migrateLlmConfigFromEnv({
      ...env,
      ATS_GEMINI_API_KEY: "ignored",
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
    });
    assert.equal(again.apiKey, "from-env");
  });

  it("ignores ATS_GEMINI_MODEL once llm.json exists", async () => {
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "pin-key", baseUrl: "" },
      env,
    );
    const loaded = loadLlmConfig({
      ...env,
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
      ATS_GEMINI_API_KEY: "env-key",
    });
    assert.equal(loaded.model, "gemini-flash");
    assert.equal(loaded.apiKey, "pin-key");
  });
});

describe("resolveActivePin", () => {
  it("resolves gemini-flash via injected list", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.7-flash-preview"] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
    assert.equal(pin.model, "gemini-flash");
  });

  it("falls back to gemini-3.7-flash when the list is empty", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => [] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
  });

  it("keeps an exact snapshot id", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => ["gemini-3.8-flash"] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
  });
});
