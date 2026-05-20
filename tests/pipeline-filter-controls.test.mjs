import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");
const latticeCss = readFileSync(join(repoRoot, "lattice.css"), "utf8");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");
const legacyHideCss = readFileSync(join(repoRoot, "jb-v2-legacy-hide.css"), "utf8");

describe("v2 pipeline filter controls", () => {
  it("does not rely on the hidden legacy filter bar for v2", () => {
    assert.ok(
      legacyHideCss.includes("body.jb-v2 #dashboard > main.main-content"),
      "v2 hides the legacy main-content surface where the old filters live",
    );
    assert.ok(
      pipelineJs.includes('data-filter="favorites"') &&
        pipelineJs.includes('data-filter="dismissed"') &&
        pipelineJs.includes('aria-label="Pipeline filters"'),
      "visible v2 pipeline toolbar should render favorites and dismissed filter chips",
    );
    assert.ok(
      latticeJs.includes('aria-label": "Pipeline filters"') &&
        latticeJs.includes('"★ Favorites"') &&
        latticeJs.includes('"Dismissed"'),
      "lattice pipeline toolbar should expose the same filters when that surface is active",
    );
  });

  it("wires v2 filter chips to the app's existing pipeline filter state", () => {
    assert.ok(
      appJs.includes("window.JobBored.getPipelineViewFilters = getPipelineViewFilters;") &&
        appJs.includes("window.JobBored.setPipelineViewFilters = setPipelineViewFilters;") &&
        appJs.includes("window.JobBored.getPipelineJobs = function ()"),
      "app.js should expose a minimal filter API for v2 surfaces",
    );
    assert.ok(
      pipelineJs.includes("api.getPipelineViewFilters") &&
        pipelineJs.includes("api.setPipelineViewFilters") &&
        pipelineJs.includes("jb:pipeline:filters-changed"),
      "pipeline.js should read, write, and sync against the app filter API",
    );
    assert.ok(
      latticeJs.includes("window.JobBored.getPipelineViewFilters") &&
        latticeJs.includes("window.JobBored.setPipelineViewFilters") &&
        latticeJs.includes("window.JobBored.getPipelineJobs"),
      "lattice.js should use the same app filter API instead of private globals",
    );
  });

  it("matches the v2 pipeline toolbar visual language", () => {
    assert.ok(
      pipelineCss.includes(".pipe-tool__chips--filters") &&
        pipelineCss.includes(".pipe-tool__chip--filter[aria-pressed=\"true\"]") &&
        pipelineCss.includes("var(--jb-amber-soft)") &&
        pipelineCss.includes("border-block-start: 1px dashed var(--jb-line);"),
      "filter chips should use the existing v2 toolbar chip pattern and responsive separators",
    );
    assert.ok(
      latticeCss.includes(".jb-lat__filters") &&
        latticeCss.includes(".jb-lat__filters .jb-lat__pill[aria-pressed=\"true\"]") &&
        latticeCss.includes("var(--jb-amber-soft)"),
      "lattice filters should match the existing pill language",
    );
  });

  it("keeps Expired visible in every v2 pipeline surface", () => {
    assert.ok(
      pipelineJs.includes('{ key: "expired",      label: "Expired" }'),
      "pipeline.js should render an Expired column",
    );
    assert.ok(
      latticeJs.includes('"Expired"') &&
        latticeJs.includes("Expired: \"expired\"") &&
        !latticeJs.includes("Expired: true"),
      "lattice.js should render Expired as a visible stage, not hide it behind closed-stage state",
    );
  });
});
