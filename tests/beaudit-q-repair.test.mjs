/**
 * BEAUDIT lane Q repair round.
 *
 * E18: the ATS prompt sends the posting's requirement sections, not the whole
 *      description (company blurb, benefits and EEO boilerplate are dropped).
 * B17: the materials writer sends the Gemini key in x-goog-api-key, never in
 *      the URL.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir;
let savedPath;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-q-repair-"));
  savedPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
});
afterEach(async () => {
  if (savedPath === undefined) delete process.env.JOBBORED_LLM_CONFIG_PATH;
  else process.env.JOBBORED_LLM_CONFIG_PATH = savedPath;
  await rm(dir, { recursive: true, force: true });
});

const BLURB = "Acme was founded in 1999 and builds rockets for coyotes worldwide. ".repeat(80);
const PERKS = "Unlimited snacks, a pet-friendly office and quarterly offsites. ".repeat(40);
const EEO = "Acme is an equal opportunity employer and values diversity. ".repeat(20);
const DESCRIPTION = [
  "About Acme",
  BLURB,
  "Requirements",
  "- 5+ years of Go in production",
  "- Kafka and PostgreSQL operations",
  "Responsibilities",
  "- Own the payments ledger service",
  "Benefits",
  PERKS,
  "Equal Opportunity",
  EEO,
].join("\n");

async function capturePrompt(description) {
  await writeFile(
    process.env.JOBBORED_LLM_CONFIG_PATH,
    JSON.stringify({ provider: "openai_compatible", model: "m", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" }),
  );
  const { analyzeAtsScorecard } = await import("../server/ats-scorecard.mjs");
  const original = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    prompt = body.messages.map((m) => String(m.content)).join("\n");
    throw new Error("stop after capture");
  };
  try {
    await analyzeAtsScorecard({
      feature: "cover_letter",
      docText: "Dear hiring manager, I build payments systems in Go.",
      job: { title: "Engineer", company: "Acme", postingEnrichment: { description } },
    }).catch(() => {});
  } finally {
    globalThis.fetch = original;
  }
  return prompt;
}

describe("E18 the ATS prompt trims the posting to its requirement sections", () => {
  it("keeps Requirements and Responsibilities and drops the blurb, benefits and EEO text", async () => {
    const prompt = await capturePrompt(DESCRIPTION);
    assert.match(prompt, /5\+ years of Go in production/);
    assert.match(prompt, /Kafka and PostgreSQL operations/);
    assert.match(prompt, /Own the payments ledger service/);
    assert.doesNotMatch(prompt, /rockets for coyotes/);
    assert.doesNotMatch(prompt, /Unlimited snacks/);
    assert.doesNotMatch(prompt, /equal opportunity employer/);
    assert.ok(prompt.length < 3000, `prompt is ${prompt.length} chars`);
  });

  it("falls back to a clipped description when the posting has no requirement heading", async () => {
    const prompt = await capturePrompt(`We need a Go engineer for payments. ${"x ".repeat(6000)}`);
    assert.match(prompt, /We need a Go engineer for payments/);
    assert.ok(prompt.length < 6000, `prompt is ${prompt.length} chars`);
  });
});

describe("B17 the materials writer keeps the Gemini key out of the URL", () => {
  it("sends x-goog-api-key and a key-free generateContent URL", async () => {
    const { callWriter } = await import("../server/materials-writer.mjs");
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      throw new Error("stop after capture");
    };
    await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "AIza-writer-key", baseUrl: "" },
      jdText: "x",
      masterResumeHtml: "y",
      voiceSamples: [],
      fetchImpl,
    }).catch(() => {});
    assert.ok(calls.length >= 1);
    assert.doesNotMatch(calls[0].url, /[?&]key=/);
    assert.doesNotMatch(calls[0].url, /AIza-writer-key/);
    assert.equal(new Headers(calls[0].init.headers).get("x-goog-api-key"), "AIza-writer-key");
  });
});

/**
 * E18 worst case: every input at its cap. The audit measured ~50k docText +
 * 25k posting + profile text, about 20k tokens per ATS call. The prompt now
 * clips docText at 18000, trims the posting to its requirement sections
 * (<= 4000) and shares one 10000-character budget across the optional
 * profile excerpts, so the whole prompt stays under 42000 characters.
 */
const PROMPT_BUDGET = 42_000;

async function captureWorstCasePrompt() {
  await writeFile(
    process.env.JOBBORED_LLM_CONFIG_PATH,
    JSON.stringify({ provider: "openai_compatible", model: "m", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" }),
  );
  const { analyzeAtsScorecard } = await import("../server/ats-scorecard.mjs");
  const original = globalThis.fetch;
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    prompt = body.messages.map((m) => String(m.content)).join("\n");
    throw new Error("stop after capture");
  };
  const posting = [
    "About Acme",
    "Acme builds rockets for coyotes. ".repeat(300),
    "Requirements",
    ...Array.from({ length: 400 }, (_, i) => `- Requirement ${i}: operate Go services in production`),
    "Benefits",
    "Unlimited snacks. ".repeat(300),
  ].join("\n");
  try {
    await analyzeAtsScorecard({
      feature: "cover_letter",
      docText: "I build payments systems in Go. ".repeat(1600),
      job: {
        title: "Engineer",
        company: "Acme",
        fitAssessment: "f".repeat(5000),
        talkingPoints: "t".repeat(5000),
        notes: "n".repeat(5000),
        postingEnrichment: { description: posting },
      },
      profile: {
        candidateProfileText: "CANDIDATE ".repeat(2000),
        resumeSourceText: "RESUME ".repeat(2000),
        linkedinProfileText: "LINKEDIN ".repeat(2000),
        additionalContextText: "EXTRA ".repeat(2000),
      },
      instructions: { userNotes: "u".repeat(5000), refinementFeedback: "r".repeat(5000) },
    }).catch(() => {});
  } finally {
    globalThis.fetch = original;
  }
  return { prompt, posting };
}

describe("E18 worst-case ATS prompt size", () => {
  it(`stays under ${PROMPT_BUDGET} characters with every input at its cap`, async () => {
    const { prompt, posting } = await captureWorstCasePrompt();
    assert.ok(prompt.length > 0, "no prompt captured");
    assert.ok(posting.length > 20_000, "fixture posting must be large");
    assert.doesNotMatch(prompt, /rockets for coyotes/);
    assert.doesNotMatch(prompt, /Unlimited snacks/);
    const postingPart = prompt.slice(
      prompt.indexOf("Description (requirement sections):"),
      prompt.indexOf("\nRequirements:"),
    );
    assert.ok(postingPart.length <= 4_100, `posting section is ${postingPart.length} chars`);
    const profilePart = prompt.slice(prompt.indexOf("--- Candidate profile excerpts"));
    const excerptChars = (profilePart.match(/CANDIDATE |RESUME |LINKEDIN |EXTRA /g) || []).join("").length;
    assert.ok(excerptChars <= 10_000, `profile excerpts are ${excerptChars} chars`);
    assert.ok(prompt.length < PROMPT_BUDGET, `prompt is ${prompt.length} chars`);
  });
});
