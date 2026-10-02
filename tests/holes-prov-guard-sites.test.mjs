/**
 * HOLES PROV · S1, P11, S12: the guard is applied at every provider and
 * catalog fetch — chat(), the judge test, the judge catalog and the profile
 * drafter — so a hosted server never calls an internal address, while a
 * loopback server keeps reaching a local model.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { chat } from "../server/ai/provider.mjs";
import { handleJudgeTest } from "../server/llm-config.mjs";
import { handlePostJudgeModels } from "../server/judge-models.mjs";
import { analyzeResumeToProfile } from "../server/profile-from-resume.mjs";

const PROVIDER_URL_BLOCKED = "provider_url_blocked";

/** Records every call; answers 200 with an empty object. */
function recordingFetch(answer = () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  };
  return { calls, fetchImpl };
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/** A hosted listener for one test: chat() and the routes read process.env. */
function withListenHost(value) {
  const before = process.env.LISTEN_HOST;
  if (value === undefined) delete process.env.LISTEN_HOST;
  else process.env.LISTEN_HOST = value;
  return () => {
    if (before === undefined) delete process.env.LISTEN_HOST;
    else process.env.LISTEN_HOST = before;
  };
}

describe("every provider and catalog fetch is guarded", () => {
  let restore = () => {};
  let dir;
  let env;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-guard-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });
  afterEach(async () => {
    restore();
    restore = () => {};
    await rm(dir, { recursive: true, force: true });
  });

  it("S1 · chat() refuses a hosted call to cloud metadata as a config error", async () => {
    restore = withListenHost("0.0.0.0");
    const { calls, fetchImpl } = recordingFetch();
    await assert.rejects(
      () => chat({
        pin: { provider: "openai_compatible", model: "fictional-model", baseUrl: "http://169.254.169.254/v1" },
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
      }),
      (error) => {
        assert.equal(error.name, "ProviderApiError");
        assert.equal(error.providerCode, PROVIDER_URL_BLOCKED);
        assert.equal(error.classification, "config");
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  it("S1 · chat() on a loopback server still reaches a local model", async () => {
    restore = withListenHost(undefined);
    const { calls, fetchImpl } = recordingFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }),
    }));
    const out = await chat({
      pin: { provider: "local", model: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434/v1" },
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    });
    assert.equal(out.text, "ok");
    assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  });

  it("P11 · judge-test on a hosted server refuses a private base URL without calling it", async () => {
    restore = withListenHost("0.0.0.0");
    const { calls, fetchImpl } = recordingFetch();
    const res = mockRes();
    await handleJudgeTest(
      { body: { provider: "openai_compatible", model: "fictional-grader", baseUrl: "http://10.0.0.8:11434/v1", apiKey: "fictional-key" } },
      res,
      env,
      { fetchImpl },
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, PROVIDER_URL_BLOCKED);
    assert.equal(res.body.retryable, false);
    assert.equal(JSON.stringify(res.body).includes("fictional-key"), false);
    assert.equal(calls.length, 0);
  });

  it("P11 · judge-models on a hosted server refuses a loopback Ollama address with a 400", async () => {
    restore = withListenHost("0.0.0.0");
    const { calls, fetchImpl } = recordingFetch();
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "local", baseUrl: "http://127.0.0.1:11434" } }, res, env, { fetchImpl });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /hosted/i);
    assert.equal(calls.length, 0);
  });

  it("P11 · judge-models on a loopback server still lists a loopback Ollama", async () => {
    restore = withListenHost(undefined);
    const { calls, fetchImpl } = recordingFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "qwen3:8b" }] }),
    }));
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "local", baseUrl: "http://127.0.0.1:11434" } }, res, env, { fetchImpl });
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].url, "http://127.0.0.1:11434/api/tags");
  });

  for (const provider of ["openai_compatible", "anthropic"]) {
    it(`S1 · the profile drafter refuses a hosted ${provider} call to cloud metadata`, async () => {
      restore = withListenHost("0.0.0.0");
      const realFetch = globalThis.fetch;
      const calls = [];
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({}) };
      };
      try {
        await assert.rejects(
          () => analyzeResumeToProfile("Senior product manager at Contoso. Shipped two products.", {
            config: { provider, apiKey: "fictional-key", model: "fictional-model", baseUrl: "http://169.254.169.254/v1", origin: "request" },
          }),
          (error) => {
            assert.equal(error.code, "profile_provider_not_configured");
            assert.match(error.message, /hosted/i);
            assert.equal(String(error.message).includes("fictional-key"), false);
            return true;
          },
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.deepEqual(calls, [], "the metadata address is never fetched");
    });
  }
});
