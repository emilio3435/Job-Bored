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

/**
 * Load resume-generate.js in an isolated vm context (the browser-global IIFE
 * pattern used across the resume tests) and return its public surface.
 */
function loadResumeGenerate({ config = {} } = {}) {
  const ctx = {
    window: { COMMAND_CENTER_CONFIG: config },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(resumeGenerateJs, ctx, { filename: "resume-generate.js" });
  return ctx.window.CommandCenterResumeGenerate;
}

const RG = loadResumeGenerate();
const resumePrompt = RG.buildSystemPrompt({ feature: "resume" });
const coverLetterPrompt = RG.buildSystemPrompt({ feature: "cover_letter" });

const OWNER_TOKENS = [/audacy/i, /AI-builder or systems proof point/i];

describe("generic resume system prompt (VAL-PROMPT-001)", () => {
  it("buildSystemPrompt carries no owner-specific facts in resume mode", () => {
    for (const token of OWNER_TOKENS) {
      assert.doesNotMatch(resumePrompt, token);
    }
  });

  it("buildSystemPrompt carries no owner-specific facts in cover_letter mode", () => {
    for (const token of OWNER_TOKENS) {
      assert.doesNotMatch(coverLetterPrompt, token);
    }
  });

  it("resume-generate.js source contains no owner-specific tokens", () => {
    for (const token of OWNER_TOKENS) {
      assert.doesNotMatch(resumeGenerateJs, token);
    }
  });
});

describe("insights sentinel + mode split (VAL-PROMPT-003)", () => {
  const SENTINEL_KEYS = ["fitAngle", "keywordCoverage", "toneMatch", "length"];

  it("resume prompt includes sentinel with four keys", () => {
    assert.ok(resumePrompt.includes("---JB-INSIGHTS---"));
    assert.ok(resumePrompt.includes("---END-JB-INSIGHTS---"));
    for (const key of SENTINEL_KEYS) {
      assert.ok(
        resumePrompt.includes(`"${key}"`),
        `resume sentinel must name ${key}`,
      );
    }
  });

  it("cover_letter prompt includes sentinel with four keys", () => {
    assert.ok(coverLetterPrompt.includes("---JB-INSIGHTS---"));
    assert.ok(coverLetterPrompt.includes("---END-JB-INSIGHTS---"));
    for (const key of SENTINEL_KEYS) {
      assert.ok(
        coverLetterPrompt.includes(`"${key}"`),
        `cover_letter sentinel must name ${key}`,
      );
    }
  });

  it("resume vs cover_letter mode bodies differ", () => {
    assert.notEqual(resumePrompt, coverLetterPrompt);
    // Resume mode: editor framing + section/page-shape rule.
    assert.match(resumePrompt, /expert resume editor/);
    assert.match(resumePrompt, /SUMMARY, EXPERIENCE, EDUCATION, and SKILLS\/CAPABILITIES/);
    assert.doesNotMatch(resumePrompt, /expert career coach/);
    // Cover-letter mode: coach framing + word-band rule.
    assert.match(coverLetterPrompt, /expert career coach/);
    assert.match(coverLetterPrompt, /325-450 words/);
    assert.doesNotMatch(coverLetterPrompt, /expert resume editor/);
  });
});
