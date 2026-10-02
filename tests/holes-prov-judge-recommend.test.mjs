/**
 * HOLES PROV · P16: the recommended grader comes from the list itself — the
 * same whatever order the provider returns it in, with no stale hard-coded id.
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

describe("P16 · the recommendation comes from the list, not its order", () => {
  const routes = [
    { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o mini", created: 1_721_260_800 },
    { id: "anthropic/claude-opus-4-8", name: "Anthropic: Claude Opus 4.8", created: 1_780_000_000 },
    { id: "openai/gpt-5.4-mini", name: "OpenAI: GPT-5.4 mini", created: 1_775_000_000 },
    { id: "openai/gpt-oss-20b:free", name: "OpenAI: gpt-oss-20b (free)", created: 1_754_000_000 },
    { id: "openai/gpt-5.4", name: "OpenAI: GPT-5.4", created: 1_775_000_001 },
  ];

  it("OpenRouter recommends the newest OpenAI mini route whatever the order", async () => {
    for (const order of [routes, [...routes].reverse(), [routes[2], routes[0], routes[4], routes[1], routes[3]]]) {
      const res = mockRes();
      await handlePostJudgeModels({ body: { provider: "openrouter" } }, res, env, { fetchImpl: answer(200, { data: order }) });
      assert.equal(res.body.recommended, "openai/gpt-5.4-mini");
    }
  });

  it("OpenRouter falls back to the newest route, not the first one listed", async () => {
    const rows = [
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3", created: 1_733_000_000 },
      { id: "x-ai/grok-4", name: "Grok 4", created: 1_752_000_000 },
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const res = mockRes();
      await handlePostJudgeModels({ body: { provider: "openrouter" } }, res, env, { fetchImpl: answer(200, { data: order }) });
      assert.equal(res.body.recommended, "x-ai/grok-4");
    }
  });

  it("Gemini recommends the newest stable Flash, not the first flash listed", async () => {
    const models = [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.0-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash-preview-09-2026", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-pro-latest", supportedGenerationMethods: ["generateContent"] },
    ];
    for (const order of [models, [...models].reverse()]) {
      const res = mockRes();
      await handlePostJudgeModels({ body: { provider: "gemini", apiKey: "fictional-key" } }, res, env, { fetchImpl: answer(200, { models: order }) });
      assert.equal(res.body.recommended, "gemini-3.8-flash");
    }
  });
});
