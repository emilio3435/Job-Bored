import assert from "node:assert/strict";
import test from "node:test";

import { callWorkerChatProvider } from "../../src/ai/chat-provider.ts";

// The worker's schemas (profile extraction, company scoring) are written for
// Gemini's responseSchema: optional properties and no additionalProperties.
// OpenAI strict json_schema and Anthropic output_config reject that shape with
// invalid_json_schema, so the worker keeps its pre-E15 response mode: the
// schema reaches Gemini only, and other providers get prompt-described JSON.
const LOOSE_SCHEMA = {
  type: "object",
  properties: {
    targetRoles: { type: "array", items: { type: "string" } },
    seniority: { type: "string" },
  },
  required: ["targetRoles"],
};

type Captured = { url: string; body: Record<string, unknown> };

function contractStub(captured: Captured[]) {
  return async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    captured.push({ url: String(url), body });
    const rf = body.response_format as { json_schema?: { strict?: boolean; schema?: Record<string, unknown> } } | undefined;
    const oc = body.output_config as { format?: { schema?: Record<string, unknown> } } | undefined;
    const strictSchema = rf?.json_schema?.strict ? rf.json_schema.schema : oc?.format?.schema;
    if (strictSchema && strictSchema.additionalProperties !== false) {
      return new Response(
        JSON.stringify({ error: { code: "invalid_json_schema", message: "additionalProperties must be false" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const text = '{"targetRoles":["PM"]}';
    const payload = String(url).includes("anthropic")
      ? { content: [{ type: "text", text }] }
      : String(url).includes("generativelanguage")
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { choices: [{ message: { content: text } }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("worker OpenAI call with a Gemini-shaped schema sends no strict response_format", async () => {
  const captured: Captured[] = [];
  const result = await callWorkerChatProvider({
    provider: { provider: "openai", model: "gpt-4o-mini", endpoint: "http://127.0.0.1:1/v1/chat/completions", apiKey: "sk-test" },
    messages: [{ role: "user", content: "extract" }],
    responseSchema: LOOSE_SCHEMA,
    fetchImpl: contractStub(captured) as unknown as typeof fetch,
  });
  assert.equal(result.text, '{"targetRoles":["PM"]}');
  assert.equal(captured[0].body.response_format, undefined);
});

test("worker Anthropic call with a Gemini-shaped schema sends no output_config", async () => {
  const captured: Captured[] = [];
  const result = await callWorkerChatProvider({
    provider: { provider: "anthropic", model: "claude-test", endpoint: "http://127.0.0.1:1/anthropic/v1/messages", apiKey: "sk-test" },
    messages: [{ role: "user", content: "extract" }],
    responseSchema: LOOSE_SCHEMA,
    fetchImpl: contractStub(captured) as unknown as typeof fetch,
  });
  assert.equal(result.text, '{"targetRoles":["PM"]}');
  assert.equal(captured[0].body.output_config, undefined);
});

test("worker Gemini call still sends the schema as responseSchema", async () => {
  const captured: Captured[] = [];
  await callWorkerChatProvider({
    provider: { provider: "gemini", model: "gemini-test", endpoint: "http://127.0.0.1:1/generativelanguage/v1beta/models/gemini-test:generateContent", apiKey: "k" },
    messages: [{ role: "user", content: "extract" }],
    responseSchema: LOOSE_SCHEMA,
    fetchImpl: contractStub(captured) as unknown as typeof fetch,
  });
  const gc = captured[0].body.generationConfig as Record<string, unknown>;
  assert.equal(gc.responseMimeType, "application/json");
  assert.ok(gc.responseSchema);
});
