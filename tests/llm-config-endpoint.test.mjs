/**
 * Tests for GET/POST /api/llm-config handlers in server/llm-config.mjs.
 * Imports the handlers directly so the suite does not boot Express.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleGetLlmConfig,
  handlePostLlmConfig,
  loadLlmConfig,
  resolveActivePin,
  writeLlmConfig,
} from "../server/llm-config.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("/api/llm-config", () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-llm-http-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("J-BE3a: saves a judge-only body without a writer pin", async () => {
    const res = mockRes();
    await handlePostLlmConfig({ body: { judge: {
      provider: "openai_compatible", model: "grok-example", apiKey: "example-judge-key", baseUrl: "https://api.x.ai/v1",
    } } }, res, env);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.judge.keyPresent, true);
    assert.equal(JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8")).judge.apiKey, "example-judge-key");
  });

  it("J-BE3b: judge-only updates preserve writer fields and fallback on disk, including a blank judge key", async () => {
    await writeLlmConfig({
      provider: "gemini", model: "gemini-flash", apiKey: "writer-example-key", baseUrl: "https://writer.example.com",
      fallback: { enabled: true, stages: { draft: { provider: "openai", model: "gpt-example", apiKey: "fallback-example-key" } } },
    }, env);
    const before = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    const save = mockRes();
    await handlePostLlmConfig({ body: { judge: {
      provider: "openai_compatible", model: "grok-example", apiKey: "judge-example-key", baseUrl: "https://api.x.ai/v1",
    } } }, save, env);
    assert.equal(save.statusCode, 200);
    const blank = mockRes();
    await handlePostLlmConfig({ body: { judge: {
      provider: "openai_compatible", model: "grok-new", apiKey: "", baseUrl: "https://api.x.ai/v1",
    } } }, blank, env);
    assert.equal(blank.statusCode, 200);
    const after = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    for (const field of ["provider", "model", "apiKey", "baseUrl", "fallback"]) assert.deepEqual(after[field], before[field], field);
    assert.equal(after.judge.apiKey, "judge-example-key");
    assert.equal(after.judge.model, "grok-new");
  });

  it("GET returns 404 llm_unconfigured when the pin file is missing", async () => {
    const res = mockRes();
    await handleGetLlmConfig({}, res, env);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "llm_unconfigured");
    assert.equal("apiKey" in res.body, false);
  });

  it("POST then GET round-trips a redacted pin and GET never contains apiKey", async () => {
    const postRes = mockRes();
    await handlePostLlmConfig(
      {
        body: {
          provider: "gemini",
          model: "gemini-flash",
          apiKey: "secret-key",
          baseUrl: "",
        },
      },
      postRes,
      env,
    );
    assert.equal(postRes.statusCode, 200);
    assert.equal(postRes.body.provider, "gemini");
    assert.equal(postRes.body.model, "gemini-flash");
    assert.equal(postRes.body.keyPresent, true);
    assert.equal("apiKey" in postRes.body, false);
    assert.equal(JSON.stringify(postRes.body).includes("secret-key"), false);

    const getRes = mockRes();
    await handleGetLlmConfig({}, getRes, env);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.provider, "gemini");
    assert.equal(getRes.body.model, "gemini-flash");
    assert.equal(getRes.body.baseUrl, "");
    assert.equal(getRes.body.keyPresent, true);
    assert.ok(typeof getRes.body.updatedAt === "string");
    assert.equal("apiKey" in getRes.body, false);
    assert.equal(JSON.stringify(getRes.body).includes("secret-key"), false);
    assert.equal(JSON.stringify(getRes.body).includes("apiKey"), false);
  });

  it("POST 400 when model is missing", async () => {
    const res = mockRes();
    await handlePostLlmConfig(
      { body: { provider: "gemini", apiKey: "k" } },
      res,
      env,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "llm_invalid");
    assert.equal("apiKey" in res.body, false);
  });

  it("round-trips an xAI judge, redacts both keys, preserves omission and clears null", async () => {
    const first = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash", apiKey: "writer-example-key", baseUrl: "",
      judge: { provider: "openai_compatible", model: "grok-example", apiKey: "judge-example-key", baseUrl: "https://api.x.ai/v1" },
    } }, first, env);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body.judge, { provider: "openai_compatible", alias: "", model: "grok-example", baseUrl: "https://api.x.ai/v1", keyPresent: true });
    assert.ok(!JSON.stringify(first.body).includes("example-key"));
    const pin = await resolveActivePin(loadLlmConfig(env));
    assert.equal(pin.provider, "gemini");
    assert.equal(pin.judge.provider, "openai_compatible");
    assert.equal(pin.judge.baseUrl, "https://api.x.ai/v1");

    const keep = mockRes();
    await handlePostLlmConfig({ body: { provider: "gemini", model: "gemini-3.8-flash" } }, keep, env);
    assert.equal(keep.body.judge.keyPresent, true);
    const get = mockRes();
    await handleGetLlmConfig({}, get, env);
    assert.deepEqual(get.body.judge, keep.body.judge);

    const clear = mockRes();
    await handlePostLlmConfig({ body: { provider: "gemini", model: "gemini-3.8-flash", judge: null } }, clear, env);
    assert.equal(clear.body.judge, null);
    assert.equal((await resolveActivePin(loadLlmConfig(env))).judge, undefined);
  });

  it("keeps an omitted judge key on the same target and clears it when the target moves", async () => {
    const first = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash", apiKey: "writer-key", baseUrl: "",
      judge: { provider: "openai", model: "gpt-4o-mini", apiKey: "judge-key", baseUrl: "" },
    } }, first, env);
    assert.equal(first.body.judge.keyPresent, true);

    const same = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash",
      judge: { provider: "openai", model: "gpt-4o-mini", baseUrl: "" },
    } }, same, env);
    assert.equal(same.body.judge.keyPresent, true, "same target + omitted key keeps the stored key");

    const moved = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash",
      judge: { provider: "openai", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" },
    } }, moved, env);
    assert.equal(moved.body.judge.keyPresent, false, "moved target + omitted key clears the stored key");
  });

  it("P2 · keeps a Local judge alias so it round-trips, and drops a mismatched one", async () => {
    const first = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash", apiKey: "writer-key", baseUrl: "",
      judge: { provider: "local", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1" },
    } }, first, env);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body.judge, {
      provider: "openai_compatible", alias: "local", model: "qwen3:8b",
      baseUrl: "http://127.0.0.1:11434/v1", keyPresent: false,
    });

    const get = mockRes();
    await handleGetLlmConfig({}, get, env);
    assert.equal(get.body.judge.alias, "local", "the alias survives a reload");

    const pin = await resolveActivePin(loadLlmConfig(env));
    assert.equal(pin.judge.provider, "openai_compatible", "grading still uses the normalized provider");
    assert.equal(pin.judge.baseUrl, "http://127.0.0.1:11434/v1");

    const mismatch = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash",
      judge: { provider: "openai", model: "gpt-4o-mini", baseUrl: "", alias: "local" },
    } }, mismatch, env);
    assert.equal(mismatch.body.judge.alias, "", "an alias that disagrees with the provider is dropped");
  });
});
