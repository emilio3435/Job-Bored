/**
 * "Your voice" — the shared module both the wizard step and Settings use
 * (server/profile-voice-shared.js): the chatbot prompt, and the live
 * preview's word count and heading / key-section detection. The server
 * uses the same checks for PUT /profile/voice.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import "../server/profile-voice-shared.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const voice = /** @type {any} */ (globalThis).JobBoredProfileVoiceShared;

const GUIDE = `# Voice guide — Jordan Rivera

## Voice summary
Plain and specific.

## What my writing should sound like
- Short sentences.

## Approved facts
- Grew trial-to-paid conversion 38% in two quarters

## Cover letter rules
Three short paragraphs.
`;

describe("the voice guide prompt", () => {
  it("should ask the chatbot to interview first and write the ten sections", () => {
    const prompt = voice.VOICE_GUIDE_PROMPT;
    assert.ok(prompt.startsWith("I want you to write a voice guide for me:"));
    assert.ok(prompt.includes("Interview me first."));
    for (const heading of [
      "# Voice guide — [my name]",
      "## Voice summary",
      "## What my writing should sound like",
      "## What it should never sound like",
      "## Core narrative",
      "## Approved facts",
      "## Cover letter rules",
      "## Resume line rules",
      "## Signature lines",
      "## Phrases to avoid",
      "## Example rewrites",
    ]) {
      assert.ok(prompt.includes(`\n${heading}\n`), `prompt names "${heading}"`);
    }
    assert.ok(prompt.endsWith("give me the whole guide in one Markdown block so I can copy it."));
  });

  it("should be the same text in the browser, where both surfaces read it", () => {
    const source = readFileSync(join(repoRoot, "server", "profile-voice-shared.js"), "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    assert.equal(sandbox.window.JobBoredProfileVoiceShared.VOICE_GUIDE_PROMPT, voice.VOICE_GUIDE_PROMPT);
  });
});

describe("findHeadings", () => {
  it("should list ATX headings in order with their level", () => {
    assert.deepEqual(voice.findHeadings(GUIDE), [
      { level: 1, text: "Voice guide — Jordan Rivera" },
      { level: 2, text: "Voice summary" },
      { level: 2, text: "What my writing should sound like" },
      { level: 2, text: "Approved facts" },
      { level: 2, text: "Cover letter rules" },
    ]);
  });

  it("should read whole-line bold labels as headings, and ignore headings inside code blocks", () => {
    const text = "**Approved facts:**\n- one\n\n```\n## Not a heading\n```\n### Cover letter rules ###\n";
    assert.deepEqual(voice.findHeadings(text), [
      { level: 0, text: "Approved facts" },
      { level: 3, text: "Cover letter rules" },
    ]);
  });

  it("should not treat a hashtag or bold words mid-sentence as a heading", () => {
    assert.deepEqual(voice.findHeadings("#hiring is a tag\nI **really** mean it.\n"), []);
  });
});

describe("analyzeVoiceGuide", () => {
  it("should count words and find both key sections in a complete guide", () => {
    const result = voice.analyzeVoiceGuide(GUIDE);
    assert.equal(result.words, 32);
    assert.deepEqual(result.found, ["approved-facts", "cover-letter-rules"]);
    assert.deepEqual(result.missing, []);
    assert.equal(result.empty, false);
    assert.equal(result.tooLarge, false);
  });

  it("should match the key sections whatever their case, punctuation or extra words", () => {
    const result = voice.analyzeVoiceGuide("## APPROVED FACTS:\n- x\n## My cover-letter rules\n- y\n");
    assert.deepEqual(result.found, ["approved-facts", "cover-letter-rules"]);
    const spaced = voice.analyzeVoiceGuide("## approved   facts\n## Cover letter rules (short)\n");
    assert.deepEqual(spaced.found, ["approved-facts", "cover-letter-rules"]);
  });

  it("should name the key sections a guide is missing", () => {
    const result = voice.analyzeVoiceGuide("# My voice\n\nI write short, warm notes.");
    assert.deepEqual(
      result.missing.map((section) => section.label),
      ["Approved facts", "Cover letter rules"],
    );
    assert.equal(result.headings.length, 1);
  });

  it("should analyze a guide pasted with its chatbot code fence", () => {
    const result = voice.analyzeVoiceGuide("```markdown\n" + GUIDE + "```");
    assert.equal(result.headings.length, 5);
    assert.equal(result.text.startsWith("# Voice guide"), true);
  });

  it("should count words in any script", () => {
    assert.equal(voice.countWords("Don't stop — l'été 200+ 東京"), 5);
    assert.equal(voice.countWords(""), 0);
  });
});

describe("voiceProblem", () => {
  it("should accept a guide and name what is wrong with the rest", () => {
    assert.equal(voice.voiceProblem(GUIDE), "");
    assert.equal(voice.voiceProblem(""), "empty");
    assert.equal(voice.voiceProblem("  \n "), "empty");
    assert.equal(voice.voiceProblem("---\n***\n"), "empty");
    assert.equal(voice.voiceProblem(null), "empty");
    assert.equal(voice.voiceProblem("PK\u0003\u0004\u0000"), "binary");
    assert.equal(voice.voiceProblem("�".repeat(20) + " text"), "binary");
    assert.equal(voice.voiceProblem("a ".repeat(40000)), "too_large");
  });

  it("should measure the cap in UTF-8 bytes, not characters", () => {
    assert.equal(voice.byteLength("é"), 2);
    assert.equal(voice.byteLength("東"), 3);
    assert.equal(voice.byteLength("😀"), 4);
    // 30,000 two-byte letters is 60 KB: under. 33,000 is over.
    assert.equal(voice.voiceProblem("é".repeat(30000)), "");
    assert.equal(voice.voiceProblem("é".repeat(33000)), "too_large");
  });
});
