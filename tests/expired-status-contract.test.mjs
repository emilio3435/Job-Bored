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
    const app = read("app.js");
    const brief = read("daily-brief.js");

    assert.match(app, /const STAGE_ORDER = \[[\s\S]*"Expired"[\s\S]*\];/);
    assert.match(app, /const STAGE_ARCHIVE = new Set\(\["Rejected", "Passed", "Expired"\]\)/);
    assert.match(app, /case "Expired":[\s\S]*Pipeline!P/);
    assert.match(app, /const statuses = \[[\s\S]*"Expired"[\s\S]*\];/);
    assert.match(brief, /const expired = getPipelineData\(\)\.filter/);
    assert.match(
      brief,
      /\{ label: "Expired", count: expired, color: "var\(--stage-rail-expired\)" \}/,
    );
  });

  it("keeps v2 pipeline adapters from dropping Expired rows", () => {
    // dawn-data.js carries the canonical stage definition that backs the
    // sheet contract — its label still mirrors the schema enum.
    assert.match(read("dawn-data.js"), /\{ key: "expired",\s+label: "Expired"/);
    // pipeline.js is the user-facing kanban; it surfaces the same stage
    // under the gentler "Dismissed" label while preserving the schema key.
    assert.match(read("pipeline.js"), /\{ key: "expired",\s+label: "Dismissed"/);
    assert.match(read("pipeline.css"), /--pipe-col-expired/);
    assert.match(read("flowing-writes.js"), /"expired": "Expired"/);
  });
});
