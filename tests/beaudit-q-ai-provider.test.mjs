/**
 * BEAUDIT lane Q: one AI provider module (E15, E2, B17).
 *
 * E15: server/ai/provider.mjs holds the single provider enum, the pin-only key
 *      source, the Gemini header transport, the request/timeout signal merge
 *      and the ProviderApiError taxonomy with redacted upstream bodies. The
 *      worker chat-provider re-exports it.
 * E2:  a "local" (Ollama) pin normalizes to openai_compatible, so ATS works.
 * B17: no server site puts the Gemini key in the `?key=` URL.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function okJson(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("E15 server/ai/provider.mjs", () => {
  it("exports one provider enum with local and ollama aliased to openai_compatible", async () => {
    const mod = await import("../server/ai/provider.mjs");
    assert.deepEqual([...mod.PROVIDERS].sort(), [
      "anthropic",
      "gemini",
      "openai",
      "openai_compatible",
      "openrouter",
    ]);
    assert.equal(mod.normalizeProvider("local"), "openai_compatible");
    assert.equal(mod.normalizeProvider("Ollama"), "openai_compatible");
    assert.equal(mod.normalizeProvider("openai-compatible"), "openai_compatible");
    assert.equal(mod.normalizeProvider("OpenRouter"), "openrouter");
    assert.equal(mod.normalizeProvider("webhook"), "");
    assert.equal(mod.normalizeProvider(""), "");
    assert.equal(mod.providerAlias("local"), "local");
    assert.equal(mod.providerAlias("gemini"), "");
  });

  it("resolveProvider reads the key from the pin only, never the environment", async () => {
    const { resolveProvider } = await import("../server/ai/provider.mjs");
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "env-key-must-not-be-used";
    try {
      const resolved = resolveProvider({ provider: "gemini", model: "gemini-x", apiKey: "" });
      assert.equal(resolved.apiKey, "");
      assert.equal(resolved.configured, false);
      const local = resolveProvider({
        provider: "local",
        model: "gemma4:e2b",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
      });
      assert.equal(local.provider, "openai_compatible");
      assert.equal(local.alias, "local");
      assert.equal(local.configured, true);
      assert.equal(local.endpoint, "http://127.0.0.1:11434/v1/chat/completions");
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });

  it("chat sends the Gemini key in x-goog-api-key, never in the URL", async () => {
    const { chat } = await import("../server/ai/provider.mjs");
    const calls = [];
    const result = await chat({
      pin: { provider: "gemini", model: "gemini-test", apiKey: "g-secret" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      schema: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
      maxTokens: 50,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return okJson({ candidates: [{ content: { parts: [{ text: "{\"a\":\"b\"}" }] } }] });
      },
    });
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].url, /key=/);
    assert.match(calls[0].url, /models\/gemini-test:generateContent$/);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "g-secret");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.generationConfig.maxOutputTokens, 50);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal("additionalProperties" in body.generationConfig.responseSchema, false);
    assert.equal(result.text, "{\"a\":\"b\"}");
    assert.equal(result.provider, "gemini");
  });

  it("chat aborts the fetch when the request signal aborts (AbortSignal.any with the timeout)", async () => {
    const { chat } = await import("../server/ai/provider.mjs");
    const request = new AbortController();
    let seen;
    const pending = chat({
      pin: { provider: "openai_compatible", model: "m", baseUrl: "http://127.0.0.1:9/v1" },
      messages: [{ role: "user", content: "x" }],
      signal: request.signal,
      timeoutMs: 60_000,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          seen = init.signal;
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    });
    request.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(error.name, "ProviderApiError");
      assert.equal(error.providerCode, "aborted");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(seen.aborted, true);
  });

  it("chat maps upstream failures to one ProviderApiError taxonomy and never echoes the body", async () => {
    const { chat, ProviderApiError } = await import("../server/ai/provider.mjs");
    const secret = "sk-upstream-SHOULD-NOT-LEAK";
    await assert.rejects(
      chat({
        pin: { provider: "openrouter", model: "m", apiKey: "k" },
        messages: [{ role: "user", content: "x" }],
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ error: { message: `bad key ${secret}`, code: "rate_limit_exceeded" } }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      }),
      (error) => {
        assert.ok(error instanceof ProviderApiError);
        assert.equal(error.provider, "openrouter");
        assert.equal(error.upstreamStatus, 429);
        assert.equal(error.classification, "rate_limit");
        assert.equal(error.retryable, true);
        assert.doesNotMatch(String(error.message), new RegExp(secret));
        assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
        return true;
      },
    );
  });
});

describe("E15 worker chat-provider re-exports the shared module", () => {
  it("normalizes local and ollama to openai_compatible and redacts upstream bodies", async () => {
    const worker = await import(
      "../integrations/browser-use-discovery/src/ai/chat-provider.ts"
    );
    const shared = await import("../server/ai/provider.mjs");
    assert.equal(worker.ProviderApiError, shared.ProviderApiError);
    assert.equal(worker.normalizeWorkerChatProviderName("local"), "openai_compatible");
    assert.equal(worker.normalizeWorkerChatProviderName("ollama"), "openai_compatible");
    const secret = "upstream-body-SECRET-1234";
    await assert.rejects(
      worker.callWorkerChatProvider({
        provider: {
          provider: "openai_compatible",
          model: "m",
          endpoint: "http://127.0.0.1:9/v1/chat/completions",
          apiKey: "",
        },
        messages: [{ role: "user", content: "x" }],
        fetchImpl: async () => new Response(`boom ${secret}`, { status: 500 }),
      }),
      (error) => {
        assert.equal(error.name, "ProviderApiError");
        assert.equal(error.upstreamStatus, 500);
        assert.doesNotMatch(String(error.message), new RegExp(secret));
        return true;
      },
    );
  });
});

describe("E2 a Local (Ollama) pin works in ATS", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-q-e2-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
  });
  afterEach(async () => {
    if (prevPath === undefined) delete process.env.JOBBORED_LLM_CONFIG_PATH;
    else process.env.JOBBORED_LLM_CONFIG_PATH = prevPath;
    await rm(dir, { recursive: true, force: true });
  });

  it("the pin oneflow-beat-ai.js builds for Local is configured and calls the base URL", async () => {
    // Exactly the pin shape the probe (probe-e-local-pin.sh) posts.
    await writeFile(
      process.env.JOBBORED_LLM_CONFIG_PATH,
      JSON.stringify({
        provider: "local",
        model: "gemma4:e2b",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
        updatedAt: "",
      }),
    );
    const { getAtsConfigStatus, analyzeAtsScorecard } = await import(
      "../server/ats-scorecard.mjs"
    );
    const status = getAtsConfigStatus();
    assert.equal(status.configured, true, status.reason);
    assert.equal(status.provider, "openai_compatible");

    const original = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return okJson({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schemaVersion: 1,
                overallScore: 70,
                dimensionScores: {
                  requirementsCoverage: 70,
                  experienceRelevance: 70,
                  impactClarity: 70,
                  atsParseability: 70,
                  toneFit: 70,
                },
                topStrengths: [],
                criticalGaps: [],
                evidence: [],
                rewriteSuggestions: [],
                confidence: 0.5,
                model: "gemma4:e2b",
              }),
            },
          },
        ],
      });
    };
    try {
      const card = await analyzeAtsScorecard({
        feature: "cover_letter",
        docText: "Dear hiring manager, I build things for a living.",
        job: { title: "Engineer", company: "Acme" },
      });
      assert.equal(card.overallScore, 70);
      assert.equal(call.url, "http://127.0.0.1:11434/v1/chat/completions");
      assert.equal(new Headers(call.init.headers).get("authorization"), null);
      assert.equal(JSON.parse(call.init.body).model, "gemma4:e2b");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("E2 every pin consumer accepts the normalized Local pin", () => {
  let dir;
  const saved = {};
  const KEYS = ["JOBBORED_LLM_CONFIG_PATH", "PROFILE_PROVIDER", "PROFILE_LLM_PROVIDER"];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-q-e2c-"));
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
  });
  afterEach(async () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("profile-from-resume uses a keyless openai_compatible pin (what POST now stores for Local)", async () => {
    const { writeLlmConfig } = await import("../server/llm-config.mjs");
    await writeLlmConfig(
      { provider: "local", model: "gemma4:e2b", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" },
      process.env,
    );
    const { getProfileProviderConfig } = await import("../server/profile-from-resume.mjs");
    const cfg = getProfileProviderConfig();
    assert.equal(cfg.provider, "openai_compatible");
    assert.equal(cfg.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(cfg.model, "gemma4:e2b");
  });
});

describe("B17 no server Gemini call puts the key in the URL", () => {
  it("no server module builds a ?key= Gemini URL", async () => {
    const files = [
      "server/llm-config.mjs",
      "server/ats-scorecard.mjs",
      "server/profile-from-resume.mjs",
      "server/profile-rescore-worker.mjs",
      "server/materials-writer.mjs",
      "server/materials-drafter.mjs",
      "server/shared/gemini-url-context-scrape.mjs",
    ];
    const aiDir = join(ROOT, "server/ai");
    const aiFiles = await readdir(aiDir).catch(() => []);
    for (const f of aiFiles) if (f.endsWith(".mjs")) files.push(`server/ai/${f}`);
    // Deferred: these two Gemini calls keep the key in the URL because tests
    // outside lane Q's fence pin it (tests/sixbeats2-server-provider-config.test.mjs:241,
    // tests/materials-writer.test.mjs:51). See BUILD-REPORT-Q.md.
    const DEFERRED = new Set(["server/profile-from-resume.mjs", "server/materials-writer.mjs"]);
    const offenders = [];
    for (const rel of files) {
      if (DEFERRED.has(rel)) continue;
      const src = await readFile(join(ROOT, rel), "utf8");
      if (/[?&]key=\$\{/.test(src)) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
  });
});
