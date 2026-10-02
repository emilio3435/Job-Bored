/**
 * HOLES PROV · P7 (browser): OpenAI's reasoning models (gpt-5*, o1/o3/o4)
 * reject `temperature`, and the default OpenAI model is a gpt-5 model. The
 * browser drops it for that family only, using the same family test that
 * already switches those models to max_completion_tokens.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputBudgetJs = readFileSync(join(repoRoot, "llm-output-budget.js"), "utf8");
const resumeGenerateJs = readFileSync(join(repoRoot, "resume-generate.js"), "utf8");

const BUNDLE = { feature: "resume", profile: { name: "Sample" }, job: { title: "SRE" } };

function load(config, { withBudget = true } = {}) {
  const calls = [];
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    },
  };
  vm.createContext(ctx);
  if (withBudget) vm.runInContext(outputBudgetJs, ctx, { filename: "llm-output-budget.js" });
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return { rg: ctx.window.CommandCenterResumeGenerate, calls };
}

/** One drafting call, then one inline call, against the same config. */
async function draftAndInline(config, options) {
  const { rg, calls } = load(config, options);
  await rg.generateFromBundle(BUNDLE);
  await rg.callConfiguredAi("sys", "user", {});
  assert.equal(calls.length, 2);
  return { draft: calls[0].body, inline: calls[1].body };
}

const openai = (model) => ({
  resumeProvider: "openai",
  resumeOpenAIApiKey: "fictional-key",
  resumeOpenAIModel: model,
});

describe("HOLES PROV P7 · OpenAI reasoning models get no temperature", () => {
  for (const model of ["gpt-5.4", "gpt-5.6-terra", "o3"]) {
    it(`omits temperature for ${model} in drafting and inline calls`, async () => {
      const { draft, inline } = await draftAndInline(openai(model));
      for (const [where, body] of [["drafting", draft], ["inline", inline]]) {
        assert.equal(body.model, model);
        assert.equal("temperature" in body, false, `${where} body for ${model} must not carry temperature`);
        assert.ok("max_completion_tokens" in body, `${where} body still uses the reasoning-family limit`);
      }
    });
  }

  it("keeps temperature for gpt-4o-mini (0.7 drafting, 0.5 inline)", async () => {
    const { draft, inline } = await draftAndInline(openai("gpt-4o-mini"));
    assert.equal(draft.temperature, 0.7);
    assert.equal(inline.temperature, 0.5);
    assert.ok("max_tokens" in draft);
  });

  it("keeps temperature on OpenRouter, even for an OpenAI reasoning model id", async () => {
    const { draft, inline } = await draftAndInline({
      resumeProvider: "openrouter",
      resumeOpenRouterApiKey: "fictional-key",
      resumeOpenRouterModel: "openai/gpt-5.4-mini",
    });
    assert.equal(draft.temperature, 0.7);
    assert.equal(inline.temperature, 0.5);
  });

  it("still drafts when llm-output-budget.js has not loaded (fallback keeps temperature)", async () => {
    const { draft, inline } = await draftAndInline(openai("gpt-5.4"), { withBudget: false });
    assert.equal(draft.temperature, 0.7);
    assert.equal(inline.temperature, 0.5);
  });
});
