/**
 * BEAUDIT lane Q, repair round 2.
 *
 * 1. Every provider's outgoing request body carries the caller's sampling
 *    options (temperature). The Anthropic body dropped it, so worker
 *    extraction (0.1) and scoring (0.2) ran at the provider default.
 *
 * The posting-trim tests that lived here were removed when the orchestrator
 * descoped E18's posting trim; tests/ats-posting-intact.test.mjs pins the
 * base clip.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function okFor(provider) {
  const body =
    provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text: "ok" }] } }] }
      : provider === "anthropic"
        ? { content: [{ type: "text", text: "ok" }] }
        : { choices: [{ message: { content: "ok" } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** @param {Record<string, unknown>} body @param {string} provider */
function sentTemperature(body, provider) {
  if (provider === "gemini") return body.generationConfig?.temperature;
  return body.temperature;
}

const PINS = {
  gemini: { provider: "gemini", model: "gemini-test", apiKey: "k" },
  anthropic: { provider: "anthropic", model: "claude-test", apiKey: "k" },
  openai: { provider: "openai", model: "gpt-4o-mini", apiKey: "k" },
  openrouter: { provider: "openrouter", model: "x/y", apiKey: "k" },
  openai_compatible: {
    provider: "openai_compatible",
    model: "m",
    apiKey: "",
    baseUrl: "http://127.0.0.1:9/v1",
  },
};

describe("shared chat() request body preserves the caller's temperature", () => {
  for (const [provider, pin] of Object.entries(PINS)) {
    for (const temperature of [0, 0.2]) {
      it(`${provider} sends temperature ${temperature}`, async () => {
        const { chat } = await import("../server/ai/provider.mjs");
        const bodies = [];
        await chat({
          pin,
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: "hi" },
          ],
          temperature,
          maxTokens: 64,
          fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            return okFor(provider);
          },
        });
        assert.equal(bodies.length, 1);
        assert.equal(sentTemperature(bodies[0], provider), temperature);
      });
    }
  }
});

describe("worker callWorkerChatProvider preserves temperature on the wire", () => {
  const endpoints = {
    gemini: "http://127.0.0.1:9/v1beta/models/gemini-test:generateContent",
    anthropic: "http://127.0.0.1:9/v1/messages",
    openai: "http://127.0.0.1:9/v1/chat/completions",
    openrouter: "http://127.0.0.1:9/api/v1/chat/completions",
    openai_compatible: "http://127.0.0.1:9/v1/chat/completions",
  };
  for (const [provider, pin] of Object.entries(PINS)) {
    it(`${provider} extraction (0.1) and scoring (0.2) temperatures reach the body`, async () => {
      const worker = await import(
        "../integrations/browser-use-discovery/src/ai/chat-provider.ts"
      );
      for (const temperature of [0.1, 0.2]) {
        const bodies = [];
        await worker.callWorkerChatProvider({
          provider: {
            provider,
            model: pin.model,
            endpoint: endpoints[provider],
            apiKey: pin.apiKey,
          },
          messages: [{ role: "user", content: "x" }],
          temperature,
          fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            return okFor(provider);
          },
        });
        assert.equal(sentTemperature(bodies[0], provider), temperature);
      }
    });
  }
});
