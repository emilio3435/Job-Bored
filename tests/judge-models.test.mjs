/** MREV JUDGEUX · xAI catalog filtering, recommendation, and key handling. */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePostLlmConfig } from "../server/llm-config.mjs";
import { handlePostJudgeModels } from "../server/judge-models.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe("POST /api/llm-config/judge-models", () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-judge-models-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
    const saved = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash", apiKey: "fictional-writer-key",
      judge: { provider: "openai_compatible", model: "grok-old", apiKey: "fictional-stored-xai-key", baseUrl: "https://api.x.ai/v1" },
    } }, saved, env);
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("U2 · returns only text-capable Grok models newest first and recommends the newest non-mini", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: [
        { id: "grok-4.2-chat", created: 400, input_modalities: ["text"], output_modalities: ["text"] },
        { id: "grok-4-mini", created: 500 },
        { id: "grok-image-1", created: 900, output_modalities: ["image"] },
        { id: "grok-embedding-1", created: 800 },
        { id: "grok-4.1-reasoning", created: 300 },
        { id: "gemini-3.8-flash", created: 999 },
      ] }) };
    };
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai", apiKey: "fictional-request-key" } }, res, env, { fetchImpl });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      models: [
        { id: "grok-4-mini", label: "grok-4-mini", created: 500 },
        { id: "grok-4.2-chat", label: "grok-4.2-chat", created: 400 },
        { id: "grok-4.1-reasoning", label: "grok-4.1-reasoning", created: 300 },
      ],
      recommended: "grok-4.2-chat",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.x.ai/v1/models");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Authorization, "Bearer fictional-request-key");
    assert.equal(JSON.stringify(res.body).includes("fictional-request-key"), false);
  });

  it("U2 · filters media models and recommends the newest numbered Grok release", async () => {
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai", apiKey: "fictional-request-key" } }, res, env, {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [
        { id: "grok-4.7", created: 2_000 },
        { id: "grok-imagine-image-2.0", created: 2_400 },
        { id: "grok-4.6", created: 1_900 },
        { id: "grok-4.5", created: 1_800 },
        { id: "grok-imagine-video-1.5", created: 2_300 },
        { id: "grok-4.3", created: 1_700 },
        { id: "grok-build-0.1", created: 2_500 },
        { id: "grok-4.20-0309-non-reasoning", created: 1_600 },
        { id: "grok-4.20-0309-reasoning", created: 1_500 },
        { id: "grok-4.20-multi-agent-0309", created: 1_400 },
        { id: "grok-voice-tts-1.0", created: 2_200 },
      ] }) }),
    });

    assert.equal(res.body.recommended, "grok-4.7");
    assert.ok(res.body.models.some((model) => model.id === "grok-build-0.1"), "build models remain listed");
    assert.ok(res.body.models.every((model) => !/(imagine|image|video|voice|audio|stt|tts|embed)/i.test(model.id)));
  });

  it("U2 · uses the stored xAI judge key when none is sent", async () => {
    let authorization = "";
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai" } }, res, env, {
      fetchImpl: async (_url, init) => {
        authorization = init.headers.Authorization;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "grok-4", created: 4 }] }) };
      },
    });
    assert.equal(authorization, "Bearer fictional-stored-xai-key");
    assert.deepEqual(res.body, { models: [{ id: "grok-4", label: "grok-4", created: 4 }], recommended: "grok-4" });
  });

  it("U2 · maps an invalid key and a network error to plain words without exposing the key", async () => {
    const badKey = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai", apiKey: "fictional-rejected-key" } }, badKey, env, {
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "private provider detail" }) }),
    });
    assert.equal(badKey.statusCode, 401);
    assert.deepEqual(badKey.body, { error: "That key didn't work: check it on the xAI console." });
    assert.equal(JSON.stringify(badKey.body).includes("fictional-rejected-key"), false);

    const network = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai", apiKey: "fictional-network-key" } }, network, env, {
      fetchImpl: async () => { throw new Error("socket details must not escape"); },
    });
    assert.equal(network.statusCode, 502);
    assert.deepEqual(network.body, { error: "Couldn't reach xAI: try again." });
  });

  it("U2 · refuses unsupported providers and missing keys without fetching", async () => {
    let fetched = false;
    const fetchImpl = async () => { fetched = true; throw new Error("must not fetch"); };
    for (const provider of ["webhook", "openai_compatible", ""]) {
      const unsupported = mockRes();
      await handlePostJudgeModels({ body: { provider } }, unsupported, env, { fetchImpl });
      assert.equal(unsupported.statusCode, 400, `${provider || "(empty)"} is refused`);
      assert.equal(fetched, false);
    }

    const missing = mockRes();
    await handlePostJudgeModels({ body: { provider: "xai" } }, missing, { JOBBORED_LLM_CONFIG_PATH: join(dir, "empty.json") }, { fetchImpl });
    assert.equal(missing.statusCode, 400);
    assert.equal(fetched, false);
  });

  it("lists OpenRouter routes without a key and recommends the cheap default", async () => {
    const calls = [];
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "openrouter" } }, res, env, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: [
          { id: "x-ai/grok-4", name: "xAI: Grok 4" },
          { id: "openai/gpt-4o-mini", name: "OpenAI: GPT 4o Mini" },
          { id: "not-a-route", name: "No slash, no route" },
        ] }) };
      },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      models: [
        { id: "x-ai/grok-4", label: "xAI: Grok 4", created: 0 },
        { id: "openai/gpt-4o-mini", label: "OpenAI: GPT 4o Mini", created: 0 },
      ],
      recommended: "openai/gpt-4o-mini",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/models");
    assert.equal(calls[0].init.headers.Authorization, undefined);
  });

  it("lists OpenAI chat models with the key and recommends a mini grader", async () => {
    const calls = [];
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "openai", apiKey: "fictional-openai-key" } }, res, env, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: [
          { id: "gpt-4o", created: 200 },
          { id: "gpt-4o-mini", created: 100 },
          { id: "gpt-4o-realtime-preview", created: 300 },
          { id: "text-embedding-3-small", created: 400 },
          { id: "whisper-1", created: 500 },
        ] }) };
      },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      models: [
        { id: "gpt-4o", label: "gpt-4o", created: 200 },
        { id: "gpt-4o-mini", label: "gpt-4o-mini", created: 100 },
      ],
      recommended: "gpt-4o-mini",
    });
    assert.equal(calls[0].url, "https://api.openai.com/v1/models");
    assert.equal(calls[0].init.headers.Authorization, "Bearer " + "fictional-openai-key");
    assert.equal(JSON.stringify(res.body).includes("fictional-openai-key"), false);
  });

  it("lists Anthropic models with the versioned headers and recommends haiku", async () => {
    const calls = [];
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "anthropic", apiKey: "fictional-anthropic-key" } }, res, env, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: [
          { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5", created_at: "2025-09-01T00:00:00Z" },
          { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
        ] }) };
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.models[0].id, "claude-haiku-4-5");
    assert.equal(res.body.models[0].label, "Claude Haiku 4.5");
    assert.equal(res.body.recommended, "claude-haiku-4-5");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/models");
    assert.equal(calls[0].init.headers["x-api-key"], "fictional-anthropic-key");
    assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
    assert.equal(JSON.stringify(res.body).includes("fictional-anthropic-key"), false);
  });

  it("lists Gemini models with the key in a header, never the URL", async () => {
    const calls = [];
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "gemini", apiKey: "fictional-gemini-key" } }, res, env, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ models: [
          { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
        ] }) };
      },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.models, [{ id: "gemini-3-flash", label: "Gemini 3 Flash", created: 0 }]);
    assert.equal(res.body.recommended, "gemini-3-flash");
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(calls[0].init.headers["x-goog-api-key"], "fictional-gemini-key");
    assert.equal(String(calls[0].url).includes("fictional-gemini-key"), false);
  });

  it("lists local Ollama tags with no key and honors a base URL override", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ models: [{ name: "qwen3:8b" }, { name: "llama3.1" }] }) };
    };
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "local" } }, res, env, { fetchImpl });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.models, [
      { id: "qwen3:8b", label: "qwen3:8b", created: 0 },
      { id: "llama3.1", label: "llama3.1", created: 0 },
    ]);
    assert.equal(res.body.recommended, "qwen3:8b");
    assert.equal(calls[0].url, "http://127.0.0.1:11434/api/tags");

    const override = mockRes();
    await handlePostJudgeModels({ body: { provider: "local", baseUrl: "http://nas:11434/v1/" } }, override, env, { fetchImpl });
    assert.equal(override.statusCode, 200);
    assert.equal(calls[1].url, "http://nas:11434/api/tags");
  });

  it("falls back to the stored same-provider judge key and refuses a keyless keyed provider", async () => {
    const saved = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini", model: "gemini-3.8-flash", apiKey: "fictional-writer-key",
      judge: { provider: "openai", model: "gpt-4o-mini", apiKey: "fictional-stored-openai-key", baseUrl: "" },
    } }, saved, env);
    let authorization = "";
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "openai" } }, res, env, {
      fetchImpl: async (_url, init) => {
        authorization = init.headers.Authorization;
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-4o-mini", created: 1 }] }) };
      },
    });
    assert.equal(authorization, "Bearer fictional-stored-openai-key");
    assert.equal(res.body.recommended, "gpt-4o-mini");

    let fetched = false;
    const missing = mockRes();
    await handlePostJudgeModels({ body: { provider: "anthropic" } }, missing, env, {
      fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(fetched, false, "no stored Anthropic judge key, so nothing is fetched");
  });

  it("maps per-provider key and network failures to plain words", async () => {
    const badKey = mockRes();
    await handlePostJudgeModels({ body: { provider: "openai", apiKey: "fictional-rejected-key" } }, badKey, env, {
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "private provider detail" }) }),
    });
    assert.equal(badKey.statusCode, 401);
    assert.deepEqual(badKey.body, { error: "That key didn't work: check it on OpenAI." });

    const network = mockRes();
    await handlePostJudgeModels({ body: { provider: "gemini", apiKey: "fictional-network-key" } }, network, env, {
      fetchImpl: async () => { throw new Error("socket details must not escape"); },
    });
    assert.equal(network.statusCode, 502);
    assert.deepEqual(network.body, { error: "Couldn't reach Gemini: try again." });
  });
});
