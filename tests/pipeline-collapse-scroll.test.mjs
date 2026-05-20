import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");

describe("v2 pipeline column collapse and scrolling", () => {
  it("renders accessible per-column collapse triggers", () => {
    assert.ok(
      pipelineJs.includes('class="pipe-col__toggle"') &&
        pipelineJs.includes('data-stage-toggle="') &&
        pipelineJs.includes('s.key') &&
        pipelineJs.includes('var bodyId = "pipe-col-body-" + s.key;') &&
        pipelineJs.includes('aria-controls="') &&
        pipelineJs.includes('aria-expanded="true"'),
      "each column header should render an accessible expand/collapse button",
    );
  });

  it("persists collapsed columns and reapplies their grid tracks", () => {
    assert.ok(
      pipelineJs.includes('var COLLAPSED_STORAGE_KEY = "jb_pipelineCollapsedColumns";'),
      "collapsed columns should use a stable localStorage key",
    );
    assert.ok(
      pipelineJs.includes("loadCollapsedState()") &&
        pipelineJs.includes("saveCollapsedState(state)") &&
        pipelineJs.includes('board.style.setProperty('),
      "collapsed column state should survive rerenders and update board tracks",
    );
  });

  it("auto-expands a collapsed destination before an optimistic move", () => {
    assert.ok(
      pipelineJs.includes("if (state && isCollapsed(state, toStage)) setColumnCollapsed(region, state, toStage, false);"),
      "dropping into a collapsed stage should reveal the moved card",
    );
  });

  it("caps column stacks and scrolls excess cards inside the column", () => {
    assert.ok(
      pipelineCss.includes("max-height: clamp(320px, 56vh, 640px);") &&
        pipelineCss.includes("overflow-y: auto;") &&
        pipelineCss.includes("overscroll-behavior: contain;") &&
        pipelineCss.includes("scrollbar-gutter: stable;"),
      "long kanban columns should scroll internally instead of stretching the page",
    );
  });

  it("uses compact visual rails when columns are collapsed", () => {
    assert.ok(
      pipelineCss.includes('.pipe-col[data-collapsed="true"]') &&
        pipelineCss.includes("writing-mode: vertical-rl") &&
        pipelineCss.includes("--pipe-col-collapsed: 56px;") &&
        pipelineCss.includes(".pipe-col__toggle-mark"),
      "collapsed columns should become compact rails with a visible trigger",
    );
  });
});
