import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   JobBoredModelCatalog — self-updating per-provider model lists +
   live "is this key alive" ping.

   Goals (per OSS first-run AI provider step):
     - One classic-global module on window.JobBoredModelCatalog
       (NOT an ES module) loaded via index.html script tag.
     - Curated, current static fallback lists per provider used
       whenever a live fetch fails or no key is available.
     - Live model-list fetch per provider using the documented
       browser-compatible endpoints:
         * gemini    GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY
         * openai    GET https://api.openai.com/v1/models  (Authorization: Bearer KEY)
         * anthropic GET https://api.anthropic.com/v1/models
                       (x-api-key, anthropic-version: 2023-06-01,
                        anthropic-dangerous-direct-browser-access: true)
         * openrouter GET https://openrouter.ai/api/v1/models (Authorization: Bearer KEY)
         * local      GET {baseUrl}/models (Authorization: Bearer KEY only if set)
     - Cache: in-memory per (provider, keyHash) PLUS localStorage
       TTL fallback so dropdowns are "ever-updating" without
       hammering APIs across reloads.
     - pingProvider({provider, apiKey, baseUrl}) returns
       {ok, status, message} — reuses the models-list endpoint as
       a cheap authenticated GET.
     - All network is dependency-injected via fetchImpl so tests
       NEVER hit the real provider APIs.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelCatalogJs = readFileSync(
  join(repoRoot, "model-catalog.js"),
  "utf8",
);
const resumeGenerateJs = readFileSync(
  join(repoRoot, "resume-generate.js"),
  "utf8",
);
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    __store: store,
  };
}

function loadCatalog({ fetchImpl, localStorage } = {}) {
  const calls = [];
  const wrappedFetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    if (typeof fetchImpl === "function") return fetchImpl(url, init);
    throw new Error("no fetchImpl provided");
  };
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: wrappedFetch,
    localStorage: localStorage || fakeLocalStorage(),
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(modelCatalogJs, ctx, { filename: "model-catalog.js" });
  return {
    api: ctx.window.JobBoredModelCatalog,
    calls,
    window: ctx.window,
    localStorage: ctx.localStorage,
  };
}

const okJson = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("JobBoredModelCatalog — module surface + static fallbacks", () => {
  it("exposes the catalog API on window.JobBoredModelCatalog", () => {
    const { api } = loadCatalog();
    assert.ok(api, "window.JobBoredModelCatalog should exist");
    for (const fn of [
      "getProviderModels",
      "fetchProviderModels",
      "pingProvider",
      "getStaticModels",
      "clearCache",
    ]) {
      assert.equal(
        typeof api[fn],
        "function",
        `JobBoredModelCatalog.${fn} should be a function`,
      );
    }
    assert.ok(
      api.STATIC && typeof api.STATIC === "object",
      "STATIC fallback dictionary should be exposed",
    );
  });

  it("static fallback has a non-empty list for every supported provider", () => {
    const { api } = loadCatalog();
    for (const provider of [
      "gemini",
      "openai",
      "anthropic",
      "openrouter",
      "local",
    ]) {
      const list = api.getStaticModels(provider);
      assert.ok(
        Array.isArray(list) && list.length > 0,
        `static fallback for ${provider} must be a non-empty array`,
      );
      for (const opt of list) {
        assert.ok(
          opt && typeof opt.value === "string" && opt.value.trim().length > 0,
          `every option needs a non-empty value (provider=${provider})`,
        );
        assert.ok(
          opt.label && typeof opt.label === "string",
          `every option needs a label (provider=${provider})`,
        );
      }
    }
  });

  it("static Anthropic list carries the current claude-opus-4-8 and claude-fable-5 ids (current as of 2026-06)", () => {
    const { api } = loadCatalog();
    const values = api.getStaticModels("anthropic").map((o) => o.value);
    for (const id of [
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]) {
      assert.ok(
        values.includes(id),
        `static Anthropic list must include ${id} — drives the dropdown when the live fetch can't run`,
      );
    }
  });

  it("CommandCenterResumeModelOptions.anthropic is also updated so legacy consumers see current ids", () => {
    // The Settings tab still reads CommandCenterResumeModelOptions for its
    // static fallback. Keep it aligned with the catalog so a user without a
    // key never sees stale Anthropic options.
    for (const id of [
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]) {
      assert.ok(
        resumeGenerateJs.includes(`value: "${id}"`),
        `resume-generate.js must list ${id} in CommandCenterResumeModelOptions.anthropic`,
      );
    }
  });
});

describe("JobBoredModelCatalog — fetchProviderModels routes per provider", () => {
  const profiles = [
    {
      name: "gemini",
      apiKey: "AIza-test-key",
      response: {
        models: [
          { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
          { name: "models/gemini-3.1-pro-preview" },
          // models that don't generateContent should be filtered out
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-3-flash-preview",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
      expectedUrlIncludes:
        "generativelanguage.googleapis.com/v1beta/models?key=AIza-test-key",
      expectAuthHeader: false,
      expectedValuesInclude: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
      excludedValues: ["text-embedding-004"],
    },
    {
      name: "openai",
      apiKey: "sk-openai-test",
      response: {
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
          // exclude obvious non-chat models
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
        ],
      },
      expectedUrlIncludes: "api.openai.com/v1/models",
      expectAuthHeader: "Bearer sk-openai-test",
      expectedValuesInclude: ["gpt-5.4", "gpt-4o-mini"],
      excludedValues: ["whisper-1", "text-embedding-3-small"],
    },
    {
      name: "anthropic",
      apiKey: "sk-ant-test",
      response: {
        data: [
          { id: "claude-opus-4-8" },
          { id: "claude-fable-5" },
          { id: "claude-sonnet-4-6" },
        ],
      },
      expectedUrlIncludes: "api.anthropic.com/v1/models",
      expectedHeaders: {
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      expectedValuesInclude: ["claude-opus-4-8", "claude-fable-5"],
    },
    {
      name: "openrouter",
      apiKey: "sk-or-v1-test",
      response: {
        data: [
          { id: "openai/gpt-oss-120b:free" },
          { id: "deepseek/deepseek-chat-v3-0324:free" },
        ],
      },
      expectedUrlIncludes: "openrouter.ai/api/v1/models",
      expectAuthHeader: "Bearer sk-or-v1-test",
      expectedValuesInclude: [
        "openai/gpt-oss-120b:free",
        "deepseek/deepseek-chat-v3-0324:free",
      ],
    },
    {
      name: "local",
      apiKey: "",
      baseUrl: "http://127.0.0.1:11434/v1",
      response: {
        data: [{ id: "gemma4:e2b" }, { id: "llama3:8b" }],
      },
      expectedUrlIncludes: "http://127.0.0.1:11434/v1/models",
      expectAuthHeader: false,
      expectedValuesInclude: ["gemma4:e2b", "llama3:8b"],
    },
  ];

  for (const p of profiles) {
    it(`fetchProviderModels(${p.name}) calls the right endpoint with the right auth`, async () => {
      const { api, calls } = loadCatalog({
        fetchImpl: async () => okJson(p.response),
      });
      const out = await api.fetchProviderModels({
        provider: p.name,
        apiKey: p.apiKey,
        baseUrl: p.baseUrl,
      });
      assert.equal(calls.length, 1, `${p.name} must hit exactly one endpoint`);
      const call = calls[0];
      assert.ok(
        call.url.includes(p.expectedUrlIncludes),
        `${p.name} url should include "${p.expectedUrlIncludes}" — got "${call.url}"`,
      );
      const headers =
        call.init && call.init.headers ? call.init.headers : {};
      const method =
        (call.init && call.init.method ? call.init.method : "GET").toUpperCase();
      assert.equal(method, "GET", `${p.name} must use GET (cheap auth check)`);
      if (p.expectAuthHeader === false) {
        // local with no key should NOT send Authorization
        assert.equal(
          headers.Authorization || headers.authorization,
          undefined,
          `${p.name} should not send Authorization when no key`,
        );
      } else if (typeof p.expectAuthHeader === "string") {
        assert.equal(
          headers.Authorization || headers.authorization,
          p.expectAuthHeader,
          `${p.name} should send the correct Authorization header`,
        );
      }
      if (p.expectedHeaders) {
        for (const [k, v] of Object.entries(p.expectedHeaders)) {
          assert.equal(
            headers[k],
            v,
            `${p.name} should send ${k}: ${v}`,
          );
        }
      }
      assert.ok(Array.isArray(out.models), "returns an array of {value,label}");
      const values = out.models.map((m) => m.value);
      for (const v of p.expectedValuesInclude) {
        assert.ok(
          values.includes(v),
          `${p.name} models should include "${v}" — got ${JSON.stringify(values)}`,
        );
      }
      for (const v of p.excludedValues || []) {
        assert.ok(
          !values.includes(v),
          `${p.name} models should exclude non-chat model "${v}"`,
        );
      }
      assert.equal(out.source, "live", "source should be 'live' on success");
    });
  }
});

describe("JobBoredModelCatalog — pingProvider returns {ok,status,message}", () => {
  it("ping ok on 200", async () => {
    const { api } = loadCatalog({
      fetchImpl: async () => okJson({ data: [] }),
    });
    const r = await api.pingProvider({
      provider: "openrouter",
      apiKey: "sk-or-v1-x",
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.ok(typeof r.message === "string");
  });

  it("ping fails with status + message on 401", async () => {
    const { api } = loadCatalog({
      fetchImpl: async () =>
        okJson({ error: { message: "Invalid API key" } }, 401),
    });
    const r = await api.pingProvider({
      provider: "openai",
      apiKey: "sk-bogus",
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(
      r.message,
      /invalid|unauthor|key/i,
      "401 should surface an actionable message",
    );
  });

  it("ping fails closed on network error with a clear message", async () => {
    const { api } = loadCatalog({
      fetchImpl: async () => {
        const e = new TypeError("Failed to fetch");
        throw e;
      },
    });
    const r = await api.pingProvider({
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.ok(
      /network|fetch|reach|cors/i.test(r.message),
      "network failure should mention network/reach/cors",
    );
  });

  it("ping refuses when no api key is provided for a key-required provider", async () => {
    const { api, calls } = loadCatalog({
      fetchImpl: async () => okJson({ data: [] }),
    });
    const r = await api.pingProvider({ provider: "openrouter", apiKey: "" });
    assert.equal(r.ok, false);
    assert.equal(
      calls.length,
      0,
      "should not hit the network when there's no key to check",
    );
    assert.match(r.message, /key/i);
  });

  it("ping local hits {baseUrl}/models without requiring a key", async () => {
    const { api, calls } = loadCatalog({
      fetchImpl: async () => okJson({ data: [{ id: "gemma4:e2b" }] }),
    });
    const r = await api.pingProvider({
      provider: "local",
      apiKey: "",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("http://127.0.0.1:11434/v1/models"));
  });
});

describe("JobBoredModelCatalog — getProviderModels falls back when live fails", () => {
  it("returns live results when fetch succeeds", async () => {
    const { api } = loadCatalog({
      fetchImpl: async () =>
        okJson({
          data: [{ id: "openai/gpt-oss-120b:free" }],
        }),
    });
    const out = await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-x",
    });
    assert.equal(out.source, "live");
    assert.ok(out.models.some((m) => m.value === "openai/gpt-oss-120b:free"));
  });

  it("falls back to the static list when the live call fails (404 / network)", async () => {
    const { api } = loadCatalog({
      fetchImpl: async () => okJson({ error: "boom" }, 500),
    });
    const out = await api.getProviderModels({
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    assert.equal(out.source, "static");
    assert.ok(
      out.models.some((m) => m.value === "claude-opus-4-8"),
      "static fallback must include current Anthropic ids",
    );
    assert.ok(typeof out.error === "string" && out.error.length > 0);
  });

  it("returns static (no fetch) when no api key is provided for a key-required provider", async () => {
    const { api, calls } = loadCatalog({
      fetchImpl: async () => okJson({ data: [] }),
    });
    const out = await api.getProviderModels({
      provider: "openai",
      apiKey: "",
    });
    assert.equal(out.source, "static");
    assert.equal(
      calls.length,
      0,
      "no network call when there is no key to authenticate with",
    );
  });
});

describe("JobBoredModelCatalog — caching", () => {
  it("the second getProviderModels call within TTL returns cached source and does not refetch", async () => {
    let n = 0;
    const ls = fakeLocalStorage();
    const { api } = loadCatalog({
      fetchImpl: async () => {
        n += 1;
        return okJson({ data: [{ id: "openai/gpt-oss-120b:free" }] });
      },
      localStorage: ls,
    });
    const first = await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-cached",
    });
    assert.equal(first.source, "live");
    assert.equal(n, 1, "first call hits the network");
    const second = await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-cached",
    });
    assert.equal(second.source, "cache");
    assert.equal(n, 1, "second call MUST be served from cache");
  });

  it("forceRefresh bypasses the cache", async () => {
    let n = 0;
    const ls = fakeLocalStorage();
    const { api } = loadCatalog({
      fetchImpl: async () => {
        n += 1;
        return okJson({ data: [{ id: "openai/gpt-oss-120b:free" }] });
      },
      localStorage: ls,
    });
    await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-cached",
    });
    await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-cached",
      forceRefresh: true,
    });
    assert.equal(n, 2, "forceRefresh should ignore the cache");
  });

  it("clearCache() drops in-memory + localStorage entries for a provider", async () => {
    let n = 0;
    const ls = fakeLocalStorage();
    const { api } = loadCatalog({
      fetchImpl: async () => {
        n += 1;
        return okJson({ data: [{ id: "openai/gpt-oss-120b:free" }] });
      },
      localStorage: ls,
    });
    await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-x",
    });
    api.clearCache("openrouter");
    await api.getProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-v1-x",
    });
    assert.equal(n, 2, "after clearCache the next call should refetch");
  });
});

describe("index.html loads model-catalog.js before its consumers", () => {
  it("model-catalog.js is loaded after resume-generate.js but before first-run-wizard.js and settings-modal.js", () => {
    const i = (s) => indexHtml.indexOf(s);
    const resume = i("resume-generate.js");
    const catalog = i("model-catalog.js");
    const wizard = i("first-run-wizard.js");
    const settings = i("settings-modal.js");
    assert.ok(resume >= 0, "index.html must load resume-generate.js");
    assert.ok(catalog >= 0, "index.html must load model-catalog.js");
    assert.ok(wizard >= 0, "index.html must load first-run-wizard.js");
    assert.ok(settings >= 0, "index.html must load settings-modal.js");
    assert.ok(
      catalog > resume,
      "model-catalog.js depends on the static options in resume-generate.js — must load AFTER it",
    );
    assert.ok(
      catalog < wizard,
      "first-run-wizard.js consumes the catalog — model-catalog.js must load BEFORE it",
    );
    assert.ok(
      catalog < settings,
      "settings-modal.js consumes the catalog — model-catalog.js must load BEFORE it",
    );
  });
});
