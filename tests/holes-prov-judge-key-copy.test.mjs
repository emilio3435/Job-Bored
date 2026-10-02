/**
 * HOLES PROV · P12: when a provider refuses the key — 403, Gemini's 400
 * API_KEY_INVALID, OpenAI's insufficient_quota — the catalog says so instead
 * of "try again", which no retry can fix.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handlePostJudgeModels } from "../server/judge-models.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const answer = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

let dir;
let env;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-catalog-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("P12 · a refused key reads as a key problem, not as try again", () => {
  it("403 from the provider is a rejected key", async () => {
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "anthropic", apiKey: "fictional-key" } }, res, env, {
      fetchImpl: answer(403, { type: "error", error: { type: "permission_error", message: "private provider detail" } }),
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "That key didn't work: check it on Anthropic." });
  });

  it("Gemini's 400 API_KEY_INVALID is a rejected key", async () => {
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "gemini", apiKey: "fictional-key" } }, res, env, {
      fetchImpl: answer(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } }),
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "That key didn't work: check it on Gemini." });
  });

  it("OpenAI's insufficient_quota names billing, not try again", async () => {
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "openai", apiKey: "fictional-key" } }, res, env, {
      fetchImpl: answer(429, { error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } }),
    });
    assert.equal(res.statusCode, 402);
    assert.deepEqual(res.body, { error: "That key has no credit left: check billing on OpenAI." });
  });

  it("a provider outage is still worth a retry", async () => {
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "openai", apiKey: "fictional-key" } }, res, env, { fetchImpl: answer(503, {}) });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: "Couldn't load OpenAI models: try again." });
  });
});
