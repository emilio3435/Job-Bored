/**
 * server/.env commonly carries ATS_PROVIDER=gemini for the scorecard. That
 * must not hijack the profile drafter when the drafter has its own provider
 * (PROFILE_PROVIDER=openrouter) — and an ATS pin WITHOUT a key must never
 * shadow a configured drafter provider at all. Seen 2026-09-02: a checkout
 * with server/.env drafted through "Gemini" with no key → 500
 * "Missing Gemini API key" while PROFILE_PROVIDER said openrouter.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(repoRoot, "server", "profile-from-resume.mjs")).href);

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const PIN_DIR = mkdtempSync(join(tmpdir(), "jb-pin-"));
const CLEAN = { JOBBORED_LLM_CONFIG_PATH: join(PIN_DIR, "llm.json"), ATS_GEMINI_API_KEY: undefined, GEMINI_API_KEY: undefined, PROFILE_GEMINI_API_KEY: undefined, ATS_OPENAI_API_KEY: undefined, ATS_ANTHROPIC_API_KEY: undefined };

describe("profile drafter provider precedence", () => {
  it("an ATS pin without a key does not shadow a configured PROFILE_PROVIDER", () => {
    withEnv({ ...CLEAN, ATS_PROVIDER: "gemini", ATS_GEMINI_MODEL: "gemini-3.5-flash", PROFILE_PROVIDER: "openrouter", PROFILE_OPENROUTER_API_KEY: "sk-or-x", PROFILE_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1", PROFILE_OPENROUTER_MODEL: "m" }, () => {
      const cfg = mod.getProfileProviderConfig();
      assert.equal(cfg.provider, "openrouter", `got ${cfg.provider}`);
    });
  });

  it("an explicit PROFILE_PROVIDER wins even over a keyed ATS pin", () => {
    withEnv({ ...CLEAN, ATS_PROVIDER: "gemini", ATS_GEMINI_API_KEY: "ats-key", ATS_GEMINI_MODEL: "gemini-3.5-flash", PROFILE_PROVIDER: "openrouter", PROFILE_OPENROUTER_API_KEY: "sk-or-x", PROFILE_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1", PROFILE_OPENROUTER_MODEL: "m" }, () => {
      assert.equal(mod.getProfileProviderConfig().provider, "openrouter");
    });
  });

  it("with no PROFILE_PROVIDER, a keyed ATS/Gemini pin is still used (compatibility)", () => {
    withEnv({ ...CLEAN, ATS_PROVIDER: "gemini", ATS_GEMINI_API_KEY: "ats-key", ATS_GEMINI_MODEL: "gemini-3.5-flash", PROFILE_PROVIDER: undefined, PROFILE_LLM_PROVIDER: undefined, PROFILE_OPENROUTER_API_KEY: undefined }, () => {
      const cfg = mod.getProfileProviderConfig();
      assert.equal(cfg.provider, "gemini");
      assert.equal(cfg.apiKey, "ats-key");
    });
  });
});
