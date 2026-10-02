/**
 * HOLES PROV · P15: ATS_PROVIDER=ollama (or local) migrates into llm.json as
 * the local pin it names, not as a keyless Gemini pin.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { migrateLlmConfigFromEnv } from "../server/llm-config.mjs";


let dir;
let env;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-holes-prov-params-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("P15 · ATS_PROVIDER aliases migrate as the provider they name", () => {
  for (const spelling of ["ollama", "local", "OLLAMA"]) {
    it(`ATS_PROVIDER=${spelling} becomes an openai_compatible pin with the compatible env settings`, () => {
      const migrated = migrateLlmConfigFromEnv({
        ...env,
        ATS_PROVIDER: spelling,
        ATS_GEMINI_API_KEY: "fictional-gemini-key",
        ATS_OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:11434/v1",
        ATS_OPENAI_COMPATIBLE_MODEL: "gemma4:e2b",
      });
      assert.equal(migrated.provider, "openai_compatible");
      assert.equal(migrated.alias, spelling.toLowerCase() === "ollama" ? "ollama" : "local");
      assert.equal(migrated.model, "gemma4:e2b");
      assert.equal(migrated.baseUrl, "http://127.0.0.1:11434/v1");
      assert.equal(migrated.apiKey, "", "the Gemini key never rides along");
    });
  }

  it("an unknown ATS_PROVIDER still migrates as Gemini, as ats-scorecard reads it", () => {
    const migrated = migrateLlmConfigFromEnv({ ...env, ATS_PROVIDER: "webhook", ATS_GEMINI_API_KEY: "fictional-gemini-key", ATS_GEMINI_MODEL: "gemini-3.8-flash" });
    assert.equal(migrated.provider, "gemini");
    assert.equal(migrated.apiKey, "fictional-gemini-key");
  });
});
