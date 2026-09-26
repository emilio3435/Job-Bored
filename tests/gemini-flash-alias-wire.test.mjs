/**
 * The `gemini-flash` family alias must never reach the Google API literally
 * (Google 404s it). resume-generate.js owns the pinned concrete id and
 * exposes the resolver; the discovery drawer and posting-insights call sites
 * share it. These tests load the real files together and assert the wire URL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const resumeGenerateJs = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
const jbTextJs = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const insightsJs = readFileSync(join(repoRoot, "job-posting-insights.js"), "utf8");

const PINNED = "gemini-3.7-flash";

function loadDrawer(fetchImpl) {
  const calls = [];
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.push(String(url));
      return fetchImpl(String(url), init);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  vm.runInContext(drawerJs, ctx, { filename: "discovery-drawer.js" });
  return { drawer: ctx.window.JobBoredDiscovery.drawer, calls };
}

function loadInsights(fetchImpl) {
  const calls = [];
  const ctx = {
    window: {
      COMMAND_CENTER_CONFIG: {
        resumeProvider: "gemini",
        resumeGeminiApiKey: "test-key",
        resumeGeminiModel: "gemini-flash",
      },
    },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.push(String(url));
      return fetchImpl(String(url), init);
    },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(jbTextJs, ctx, { filename: "jb-text.js" });
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  vm.runInContext(insightsJs, ctx, { filename: "job-posting-insights.js" });
  return { insights: ctx.window.CommandCenterJobPostingInsights, calls };
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("gemini-flash alias — every call site sends a concrete id", () => {
  it("drawer suggestions resolve the alias before the wire call", async () => {
    const { drawer, calls } = loadDrawer(async () =>
      json(200, { candidates: [{ content: { parts: [{ text: "a suggestion" }] } }] }),
    );
    const text = await drawer.callDiscoveryAiGemini("sys", "user", "k", "gemini-flash", {});
    assert.equal(text, "a suggestion");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`models/${PINNED}:`), `got ${calls[0]}`);
  });

  it("posting-insights URL-context lane resolves the alias before the wire call", async () => {
    const extract = `Acme is hiring a Staff Backend Engineer to own payments services, Kafka pipelines, and PostgreSQL reliability. You will mentor engineers and ship production APIs.`;
    assert.ok(extract.length >= 80);
    const { insights, calls } = loadInsights(async () =>
      json(200, {
        candidates: [
          {
            content: { parts: [{ text: extract }] },
            urlContextMetadata: {
              urlMetadata: [{ urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }],
            },
          },
        ],
      }),
    );
    const result = await insights.fetchViaGeminiUrlContext("https://jobs.example.com/role");
    assert.equal(result && result._scrapeSource, "gemini-url-context");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`models/${PINNED}:`), `got ${calls[0]}`);
  });
});
