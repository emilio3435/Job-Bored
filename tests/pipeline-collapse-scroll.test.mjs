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

  it("hydrates hard refreshes with Researching as the expanded default column", () => {
    assert.ok(
      pipelineJs.includes('var DEFAULT_FOCUSED_STAGE = "researching";') &&
        pipelineJs.includes("function defaultCollapsedState") &&
        pipelineJs.includes("if (s.key !== DEFAULT_FOCUSED_STAGE) next[s.key] = true;") &&
        pipelineJs.includes("function inferFocusedStageFromCollapsed") &&
        pipelineJs.includes("focusedStage: inferFocusedStageFromCollapsed(collapsed),"),
      "no saved preference should start with Researching as the single expanded column",
    );
    assert.ok(
      pipelineJs.includes("state.focusedStage = state.focusedStage || inferFocusedStageFromCollapsed(state.collapsed);"),
      "a saved single-open collapse state should rehydrate its expanded focus on refresh",
    );
  });

  it("auto-expands a collapsed destination before an optimistic move", () => {
    assert.ok(
      pipelineJs.includes("if (state && isCollapsed(state, toStage)) setColumnCollapsed(region, state, toStage, false);"),
      "dropping into a collapsed stage should reveal the moved card",
    );
  });

  it("uses single-open behavior when a column chevron expands a stage", () => {
    assert.ok(
      pipelineJs.includes("function expandColumnExclusive") &&
        pipelineJs.includes("if (isCollapsed(state, stageKey)) expandColumnExclusive(region, state, stageKey);") &&
        pipelineJs.includes("else state.collapsed[s.key] = true;"),
      "expanding a collapsed column from its chevron should collapse every other column",
    );
  });

  it("lets the selected card column consume available width in focus mode", () => {
    assert.ok(
      pipelineJs.includes("function focusColumnForCard") &&
        pipelineJs.includes("state.focusedStage = stageKey;") &&
        pipelineJs.includes("state.selectedJobKey = String(jobKey);") &&
        pipelineJs.includes("else state.collapsed[s.key] = true;"),
      "opening a card should select it and collapse every non-selected column",
    );
    assert.ok(
      pipelineCss.includes(".pipe-board[data-focus-stage]") &&
        pipelineCss.includes("--pipe-col-focused: minmax(0, 1fr);") &&
        pipelineCss.includes("width: 100%;") &&
        pipelineCss.includes('.pipe-sticker[data-selected="true"]') &&
        pipelineCss.includes("box-sizing: border-box;"),
      "focus mode should let the selected card's column take the remaining kanban width",
    );
  });

  it("caps column stacks and scrolls excess cards inside the column", () => {
    assert.ok(
      pipelineCss.includes("max-height: clamp(340px, calc(100vh - 300px), 680px);") &&
        pipelineCss.includes("overflow-y: auto;") &&
        pipelineCss.includes("overscroll-behavior: contain;") &&
        pipelineCss.includes("scrollbar-gutter: stable;") &&
        pipelineCss.includes("scrollbar-width: thin;"),
      "long kanban columns should scroll internally instead of stretching the page",
    );
  });

  it("keeps wide kanban columns inside a horizontally scrollable shell", () => {
    assert.ok(
      pipelineCss.includes(".pipe-shell") &&
        pipelineCss.includes("overflow-x: auto;") &&
        pipelineCss.includes("overscroll-behavior-inline: contain;") &&
        pipelineCss.includes("scroll-snap-type: x proximity;") &&
        pipelineCss.includes("--pipe-col-open: clamp(236px, 22vw, 280px);") &&
        pipelineCss.includes("width: max-content;") &&
        pipelineCss.includes("min-width: 100%;"),
      "the kanban should scroll horizontally in its shell instead of compressing across the viewport",
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
