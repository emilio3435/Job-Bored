/**
 * HOLES PROV · P4/S5: the grading-model catalog (POST
 * /api/llm-config/judge-models) answers at its deadline when a provider's
 * model list hangs, instead of leaving Settings spinning.
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

let dir;
let env;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-catalog-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("P4/S5 · the catalog fetch times out", () => {
  it("aborts a provider list that never answers and says it timed out", async () => {
    const seen = [];
    const fetchImpl = (url, init) => new Promise((_resolve, reject) => {
      seen.push(init && init.signal);
      const hung = setTimeout(() => reject(new Error("hung: the request carried no deadline")), 1_000);
      if (init && init.signal) {
        init.signal.addEventListener("abort", () => {
          clearTimeout(hung);
          reject(init.signal.reason);
        }, { once: true });
      }
    });
    const res = mockRes();
    const started = Date.now();
    await handlePostJudgeModels({ body: { provider: "openai", apiKey: "fictional-key" } }, res, env, { fetchImpl, timeoutMs: 50 });
    assert.ok(seen[0], "the upstream request carries an abort signal");
    assert.equal(res.statusCode, 504);
    assert.deepEqual(res.body, { error: "OpenAI didn't answer in time: try again." });
    assert.ok(Date.now() - started < 900, "the route answered at the deadline, not when the hang gave up");
  });

  it("keeps a partial list when a later page times out", async () => {
    let page = 0;
    const fetchImpl = (url, init) => {
      page += 1;
      if (page === 1) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          models: [{ name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", supportedGenerationMethods: ["generateContent"] }],
          nextPageToken: "pg-two",
        }) });
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    };
    const res = mockRes();
    await handlePostJudgeModels({ body: { provider: "gemini", apiKey: "fictional-key" } }, res, env, { fetchImpl, timeoutMs: 50 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.models.map((model) => model.id), ["gemini-3-flash"]);
  });
});
