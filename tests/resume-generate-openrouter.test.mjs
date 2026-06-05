import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const resumeGenerateJs = readFileSync(
  join(repoRoot, "resume-generate.js"),
  "utf8",
);
const configOverridesJs = readFileSync(
  join(repoRoot, "config-overrides.js"),
  "utf8",
);
const configExampleJs = readFileSync(
  join(repoRoot, "config.example.js"),
  "utf8",
);
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);

/**
 * Load resume-generate.js in an isolated vm context with a stubbed
 * window.COMMAND_CENTER_CONFIG and global fetch (the browser-global IIFE
 * pattern used across the resume tests).
 */
function loadResumeGenerate({ config = {}, fetchImpl } = {}) {
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    fetch: fetchImpl,
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return ctx.window.CommandCenterResumeGenerate;
}

function makeFetchStub(responder) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responder({ url, options, callIndex: calls.length - 1 });
  };
  return { fetchImpl, calls };
}

const SENTINEL_DRAFT =
  "SUMMARY\nGreat candidate.\n\n---JB-INSIGHTS---\n" +
  JSON.stringify({
    fitAngle: "Lead reliability work end-to-end.",
    keywordCoverage: { score: 80, reason: "hits the core JD priorities" },
    toneMatch: { score: 75, reason: "professional and direct" },
    length: { score: 70, reason: "fits the scan band" },
  }) +
  "\n---END-JB-INSIGHTS---\n";

const BUNDLE = { feature: "resume", profile: { name: "Sample" }, job: { title: "SRE" } };

function okJsonResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function errorJsonResponse(status, message) {
  return {
    ok: false,
    status,
    // A headers accessor that throws — proves the code never reads Retry-After
    // (which is not browser-readable cross-origin).
    headers: {
      get() {
        throw new Error("headers.get must not be called for cross-origin OpenRouter responses");
      },
    },
    json: async () => ({ error: { code: status, message } }),
  };
}

describe("resume-generate openrouter provider", () => {
  it("openrouter posts to configured base url with bearer + max_tokens", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-test-key",
        resumeOpenRouterBaseUrl: "https://router.example/api/v9",
        resumeOpenRouterModel: "vendor/some-model:free",
      },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.equal(url, "https://router.example/api/v9/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer sk-or-test-key");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.notEqual(
      options.credentials,
      "include",
      "openrouter must not send credentials:'include'",
    );
    const body = JSON.parse(options.body);
    assert.equal(body.model, "vendor/some-model:free");
    assert.equal(body.max_tokens, 8000);
    assert.ok(
      !("max_completion_tokens" in body),
      "openrouter body must use max_tokens, not max_completion_tokens",
    );
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
  });

  it("openrouter uses default base url and default model when unset", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-test-key",
      },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "openai/gpt-oss-120b:free");
  });

  it("openrouter valid sentinel parses insights", async () => {
    const { fetchImpl } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.ok(out.insights, "insights should be populated");
    assert.equal(out.insightsError, "");
    assert.ok(out.cleanText.includes("Great candidate."));
    assert.ok(!out.cleanText.includes("JB-INSIGHTS"));
  });

  it("openrouter missing sentinel sets insightsError", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      okJsonResponse("Just a draft with no sentinel block."),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.equal(out.insights, null);
    assert.ok(out.insightsError && out.insightsError.length > 0);
    assert.ok(out.cleanText.includes("Just a draft"));
  });

  it("openrouter 401 message", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      errorJsonResponse(401, "No auth credentials found"),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "bad" },
      fetchImpl,
    });
    await assert.rejects(
      () => RG.generateFromBundle(BUNDLE),
      /invalid.*key|key.*invalid/i,
    );
    await assert.rejects(
      () => RG.generateFromBundle(BUNDLE),
      /openrouter\.ai\/keys/i,
    );
  });

  it("openrouter 402 message", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      errorJsonResponse(402, "Insufficient credits"),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /balance|top up|credit/i);
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /pause/i);
  });

  it("openrouter 429 message names limit and upgrade", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      errorJsonResponse(429, "Rate limit exceeded"),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    let caught;
    try {
      await RG.generateFromBundle(BUNDLE);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "429 should throw");
    const msg = caught.message;
    assert.match(msg, /limit/i, "names the free-tier limit");
    assert.match(msg, /60/, "includes the ~60s fixed backoff hint");
    assert.match(msg, /credit|upgrade|top up/i, "names the upgrade path");
  });

  it("openrouter 400 unknown model message", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      errorJsonResponse(400, "model not found"),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /:free/);
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /model/i);
  });

  it("openrouter 401/402/429/400 messages are all distinct", async () => {
    const messages = {};
    for (const status of [401, 402, 429, 400]) {
      const { fetchImpl } = makeFetchStub(() => errorJsonResponse(status, "x"));
      const RG = loadResumeGenerate({
        config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
        fetchImpl,
      });
      try {
        await RG.generateFromBundle(BUNDLE);
      } catch (e) {
        messages[status] = e.message;
      }
    }
    const values = Object.values(messages);
    assert.equal(values.length, 4);
    assert.equal(new Set(values).size, 4, "each error code maps to a distinct message");
  });

  it("openrouter retries once on empty content then succeeds", async () => {
    let n = 0;
    const { fetchImpl, calls } = makeFetchStub(() => {
      n += 1;
      return okJsonResponse(n === 1 ? "" : SENTINEL_DRAFT);
    });
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.equal(calls.length, 2, "should retry exactly once on empty content");
    assert.ok(out.insights);
  });

  it("openrouter retries once then throws if still empty", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(""));
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /empty/i);
    assert.equal(calls.length, 2, "retries exactly once before giving up");
  });

  it("openrouter without a key throws an actionable error", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter" },
      fetchImpl,
    });
    await assert.rejects(() => RG.generateFromBundle(BUNDLE), /openrouter/i);
    assert.equal(calls.length, 0, "should not call fetch when unconfigured");
  });

  it("config keeps openrouter provider (no coercion); unknown falls back to gemini", () => {
    const RG = loadResumeGenerate({
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "k",
        resumeOpenRouterModel: "vendor/m:free",
        resumeOpenRouterBaseUrl: "https://r.example/api/v1",
      },
    });
    const cfg = RG.getResumeGenerationConfig();
    assert.equal(cfg.provider, "openrouter");
    assert.equal(cfg.resumeOpenRouterApiKey, "k");
    assert.equal(cfg.resumeOpenRouterModel, "vendor/m:free");
    assert.equal(cfg.resumeOpenRouterBaseUrl, "https://r.example/api/v1");

    const RG2 = loadResumeGenerate({ config: { resumeProvider: "nonsense" } });
    assert.equal(RG2.getResumeGenerationConfig().provider, "gemini");
  });

  it("isResumeGenerationConfigured gates openrouter on a key", () => {
    const withKey = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
    });
    assert.equal(withKey.isResumeGenerationConfigured(), true);

    const noKey = loadResumeGenerate({ config: { resumeProvider: "openrouter" } });
    assert.equal(noKey.isResumeGenerationConfigured(), false);
  });

  it("CommandCenterResumeModelOptions.openrouter default is openai/gpt-oss-120b:free", () => {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
    const opts = ctx.window.CommandCenterResumeModelOptions;
    assert.ok(Array.isArray(opts.openrouter), "openrouter model list exists");
    assert.equal(opts.openrouter[0].value, "openai/gpt-oss-120b:free");
    assert.ok(
      opts.openrouter.every((o) => /:free$/.test(o.value)),
      "openrouter options should all be :free model ids",
    );
  });
});

describe("resume-generate preserves OpenAI base-url behavior", () => {
  it("openai still posts to api.openai.com/v1/chat/completions", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openai", resumeOpenAIApiKey: "sk-test", resumeOpenAIModel: "gpt-4o-mini" },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.max_tokens, 8192);
    assert.ok(!("max_completion_tokens" in body));
  });

  it("openai keeps max_completion_tokens for gpt-5 models", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openai", resumeOpenAIApiKey: "sk-test", resumeOpenAIModel: "gpt-5.4" },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.max_completion_tokens, 8192);
    assert.ok(!("max_tokens" in body));
  });
});

describe("openrouter config wiring across files", () => {
  it("config-overrides allowlist includes the three openrouter keys", () => {
    for (const key of [
      "resumeOpenRouterApiKey",
      "resumeOpenRouterModel",
      "resumeOpenRouterBaseUrl",
    ]) {
      assert.ok(
        new RegExp(`"${key}"`).test(configOverridesJs),
        `${key} must be on the COMMAND_CENTER_OVERRIDE_KEYS allowlist or Settings values are dropped on save`,
      );
    }
  });

  it("config.example.js ships openrouter as the default provider with defaulted keys", () => {
    assert.match(configExampleJs, /resumeProvider:\s*"openrouter"/);
    assert.match(configExampleJs, /resumeOpenRouterApiKey:\s*""/);
    assert.match(
      configExampleJs,
      /resumeOpenRouterModel:\s*"openai\/gpt-oss-120b:free"/,
    );
    assert.match(
      configExampleJs,
      /resumeOpenRouterBaseUrl:\s*"https:\/\/openrouter\.ai\/api\/v1"/,
    );
  });

  it("config.example.js ships an empty openrouter key (no committed secret)", () => {
    assert.doesNotMatch(configExampleJs, /resumeOpenRouterApiKey:\s*"sk-or-/);
  });

  it("settings-modal.js whitelists openrouter in both populate and save guards", () => {
    const whitelistHits = (
      settingsModalJs.match(/"webhook",\s*\n?\s*"openrouter"/g) || []
    ).length;
    assert.ok(
      whitelistHits >= 2,
      "openrouter must be in BOTH the populate and save provider whitelists",
    );
    assert.match(
      settingsModalJs,
      /settingsPanelOpenRouter/,
      "updateSettingsProviderPanels must toggle the openrouter panel",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeOpenRouterModel/,
      "settings must populate/read the openrouter model select",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeOpenRouterApiKey/,
      "settings must read/write the openrouter key field",
    );
  });
});
