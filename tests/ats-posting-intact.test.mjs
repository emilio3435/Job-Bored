/**
 * BEAUDIT lane Q, E18 descope (orchestrator decision): the ATS prompt sends the
 * posting description as the base clip, with no heading-based boilerplate drop.
 * A heading-shaped line such as "Benefits administration experience is
 * required." is a requirement, and every requirement line must reach the
 * prompt intact.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir;
let savedPath;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-q-posting-"));
  savedPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
});
afterEach(async () => {
  if (savedPath === undefined) delete process.env.JOBBORED_LLM_CONFIG_PATH;
  else process.env.JOBBORED_LLM_CONFIG_PATH = savedPath;
  await rm(dir, { recursive: true, force: true });
});

const REQUIREMENT_LINES = [
  "This role owns payroll and HR systems for 4,000 employees.",
  "Active TS/SCI clearance required.",
  "Benefits administration experience is required.",
  "- 5+ years administering Workday HCM",
  "- PHR or SHRM-CP certification",
];

const POSTING = [
  "About us",
  "Acme builds rockets for coyotes.",
  "About the role",
  REQUIREMENT_LINES[0],
  "Job Summary",
  REQUIREMENT_LINES[1],
  REQUIREMENT_LINES[2],
  REQUIREMENT_LINES[3],
  REQUIREMENT_LINES[4],
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
      docText: "Dear hiring manager, I run HR systems.",
      job: { title: "HRIS Lead", company: "Acme", postingEnrichment: { description } },
    }).catch(() => {});
  } finally {
    globalThis.fetch = original;
  }
  return prompt;
}

describe("E18 descope: the ATS prompt keeps the posting's requirement lines", () => {
  it("a posting with About us, About the role, Job Summary and a Benefits-led requirement reaches the prompt intact", async () => {
    const prompt = await capturePrompt(POSTING);
    assert.ok(prompt.length > 0, "no prompt captured");
    for (const line of REQUIREMENT_LINES) {
      assert.ok(prompt.includes(line), `prompt is missing requirement line: ${line}`);
    }
  });
});
