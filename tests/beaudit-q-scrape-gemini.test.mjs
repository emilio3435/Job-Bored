/**
 * BEAUDIT lane Q: the scraper's Gemini URL-context lane (E9, E10) and
 * request cancellation for ATS and the Gemini lane (E11).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scrapeViaGeminiUrlContext } from "../server/shared/gemini-url-context-scrape.mjs";

const EXTRACT =
  "About the role: Acme is hiring a Staff Backend Engineer to own payments services, " +
  "Kafka pipelines and PostgreSQL reliability, mentor engineers and ship production APIs.";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A REST (lowerCamelCase) generateContent response, as the live API returns it. */
const CAMEL_CASE_RESPONSE = {
  candidates: [
    {
      content: { parts: [{ text: EXTRACT }], role: "model" },
      finishReason: "STOP",
      urlContextMetadata: {
        urlMetadata: [
          {
            retrievedUrl: "https://jobs.example.com/roles/staff-backend",
            urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
          },
        ],
      },
    },
  ],
};

let dir;
const saved = {};
const ENV_KEYS = ["JOBBORED_LLM_CONFIG_PATH", "GEMINI_API_KEY", "ATS_GEMINI_API_KEY", "ATS_GEMINI_MODEL"];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-q-scrape-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(dir, { recursive: true, force: true });
});

async function pin(p) {
  await writeFile(process.env.JOBBORED_LLM_CONFIG_PATH, JSON.stringify(p));
}

describe("E9 URL-context success check reads the REST lowerCamelCase fields", () => {
  it("accepts urlContextMetadata.urlMetadata[].urlRetrievalStatus", async () => {
    const hit = await scrapeViaGeminiUrlContext("https://jobs.example.com/roles/staff-backend", {
      geminiApiKey: "k",
      fetchImpl: async () => json(CAMEL_CASE_RESPONSE),
    });
    assert.ok(hit, "a successful camelCase response must not be discarded");
    assert.match(hit.description, /Kafka pipelines/);
  });
});

describe("E10 the Gemini lane follows the llm.json pin", () => {
  it("skips the lane (no Google call) when the pin is not Gemini, even with an env Gemini key", async () => {
    process.env.GEMINI_API_KEY = "env-gemini-key";
    await pin({ provider: "local", model: "gemma4:e2b", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1" });
    let called = 0;
    const hit = await scrapeViaGeminiUrlContext("https://jobs.example.com/roles/x", {
      fetchImpl: async () => {
        called += 1;
        return json(CAMEL_CASE_RESPONSE);
      },
    });
    assert.equal(hit, null);
    assert.equal(called, 0);
  });

  it("skips the lane when there is no pin, ignoring env keys", async () => {
    process.env.GEMINI_API_KEY = "env-gemini-key";
    let called = 0;
    const hit = await scrapeViaGeminiUrlContext("https://jobs.example.com/roles/x", {
      fetchImpl: async () => {
        called += 1;
        return json(CAMEL_CASE_RESPONSE);
      },
    });
    assert.equal(hit, null);
    assert.equal(called, 0);
  });

  it("uses the pin's key and model when the pin is Gemini", async () => {
    process.env.GEMINI_API_KEY = "env-gemini-key";
    process.env.ATS_GEMINI_MODEL = "gemini-env-model";
    await pin({ provider: "gemini", model: "gemini-pin-model", apiKey: "pin-key", baseUrl: "" });
    let call;
    const hit = await scrapeViaGeminiUrlContext("https://jobs.example.com/roles/x", {
      fetchImpl: async (url, init) => {
        call = { url: String(url), init };
        return json(CAMEL_CASE_RESPONSE);
      },
    });
    assert.ok(hit);
    assert.equal(call.init.headers["x-goog-api-key"], "pin-key");
    assert.match(call.url, /models\/gemini-pin-model:generateContent/);
  });
});

describe("E11 request cancellation reaches the provider calls", () => {
  it("the Gemini lane aborts its fetch when the caller's signal aborts", async () => {
    const controller = new AbortController();
    let seen;
    const pending = scrapeViaGeminiUrlContext("https://jobs.example.com/roles/x", {
      geminiApiKey: "k",
      signal: controller.signal,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          seen = init.signal;
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    setTimeout(() => controller.abort(), 20);
    const started = Date.now();
    assert.equal(await pending, null);
    assert.ok(Date.now() - started < 5000);
    assert.equal(seen.aborted, true);
  });

  it("analyzeAtsScorecard forwards the request signal to the provider fetch", async () => {
    await pin({ provider: "openai_compatible", model: "m", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" });
    const { analyzeAtsScorecard } = await import("../server/ats-scorecard.mjs");
    const controller = new AbortController();
    const original = globalThis.fetch;
    let seen;
    globalThis.fetch = (_url, init) =>
      new Promise((_, reject) => {
        seen = init.signal;
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    try {
      const pending = analyzeAtsScorecard(
        {
          feature: "cover_letter",
          docText: "Dear hiring manager, I build things for a living.",
          job: { title: "Engineer", company: "Acme" },
        },
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 20);
      const started = Date.now();
      await assert.rejects(pending);
      assert.ok(Date.now() - started < 5000, "must abort on the request signal, not the 30 s timeout");
      assert.equal(seen.aborted, true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("routeDeadlineSignal aborts on client disconnect and on the deadline", async () => {
    const { routeDeadlineSignal } = await import("../server/ai/provider.mjs");
    const { EventEmitter } = await import("node:events");
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.writableFinished = false;
    const s1 = routeDeadlineSignal(req, res, 60_000);
    assert.equal(s1.aborted, false);
    res.emit("close");
    assert.equal(s1.aborted, true);

    const s2 = routeDeadlineSignal(new EventEmitter(), Object.assign(new EventEmitter(), { writableFinished: false }), 20);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(s2.aborted, true);
  });
});
