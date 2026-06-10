import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   Settings → AI Providers — live "Check connection" + self-
   updating model lists, sourced from the shared
   JobBoredModelCatalog.

   This test file is source-sniff only: settings-modal.js is a
   classic-global that opens the modal via real DOM + heavy host
   bridges. The behavioral path is already covered by
   tests/first-run-wizard-provider-picker.test.mjs (same shared
   catalog + same call site). Here we pin:
     - the per-provider "Check connection" buttons + status lines
       exist in the Settings partial
     - settings-modal.js routes the model fill through the catalog
     - settings-modal.js exposes a verify call that uses the catalog
     - the static fallback list mirrored from
       CommandCenterResumeModelOptions still carries current
       Anthropic ids (claude-opus-4-8, claude-fable-5)
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsPartial = readFileSync(
  join(repoRoot, "partials", "settings-modal.html"),
  "utf8",
);
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);
const resumeGenerateJs = readFileSync(
  join(repoRoot, "resume-generate.js"),
  "utf8",
);

describe("Settings → AI Providers — Check connection controls", () => {
  it("every provider panel exposes a Check connection button + status line", () => {
    const buttons = [
      "settingsOpenRouterCheckBtn",
      "settingsGeminiCheckBtn",
      "settingsOpenAICheckBtn",
      "settingsAnthropicCheckBtn",
      "settingsLocalCheckBtn",
    ];
    for (const id of buttons) {
      assert.ok(
        settingsPartial.includes(`id="${id}"`),
        `Settings partial must define ${id} so users can verify their key live`,
      );
    }
    for (const id of [
      "settingsOpenRouterCheckStatus",
      "settingsGeminiCheckStatus",
      "settingsOpenAICheckStatus",
      "settingsAnthropicCheckStatus",
      "settingsLocalCheckStatus",
    ]) {
      assert.ok(
        settingsPartial.includes(`id="${id}"`),
        `Settings partial must define ${id} as the inline status line`,
      );
    }
  });
});

describe("Settings → AI Providers — self-updating model dropdowns", () => {
  it("settings-modal.js routes model fills through JobBoredModelCatalog when a key is present", () => {
    assert.ok(
      settingsModalJs.includes("JobBoredModelCatalog"),
      "settings-modal.js should consume the shared catalog so its dropdowns are 'ever-updating'",
    );
  });

  it("settings-modal.js exposes a check-connection click handler that uses the catalog", () => {
    // We don't pin a specific function name beyond the load-bearing one — the
    // verify handler is invoked by the new buttons.
    assert.ok(
      /settingsResume(?:Gemini|OpenAI|Anthropic|OpenRouter|Local)CheckBtn|settingsVerifyProvider|verifyProvider/.test(
        settingsModalJs,
      ),
      "settings-modal.js should bind a verify handler for the new Check connection buttons",
    );
    assert.ok(
      /pingProvider/.test(settingsModalJs),
      "the verify handler should reach JobBoredModelCatalog.pingProvider",
    );
  });

  it("CommandCenterResumeModelOptions.anthropic carries current ids (claude-opus-4-8 / claude-fable-5)", () => {
    for (const id of [
      "claude-opus-4-8",
      "claude-fable-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]) {
      assert.ok(
        resumeGenerateJs.includes(`value: "${id}"`),
        `CommandCenterResumeModelOptions.anthropic must include ${id} so the Settings dropdown shows the current line-up without a live fetch`,
      );
    }
  });
});
