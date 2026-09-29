/** Live per-provider judge catalog probe — every provider verified, none typed. */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runProbe } from "../scripts/probe-judge-providers.mjs";

const XAI_ROWS = { data: [{ id: "grok-4.7", created: 7 }, { id: "grok-4.6", created: 6 }] };
const OPENROUTER_ROWS = { data: [{ id: "openai/gpt-4o-mini", name: "Mini" }] };
const TAGS_ROWS = { models: [{ name: "qwen3:8b" }] };

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes[String(url)] ?? { ok: false, status: 404, json: async () => ({}) };
    if (route instanceof Error) throw route;
    if (typeof route === "function") return route();
    return route;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload });

async function emptyConfig() {
  const dir = await mkdtemp(join(tmpdir(), "jb-probe-"));
  return { dir, configPath: join(dir, "llm.json") };
}

describe("probe:judge-providers", () => {
  it("passes live providers and skips whatever has no key", async () => {
    const { dir, configPath } = await emptyConfig();
    try {
      const fetchImpl = stubFetch({
        "https://api.x.ai/v1/models": okJson(XAI_ROWS),
        "https://openrouter.ai/api/v1/models": okJson(OPENROUTER_ROWS),
        "http://127.0.0.1:11434/api/tags": new TypeError("connect ECONNREFUSED"),
      });
      const rows = await runProbe({
        env: { XAI_API_KEY: "probe-xai-key", JOBBORED_LLM_CONFIG_PATH: configPath },
        fetchImpl,
        configPath,
      });
      const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row]));
      assert.equal(byProvider.xai.status, "PASS");
      assert.equal(byProvider.xai.models, 2);
      assert.equal(byProvider.xai.recommended, "grok-4.7");
      assert.equal(byProvider.openrouter.status, "PASS");
      assert.equal(byProvider.openai.status, "SKIP");
      assert.match(byProvider.openai.detail, /no key/i);
      assert.equal(byProvider.anthropic.status, "SKIP");
      assert.equal(byProvider.gemini.status, "SKIP");
      assert.equal(byProvider.local.status, "SKIP");
      assert.match(byProvider.local.detail, /nothing listening/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails a rejected key and an empty list", async () => {
    const { dir, configPath } = await emptyConfig();
    try {
      const fetchImpl = stubFetch({
        "https://api.openai.com/v1/models": { ok: false, status: 401, json: async () => ({}) },
        "https://generativelanguage.googleapis.com/v1beta/models": okJson({ models: [] }),
        "http://127.0.0.1:11434/api/tags": new TypeError("connect ECONNREFUSED"),
      });
      const rows = await runProbe({
        env: {
          OPENAI_API_KEY: "probe-rejected-key",
          GEMINI_API_KEY: "probe-gemini-key",
          JOBBORED_LLM_CONFIG_PATH: configPath,
        },
        fetchImpl,
        configPath,
      });
      const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row]));
      assert.equal(byProvider.openai.status, "FAIL");
      assert.match(byProvider.openai.detail, /didn't work/i);
      assert.equal(byProvider.gemini.status, "FAIL");
      assert.match(byProvider.gemini.detail, /empty list/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors an Ollama base URL override for the local tags check", async () => {
    const { dir, configPath } = await emptyConfig();
    try {
      const fetchImpl = stubFetch({ "http://nas:11434/api/tags": okJson(TAGS_ROWS) });
      const rows = await runProbe({
        env: { OLLAMA_BASE_URL: "http://nas:11434/v1", JOBBORED_LLM_CONFIG_PATH: configPath },
        fetchImpl,
        configPath,
      });
      const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row]));
      assert.equal(byProvider.local.status, "PASS");
      assert.equal(byProvider.local.models, 1);
      assert.equal(byProvider.local.recommended, "qwen3:8b");
      assert.ok(fetchImpl.calls.some((call) => call.url === "http://nas:11434/api/tags"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
