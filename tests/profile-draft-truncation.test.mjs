/**
 * A long resume produced a draft longer than the drafter's output cap; the
 * provider stopped mid-JSON and the user saw "Gemini returned non-JSON
 * content: Unterminated string in JSON at position 14240" (2026-09-02, live).
 * The drafter must (a) ask for enough output for a full profile and (b) name
 * a truncated answer as truncated — never as malformed JSON.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(repoRoot, "server", "profile-from-resume.mjs")).href);

const RESUME = "Senior product manager. Shipped two 0→1 products. ".repeat(40);
const CUT_JSON = '{"identity":{"targetRoles":["Senior PM"],"primaryNarrative":"Product manager who ships 0→1 and scal';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  };
  return calls;
}
const json = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });

describe("profile drafter — output cap and truncation", () => {
  it("Gemini: asks for at least 8192 output tokens", async () => {
    const calls = stubFetch(() => json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"identity":{"targetRoles":["PM"],"primaryNarrative":"' + "x".repeat(40) + '"},"strengths":[{"name":"a"}]}' }] } }] }));
    await mod.analyzeResumeToProfile(RESUME, { config: { provider: "gemini", apiKey: "k", model: "gemini-3.5-flash" } }).catch(() => {});
    assert.ok(calls.length >= 1);
    assert.ok(calls[0].body.generationConfig.maxOutputTokens >= 8192, `cap was ${calls[0].body.generationConfig.maxOutputTokens}`);
  });

  it("Gemini: a MAX_TOKENS answer is reported as truncated, not as non-JSON", async () => {
    stubFetch(() => json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: CUT_JSON }] } }] }));
    await assert.rejects(
      () => mod.analyzeResumeToProfile(RESUME, { config: { provider: "gemini", apiKey: "k", model: "gemini-3.5-flash" } }),
      (err) => {
        assert.match(String(err.code || ""), /TRUNCATED/, `code was ${err.code}`);
        assert.doesNotMatch(String(err.message), /non-JSON/);
        assert.match(String(err.message), /cut off|output limit|too long/i);
        return true;
      },
    );
  });

  it("OpenAI-compatible: finish_reason=length is reported as truncated and the cap is ≥ 8192", async () => {
    const calls = stubFetch(() => json({ choices: [{ finish_reason: "length", message: { content: CUT_JSON } }] }));
    await assert.rejects(
      () => mod.analyzeResumeToProfile(RESUME, { config: { provider: "openrouter", apiKey: "k", model: "openai/gpt-oss-120b", baseUrl: "https://openrouter.ai/api/v1" } }),
      (err) => { assert.match(String(err.code || ""), /TRUNCATED/, `code was ${err.code}`); return true; },
    );
    const cap = calls[0].body.max_tokens ?? calls[0].body.max_completion_tokens;
    assert.ok(cap >= 8192, `cap was ${cap}`);
  });
});
