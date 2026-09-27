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
  it("resolves the stored family to the provider alias without a catalog request", async () => {
    let catalogCalls = 0;
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => { catalogCalls += 1; return ["gemini-3.8-flash"]; } },
    );
    assert.equal(pin.resolvedModel, "gemini-flash-latest");
    assert.equal(pin.model, "gemini-flash");
    assert.equal(catalogCalls, 0);
  });

  it("uses the moving alias when the catalog is empty", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => [] },
    );
    assert.equal(pin.resolvedModel, "gemini-flash-latest");
  });

  it("maps the old app-generated snapshot without changing the pin's stored id", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => ["gemini-3.8-flash"] },
    );
    assert.equal(pin.resolvedModel, "gemini-flash-latest");
    assert.equal(pin.model, "gemini-3.7-flash");
  });

  it("ignores stale model-list responses and never sends a catalog request", async () => {
    const calls = [];
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      {
        fetchImpl: async (url, init = {}) => {
          calls.push({ url: String(url), init });
          return {
            ok: true,
            json: async () => ({
              models: [
                { name: "models/gemini-3.5-flash" },
                { name: "models/gemini-3.8-flash" },
                { name: "models/gemini-3.8-flash-preview" },
              ],
            }),
          };
        },
      },
    );
    assert.equal(pin.resolvedModel, "gemini-flash-latest");
    assert.equal(calls.length, 0);
  });

  it("does not depend on catalog availability", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      {
        fetchImpl: async () => {
          throw new Error("network");
        },
      },
    );
    assert.equal(pin.resolvedModel, "gemini-flash-latest");
  });

  it("preserves an explicit nonlegacy model", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-3.5-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
    );
    assert.equal(pin.model, "gemini-3.5-flash");
    assert.equal(pin.resolvedModel, "gemini-3.5-flash");
  });
});
