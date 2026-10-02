/**
 * HOLES PROV · P17 (browser): a provider that never answers used to leave
 * the page waiting forever. Every browser provider fetch now carries a
 * deadline (cloud providers and the webhook 180 s, the local model server
 * 300 s, the model catalog 15 s), and a timeout reads as plain words. A
 * caller's own abort still propagates as an abort.
 *
 * The vm context gets a fake AbortSignal whose timeout(ms) records ms and
 * returns a signal the test fires by hand, so no test waits on a clock. The
 * fetch stub never answers: it rejects with the signal's reason once that
 * signal aborts, and rejects at once when it gets no signal at all.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const outputBudgetJs = read("llm-output-budget.js");
const resumeGenerateJs = read("resume-generate.js");
const modelCatalogJs = read("model-catalog.js");

const BUNDLE = { feature: "resume", profile: { name: "Sample" }, job: { title: "SRE" } };
const CLOUD_MS = 180_000;
const LOCAL_MS = 300_000;
const CATALOG_MS = 15_000;

/** A network that never answers, plus deadlines the test fires by hand. */
function hangingNetwork() {
  const timeouts = [];
  const callers = [];
  const calls = [];
  const FakeAbortSignal = {
    timeout(ms) {
      const controller = new AbortController();
      timeouts.push({
        ms,
        fire: () => controller.abort(new DOMException("timed out", "TimeoutError")),
      });
      return controller.signal;
    },
    any: (signals) => AbortSignal.any(signals),
  };
  const fetch = (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { signal } = init;
    if (!signal) {
      return Promise.reject(new Error("fetch stub: no signal, so this request could hang forever"));
    }
    return new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  return {
    AbortSignal: FakeAbortSignal,
    fetch,
    timeouts,
    calls,
    /** A caller-owned controller that release() also aborts. */
    caller() {
      const controller = new AbortController();
      callers.push(controller);
      return controller;
    },
    /** Settle every pending request so nothing outlives its test. */
    release() {
      for (const t of timeouts) t.fire();
      for (const c of callers) c.abort();
    },
  };
}

function loadResumeGenerate(net, config) {
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    console: { log() {}, warn() {}, error() {} },
    fetch: net.fetch,
  };
  if (net.AbortSignal) ctx.AbortSignal = net.AbortSignal;
  vm.createContext(ctx);
  vm.runInContext(outputBudgetJs, ctx, { filename: "llm-output-budget.js" });
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return ctx.window.CommandCenterResumeGenerate;
}

function loadCatalog(net) {
  const store = new Map();
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: net.fetch,
    AbortSignal: net.AbortSignal,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
  return ctx.window.JobBoredModelCatalog;
}

const settled = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Start one call and check its deadline before anything waits on it, so
 * the unfixed code fails these asserts at once instead of hanging. Then
 * fire the deadline and return how the call settled.
 */
async function expireDeadline(net, start, ms) {
  const outcome = settled(start());
  try {
    await tick();
    assert.equal(net.calls.length, 1, "the provider was called once");
    assert.ok(net.calls[0].init.signal, "the provider fetch carries a signal");
    assert.deepEqual(net.timeouts.map((t) => t.ms), [ms], `one ${ms} ms deadline is registered`);
    net.timeouts[0].fire();
    return await outcome;
  } finally {
    net.release();
    await outcome;
  }
}

const CLOUD = [
  ["gemini", "Gemini", { resumeGeminiApiKey: "fictional-key" }],
  ["openai", "OpenAI", { resumeOpenAIApiKey: "fictional-key" }],
  ["anthropic", "Anthropic", { resumeAnthropicApiKey: "fictional-key" }],
  ["openrouter", "OpenRouter", { resumeOpenRouterApiKey: "fictional-key" }],
];
const LOCAL_TIMEOUT = /^The local model server at http:\/\/127\.0\.0\.1:11434\/v1 didn't answer within 300 seconds\./;

describe("HOLES PROV P17 · drafting (generateFromBundle) has a deadline", () => {
  for (const [provider, label, keys] of CLOUD) {
    it(`${provider} gives up after 180 seconds and says so`, async () => {
      const net = hangingNetwork();
      const rg = loadResumeGenerate(net, { resumeProvider: provider, ...keys });
      const { error } = await expireDeadline(net, () => rg.generateFromBundle(BUNDLE), CLOUD_MS);
      assert.ok(error, "the timed-out draft rejects");
      assert.equal(
        error.message,
        `${label} didn't answer within 180 seconds. Try again, or pick a faster model.`,
      );
    });
  }

  it("the local model server gets 300 seconds", async () => {
    const net = hangingNetwork();
    const rg = loadResumeGenerate(net, { resumeProvider: "local" });
    const { error } = await expireDeadline(net, () => rg.generateFromBundle(BUNDLE), LOCAL_MS);
    assert.ok(error);
    assert.match(error.message, LOCAL_TIMEOUT);
  });

  it("the webhook gets 180 seconds", async () => {
    const net = hangingNetwork();
    const rg = loadResumeGenerate(net, {
      resumeProvider: "webhook",
      resumeGenerationWebhookUrl: "https://hooks.example/fictional-draft",
    });
    const { error } = await expireDeadline(net, () => rg.generateFromBundle(BUNDLE), CLOUD_MS);
    assert.ok(error);
    assert.match(error.message, /^Your webhook didn't answer within 180 seconds\./);
  });
});

describe("HOLES PROV P17 · inline AI (callConfiguredAi) keeps the caller's signal and adds a deadline", () => {
  for (const [provider, label, keys] of CLOUD) {
    it(`${provider}: the deadline fires through a caller's signal`, async () => {
      const net = hangingNetwork();
      const rg = loadResumeGenerate(net, { resumeProvider: provider, ...keys });
      const caller = net.caller();
      const { error } = await expireDeadline(
        net,
        () => rg.callConfiguredAi("sys", "user", { signal: caller.signal }),
        CLOUD_MS,
      );
      assert.notEqual(net.calls[0].init.signal, caller.signal, "the fetch signal also carries the deadline");
      assert.ok(error);
      assert.equal(
        error.message,
        `${label} didn't answer within 180 seconds. Try again, or pick a faster model.`,
      );
    });

    it(`${provider}: the caller's own abort still rejects as an abort`, async () => {
      const net = hangingNetwork();
      const rg = loadResumeGenerate(net, { resumeProvider: provider, ...keys });
      const caller = net.caller();
      const outcome = settled(rg.callConfiguredAi("sys", "user", { signal: caller.signal }));
      try {
        await tick();
        assert.deepEqual(net.timeouts.map((t) => t.ms), [CLOUD_MS], "a deadline is registered");
        assert.notEqual(net.calls[0].init.signal, caller.signal, "the fetch signal merges both");
        caller.abort();
        const { error } = await outcome;
        assert.ok(error, "the aborted call rejects");
        assert.match(`${error.name} ${error.message}`, /abort/i);
        assert.doesNotMatch(error.message, /didn't answer within/);
      } finally {
        net.release();
        await outcome;
      }
    });
  }

  it("local: the deadline is 300 seconds", async () => {
    const net = hangingNetwork();
    const rg = loadResumeGenerate(net, { resumeProvider: "local" });
    const caller = net.caller();
    const { error } = await expireDeadline(
      net,
      () => rg.callConfiguredAi("sys", "user", { signal: caller.signal }),
      LOCAL_MS,
    );
    assert.ok(error);
    assert.match(error.message, LOCAL_TIMEOUT);
  });
});

describe("HOLES PROV P17 · model catalog requests have a 15-second deadline", () => {
  it("fetchProviderModels falls back to the static list and names the timeout", async () => {
    const net = hangingNetwork();
    const catalog = loadCatalog(net);
    const { value } = await expireDeadline(
      net,
      () => catalog.fetchProviderModels({ provider: "openai", apiKey: "fictional-key" }),
      CATALOG_MS,
    );
    assert.deepEqual(Object.keys(value).sort(), ["error", "models", "source"]);
    assert.equal(value.source, "static");
    assert.ok(Array.isArray(value.models) && value.models.length > 0, "the static list is served");
    assert.match(value.error, /15 seconds/);
  });

  it("pingProvider reports the timeout in plain words", async () => {
    const net = hangingNetwork();
    const catalog = loadCatalog(net);
    const { value } = await expireDeadline(
      net,
      () => catalog.pingProvider({ provider: "anthropic", apiKey: "fictional-key" }),
      CATALOG_MS,
    );
    assert.deepEqual(Object.keys(value).sort(), ["message", "ok", "status"]);
    assert.equal(value.ok, false);
    assert.equal(value.status, 0);
    assert.equal(value.message, "No answer from anthropic within 15 seconds. Check the connection, then try again.");
  });

  it("pingProvider names the URL for the local server", async () => {
    const net = hangingNetwork();
    const catalog = loadCatalog(net);
    const { value } = await expireDeadline(
      net,
      () => catalog.pingProvider({ provider: "local", baseUrl: "http://127.0.0.1:11434/v1" }),
      CATALOG_MS,
    );
    assert.equal(value.ok, false);
    assert.equal(value.status, 0);
    assert.match(value.message, /http:\/\/127\.0\.0\.1:11434\/v1\/models/);
    assert.match(value.message, /15 seconds/);
  });
});

describe("HOLES PROV P17 · pages without AbortSignal.timeout or AbortSignal.any", () => {
  /** A network that answers at once, recording each request's signal. */
  function answeringNetwork(AbortSignalImpl) {
    const calls = [];
    return {
      AbortSignal: AbortSignalImpl,
      calls,
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
      },
    };
  }
  const OPENAI = { resumeProvider: "openai", resumeOpenAIApiKey: "fictional-key", resumeOpenAIModel: "gpt-4o-mini" };

  it("with no AbortSignal, inline AI passes the caller's signal unchanged and drafting sends none", async () => {
    const net = answeringNetwork(undefined);
    const rg = loadResumeGenerate(net, OPENAI);
    const caller = new AbortController();
    assert.equal(await rg.callConfiguredAi("sys", "user", { signal: caller.signal }), "ok");
    await rg.generateFromBundle(BUNDLE);
    assert.equal(net.calls[0].init.signal, caller.signal);
    assert.equal(net.calls[1].init.signal, undefined);
  });

  it("with AbortSignal.timeout but no AbortSignal.any, the caller's signal passes unchanged", async () => {
    const net = answeringNetwork({ timeout: (ms) => AbortSignal.timeout(ms) });
    const rg = loadResumeGenerate(net, OPENAI);
    const caller = new AbortController();
    assert.equal(await rg.callConfiguredAi("sys", "user", { signal: caller.signal }), "ok");
    assert.equal(net.calls[0].init.signal, caller.signal);
  });
});
