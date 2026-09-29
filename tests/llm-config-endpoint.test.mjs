/**
 * Tests for GET/POST /api/llm-config handlers in server/llm-config.mjs.
 * Imports the handlers directly so the suite does not boot Express.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleGetLlmConfig,
  handleJudgeTest,
  handlePostLlmConfig,
  loadLlmConfig,
  migrateLlmConfigFromEnv,
  resolveActivePin,
  writeLlmConfig,
} from "../server/llm-config.mjs";
import { handlePostJudgeModels } from "../server/judge-models.mjs";

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

  it("FIX1 P2-3: a grading-only pin stays unconfigured for writing, reuses its key, and permits env migration", async () => {
    const judge = { provider: "openai_compatible", model: "grok-fictional", apiKey: "fictional-grading-key", baseUrl: "https://api.x.ai/v1" };
    const post = mockRes();
    await handlePostLlmConfig({ body: { judge } }, post, env);
    assert.equal(post.statusCode, 200);
    const disk = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    for (const field of ["provider", "model", "apiKey", "baseUrl"]) assert.equal(Object.hasOwn(disk, field), false, field);
    assert.equal(loadLlmConfig(env), null);
    const get = mockRes();
    await handleGetLlmConfig({}, get, env);
    assert.equal(get.statusCode, 404);
    assert.equal(get.body.code, "llm_unconfigured");
    assert.equal(get.body.judge.keyPresent, true);
    assert.doesNotMatch(JSON.stringify(get.body), /fictional-grading-key|apiKey/);
    const blank = mockRes();
    await handlePostLlmConfig({ body: { judge: { ...judge, apiKey: " \t " } } }, blank, env);
    assert.equal(blank.body.judge.keyPresent, true);
    const auth = [];
    const fetchImpl = async (url, init) => {
      auth.push(new Headers(init.headers).get("authorization"));
      return { ok: true, json: async () => String(url).endsWith("/models")
        ? { data: [{ id: "grok-fictional", created: 1 }] }
        : { choices: [{ message: { content: '{"grade":3}' } }] } };
    };
    const test = mockRes();
    await handleJudgeTest({ body: { ...judge, apiKey: undefined } }, test, env, { fetchImpl });
    assert.equal(test.body.ok, true);
    const models = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai" } }, models, env, { fetchImpl });
    assert.equal(models.statusCode, 200);
    assert.deepEqual(auth, ["Bearer fictional-grading-key", "Bearer fictional-grading-key"]);
    const migrated = migrateLlmConfigFromEnv({ ...env, ATS_PROVIDER: "openai", ATS_OPENAI_MODEL: "fictional-writer", ATS_OPENAI_API_KEY: "fictional-env-key" });
    assert.equal(migrated.provider, "openai");
    assert.equal(migrated.apiKey, "fictional-env-key");
    assert.equal(migrated.judge.apiKey, judge.apiKey);
  });

  it("FIX1 P2-3: a legacy empty provider permits env migration; a later writer save keeps the grader", async () => {
    const judge = { provider: "openai", model: "fictional-grader", apiKey: "fictional-grading-key" };
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify({ provider: " \t ", model: "", judge }));
    assert.equal(loadLlmConfig(env), null);
    const migrated = migrateLlmConfigFromEnv({ ...env, ATS_PROVIDER: "openai", ATS_OPENAI_MODEL: "fictional-writer", ATS_OPENAI_API_KEY: "fictional-env-key" });
    assert.equal(migrated.provider, "openai");
    assert.equal(migrated.judge.apiKey, judge.apiKey);
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify({ judge }));
    const writer = mockRes();
    await handlePostLlmConfig({ body: { provider: "openai", model: "fictional-writer", apiKey: "fictional-writer-key" } }, writer, env);
    assert.equal(writer.body.judge.keyPresent, true);
  });

  it("FIX1 P2-4: whitespace grading keys keep the same-target key, null explicitly clears it", async () => {
    const judge = { provider: "openai", model: "fictional-grader", apiKey: "fictional-grading-key" };
    await writeLlmConfig({ provider: "openai", model: "fictional-writer", apiKey: "fictional-writer-key", judge }, env);
    for (const apiKey of ["", " \t\n ", null]) {
      const res = mockRes();
      await handlePostLlmConfig({ body: { judge: { ...judge, apiKey } } }, res, env);
      assert.equal(res.body.judge.keyPresent, apiKey !== null);
      assert.equal(loadLlmConfig(env).judge.apiKey, apiKey === null ? "" : judge.apiKey);
    }
    const moved = mockRes();
    await handlePostLlmConfig({ body: { judge: { ...judge, apiKey: "   ", baseUrl: "https://fictional.example/v1" } } }, moved, env);
    assert.equal(moved.body.judge.keyPresent, false);
  });

  it("FIX1 P2-5: invalid grading-model requests never display judge in 400 copy", async () => {
    for (const body of [{ provider: "unsupported", model: "fictional" }, { provider: "openai" }]) {
      const post = mockRes();
      await handlePostLlmConfig({ body: { judge: body } }, post, env);
      assert.equal(post.statusCode, 400);
      assert.doesNotMatch(post.body.error, /judge/i);
      const test = mockRes();
      await handleJudgeTest({ body }, test, env);
      assert.equal(test.statusCode, 400);
      assert.doesNotMatch(test.body.error, /judge/i);
    }
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

  it("J-BE3c: judge:null removes only the judge from the stored config", async () => {
    await writeLlmConfig({
      provider: "gemini", model: "gemini-flash", apiKey: "writer-example-key", baseUrl: "",
      judge: { provider: "openai", model: "gpt-example", apiKey: "judge-example-key" },
    }, env);
    const res = mockRes();
    await handlePostLlmConfig({ body: { judge: null } }, res, env);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.judge, null);
    const stored = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    assert.equal(stored.judge, undefined);
    assert.equal(stored.apiKey, "writer-example-key");
  });

  it("J-BE3d: judge-only save does not migrate an older writer model on disk", async () => {
    const original = {
      provider: "gemini", model: "gemini-3.7-flash", apiKey: "writer-example-key", baseUrl: "",
      fallback: { enabled: false, stages: { draft: { provider: "openai", model: "gpt-example" } } },
    };
    await writeFile(env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify(original));
    const res = mockRes();
    await handlePostLlmConfig({ body: { judge: { provider: "openai", model: "gpt-example", apiKey: "judge-example-key" } } }, res, env);
    assert.equal(res.statusCode, 200);
    const after = JSON.parse(await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8"));
    for (const field of ["provider", "model", "apiKey", "baseUrl", "fallback"]) assert.deepEqual(after[field], original[field], field);
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
