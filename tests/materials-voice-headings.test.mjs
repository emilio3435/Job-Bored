import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import "../server/profile-voice-shared.js";
import { voiceProfileLines } from "../server/materials-draft.mjs";
import { namedClientProofs } from "../server/materials-positioning.mjs";
import { headingKey, parseVoiceProfile } from "../server/materials-voice-profile.mjs";

const shared = /** @type {{ JobBoredProfileVoiceShared: { VOICE_GUIDE_PROMPT: string } }} */ (/** @type {unknown} */ (globalThis)).JobBoredProfileVoiceShared;
const fixture = (/** @type {string} */ name) => readFileSync(new URL(`./fixtures/materials-voice/${name}`, import.meta.url), "utf8");
const ONBOARDING = parseVoiceProfile(fixture("voice-onboarding.md"), "/fixture/voice-onboarding.md");
const HAND = parseVoiceProfile(fixture("voice.md"), "/fixture/voice.md");

/** The "## " headings the onboarding template asks the chatbot to write. */
const templateHeadings = shared.VOICE_GUIDE_PROMPT.split("\n").filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());

describe("voice.md heading contract: the onboarding template and the hand-written guide", () => {
  it("should keep the onboarding fixture in the template's exact shape", () => {
    const fixtureHeadings = fixture("voice-onboarding.md").split("\n").filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
    assert.deepEqual(fixtureHeadings, templateHeadings);
    assert.equal(templateHeadings.length, 10);
  });

  it("should match headings case-insensitively and tolerate punctuation", () => {
    assert.equal(headingKey("What it should NEVER sound like:"), "what it should never sound like");
    assert.equal(headingKey("Cover-letter rules"), "cover letter rules");
    const shouted = parseVoiceProfile("## APPROVED FACTS!\n- Built a bot that handles 1,200 tickets a week.\n\n## signature lines —\n- \"Fast is a feature.\"\n");
    assert.deepEqual(shouted.facts, ["Built a bot that handles 1,200 tickets a week.", "Fast is a feature."]);
    assert.deepEqual(shouted.signatureLines, ["Fast is a feature."]);
  });

  it("should read an onboarding guide's Approved facts as voice facts, Signature lines as signature lines, and its letter rules", () => {
    for (const fact of [
      "Seven years at Harbor Health running the patient help desk.",
      "Cut first-response time from 26 hours to 4.",
      "Built a ticket-routing bot that handles 1,200 tickets a week.",
      "Clients included Pine Clinics' 30 locations.",
    ]) {
      assert.ok(ONBOARDING.facts.includes(fact), `missing fact: ${fact}`);
    }
    assert.ok(ONBOARDING.facts.includes("I'm a support-operations lead and automation builder."), "a plain-paragraph core narrative is read too");
    assert.deepEqual(ONBOARDING.signatureLines, ["Fast is a feature.", "I fix the queue before I fix the tone."]);
    assert.deepEqual(ONBOARDING.hookPatterns, ["Fast is a feature.", "I fix the queue before I fix the tone."]);
    assert.match(ONBOARDING.guideText, /## cover letter rules\nThree short paragraphs\. Open with a fact about me, never flattery\./);
    assert.match(ONBOARDING.guideText, /## what my writing should sound like\n/);
    assert.match(ONBOARDING.guideText, /## what it should never sound like\n/);
    assert.match(ONBOARDING.guideText, /## voice summary\n/);
  });

  it("should read an onboarding guide's plain avoid list and inline example pairs", () => {
    assert.equal(ONBOARDING.avoid.length, 3);
    assert.ok(ONBOARDING.avoid.some((a) => new RegExp(a.pattern, "i").test("let's circle back")));
    assert.equal(ONBOARDING.examples.length, 2);
    assert.deepEqual(ONBOARDING.examples[0], {
      title: "Example 1",
      generic: "I am passionate about customer support excellence.",
      better: "I cut first-response time from 26 hours to 4 at Harbor Health.",
      why: ["It names the number and the place."],
    });
  });

  it("should use an onboarding guide's examples as the pattern and its client facts as named-client proofs", () => {
    const text = voiceProfileLines(ONBOARDING, { positioning: { kind: "consultant", why: "test", phrase: "" } }).join("\n");
    assert.match(text, /Voice\.md examples and sample lines are style references, not to be copied[\s\S]*Candidate version: I cut first-response time from 26 hours to 4 at Harbor Health\./);
    assert.deepEqual(namedClientProofs(ONBOARDING), ["Clients included Pine Clinics' 30 locations."]);
  });

  it("should still read the hand-written shape as before", () => {
    assert.ok(HAND.facts.includes("Lumen Grocers, 40 stores."));
    assert.ok(HAND.facts.includes("Clients include Lumen Grocers, Harbor Co-op, Pine Freight."));
    assert.ok(HAND.signatureLines.includes("The best forecasters aren't just modelers — they're drivers' advocates."));
    assert.match(HAND.guideText, /## cover letter voice rules/);
    assert.match(HAND.guideText, /## what the voice should not sound like/);
    assert.equal(HAND.examples.length, 2);
    assert.deepEqual(HAND.links, [{ text: "RouteLab", href: "https://routelab.example" }]);
  });
});
