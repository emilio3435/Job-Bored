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

  it("persists explicit open/close choices and reapplies their grid tracks", () => {
    assert.ok(
      pipelineJs.includes('var COLUMN_PREFS_STORAGE_KEY = "jb_pipelineColumns.v2";'),
      "column choices should use a stable localStorage key",
    );
    assert.ok(
      pipelineJs.includes("loadColumnPrefs()") &&
        pipelineJs.includes("saveColumnPrefs(state)") &&
        pipelineJs.includes('board.style.setProperty('),
      "column choices should survive rerenders and update board tracks",
    );
  });

  it("UX01 C19 (TR-09): opens every stage that holds a role by default", () => {
    assert.ok(
      pipelineJs.includes("function isCollapsed(state, stageKey)") &&
        pipelineJs.includes("return count === 0;") &&
        pipelineJs.includes("state.counts[s.key] = cards.length;"),
      "with no saved choice, an empty stage rests as a rail and every non-empty stage is open",
    );
    assert.equal(
      pipelineJs.includes('var DEFAULT_FOCUSED_STAGE = "researching";'),
      false,
      "no single Researching-only default: new roles land in Discovered and must be visible",
    );
  });

  it("acknowledges the destination column on drop without expanding it", () => {
    assert.ok(
      !pipelineJs.includes("if (state && isCollapsed(state, toStage)) setColumnCollapsed(region, state, toStage, false);"),
      "dropping into a stage should leave the destination collapse state alone so the source column keeps its focused width",
    );
    assert.ok(
      pipelineJs.includes("pulseColumnDrop(region, toStage);") &&
        pipelineJs.includes("function pulseColumnDrop") &&
        pipelineJs.includes('col.setAttribute("data-just-dropped", "true");'),
      "the destination column should briefly pulse so the user sees the drop landed",
    );
    assert.ok(
      pipelineCss.includes('.pipe-col[data-just-dropped="true"]') &&
        pipelineCss.includes("@keyframes pipe-col-drop-pulse"),
      "CSS should provide a drop-pulse animation on the destination column",
    );
  });

  it("UX01 C19: a column chevron flips only its own column", () => {
    assert.ok(
      pipelineJs.includes("function toggleColumn") &&
        pipelineJs.includes("if (stageKey) toggleColumn(region, state, stageKey);") &&
        !pipelineJs.includes("function expandColumnExclusive"),
      "expanding one stage must not collapse the others",
    );
  });

  it("UX01 C19 (TR-08): no focus track can squeeze a column to 22 px", () => {
    assert.ok(
      pipelineJs.includes("function focusColumnForCard") &&
        pipelineJs.includes("state.selectedJobKey = String(jobKey);"),
      "opening a card still selects it",
    );
    assert.equal(
      pipelineCss.includes("--pipe-col-focused: minmax(0, 1fr);"),
      false,
      "the minmax(0, 1fr) focus track squeezed the phone board to 22 px",
    );
    assert.ok(
      pipelineCss.includes('.pipe-sticker[data-selected="true"]') &&
        pipelineCss.includes("box-sizing: border-box;"),
      "the selected card still fills its column",
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
        // UX01 C19: the six active stages share the width at desktop, and a
        // track never drops below 164 px; past that the shell scrolls.
        pipelineCss.includes("--pipe-col-open: minmax(164px, 1fr);"),
      "the kanban should scroll horizontally in its shell instead of compressing below a readable column",
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
