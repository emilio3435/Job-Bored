import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");

function loadPipelineInternals() {
  // Marker must appear AFTER RECENTLY_MOVED_TTL_MS is assigned (var hoists
  // but the value isn't bound until the assignment line runs).
  const marker = "  function normalizePipelineFilters(raw) {";
  const instrumented = pipelineJs.replace(
    marker,
    "  root.__pipelineTest = {\n" +
      "    isRecentlyMoved: isRecentlyMoved,\n" +
      "    RECENTLY_MOVED_TTL_MS: RECENTLY_MOVED_TTL_MS,\n" +
      "  };\n\n" +
      marker,
  );
  assert.notEqual(instrumented, pipelineJs, "marker moved");

  const win = {};
  const doc = {
    readyState: "loading",
    addEventListener() {},
    body: null,
    querySelector() { return null; },
  };
  vm.runInNewContext(
    instrumented,
    { window: win, document: doc, console, setTimeout, Date, Number, isFinite, Object, Math },
    { filename: "pipeline.js" },
  );
  return win.__pipelineTest;
}

describe("pipeline recently-moved card pin", () => {
  it("isRecentlyMoved returns true within the TTL window for the matching jobKey", () => {
    const { isRecentlyMoved, RECENTLY_MOVED_TTL_MS } = loadPipelineInternals();
    const now = Date.now();
    const state = { recentlyMovedJobKey: "42", recentlyMovedAt: now };
    assert.equal(isRecentlyMoved(state, "42"), true, "Just moved → pinned");
    assert.equal(isRecentlyMoved(state, 42), true, "Coerces numeric key to string");
    assert.equal(isRecentlyMoved(state, "99"), false, "Different jobKey → not pinned");
    assert.ok(RECENTLY_MOVED_TTL_MS > 0, "TTL is a positive number");
  });

  it("isRecentlyMoved returns false once the TTL window has elapsed", () => {
    const { isRecentlyMoved, RECENTLY_MOVED_TTL_MS } = loadPipelineInternals();
    const state = {
      recentlyMovedJobKey: "42",
      recentlyMovedAt: Date.now() - RECENTLY_MOVED_TTL_MS - 1000,
    };
    assert.equal(isRecentlyMoved(state, "42"), false, "Past TTL → not pinned");
  });

  it("isRecentlyMoved returns false when no recently-moved key is set", () => {
    const { isRecentlyMoved } = loadPipelineInternals();
    assert.equal(isRecentlyMoved({}, "42"), false);
    assert.equal(isRecentlyMoved({ recentlyMovedJobKey: "" }, "42"), false);
    assert.equal(isRecentlyMoved(null, "42"), false);
  });
});
