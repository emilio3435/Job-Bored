/**
 * SIXBEATS-2 NEW-2 (BLOCKER) — drafting runs on the provider Beat 2 verified.
 *
 * The acceptance rerun on main @ cf0da4d walked a fresh install through
 * Beat 2 with a live OpenRouter key, and Beat 3 answered
 * `POST /profile/from-resume` → 500 "Missing Gemini API key: set
 * PROFILE_GEMINI_API_KEY…". Two defects in one line: the drafter ignored
 * the provider the user had just connected, and it explained itself with
 * the names of server environment variables a browser user has never seen.
 *
 * SIXBEATS2-SPEC locked decision 3: the request body carries
 * `{provider, apiKey, model, baseUrl}` and the server prefers it over env
 * for EVERY provider it supports; user-facing errors name the provider,
 * never an env var.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(join(repoRoot, "server/profile-from-resume.mjs")).href;

const RESUME = "Emilio N. — Staff engineer. Ten years shipping infrastructure.";

/** The env a machine with only a (stale) Gemini setup would present. */
const GEMINI_ONLY_ENV = {
  PROFILE_PROVIDER: "gemini",
  PROFILE_GEMINI_API_KEY: "AIza-stale-server-key",
  GEMINI_API_KEY: "AIza-stale-server-key",
};

const savedEnv = {};
let savedFetch;

function setEnv(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
}

beforeEach(() => {
  savedFetch = globalThis.fetch;
  // A pin file on the developer's real machine must never decide this test.
  setEnv({ JOBBORED_LLM_CONFIG_PATH: join(repoRoot, "tests", ".no-such-llm-pin.json") });
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
});

async function loadModule() {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

/** Records every request and answers with one canned provider payload. */
function recordingFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), options, body: null };
    if (options && typeof options.body === "string") {
      try {
        call.body = JSON.parse(options.body);
      } catch {
        call.body = options.body;
      }
    }
    calls.push(call);
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return calls;
}

const PROFILE_JSON = JSON.stringify({
  version: 1,
  starterTemplate: "custom",
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "I build the systems other teams build on top of, and I want more of that.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "any" },
});

const CHAT_PAYLOAD = { choices: [{ message: { content: PROFILE_JSON } }] };
const ANTHROPIC_PAYLOAD = { content: [{ type: "text", text: PROFILE_JSON }] };

describe("SIXBEATS-2 NEW-2 — the request body carries the verified provider", () => {
  it("reads {provider, apiKey, model, baseUrl} off the body", async () => {
    const mod = await loadModule();
    const config = mod.parseProfileProviderConfigFromBody({
      resumeText: RESUME,
      provider: "openrouter",
      apiKey: "sk-or-body-key",
      model: "openai/gpt-oss-120b:free",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    assert.deepEqual(
      { provider: config.provider, apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl },
      {
        provider: "openrouter",
        apiKey: "sk-or-body-key",
        model: "openai/gpt-oss-120b:free",
        baseUrl: "https://openrouter.ai/api/v1",
      },
    );
  });

  it("fills the provider's own default base URL when the body omits it", async () => {
    const mod = await loadModule();
    const config = mod.parseProfileProviderConfigFromBody({
      provider: "openrouter",
      apiKey: "sk-or-body-key",
      model: "openai/gpt-oss-120b:free",
    });
    assert.equal(config.baseUrl, "https://openrouter.ai/api/v1");
  });

  it("returns null for a body with no provider, so env still decides", async () => {
    const mod = await loadModule();
    assert.equal(mod.parseProfileProviderConfigFromBody({ resumeText: RESUME }), null);
    assert.equal(mod.parseProfileProviderConfigFromBody(null), null);
  });

  it("returns null for a provider the drafter cannot call (webhook)", async () => {
    const mod = await loadModule();
    assert.equal(
      mod.parseProfileProviderConfigFromBody({ provider: "webhook", apiKey: "x" }),
      null,
      "an unsupported provider must fall back to env, never silently draft on Gemini",
    );
  });
});

describe("SIXBEATS-2 NEW-2 — drafting uses the body config, never the Gemini env", () => {
  it("drafts through OpenRouter's OpenAI-compatible path", async () => {
    setEnv(GEMINI_ONLY_ENV);
    const mod = await loadModule();
    const calls = recordingFetch(CHAT_PAYLOAD);
    const profile = await mod.analyzeResumeToProfile(RESUME, {
      config: mod.parseProfileProviderConfigFromBody({
        provider: "openrouter",
        apiKey: "sk-or-body-key",
        model: "openai/gpt-oss-120b:free",
      }),
    });
    assert.equal(profile.identity.targetRoles[0], "Staff Engineer");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].options.headers.Authorization, "Bearer sk-or-body-key");
    assert.equal(calls[0].body.model, "openai/gpt-oss-120b:free");
    assert.equal(
      /generativelanguage\.googleapis\.com/.test(calls.map((c) => c.url).join(" ")),
      false,
      "NEW-2: a verified OpenRouter key must not end at Google",
    );
  });

  it("drafts through OpenAI", async () => {
    setEnv(GEMINI_ONLY_ENV);
    const mod = await loadModule();
    const calls = recordingFetch(CHAT_PAYLOAD);
    await mod.analyzeResumeToProfile(RESUME, {
      config: mod.parseProfileProviderConfigFromBody({
        provider: "openai",
        apiKey: "sk-openai-body-key",
        model: "gpt-5.6-terra",
      }),
    });
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].options.headers.Authorization, "Bearer sk-openai-body-key");
  });

  it("drafts through a local OpenAI-compatible server with no key", async () => {
    setEnv(GEMINI_ONLY_ENV);
    const mod = await loadModule();
    const calls = recordingFetch(CHAT_PAYLOAD);
    await mod.analyzeResumeToProfile(RESUME, {
      config: mod.parseProfileProviderConfigFromBody({
        provider: "local",
        apiKey: "",
        model: "gemma4:e2b",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    });
    assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(
      "Authorization" in calls[0].options.headers,
      false,
      "an ambient key must never be forwarded to an arbitrary local endpoint",
    );
  });

  it("drafts through Anthropic's messages API", async () => {
    setEnv(GEMINI_ONLY_ENV);
    const mod = await loadModule();
    const calls = recordingFetch(ANTHROPIC_PAYLOAD);
    const profile = await mod.analyzeResumeToProfile(RESUME, {
      config: mod.parseProfileProviderConfigFromBody({
        provider: "anthropic",
        apiKey: "sk-ant-body-key",
        model: "claude-sonnet-5",
      }),
    });
    assert.equal(profile.identity.targetSeniority, "ic_staff");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].options.headers["x-api-key"], "sk-ant-body-key");
    assert.equal(calls[0].body.model, "claude-sonnet-5");
    assert.equal(
      /generativelanguage\.googleapis\.com/.test(calls.map((c) => c.url).join(" ")),
      false,
      "anthropic used to normalize to gemini and draft on the wrong key",
    );
  });

  it("still drafts through Gemini when Gemini is what the body carries", async () => {
    const mod = await loadModule();
    const calls = recordingFetch({
      candidates: [{ content: { parts: [{ text: PROFILE_JSON }] } }],
    });
    await mod.analyzeResumeToProfile(RESUME, {
      config: mod.parseProfileProviderConfigFromBody({
        provider: "gemini",
        apiKey: "AIza-body-key",
        model: "gemini-3.5-flash",
      }),
    });
    assert.match(calls[0].url, /models\/gemini-3\.5-flash:generateContent/);
    assert.match(calls[0].url, /key=AIza-body-key/);
  });
});

describe("SIXBEATS-2 NEW-2 — errors name the provider, never an env var", () => {
  const ENV_VAR_SHAPE = /PROFILE_[A-Z_]+|ATS_[A-Z_]+|GEMINI_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY/;

  it("names OpenRouter when the body config has no key", async () => {
    setEnv(GEMINI_ONLY_ENV);
    const mod = await loadModule();
    recordingFetch(CHAT_PAYLOAD);
    const config = mod.parseProfileProviderConfigFromBody({
      provider: "openrouter",
      apiKey: "",
      model: "openai/gpt-oss-120b:free",
    });
    await assert.rejects(
      () => mod.analyzeResumeToProfile(RESUME, { config }),
      (err) => {
        assert.match(err.message, /OpenRouter/);
        assert.equal(
          ENV_VAR_SHAPE.test(err.message),
          false,
          `a browser user never set ${err.message}`,
        );
        assert.match(err.message, /try|again|reconnect/i, "§8.4: every error names its next action");
        return true;
      },
    );
  });

  it("names Anthropic on an upstream HTTP failure", async () => {
    const mod = await loadModule();
    recordingFetch({ error: { message: "credit balance is too low" } }, { ok: false, status: 400 });
    await assert.rejects(
      () =>
        mod.analyzeResumeToProfile(RESUME, {
          config: mod.parseProfileProviderConfigFromBody({
            provider: "anthropic",
            apiKey: "sk-ant-body-key",
            model: "claude-sonnet-5",
          }),
        }),
      (err) => {
        assert.match(err.message, /credit balance is too low/);
        assert.equal(err.provider, "anthropic");
        return true;
      },
    );
  });

  it("keeps naming env vars for a server-side (env) config — that reader IS the operator", async () => {
    setEnv(GEMINI_ONLY_ENV);
    setEnv({ PROFILE_GEMINI_API_KEY: "", GEMINI_API_KEY: "", ATS_GEMINI_API_KEY: "" });
    const mod = await loadModule();
    const status = mod.__test.getProfileProviderConfigStatus({
      provider: "gemini",
      apiKey: "",
      model: "gemini-3.5-flash",
      baseUrl: "",
    });
    assert.equal(status.configured, false);
    assert.match(status.reason, /PROFILE_GEMINI_API_KEY/);
  });
});
