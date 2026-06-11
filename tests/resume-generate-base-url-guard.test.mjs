/**
 * Pins the resume-generate.js baseUrl guard introduced to stop BYOK Bearer
 * keys from leaking to attacker-controlled hosts.
 *
 * The vulnerability: resume-generate calls fetch(`${userBaseUrl}/chat/completions`)
 * with `Authorization: Bearer <apiKey>` attached. A user tricked into
 * pasting `http://attacker.example/v1` as resumeOpenRouterBaseUrl would
 * hand their OpenRouter key to the attacker in cleartext.
 *
 * The guard allows https:// anywhere and http:// only for 127.0.0.1 /
 * localhost (the Ollama / local-server case). Everything else throws
 * before fetch is reached.
 */
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

function loadResumeGenerate({ config = {}, fetchImpl } = {}) {
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    fetch: fetchImpl,
    URL,
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return ctx;
}

function makeFetchSpy() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "ok\n---JB-INSIGHTS---\n{}\n---END-JB-INSIGHTS---\n" } }],
      }),
    };
  };
  return { fetchImpl, calls };
}

describe("assertSafeBaseUrl (security guard)", () => {
  it("accepts https:// to any host", () => {
    const { window } = loadResumeGenerate({ config: {} });
    const guard = window.CommandCenterResumeBaseUrlGuard.assertSafeBaseUrl;
    assert.doesNotThrow(() => guard("https://api.openai.com/v1"));
    assert.doesNotThrow(() => guard("https://openrouter.ai/api/v1"));
    assert.doesNotThrow(() => guard("https://my-private-llm.example.org/v1"));
  });

  it("accepts http:// only for 127.0.0.1 and localhost", () => {
    const { window } = loadResumeGenerate({ config: {} });
    const guard = window.CommandCenterResumeBaseUrlGuard.assertSafeBaseUrl;
    assert.doesNotThrow(() => guard("http://127.0.0.1:11434/v1"));
    assert.doesNotThrow(() => guard("http://localhost:11434/v1"));
    assert.doesNotThrow(() => guard("http://127.0.0.1:8000"));
  });

  it("rejects http:// to non-local hosts (the attacker-base-url case)", () => {
    const { window } = loadResumeGenerate({ config: {} });
    const guard = window.CommandCenterResumeBaseUrlGuard.assertSafeBaseUrl;
    assert.throws(() => guard("http://attacker.example/v1"), /https or 127\.0\.0\.1/);
    assert.throws(() => guard("http://10.0.0.5/v1"), /https or 127\.0\.0\.1/);
    assert.throws(() => guard("http://example.com:8080/v1"), /https or 127\.0\.0\.1/);
  });

  it("rejects exotic schemes (javascript:, file:, ws:)", () => {
    const { window } = loadResumeGenerate({ config: {} });
    const guard = window.CommandCenterResumeBaseUrlGuard.assertSafeBaseUrl;
    assert.throws(() => guard("javascript:alert(1)"), /https or 127\.0\.0\.1/);
    assert.throws(() => guard("file:///etc/passwd"), /https or 127\.0\.0\.1/);
    assert.throws(() => guard("ws://attacker.example/v1"), /https or 127\.0\.0\.1/);
  });

  it("rejects garbage / unparseable input", () => {
    const { window } = loadResumeGenerate({ config: {} });
    const guard = window.CommandCenterResumeBaseUrlGuard.assertSafeBaseUrl;
    assert.throws(() => guard("not a url"), /https or 127\.0\.0\.1/);
    assert.throws(() => guard(""), /https or 127\.0\.0\.1/);
    assert.throws(() => guard(null), /https or 127\.0\.0\.1/);
  });
});

describe("callConfiguredAi refuses fetches to unsafe base URLs", () => {
  // The load-bearing assertion: even if a malicious value somehow lands in
  // localStorage (e.g. predates the write-time check), the request-time
  // guard must stop the Bearer key from going out.
  it("openrouter provider with http://attacker base url throws before fetching", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    const { window } = loadResumeGenerate({
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-secret-key",
        resumeOpenRouterBaseUrl: "http://attacker.example/v1",
        resumeOpenRouterModel: "openai/gpt-oss-120b:free",
      },
      fetchImpl,
    });
    await assert.rejects(
      window.CommandCenterResumeGenerate.callConfiguredAi(
        "you are helpful",
        "say hi",
      ),
      /https or 127\.0\.0\.1/,
    );
    assert.equal(calls.length, 0, "fetch must not be reached when guard rejects");
  });

  it("local provider with http://attacker base url throws before fetching", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    const { window } = loadResumeGenerate({
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://attacker.example/v1",
        resumeLocalModel: "gemma4:e2b",
      },
      fetchImpl,
    });
    await assert.rejects(
      window.CommandCenterResumeGenerate.callConfiguredAi(
        "you are helpful",
        "say hi",
      ),
      /https or 127\.0\.0\.1/,
    );
    assert.equal(calls.length, 0);
  });

  it("openrouter with https base url proceeds to fetch (positive path)", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    const { window } = loadResumeGenerate({
      config: {
        resumeProvider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-secret-key",
        resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
        resumeOpenRouterModel: "openai/gpt-oss-120b:free",
      },
      fetchImpl,
    });
    await window.CommandCenterResumeGenerate.callConfiguredAi(
      "you are helpful",
      "say hi",
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/);
  });

  it("local with http://127.0.0.1 proceeds to fetch (positive path)", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    const { window } = loadResumeGenerate({
      config: {
        resumeProvider: "local",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
        resumeLocalModel: "gemma4:e2b",
      },
      fetchImpl,
    });
    await window.CommandCenterResumeGenerate.callConfiguredAi(
      "you are helpful",
      "say hi",
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions$/);
  });
});
