import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const jbTextSource = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const insightsSource = readFileSync(join(repoRoot, "job-posting-insights.js"), "utf8");

function loadInsights(rawText) {
  const window = {
    CommandCenterResumeGenerate: {
      getResumeGenerationConfig: () => ({
        provider: "local",
        resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
        resumeLocalModel: "fixture-model",
      }),
    },
  };
  const context = vm.createContext({
    window,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: rawText } }] }),
    }),
    URL,
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(jbTextSource, context, { filename: "jb-text.js" });
  vm.runInContext(insightsSource, context, { filename: "job-posting-insights.js" });
  return window.CommandCenterJobPostingInsights;
}

async function enrich(rawText) {
  return loadInsights(rawText).enrichFromScrape(
    { description: "Posting text", requirements: [], skills: [] },
    { title: "Systems Engineer", company: "Acme" },
    "",
  );
}


/* The "visibly demotes to recovered — review" case retired with role-brief.js:
   The Case renders no .brief__struct provenance chip (spec §3). The parse-mode
   lineage the chip read from is still asserted below, on the parser itself. */
describe("DOSSIER-02 recovered parse provenance", () => {
  it("marks loose key/value recovery instead of presenting it as schema output", async () => {
    const out = await enrich(
      "mustHaves: - 5 years Rust\n- willingness to relocate\n" +
      "responsibilities: stuff; more stuff",
    );

    assert.equal(out._parseMode, "loose");
    assert.deepEqual(Array.from(out.mustHaves), ["5 years Rust", "willingness to relocate"]);
  });

  it("marks repaired truncated JSON separately from schema output", async () => {
    const out = await enrich(
      '{"mustHaves":["5 years Rust"],"responsibilities":["Build systems"]',
    );

    assert.equal(out._parseMode, "repaired");
  });

  it("marks valid JSON as schema output", async () => {
    const out = await enrich(JSON.stringify({ mustHaves: ["5 years Rust"] }));
    assert.equal(out._parseMode, "schema");
  });

});
