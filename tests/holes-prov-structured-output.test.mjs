/**
 * HOLES PROV · P18: OpenRouter gets structured output when a schema is asked
 * for, and a keyless grading model reuses the writer's key — but only on the
 * same endpoint, so a key never follows a pin somewhere else.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { chat } from "../server/ai/provider.mjs";
import { handleJudgeTest, resolveActivePin, writeLlmConfig } from "../server/llm-config.mjs";
const OK = { choices: [{ finish_reason: "stop", message: { content: "{\"grade\":3}" } }] };

function capture(payload = OK) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => payload };
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

let dir;
let env;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-params-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("P18 · structured output on OpenRouter", () => {
  const SCHEMA = { type: "object", additionalProperties: false, required: ["grade"], properties: { grade: { type: "integer" } } };

  it("asks OpenRouter for a strict json_schema when a schema is given", async () => {
    const { calls, fetchImpl } = capture();
    await chat({ pin: { provider: "openrouter", model: "x-ai/grok-4", apiKey: "fictional-key" }, messages: [{ role: "user", content: "grade" }], schema: SCHEMA, schemaName: "grade_probe", fetchImpl });
    assert.deepEqual(calls[0].body.response_format, {
      type: "json_schema",
      json_schema: { name: "grade_probe", strict: true, schema: SCHEMA },
    });
  });

  it("leaves OpenRouter's response format alone for plain JSON mode", async () => {
    const { calls, fetchImpl } = capture();
    await chat({ pin: { provider: "openrouter", model: "x-ai/grok-4", apiKey: "fictional-key" }, messages: [{ role: "user", content: "grade" }], jsonMode: true, fetchImpl });
    assert.equal(calls[0].body.response_format, undefined);
  });
});

describe("P18 · a keyless grading model reuses the writer's key on the same endpoint", () => {
  for (const [provider, baseUrl, model] of [
    ["openai", "https://api.openai.com/v1", "gpt-5.4-mini"],
    ["openrouter", "https://openrouter.ai/api/v1", "openai/gpt-5.4-mini"],
  ]) {
    it(`${provider} Settings writer shares its key with the explicit default judge endpoint`, async () => {
      for (const [writerBase, judgeBase] of [["", baseUrl], [baseUrl + "/", ""]]) {
        const pin = await resolveActivePin({
          provider, model, apiKey: "fictional-writer-key", baseUrl: writerBase, updatedAt: "",
          judge: { provider, model, baseUrl: judgeBase },
        });
        assert.equal(pin.judge.apiKey, "fictional-writer-key");
      }
      const custom = await resolveActivePin({
        provider, model, apiKey: "fictional-writer-key", baseUrl: "", updatedAt: "",
        judge: { provider, model, baseUrl: "https://other.example/v1" },
      });
      assert.equal(custom.judge.apiKey, "", "a custom endpoint must not inherit the default endpoint's key");
    });

    it(`${provider} judge-test accepts the Settings pair with an explicit default base URL`, async () => {
      await writeLlmConfig({ provider, model, apiKey: "fictional-writer-key", baseUrl: "" }, env);
      const { calls, fetchImpl } = capture();
      const res = mockRes();
      await handleJudgeTest({ body: { provider, model, baseUrl } }, res, env, { fetchImpl });
      assert.equal(res.body.ok, true);
      assert.equal(calls[0].headers.authorization, "Bearer fictional-writer-key");
      assert.equal(JSON.stringify(res.body).includes("fictional-writer-key"), false);
    });
  }

  it("resolveActivePin hands the writer's key to a same-endpoint judge only", async () => {
    const same = await resolveActivePin({
      provider: "openai", model: "gpt-5.4", apiKey: "fictional-writer-key", baseUrl: "", updatedAt: "",
      judge: { provider: "openai", model: "gpt-5.4-mini", baseUrl: "" },
    });
    assert.equal(same.judge.apiKey, "fictional-writer-key");

    const otherProvider = await resolveActivePin({
      provider: "openai", model: "gpt-5.4", apiKey: "fictional-writer-key", baseUrl: "", updatedAt: "",
      judge: { provider: "anthropic", model: "claude-haiku-4-5", baseUrl: "" },
    });
    assert.equal(otherProvider.judge.apiKey, "", "a key never follows the judge to another provider");

    const otherEndpoint = await resolveActivePin({
      provider: "openai_compatible", model: "local-writer", apiKey: "fictional-local-key", baseUrl: "http://127.0.0.1:11434/v1", updatedAt: "",
      judge: { provider: "openai_compatible", model: "grok-4", baseUrl: "https://api.x.ai/v1" },
    });
    assert.equal(otherEndpoint.judge.apiKey, "", "a key never follows the judge to another endpoint");

    const ownKey = await resolveActivePin({
      provider: "openai", model: "gpt-5.4", apiKey: "fictional-writer-key", baseUrl: "", updatedAt: "",
      judge: { provider: "openai", model: "gpt-5.4-mini", apiKey: "fictional-judge-key", baseUrl: "" },
    });
    assert.equal(ownKey.judge.apiKey, "fictional-judge-key");
  });

  it("judge-test falls back to the saved writer key for a same-endpoint grader", async () => {
    await writeLlmConfig({ provider: "openai", model: "gpt-5.4", apiKey: "fictional-writer-key", baseUrl: "" }, env);
    const { calls, fetchImpl } = capture();
    const res = mockRes();
    await handleJudgeTest({ body: { provider: "openai", model: "gpt-5.4-mini" } }, res, env, { fetchImpl });
    assert.equal(res.body.ok, true);
    assert.equal(calls[0].headers.authorization, "Bearer fictional-writer-key");
    assert.equal(JSON.stringify(res.body).includes("fictional-writer-key"), false);
  });

  it("judge-test never sends the writer key to a different endpoint", async () => {
    await writeLlmConfig({ provider: "openai_compatible", model: "local-writer", apiKey: "fictional-local-key", baseUrl: "http://127.0.0.1:11434/v1" }, env);
    const { calls, fetchImpl } = capture();
    const res = mockRes();
    await handleJudgeTest({ body: { provider: "openai_compatible", model: "grok-4", baseUrl: "https://api.x.ai/v1" } }, res, env, { fetchImpl });
    assert.equal(calls.length ? calls[0].headers.authorization : undefined, undefined);
  });
});
