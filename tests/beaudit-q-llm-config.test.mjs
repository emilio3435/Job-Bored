/**
 * BEAUDIT lane Q: POST /api/llm-config and the llm.json store (E2, E12, E14, E18).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readdir, stat, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handlePostLlmConfig,
  loadLlmConfig,
  resolveActivePin,
  writeLlmConfig,
  clearResolvedFlashCache,
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

async function post(body, env) {
  const res = mockRes();
  await handlePostLlmConfig({ body }, res, env);
  return res;
}

describe("POST /api/llm-config", () => {
  let dir;
  let env;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-q-llm-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("E2 normalizes a Local pin to openai_compatible and reports the alias", async () => {
    const res = await post(
      { provider: "local", model: "gemma4:e2b", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" },
      env,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.provider, "openai_compatible");
    assert.equal(res.body.alias, "local");
    assert.equal(res.body.keyPresent, false);
    assert.equal(loadLlmConfig(env).provider, "openai_compatible");
  });

  it("E12 keeps the stored key when apiKey is omitted", async () => {
    await post({ provider: "gemini", model: "gemini-flash", apiKey: "stored-secret" }, env);
    const res = await post({ provider: "gemini", model: "gemini-3.7-flash" }, env);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.keyPresent, true);
    assert.equal(loadLlmConfig(env).apiKey, "stored-secret");
    assert.equal(loadLlmConfig(env).model, "gemini-3.7-flash");
  });

  it("E12 clears the key only on explicit apiKey:null", async () => {
    await post({ provider: "gemini", model: "gemini-flash", apiKey: "stored-secret" }, env);
    const res = await post({ provider: "gemini", model: "gemini-flash", apiKey: null }, env);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.keyPresent, false);
    assert.equal(loadLlmConfig(env).apiKey, "");
  });

  it("E12 never carries a stored key to a different provider or base URL", async () => {
    await post({ provider: "openrouter", model: "m", apiKey: "or-secret" }, env);
    const moved = await post(
      { provider: "openai_compatible", model: "exfil", baseUrl: "https://attacker.test/v1" },
      env,
    );
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.body.keyPresent, false);
    assert.equal(loadLlmConfig(env).apiKey, "");
  });

  it("E12 rejects an unknown provider and a non-http baseUrl", async () => {
    const bad = await post({ provider: "evil", model: "m", apiKey: "k" }, env);
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.code, "llm_invalid");
    const badUrl = await post(
      { provider: "openai_compatible", model: "m", baseUrl: "file:///etc/passwd" },
      env,
    );
    assert.equal(badUrl.statusCode, 400);
    assert.equal(badUrl.body.code, "llm_invalid");
    assert.equal(loadLlmConfig(env), null);
  });
});

describe("E14 llm.json is written atomically at 0600", () => {
  let dir;
  let env;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-q-atomic-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("replaces the file by rename: a read-only old pin is swapped, not written through", async () => {
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, "{\"provider\":\"gemini\"}\n");
    await chmod(env.JOBBORED_LLM_CONFIG_PATH, 0o444);
    await writeLlmConfig({ provider: "gemini", model: "m", apiKey: "k" }, env);
    const saved = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    assert.equal(saved.apiKey, "k");
    const mode = (await stat(env.JOBBORED_LLM_CONFIG_PATH)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.deepEqual(await readdir(dir), ["llm.json"]);
  });
});

describe("E14/E18 Gemini flash resolution", () => {
  beforeEach(() => clearResolvedFlashCache());

  it("lists models with the key in a header and caches the resolved id per process", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ models: [{ name: "models/gemini-3.9-flash" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const pin = { provider: "gemini", model: "gemini-flash", apiKey: "k1", baseUrl: "", updatedAt: "" };
    const a = await resolveActivePin(pin, { fetchImpl });
    const b = await resolveActivePin(pin, { fetchImpl });
    assert.equal(a.resolvedModel, "gemini-3.9-flash");
    assert.equal(b.resolvedModel, "gemini-3.9-flash");
    assert.equal(calls.length, 1, "second resolve must hit the cache");
    assert.doesNotMatch(calls[0].url, /key=/);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "k1");
  });
});
