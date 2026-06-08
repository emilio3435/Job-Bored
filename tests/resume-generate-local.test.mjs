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
const settingsModalHtml = readFileSync(
  join(repoRoot, "partials", "settings-modal.html"),
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

/** Fetch stub that rejects like the browser does when nothing is listening. */
function makeNetworkErrorFetch() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    throw new TypeError("Failed to fetch");
  };
  return { fetchImpl, calls };
}

function sentinelDraft(body) {
  return (
    `${body}\n\n---JB-INSIGHTS---\n` +
    JSON.stringify({
      fitAngle: "Lead reliability work end-to-end.",
      keywordCoverage: { score: 80, reason: "hits the core JD priorities" },
      toneMatch: { score: 75, reason: "professional and direct" },
      length: { score: 70, reason: "fits the scan band" },
    }) +
    `\n---END-JB-INSIGHTS---\n`
  );
}

const SENTINEL_DRAFT = sentinelDraft("SUMMARY\nGreat candidate.");

const BUNDLE = {
  feature: "resume",
  profile: { name: "Sample" },
  job: { title: "SRE" },
};
const COVER_LETTER_BUNDLE = {
  feature: "cover_letter",
  profile: { name: "Sample" },
  job: { title: "SRE" },
};

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
    json: async () => ({ error: { code: status, message } }),
  };
}

const LOCAL_CONFIG = {
  resumeProvider: "local",
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  resumeLocalModel: "gemma4:e2b",
};

describe("resume-generate local provider — request shape (VAL-PROV-009)", () => {
  it("local posts to configured base url with max_tokens, not max_completion_tokens", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(SENTINEL_DRAFT),
    );
    const RG = loadResumeGenerate({
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://localhost:1234/v1",
        resumeLocalModel: "gemma4:e2b-mlx",
      },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.equal(url, "http://localhost:1234/v1/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.notEqual(
      options.credentials,
      "include",
      "local must not send credentials:'include'",
    );
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gemma4:e2b-mlx");
    assert.equal(body.max_tokens, 8000);
    assert.ok(
      !("max_completion_tokens" in body),
      "local body must use max_tokens, not max_completion_tokens",
    );
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
  });

  it("local omits Authorization when no key", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(SENTINEL_DRAFT),
    );
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    await RG.generateFromBundle(BUNDLE);
    const { options } = calls[0];
    assert.ok(
      !("Authorization" in options.headers),
      "local must not send an Authorization header when resumeLocalApiKey is unset (Ollama ignores it)",
    );
  });

  it("local sends Authorization only when a key is set", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(SENTINEL_DRAFT),
    );
    const RG = loadResumeGenerate({
      config: { ...LOCAL_CONFIG, resumeLocalApiKey: "local-secret" },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls[0].options.headers.Authorization, "Bearer local-secret");
  });

  it("local uses default base url and default model when unset", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(SENTINEL_DRAFT),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "local" },
      fetchImpl,
    });
    await RG.generateFromBundle(BUNDLE);
    assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "gemma4:e2b");
  });
});

describe("resume-generate local provider — extractInsights routing (VAL-PROV-002)", () => {
  it("local valid sentinel parses insights", async () => {
    const { fetchImpl } = makeFetchStub(() => okJsonResponse(SENTINEL_DRAFT));
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.ok(out.insights, "insights should be populated");
    assert.equal(out.insightsError, "");
    assert.ok(out.cleanText.includes("Great candidate."));
    assert.ok(!out.cleanText.includes("JB-INSIGHTS"));
  });

  it("local missing sentinel sets insightsError", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      okJsonResponse("Just a draft with no sentinel block."),
    );
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.equal(out.insights, null);
    assert.ok(out.insightsError && out.insightsError.length > 0);
    assert.ok(out.cleanText.includes("Just a draft"));
  });

  it("local malformed sentinel sets insightsError", async () => {
    const malformed =
      "SUMMARY\nGreat.\n\n---JB-INSIGHTS---\n{ not valid json ]\n---END-JB-INSIGHTS---\n";
    const { fetchImpl } = makeFetchStub(() => okJsonResponse(malformed));
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    const out = await RG.generateFromBundle(BUNDLE);
    assert.equal(out.insights, null);
    assert.match(out.insightsError, /malformed|parse/i);
    assert.ok(out.cleanText.includes("Great."));
  });
});

describe("resume-generate local provider — actionable network error (VAL-PROV-008)", () => {
  it("local network error actionable message", async () => {
    const { fetchImpl, calls } = makeNetworkErrorFetch();
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    let caught;
    try {
      await RG.generateFromBundle(BUNDLE);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "a local network error must reject");
    assert.equal(calls.length, 1, "fetch should have been attempted once");
    const msg = caught.message;
    assert.doesNotMatch(
      msg,
      /^Failed to fetch$/,
      "must not surface a bare 'Failed to fetch'",
    );
    assert.match(msg, /local model server|Ollama/i, "names the local server");
    assert.match(msg, /127\.0\.0\.1:11434/, "names the default Ollama host");
  });
});

describe("resume-generate local provider — cover-letter mode (VAL-PROV-010)", () => {
  it("local cover-letter mode returns a draft with parsed insights", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(sentinelDraft("Dear hiring team, I am a strong fit.")),
    );
    const RG = loadResumeGenerate({ config: LOCAL_CONFIG, fetchImpl });
    const out = await RG.generateFromBundle(COVER_LETTER_BUNDLE);
    assert.equal(calls.length, 1);
    assert.ok(out.cleanText.includes("Dear hiring team"));
    assert.ok(out.insights, "cover-letter insights should be populated");
    assert.equal(out.insightsError, "");
  });

  it("openrouter cover-letter mode returns a draft with parsed insights", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      okJsonResponse(sentinelDraft("Dear hiring team, I am a strong fit.")),
    );
    const RG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
      fetchImpl,
    });
    const out = await RG.generateFromBundle(COVER_LETTER_BUNDLE);
    assert.equal(calls.length, 1);
    assert.ok(out.cleanText.includes("Dear hiring team"));
    assert.ok(out.insights, "cover-letter insights should be populated");
    assert.equal(out.insightsError, "");
  });
});

describe("resume-generate local + openrouter — config layer wiring (VAL-PROV-009)", () => {
  it("config keeps local and openrouter providers (no coercion); unknown falls back to gemini", () => {
    const localRG = loadResumeGenerate({
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://host:9/v1",
        resumeLocalModel: "gemma4:e2b-mlx",
        resumeLocalApiKey: "z",
      },
    });
    const localCfg = localRG.getResumeGenerationConfig();
    assert.equal(localCfg.provider, "local");
    assert.equal(localCfg.resumeLocalBaseUrl, "http://host:9/v1");
    assert.equal(localCfg.resumeLocalModel, "gemma4:e2b-mlx");
    assert.equal(localCfg.resumeLocalApiKey, "z");

    const orRG = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
    });
    assert.equal(orRG.getResumeGenerationConfig().provider, "openrouter");

    const junkRG = loadResumeGenerate({ config: { resumeProvider: "nope" } });
    assert.equal(junkRG.getResumeGenerationConfig().provider, "gemini");
  });

  it("local config defaults base url and model when unset", () => {
    const RG = loadResumeGenerate({ config: { resumeProvider: "local" } });
    const cfg = RG.getResumeGenerationConfig();
    assert.equal(cfg.resumeLocalBaseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(cfg.resumeLocalModel, "gemma4:e2b");
    assert.equal(cfg.resumeLocalApiKey, "");
  });

  it("isResumeGenerationConfigured gates local and openrouter", () => {
    // Local needs no secret: with the defaulted base URL + model it is
    // configured out of the box. This also guards the default→gate wiring —
    // if getResumeGenerationConfig stopped defaulting, the gate would go false.
    const localDefaults = loadResumeGenerate({
      config: { resumeProvider: "local" },
    });
    assert.equal(
      localDefaults.isResumeGenerationConfigured(),
      true,
      "local is configured out of the box (base URL + model both default)",
    );

    const localExplicit = loadResumeGenerate({
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
        resumeLocalModel: "gemma4:e2b",
      },
    });
    assert.equal(localExplicit.isResumeGenerationConfigured(), true);

    // OpenRouter requires a key (no default key), so the gate can go false.
    const orWithKey = loadResumeGenerate({
      config: { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
    });
    assert.equal(orWithKey.isResumeGenerationConfigured(), true);

    const orNoKey = loadResumeGenerate({
      config: { resumeProvider: "openrouter" },
    });
    assert.equal(orNoKey.isResumeGenerationConfigured(), false);
  });

  it("both local and openrouter reuse the OpenAI request shape (model + system/user messages + max_tokens)", async () => {
    for (const config of [
      {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
        resumeLocalModel: "gemma4:e2b",
      },
      { resumeProvider: "openrouter", resumeOpenRouterApiKey: "k" },
    ]) {
      const { fetchImpl, calls } = makeFetchStub(() =>
        okJsonResponse(SENTINEL_DRAFT),
      );
      const RG = loadResumeGenerate({ config, fetchImpl });
      await RG.generateFromBundle(BUNDLE);
      const { url, options } = calls[0];
      assert.match(url, /\/chat\/completions$/);
      const body = JSON.parse(options.body);
      assert.ok(typeof body.model === "string" && body.model.length > 0);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      assert.equal(body.max_tokens, 8000);
      assert.ok(!("max_completion_tokens" in body));
    }
  });
});

describe("resume-generate local — model options (VAL-PROV-009)", () => {
  it("CommandCenterResumeModelOptions.local offers gemma4:e2b (default) and gemma4:e2b-mlx", () => {
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
    const opts = ctx.window.CommandCenterResumeModelOptions;
    assert.ok(Array.isArray(opts.local), "local model list exists");
    assert.equal(opts.local[0].value, "gemma4:e2b");
    const values = opts.local.map((o) => o.value);
    assert.ok(values.includes("gemma4:e2b-mlx"), "offers the MLX variant");
  });
});

describe("local provider config wiring across files (VAL-PROV-009 / config layer)", () => {
  it("config-overrides allowlist includes the three local keys", () => {
    for (const key of [
      "resumeLocalBaseUrl",
      "resumeLocalModel",
      "resumeLocalApiKey",
    ]) {
      assert.ok(
        new RegExp(`"${key}"`).test(configOverridesJs),
        `${key} must be on the COMMAND_CENTER_OVERRIDE_KEYS allowlist or Settings values are dropped on save`,
      );
    }
  });

  it("config.example.js declares the local keys with defaults", () => {
    assert.match(
      configExampleJs,
      /resumeLocalBaseUrl:\s*"http:\/\/127\.0\.0\.1:11434\/v1"/,
    );
    assert.match(configExampleJs, /resumeLocalModel:\s*"gemma4:e2b"/);
    assert.match(configExampleJs, /resumeLocalApiKey:\s*""/);
  });

  it("config.example.js ships an empty local key (no committed secret)", () => {
    assert.doesNotMatch(configExampleJs, /resumeLocalApiKey:\s*"\S+"/);
  });

  it("settings-modal.js whitelists local in both populate and save guards", () => {
    const whitelistHits = (
      settingsModalJs.match(/"openrouter",\s*\n?\s*"local"/g) || []
    ).length;
    assert.ok(
      whitelistHits >= 2,
      "local must be in BOTH the populate and save provider whitelists",
    );
    assert.match(
      settingsModalJs,
      /settingsPanelLocal/,
      "updateSettingsProviderPanels must toggle the local panel",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeLocalModel/,
      "settings must populate/read the local model select",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeLocalBaseUrl/,
      "settings must read/write the local base URL field",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeLocalApiKey/,
      "settings must read/write the optional local key field",
    );
  });

  it("settings-modal.html exposes the local option and panel", () => {
    assert.match(settingsModalHtml, /<option value="local"/);
    assert.match(settingsModalHtml, /id="settingsPanelLocal"/);
    assert.match(settingsModalHtml, /id="settingsResumeLocalBaseUrl"/);
    assert.match(settingsModalHtml, /id="settingsResumeLocalModel"/);
    assert.match(settingsModalHtml, /id="settingsResumeLocalApiKey"/);
  });
});
