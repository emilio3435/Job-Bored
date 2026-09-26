/**
 * BEAUDIT lane Q, browser half of E9 and B17 (job-posting-insights.js).
 *
 * E9: the Gemini REST API answers in lowerCamelCase
 * (urlContextMetadata.urlMetadata[].urlRetrievalStatus). The browser URL
 * Context lane read only the snake_case spelling, so a camelCase "retrieval
 * failed" answer looked like a success and the model's guess became the
 * posting text.
 * B17: the browser sent the Gemini key in the ?key= URL; it now travels in
 * the x-goog-api-key header.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jbTextJs = readFileSync(join(ROOT, "jb-text.js"), "utf8");
const insightsJs = readFileSync(join(ROOT, "job-posting-insights.js"), "utf8");
const CAMEL = JSON.parse(
  readFileSync(join(ROOT, "tests", "fixtures", "gemini-url-context-camelcase.json"), "utf8"),
);

/** @param {(url: string, init: any) => Promise<any>} fetchImpl */
function loadInsights(fetchImpl) {
  const ctx = {
    window: {
      CommandCenterResumeGenerate: {
        getResumeGenerationConfig: () => ({
          provider: "gemini",
          resumeGeminiApiKey: "AIza-browser-key",
          resumeGeminiModel: "gemini-3.5-flash",
        }),
      },
    },
    fetch: fetchImpl,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(jbTextJs, ctx, { filename: "jb-text.js" });
  vm.runInContext(insightsJs, ctx, { filename: "job-posting-insights.js" });
  return /** @type {any} */ (ctx.window).CommandCenterJobPostingInsights;
}

/** @param {unknown} body */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("E9 browser URL Context reads the REST lowerCamelCase casing", () => {
  it("a camelCase success returns the extract", async () => {
    const api = loadInsights(async () => okResponse(CAMEL));
    const out = await api.fetchViaGeminiUrlContext("https://jobs.example.com/roles/staff-backend");
    assert.ok(out, "camelCase success must not be dropped");
    assert.equal(out._scrapeSource, "gemini-url-context");
    assert.match(out.description, /Kafka pipelines/);
  });

  it("a camelCase retrieval failure returns null instead of the model's guess", async () => {
    const failed = structuredClone(CAMEL);
    failed.candidates[0].urlContextMetadata.urlMetadata[0].urlRetrievalStatus =
      "URL_RETRIEVAL_STATUS_ERROR";
    const api = loadInsights(async () => okResponse(failed));
    const out = await api.fetchViaGeminiUrlContext("https://jobs.example.com/roles/staff-backend");
    assert.equal(out, null);
  });

  it("the snake_case spelling still works", async () => {
    const snake = structuredClone(CAMEL);
    const c = snake.candidates[0];
    c.url_context_metadata = {
      url_metadata: [{ retrieved_url: "x", url_retrieval_status: "URL_RETRIEVAL_STATUS_ERROR" }],
    };
    delete c.urlContextMetadata;
    const api = loadInsights(async () => okResponse(snake));
    assert.equal(
      await api.fetchViaGeminiUrlContext("https://jobs.example.com/roles/staff-backend"),
      null,
    );
  });
});

describe("B17 browser Gemini calls send the key in a header", () => {
  it("the URL Context lane puts the key in x-goog-api-key, not the URL", async () => {
    /** @type {{ url: string, init: any }[]} */
    const calls = [];
    const api = loadInsights(async (url, init) => {
      calls.push({ url: String(url), init });
      return okResponse(CAMEL);
    });
    await api.fetchViaGeminiUrlContext("https://jobs.example.com/roles/staff-backend");
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].url, /[?&]key=/);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "AIza-browser-key");
  });
});
