/**
 * HOLES PROV · P7 (server): OpenAI's reasoning models (gpt-5, o-series)
 * reject any temperature with a 400, so chat() sends them none.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chat } from "../server/ai/provider.mjs";
const OK = { choices: [{ finish_reason: "stop", message: { content: "{\"grade\":3}" } }] };

function capture(payload = OK) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => payload };
  };
  return { calls, fetchImpl };
}

describe("P7 · OpenAI reasoning models get no temperature", () => {
  for (const model of ["gpt-5.4-mini", "gpt-5.6-terra", "o3-mini", "o4-mini", "o1"]) {
    it(`omits temperature for ${model}`, async () => {
      const { calls, fetchImpl } = capture();
      await chat({ pin: { provider: "openai", model, apiKey: "fictional-key" }, messages: [{ role: "user", content: "hi" }], temperature: 0.2, fetchImpl });
      assert.equal("temperature" in calls[0].body, false, `${model} rejects temperature`);
      assert.ok("max_completion_tokens" in calls[0].body);
    });
  }

  for (const provider of ["openrouter", "openai_compatible"]) {
    for (const model of ["openai/gpt-5.4-mini", "o3-mini"]) {
      it(`omits temperature for ${model} through ${provider}`, async () => {
        const { calls, fetchImpl } = capture();
        await chat({ pin: { provider, model, apiKey: "fictional-key", baseUrl: provider === "openai_compatible" ? "http://127.0.0.1:11434/v1" : "" }, messages: [{ role: "user", content: "hi" }], temperature: 0.2, fetchImpl });
        assert.equal("temperature" in calls[0].body, false);
      });
    }
  }

  it("keeps temperature for ordinary chat models through OpenAI and OpenRouter", async () => {
    const openai = capture();
    await chat({ pin: { provider: "openai", model: "gpt-4o-mini", apiKey: "fictional-key" }, messages: [{ role: "user", content: "hi" }], temperature: 0.2, fetchImpl: openai.fetchImpl });
    assert.equal(openai.calls[0].body.temperature, 0.2);
    const router = capture();
    await chat({ pin: { provider: "openrouter", model: "openai/gpt-4o-mini", apiKey: "fictional-key" }, messages: [{ role: "user", content: "hi" }], temperature: 0.2, fetchImpl: router.fetchImpl });
    assert.equal(router.calls[0].body.temperature, 0.2);
  });
});
