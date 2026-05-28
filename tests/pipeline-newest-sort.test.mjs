import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");

function loadPipelineInternals() {
  const marker = "  function stageLabel(stageKey) {";
  const instrumented = pipelineJs.replace(
    marker,
    "  root.__pipelineTest = { sortCards: sortCards };\n\n" + marker,
  );
  assert.notEqual(instrumented, pipelineJs, "pipeline.js instrumentation marker moved");

  const win = {};
  const doc = {
    readyState: "loading",
    addEventListener() {},
    body: null,
    querySelector() { return null; },
  };
  vm.runInNewContext(
    instrumented,
    { window: win, document: doc, console, setTimeout, Date, Number, isFinite },
    { filename: "pipeline.js" },
  );
  return win.__pipelineTest;
}

describe("v2 pipeline Newest sort", () => {
  it("sorts by Date Found descending instead of role/company text", () => {
    const { sortCards } = loadPipelineInternals();
    const ordered = sortCards([
      { jobKey: "old-alpha", role: "Alpha", foundAt: "2026-05-25", index: 1 },
      { jobKey: "new-mango", role: "Mango", foundAt: "2026-05-28", index: 2 },
      { jobKey: "mid-zebra", role: "Zebra", foundAt: "2026-05-27", index: 3 },
    ], "newest");

    assert.deepEqual(
      ordered.map((c) => c.jobKey),
      ["new-mango", "mid-zebra", "old-alpha"],
      "Newest should follow Date Found descending, not alphabetical labels",
    );
  });

  it("falls back to sheet row order when Date Found is missing or invalid", () => {
    const { sortCards } = loadPipelineInternals();
    const ordered = sortCards([
      { jobKey: "lower-row", role: "Z", foundAt: "", index: 4 },
      { jobKey: "invalid-date", role: "A", foundAt: "not-a-date", index: 11 },
      { jobKey: "higher-row", role: "M", index: 17 },
    ], "newest");

    assert.deepEqual(
      ordered.map((c) => c.jobKey),
      ["higher-row", "invalid-date", "lower-row"],
      "Newest should use higher sheet row index as the resilience fallback",
    );
  });
});
