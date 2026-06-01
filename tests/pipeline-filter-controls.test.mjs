import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const ingestUrlFlowJs = readFileSync(join(repoRoot, "ingest-url-flow.js"), "utf8");
const pipelineControllerJs = readFileSync(
  join(repoRoot, "pipeline-controller.js"),
  "utf8",
);
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");
const latticeCss = readFileSync(join(repoRoot, "lattice.css"), "utf8");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");
const roleJs = readFileSync(join(repoRoot, "role.js"), "utf8");
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
        appJs.includes("window.JobBored.getPipelineJobs = function ()") &&
        appJs.includes("window.JobBored.toggleFavorite = toggleFavorite;"),
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

  it("renders card-level favorite actions in both v2 kanban surfaces", () => {
    assert.ok(
      pipelineJs.includes('data-card-action="toggle-favorite"') &&
        pipelineJs.includes("setCardFavoriteState(region, favoriteKey, nextFavorite)") &&
        pipelineJs.includes("togglePipelineFavorite(favoriteKey)") &&
        pipelineJs.includes("e.stopImmediatePropagation") &&
        pipelineJs.includes("pipe-sticker__favorite"),
      "pipeline.js should render a visible star button on each v2 card, update immediately, and call the existing favorite writer",
    );
    assert.ok(
      latticeJs.includes("setCardFavoriteState(dataIndex, nextFavorite)") &&
        latticeJs.includes("togglePipelineFavorite(dataIndex)") &&
        latticeJs.includes('class: "jb-lat__fav"') &&
        latticeCss.includes(".jb-lat__fav[aria-pressed=\"true\"]"),
      "lattice cards should expose the same favorite action, immediate feedback, and active state",
    );
  });

  it("focuses the selected kanban column and collapses the rest", () => {
    assert.ok(
      pipelineJs.includes("function focusColumnForCard") &&
        pipelineJs.includes("state.focusedStage = stageKey;") &&
        pipelineJs.includes("else state.collapsed[s.key] = true;") &&
        pipelineJs.includes('el.setAttribute("data-expanded", selected ? "true" : "false");') &&
        pipelineCss.includes("--pipe-col-focused") &&
        pipelineCss.includes('.pipe-col[data-focused="true"]') &&
        pipelineCss.includes('.pipe-col[data-focused="true"] .pipe-sticker:not([data-selected="true"])'),
      "opening a v2 pipeline card should focus that card's column, expand only that card, and collapse the rest",
    );
    assert.ok(
      latticeJs.includes("function openCard(dataIndex, stage)") &&
        latticeJs.includes("state.focusStage = normalizeStage(stage);") &&
        latticeCss.includes(".jb-lat__board[data-focus-stage]") &&
        latticeCss.includes(".jb-lat__col--collapsed") &&
        latticeCss.includes('.jb-lat__col--focused .jb-lat__card:not([data-selected="true"])'),
      "lattice should mirror the single-selected-card focused-column layout",
    );
  });

  it("renders fit rings statically so repeated rerenders do not flicker", () => {
    assert.equal(
      pipelineJs.includes('classList.add("is-anim")'),
      false,
      "pipeline should not restart fit-ring animations after every render",
    );
    assert.equal(
      pipelineCss.includes("pipe-fit-fill"),
      false,
      "pipeline CSS should not keep the old animated fit-ring keyframes",
    );
    assert.ok(
      pipelineJs.includes("stroke-dasharray:' + fitPct + ' 100") &&
        pipelineCss.includes("stroke-dasharray: 0 100;"),
      "fit ring progress should render directly from the score",
    );
  });

  it("provides a visible v2 kanban search and wires Cmd+K to it", () => {
    const searchHandler = pipelineJs.slice(
      pipelineJs.indexOf('region.addEventListener("input"'),
      pipelineJs.indexOf("function bindRegion"),
    );
    assert.ok(
      pipelineJs.includes("data-pipeline-search") &&
        pipelineJs.includes("filterCardsBySearch(cards, state)") &&
        pipelineJs.includes('col.setAttribute("data-search-active"') &&
        pipelineJs.includes('col.setAttribute("data-search-match"') &&
        pipelineJs.includes("pipe-col__search-hit") &&
        pipelineJs.includes("root.JobBoredPipeline.focusSearch = focusSearch;") &&
        pipelineJs.includes("e.metaKey || e.ctrlKey") &&
        pipelineJs.includes('toLowerCase() !== "k"') &&
        pipelineCss.includes(".pipe-tool__search-input") &&
        pipelineCss.includes('[data-search-active="true"][data-search-match="true"]') &&
        pipelineCss.includes(".pipe-col__search-hit"),
      "pipeline.js/css should render search, wire Cmd+K, and mark matching kanban phases",
    );
    assert.ok(
      roleJs.includes("pipelineApi.focusSearch({ select: true });"),
      "the empty-state Cmd+K CTA should focus the v2 kanban search field",
    );
    assert.ok(
      searchHandler.includes('state.search = String(input.value || "").trim();'),
      "typing in kanban search should update only the search query",
    );
    assert.equal(
      searchHandler.includes("state.collapsed = {};") ||
        searchHandler.includes("saveCollapsedState(state)") ||
        searchHandler.includes('state.focusedStage = "";') ||
        searchHandler.includes('state.selectedJobKey = "";'),
      false,
      "typing in kanban search must not reset the single-open column state",
    );
  });

  it("lets searched cards complete drag stage moves without freezing the filtered board", () => {
    const successHandler = pipelineJs.slice(
      pipelineJs.indexOf('document.addEventListener("jb:write:succeeded"'),
      pipelineJs.indexOf('document.addEventListener("jb:write:failed"'),
    );
    assert.ok(
      appJs.includes("function applyPipelineStageWrite(jobKey, statusLabel)") &&
        pipelineControllerJs.includes("pipelineData[idx].status = nextStatus;") &&
        appJs.includes("window.JobBored.applyPipelineStageWrite = applyPipelineStageWrite;"),
      "app.js should expose a local stage-sync hook so v2 drag writes update the model used by search renders",
    );
    assert.ok(
      pipelineJs.includes('document.addEventListener("jb:write:succeeded"') &&
        successHandler.includes("pendingList[i].jobKey === jobKey") &&
        successHandler.includes("pendingList.splice(i, 1)") &&
        successHandler.includes("scheduleRender();"),
      "pipeline.js should clear successful optimistic moves so filtered renders are no longer blocked",
    );
  });

  it("condenses v2 manual add actions into one URL modal backed by the real ingest flow", () => {
    assert.ok(
      pipelineJs.includes('data-action="add-job-url"') &&
        pipelineJs.includes("buildJobUrlModal()") &&
        pipelineJs.includes("data-pipeline-url-modal") &&
        pipelineJs.includes("data-pipeline-url-progress") &&
        pipelineJs.includes("api.ingestJobUrl(url") &&
        pipelineCss.includes(".pipe-url-modal__panel") &&
        pipelineCss.includes(".pipe-url-modal__bar") &&
        pipelineCss.includes("pipe-url-spin"),
      "v2 pipeline should show one add-from-URL action, open a modal, and show progress while ingest runs",
    );
    assert.equal(
      pipelineJs.includes('data-action="add-role"') ||
        pipelineJs.includes('data-action="paste-url"') ||
        pipelineJs.includes("openAddJobDialog") ||
        pipelineJs.includes("openPasteUrlDialog"),
      false,
      "v2 pipeline should not keep the separate Add role / Paste URL buttons or dead legacy dialog hooks",
    );
    assert.ok(
      appJs.includes("window.JobBored.ingestJobUrl = ingestJobUrl;") &&
        appJs.includes("async function ingestJobUrl(...args)") &&
        ingestUrlFlowJs.includes("async function ingestJobUrl(url, options = {})") &&
        ingestUrlFlowJs.includes("handleIngestUrlResponse(data, value, {") &&
        ingestUrlFlowJs.includes("awaitAutoEnrich: true") &&
        ingestUrlFlowJs.includes("reportIngestProgress(onProgress"),
      "app.js should expose the existing ingest worker and enrichment flow through a progress-aware API",
    );
  });

  it("keeps Expired visible in every v2 pipeline surface", () => {
    // pipeline.js surfaces the "expired" schema stage under the gentler
    // user-facing label "Dismissed"; the stage key (which drives the
    // Sheet contract and CSS rails) is preserved.
    assert.ok(
      pipelineJs.includes('{ key: "expired",      label: "Dismissed" }'),
      "pipeline.js should render the expired column as Dismissed",
    );
    assert.ok(
      latticeJs.includes('"Expired"') &&
        latticeJs.includes("Expired: \"expired\"") &&
        !latticeJs.includes("Expired: true"),
      "lattice.js should render Expired as a visible stage, not hide it behind closed-stage state",
    );
  });
});
