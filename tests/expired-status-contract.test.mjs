import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("Expired pipeline status contract", () => {
  it("documents Expired across schema and public contract docs", () => {
    const schema = JSON.parse(read("schemas/pipeline-row.v1.json"));
    const statusEnum = schema.columns.find((c) => c.id === "status").enum;

    assert.deepEqual(statusEnum.slice(-2), ["Passed", "Expired"]);
    assert.match(read("README.md"), /Rejected \/ Passed \/ Expired/);
    assert.match(read("AGENT_CONTRACT.md"), /`Rejected`, `Passed`, `Expired`/);
  });

  it("surfaces Expired in legacy dashboard stages, dropdowns, and brief counts", () => {
    const pipelineController = read("pipeline-controller.js");
    const sheetsWrite = read("sheets-writeback.js");
    const pipelineRender = read("pipeline-render.js");
    const brief = read("daily-brief.js");

    // Stage lists now come from stage-registry.js (window.JobBoredStages);
    // each consumer keeps only the pinned STAGE_FALLBACK mirror. Expired must
    // still reach the end of every one of them, and stay an archived column.
    assert.match(
      pipelineController,
      /const STAGE_FALLBACK = \[[\s\S]*\["expired", "Expired"\][\s\S]*\];/,
    );
    assert.ok(
      pipelineController.includes("reg.ARCHIVE_KEYS.map"),
      "the archive set should come from the registry's ARCHIVE_KEYS (rejected/passed/expired)",
    );
    assert.match(sheetsWrite, /case "Expired":[\s\S]*Pipeline!P/);
    assert.ok(
      pipelineRender.includes("const statuses = STAGE_ORDER;"),
      "the drawer status dropdown should offer the canonical stage list, not a fourth copy",
    );
    assert.match(brief, /const expired = getPipelineData\(\)\.filter/);
    assert.match(
      brief,
      /\{ label: "Expired", count: expired, color: "var\(--stage-rail-expired\)" \}/,
    );
  });

  it("keeps v2 pipeline adapters from dropping Expired rows", () => {
    // Every v2 adapter mirrors the schema label for Expired. pipeline.js used
    // to relabel it "Dismissed", which named a completely different write
    // (dismissJob -> Pipeline!W); see tests/closure-model-convergence.test.mjs.
    assert.match(read("dawn-data.js"), /\["expired", "Expired"\]/);
    assert.match(read("pipeline.js"), /\["expired", "Expired"\]/);
    assert.equal(
      /"expired":\s*"Dismissed"/.test(read("pipeline.js")),
      false,
      "the Expired column must not be labelled Dismissed",
    );
    assert.match(read("pipeline.css"), /--pipe-col-expired/);
    assert.match(read("flowing-writes.js"), /"expired": "Expired"/);
  });
});
