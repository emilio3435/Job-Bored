/**
 * Tests for POST /api/llm-config/judge-test in server/llm-config.mjs.
 * Imports the handler directly so the suite does not boot Express.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  handleJudgeTest,
  handlePostLlmConfig,
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

function providerStub({ ok = true, status = 200, payload = null, onCall } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url: String(url), init, body: JSON.parse(init.body) };
    calls.push(call);
    if (typeof onCall === "function") onCall(call);
    return {
      ok,
      status,
      json: async () => payload !== null && payload !== undefined
        ? payload
        : { choices: [{ message: { content: '{"grade":3}' } }] },
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

describe("POST /api/llm-config/judge-test", () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-judge-test-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("J-BE1a: rejects free text and sends only a one-field grade schema with both 60-second limits", async () => {
    const timeouts = [];
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms) => {
      timeouts.push(ms);
      return originalTimeout.call(AbortSignal, ms);
    };
    try {
      const fetchImpl = providerStub({ payload: { choices: [{ message: { content: "ok" } }] } });
      const res = mockRes();
      await handleJudgeTest(
        { body: { provider: "openai_compatible", model: "grok-example", apiKey: "example-key", baseUrl: "https://api.x.ai/v1" } },
        res, env, { fetchImpl },
      );
      assert.equal(res.body.ok, false);
      assert.equal(res.body.structured, false);
      assert.equal(res.body.code, "judge_no_structured_output");
      assert.deepEqual(fetchImpl.calls[0].body.response_format.json_schema.schema.required, ["grade"]);
      assert.deepEqual(Object.keys(fetchImpl.calls[0].body.response_format.json_schema.schema.properties), ["grade"]);
      assert.ok(timeouts.filter((ms) => ms === 60_000).length >= 2, JSON.stringify(timeouts));
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });

  it("J-BE1b: accepts a schema-shaped grade and reports structured with elapsed milliseconds", async () => {
    const fetchImpl = providerStub({ payload: { choices: [{ message: { content: '{"grade":3}' } }] } });
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openai_compatible", model: "grok-example", apiKey: "example-key", baseUrl: "https://api.x.ai/v1" } },
      res, env, { fetchImpl },
    );
    assert.equal(res.body.ok, true);
    assert.equal(res.body.structured, true);
    assert.ok(Number.isFinite(res.body.ms) && res.body.ms >= 0);
  });

  it("400s a malformed body and never calls the provider", async () => {
    for (const body of [
      null,
      { provider: "webhook", model: "m" },
      { provider: "openrouter" },
      { provider: "openrouter", model: "m", baseUrl: "ftp://x" },
    ]) {
      const fetchImpl = providerStub({});
      const res = mockRes();
      await handleJudgeTest({ body }, res, env, { fetchImpl });
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.code, "llm_invalid");
      assert.equal(fetchImpl.calls.length, 0);
    }
  });

  it("asks the candidate once and answers ok:true without writing anything", async () => {
    const fetchImpl = providerStub({});
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openrouter", model: "openai/gpt-5.4-mini", apiKey: "sk-or-test-key" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, "openrouter");
    assert.equal(res.body.model, "openai/gpt-5.4-mini");
    assert.equal(typeof res.body.ms, "number");
    assert.equal(JSON.stringify(res.body).includes("sk-or-test-key"), false);
    assert.equal(existsSync(join(dir, "llm.json")), false, "a test writes nothing");

    assert.equal(fetchImpl.calls.length, 1);
    const [call] = fetchImpl.calls;
    assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(call.body.model, "openai/gpt-5.4-mini");
    assert.equal(call.init.headers.authorization, "Bearer sk-or-test-key");
    assert.match(call.body.messages[0].content, /Grade this fictional sentence/);
  });

  it("answers ok:false with the cause on a 401, and never echoes the key", async () => {
    const fetchImpl = providerStub({
      ok: false,
      status: 401,
      payload: { error: { code: "invalid_api_key", message: "wrong key secret-inner" } },
    });
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openrouter", model: "m", apiKey: "sk-or-wrong-key" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.statusCode, 200, "the test ran; the key failed");
    assert.equal(res.body.ok, false);
    assert.equal(res.body.upstreamStatus, 401);
    assert.equal(res.body.retryable, false);
    assert.match(res.body.error, /401/);
    const serialized = JSON.stringify(res.body);
    assert.equal(serialized.includes("sk-or-wrong-key"), false);
    assert.equal(serialized.includes("secret-inner"), false, "no upstream body in the reply");
  });

  it("answers ok:false judge_unconfigured when a keyed provider gets no key", async () => {
    const fetchImpl = providerStub({});
    const res = mockRes();
    await handleJudgeTest({ body: { provider: "openai", model: "m" } }, res, env, { fetchImpl });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, "judge_unconfigured");
    assert.equal(fetchImpl.calls.length, 0);
  });

  it("falls back to the stored judge key on the same target", async () => {
    const saved = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini",
      model: "gemini-flash",
      apiKey: "writer-key",
      baseUrl: "",
      judge: { provider: "openai_compatible", model: "grok-example", apiKey: "judge-stored-key", baseUrl: "https://api.x.ai/v1" },
    } }, saved, env);
    assert.equal(saved.statusCode, 200);

    let seenAuth = "";
    const fetchImpl = providerStub({ onCall: (call) => { seenAuth = call.init.headers.authorization; } });
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openai_compatible", model: "grok-example", baseUrl: "https://api.x.ai/v1" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.body.ok, true);
    assert.equal(seenAuth, "Bearer judge-stored-key");
    assert.equal(JSON.stringify(res.body).includes("judge-stored-key"), false);
  });

  it("does not borrow the stored key for a different endpoint", async () => {
    const saved = mockRes();
    await handlePostLlmConfig({ body: {
      provider: "gemini",
      model: "gemini-flash",
      apiKey: "writer-key",
      baseUrl: "",
      judge: { provider: "openai_compatible", model: "grok-example", apiKey: "judge-stored-key", baseUrl: "https://api.x.ai/v1" },
    } }, saved, env);
    assert.equal(saved.statusCode, 200);

    const fetchImpl = providerStub({});
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openrouter", model: "m" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, "judge_unconfigured");
    assert.equal(fetchImpl.calls.length, 0);
  });

  it("tests a keyless local grader against its base URL", async () => {
    const fetchImpl = providerStub({});
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "local", model: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434/v1" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.body.ok, true);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  });

  it("calls Gemini on the wire model with the key in a header", async () => {
    const fetchImpl = providerStub({
      payload: { candidates: [{ content: { parts: [{ text: '{"grade":3}' }] } }] },
    });
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "gemini", model: "gemini-flash", apiKey: "AIza-test-key" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.body.ok, true);
    assert.equal(fetchImpl.calls.length, 1);
    const [call] = fetchImpl.calls;
    assert.match(call.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    assert.equal(call.url.includes("AIza-test-key"), false, "the key travels in a header, never the URL");
    assert.equal(call.init.headers["x-goog-api-key"], "AIza-test-key");
  });
});
