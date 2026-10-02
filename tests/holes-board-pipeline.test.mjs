/**
 * HOLES BOARD — the v2 sticker board (pipeline.js) mounted in a small DOM.
 *
 * Each describe block names the finding it pins. The board is loaded as the
 * browser loads it (a classic script in a window-shaped vm context) on top of
 * tests/holes-board-dom.mjs, with the data seams it reads stubbed:
 * JobBoredDawn.data.getPipelineViewModel() and JobBored.getPipelineJobs().
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createBoardEnv } from "./holes-board-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const pipelineJs = read("pipeline.js");
const companyCapJs = read("company-cap.js");

const STAGE_KEYS = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];

/** Rows in the shape JobBored.getPipelineJobs() returns; jobKey is the index. */
function job(over = {}) {
  return { title: "Engineer", company: "Acme", status: "Researching", favorite: false, ...over };
}

function viewModelFrom(jobs) {
  const byStage = Object.fromEntries(STAGE_KEYS.map((k) => [k, []]));
  jobs.forEach((j, i) => {
    const stage = j.stage || "researching";
    byStage[stage].push({ jobKey: String(i), role: j.title, company: j.company, fitScore: j.fit ?? null, index: i });
  });
  const stages = STAGE_KEYS.map((key) => ({ key, label: key, cards: byStage[key] }));
  return { stages, untriaged: byStage.new.slice(), empty: jobs.length === 0 };
}

/** Mount the board. Returns the env plus spies on the seams it calls. */
function mountBoard({ jobs = [job()], withCap = false, a11y = null, adapter = null } = {}) {
  const env = createBoardEnv({ html: '<section data-region="pipeline"></section>' });
  const w = env.window;
  const calls = { favorite: [], ingest: [], moves: [], vm: 0 };
  const state = { jobs };
  w.JobBoredDawn = {
    data: {
      getPipelineViewModel() {
        calls.vm += 1;
        return viewModelFrom(state.jobs);
      },
    },
  };
  w.JobBored = {
    getPipelineJobs: () => state.jobs,
    toggleFavorite: (key) => {
      calls.favorite.push(String(key));
      const row = state.jobs[Number(key)];
      if (row) row.favorite = !row.favorite;
    },
    ingestJobUrl: (url) => {
      calls.ingest.push(url);
      return new Promise(() => {}); // stays in flight; the test only counts calls
    },
  };
  if (a11y) w.JobBoredA11y = a11y;
  if (adapter) w.JobBoredPipelineTransitionAdapter = adapter;
  if (withCap) vm.runInNewContext(companyCapJs, w, { filename: "company-cap.js" });
  vm.runInNewContext(pipelineJs, w, { filename: "pipeline.js" });
  env.flush();
  const region = env.document.querySelector('[data-region="pipeline"]');
  return { ...env, w, region, calls, state, api: w.JobBoredPipeline };
}

function remount(board) {
  board.api.clearRegion();
  board.api.scheduleRender();
  board.flush();
}

function pointer(board, target, type) {
  return board.fire(target, type, { props: { button: 0, pointerId: 1, clientX: 0, clientY: 0 } });
}

describe("B1 · a remount does not stack listeners (one AbortController per mount)", () => {
  it("should hold the same listener count on the region and document after unmount and remount", () => {
    const board = mountBoard();
    const regionCount = board.region.listenerCount();
    const docCount = board.document.listenerCount();
    assert.ok(regionCount > 0, "the board binds its delegated listeners on mount");
    remount(board);
    remount(board);
    assert.equal(board.region.listenerCount(), regionCount, "region listeners after two remounts");
    assert.equal(board.document.listenerCount(), docCount, "document listeners after two remounts");
  });

  it("should remove every mount listener on unmount", () => {
    const board = mountBoard();
    const docBefore = board.document.listenerCount();
    board.api.clearRegion();
    assert.equal(board.region.listenerCount(), 0, "an unmounted region keeps no board listeners");
    assert.ok(board.document.listenerCount() < docBefore, "mount-scoped document listeners are released");
  });

  it("should toggle a favorite once per press after a remount", () => {
    const board = mountBoard();
    remount(board);
    const star = board.region.querySelector('[data-card-action="toggle-favorite"]');
    assert.ok(star, "the card renders its favorite star");
    pointer(board, star, "pointerdown");
    pointer(board, star, "pointerup");
    star.click();
    assert.deepEqual(board.calls.favorite, ["0"], "one press is one toggle");
  });

  it("should ingest a pasted URL once per submit after a remount", () => {
    const board = mountBoard();
    remount(board);
    board.region.querySelector('.pipe-tool__btn[data-action="add-job-url"]').click();
    board.region.querySelector("[data-pipeline-url-input]").value = "https://boards.example.com/jobs/1";
    board.fire(board.region.querySelector("[data-pipeline-url-form]"), "submit");
    assert.deepEqual(board.calls.ingest, ["https://boards.example.com/jobs/1"], "one submit is one ingest");
  });
});

function card(board, key) {
  return board.region.querySelector(`.pipe-sticker[data-stable-key="${key}"]`);
}

function stageOf(board, key) {
  const node = card(board, key);
  const body = node && node.closest("[data-stage-body]");
  return body ? body.getAttribute("data-stage-body") : null;
}

function typeSearch(board, value) {
  const input = board.region.querySelector("[data-pipeline-search]");
  input.value = value;
  board.fire(input, "input");
  return input;
}

/** Drag a card onto a column through the board's own pointer handlers. */
function dragTo(board, key, toStage) {
  const target = board.region.querySelector(`.pipe-col[data-stage="${toStage}"]`);
  board.document.elementsFromPoint = () => [target];
  const node = card(board, key);
  board.fire(node, "pointerdown", { props: { button: 0, pointerId: 7, clientX: 10, clientY: 10 } });
  board.fire(node, "pointermove", { props: { button: 0, pointerId: 7, clientX: 60, clientY: 60 } });
  board.fire(node, "pointerup", { props: { button: 0, pointerId: 7, clientX: 60, clientY: 60 } });
}

const inFlightAdapter = () => {
  const moves = [];
  return { moves, move: (m) => { moves.push(m); return new Promise(() => {}); } };
};

describe("B6 · scoped rebuilds and a debounced search", () => {
  it("should not rebuild the board when an unrelated body class flips", () => {
    const board = mountBoard();
    const before = card(board, "0");
    const vmCalls = board.calls.vm;
    board.document.body.classList.add("detail-open");
    board.document.body.classList.add("pipe-url-modal-open");
    board.flush();
    assert.equal(board.calls.vm, vmCalls, "a non-jb-v2 class flip must not re-read the view-model");
    assert.ok(card(board, "0") === before, "the card node survives");
  });

  it("should still unmount and remount when body.jb-v2 itself flips", () => {
    const board = mountBoard();
    board.document.body.classList.remove("jb-v2");
    board.flush();
    assert.ok(card(board, "0") === null, "the board clears when v2 turns off");
    board.document.body.classList.add("jb-v2");
    board.flush();
    assert.ok(card(board, "0"), "and renders again when it turns back on");
  });

  it("should coalesce a burst of keystrokes into one rerender", () => {
    const board = mountBoard({ jobs: [job({ title: "Senior Engineer" }), job({ title: "Designer" })] });
    const vmCalls = board.calls.vm;
    typeSearch(board, "s");
    typeSearch(board, "se");
    typeSearch(board, "sen");
    assert.equal(board.calls.vm, vmCalls, "no rerender while the person is still typing");
    board.advance(400);
    assert.equal(board.calls.vm, vmCalls + 1, "one rerender once typing pauses");
    assert.ok(card(board, "0"), "the match stays");
    assert.ok(card(board, "1") === null, "the miss is filtered out");
  });

  it("should leave the typed text alone so a space can start the next word", () => {
    const board = mountBoard();
    const input = typeSearch(board, "senior ");
    board.advance(400);
    assert.equal(input.value, "senior ", "the field keeps the trailing space the person typed");
  });

  it("should reuse an unchanged card's node when another row changes", () => {
    const board = mountBoard({ jobs: [job({ title: "Staff Engineer" })] });
    const before = card(board, "0");
    board.state.jobs.push(job({ title: "Platform Engineer", company: "Globex", stage: "applied" }));
    board.api.scheduleRender();
    board.flush();
    assert.ok(card(board, "1"), "the new row renders");
    assert.ok(card(board, "0") === before, "the untouched card keeps its node (and any focus inside it)");
  });

  it("should rebuild a card whose row changed", () => {
    const board = mountBoard({ jobs: [job({ title: "Staff Engineer" })] });
    const before = card(board, "0");
    board.state.jobs[0].title = "Principal Engineer";
    board.api.scheduleRender();
    board.flush();
    assert.ok(card(board, "0") !== before, "a changed row gets a fresh card");
    assert.match(card(board, "0").textContent, /Principal Engineer/);
  });
});

describe("B13 · a pending drag survives a rerender", () => {
  it("should keep a dropped card in its new column when the sort changes before the write lands", () => {
    const adapter = inFlightAdapter();
    const board = mountBoard({ adapter });
    dragTo(board, "0", "applied");
    assert.equal(stageOf(board, "0"), "applied", "the drop moves the card optimistically");
    assert.equal(adapter.moves.length, 1);
    board.region.querySelector('.pipe-tool__chip[data-sort="fit"]').click();
    assert.equal(stageOf(board, "0"), "applied", "a sort must not snap the card back while its write is in flight");
  });

  it("should keep a dropped card in its new column when a search rerenders", () => {
    const board = mountBoard({ adapter: inFlightAdapter() });
    dragTo(board, "0", "applied");
    typeSearch(board, "engineer");
    board.advance(400);
    assert.equal(stageOf(board, "0"), "applied");
  });

  it("should settle a pending move whose success event carries a numeric jobKey", () => {
    const board = mountBoard({ adapter: inFlightAdapter() });
    dragTo(board, "0", "applied");
    board.state.jobs[0].stage = "applied";
    board.fire(board.document, "jb:write:succeeded", { detail: { kind: "pipeline:move", jobKey: 0 } });
    board.flush();
    assert.equal((board.region.__pipePending || []).length, 0, "the pending entry clears");
    board.state.jobs.push(job({ title: "New role", company: "Initech" }));
    board.api.scheduleRender();
    board.flush();
    assert.ok(card(board, "1"), "later renders are no longer blocked by a stuck pending move");
  });
});

describe("B6 · the v2 boot contract does not rebuild a mounted board", () => {
  it("should not re-read the board when the boot contract sees an unrelated class flip", () => {
    const board = mountBoard();
    vm.runInNewContext(read("jb-v2-boot-contract.js"), board.w, { filename: "jb-v2-boot-contract.js" });
    board.fire(board.document, "DOMContentLoaded");
    board.flush();
    const before = card(board, "0");
    const vmCalls = board.calls.vm;
    board.document.body.classList.add("detail-open");
    board.flush();
    assert.equal(board.calls.vm, vmCalls, "a remount on a mounted board is a no-op");
    assert.ok(card(board, "0") === before);
    board.document.body.classList.remove("jb-v2");
    board.flush();
    assert.ok(card(board, "0") === null, "the contract still unmounts when v2 turns off");
  });
});

/** The board plus the real jb-a11y.js, with a top-bar opener outside the region. */
function mountWithA11y() {
  const env = createBoardEnv({ html: '<header class="page-top"><button type="button" id="topAdd">Add job</button></header><section data-region="pipeline"></section>' });
  const w = env.window;
  const jobs = [job()];
  w.JobBoredDawn = { data: { getPipelineViewModel: () => viewModelFrom(jobs) } };
  w.JobBored = { getPipelineJobs: () => jobs, ingestJobUrl: () => new Promise(() => {}) };
  vm.runInNewContext(read("jb-a11y.js"), w, { filename: "jb-a11y.js" });
  vm.runInNewContext(pipelineJs, w, { filename: "pipeline.js" });
  env.flush();
  const region = env.document.querySelector('[data-region="pipeline"]');
  const opener = env.document.getElementById("topAdd");
  const modal = region.querySelector("[data-pipeline-url-modal]");
  const input = region.querySelector("[data-pipeline-url-input]");
  /** The top bar's Add job clicks the board's button while keeping focus. */
  function openFromTopBar() {
    opener.focus();
    region.querySelector('.pipe-tool__btn[data-action="add-job-url"]').click();
    env.flush();
  }
  return { ...env, region, opener, modal, input, openFromTopBar };
}

describe("B4 · the Add job by URL modal is a real dialog (JobBoredA11y.dialog)", () => {
  it("should move focus into the URL field and make the page behind it inert", () => {
    const m = mountWithA11y();
    m.openFromTopBar();
    assert.equal(m.modal.hidden, false);
    assert.ok(m.document.activeElement === m.input, "focus lands in the URL field");
    assert.equal(m.opener.closest(".page-top").inert, true, "the top bar behind the dialog is inert");
    assert.equal(m.region.querySelector(".pipe-board").closest(".pipe-shell").inert, true, "so is the board");
  });

  it("should close on Escape and hand focus back to the control that opened it", () => {
    const m = mountWithA11y();
    m.openFromTopBar();
    m.fire(m.input, "keydown", { props: { key: "Escape" } });
    m.flush();
    assert.equal(m.modal.hidden, true, "Escape closes the modal");
    assert.ok(m.document.activeElement === m.opener, "focus returns to the opener");
    assert.equal(m.opener.closest(".page-top").inert, false, "the page is live again");
  });

  it("should hand focus back after Cancel too", () => {
    const m = mountWithA11y();
    m.openFromTopBar();
    m.region.querySelector("[data-pipeline-url-cancel]").click();
    m.flush();
    assert.equal(m.modal.hidden, true);
    assert.ok(m.document.activeElement === m.opener);
  });
});

describe("B11 · card controls have names that say which role they act on", () => {
  const twoRoles = () => mountBoard({ jobs: [job({ title: "Staff Engineer", company: "Acme" }), job({ title: "Designer", company: "Globex" })] });

  it("should name each card's edit button after its role", () => {
    const board = twoRoles();
    const names = board.region.querySelectorAll('[data-card-action="edit-open"]').map((b) => b.getAttribute("aria-label"));
    assert.deepEqual(names, ["Edit role details: Staff Engineer at Acme", "Edit role details: Designer at Globex"]);
  });

  it("should keep the favorite toggle's name while aria-pressed carries its state", () => {
    const board = twoRoles();
    const star = () => board.region.querySelector('[data-card-action="toggle-favorite"][data-key="0"]');
    assert.equal(star().getAttribute("aria-label"), "Favorite: Staff Engineer at Acme");
    assert.equal(star().getAttribute("aria-pressed"), "false");
    star().click();
    assert.equal(star().getAttribute("aria-pressed"), "true", "pressing flips the state");
    assert.equal(star().getAttribute("aria-label"), "Favorite: Staff Engineer at Acme", "the name does not flip with it");
    const names = board.region.querySelectorAll('[data-card-action="toggle-favorite"]').map((b) => b.getAttribute("aria-label"));
    assert.equal(new Set(names).size, 2, "two cards, two names");
  });

  it("should expose the fit ring as an image named with its score", () => {
    const board = mountBoard({ jobs: [job({ fit: 7 })] });
    const fit = board.region.querySelector(".pipe-sticker__fit");
    assert.equal(fit.getAttribute("role"), "img", "a bare span's aria-label is ignored; role=img makes it count");
    assert.equal(fit.getAttribute("aria-label"), "Fit 7 of 10");
  });
});

function figmaRows(count, stage, extra = {}) {
  return Array.from({ length: count }, (_, i) => job({ title: `Designer ${i}`, company: "Figma", stage, fit: 9 - i, ...extra }));
}

function stageCards(board, stage) {
  return board.region.querySelectorAll(`[data-stage-body="${stage}"] .pipe-sticker`);
}

describe("R5 · the company cap applies only to New and Researching, with a Show all toggle", () => {
  for (const stage of ["applied", "interviewing", "offer"]) {
    it(`should never hide a ${stage} card behind the cap`, () => {
      const board = mountBoard({ withCap: true, jobs: figmaRows(5, stage) });
      assert.equal(stageCards(board, stage).length, 5, "every role in a later stage stays on the board");
      assert.ok(board.region.querySelector(`[data-show-all="${stage}"]`) === null);
    });
  }

  it("should cap Researching at three per company and offer Show all", () => {
    const board = mountBoard({ withCap: true, jobs: figmaRows(5, "researching") });
    assert.equal(stageCards(board, "researching").length, 3);
    const toggle = board.region.querySelector('[data-show-all="researching"]');
    assert.ok(toggle, "the hidden note is a control now");
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.match(toggle.textContent, /Show all/);
    assert.match(toggle.textContent, /\+2 from Figma/);
  });

  it("should show every card, then three again, as the toggle flips", () => {
    const board = mountBoard({ withCap: true, jobs: figmaRows(5, "new") });
    const first = board.region.querySelector('[data-show-all="new"]');
    first.focus();
    first.click();
    assert.equal(stageCards(board, "new").length, 5, "Show all shows them all");
    const toggle = board.region.querySelector('[data-show-all="new"]');
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.match(toggle.textContent, /Show fewer/);
    assert.ok(board.document.activeElement === toggle, "focus stays on the toggle across the re-render");
    toggle.click();
    assert.equal(stageCards(board, "new").length, 3);
    assert.ok(board.document.activeElement === toggle, "and stays there when the column shrinks again");
  });

  it("should keep the cap per column, so showing all in one column leaves the other capped", () => {
    const board = mountBoard({ withCap: true, jobs: [...figmaRows(4, "new"), ...figmaRows(4, "researching")] });
    board.region.querySelector('[data-show-all="new"]').click();
    assert.equal(stageCards(board, "new").length, 4);
    assert.equal(stageCards(board, "researching").length, 3);
  });
});

describe("R5 · the view-model reaches the board uncapped (pipeline-render.js)", () => {
  function loadRender(rows) {
    const win = {
      JobBoredApp: {
        core: {
          getPipelineData: () => rows,
          getViewedJobKeys: () => new Set(),
          getExpandedStages: () => new Set(),
          getCurrentSearch: () => "",
          getCurrentSort: () => "fit",
          getShowDismissed: () => false,
          getFavoritesOnly: () => false,
          getDataLoadFailed: () => false,
          host: { escapeHtml: (s) => String(s) },
        },
        companyLogo: { renderLogoHtml: () => "" },
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
    };
    const doc = {
      body: { classList: { contains: () => true } },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      dispatchEvent() { return true; },
    };
    const ctx = vm.createContext({ window: win, document: doc, console, CustomEvent: class {}, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} } });
    for (const f of ["jb-text.js", "stage-registry.js", "company-cap.js", "pipeline-render.js"]) {
      vm.runInContext(read(f), ctx, { filename: f });
    }
    return win.JobBoredApp.pipelineRender;
  }

  it("should hand v2 every card, leaving each surface to apply its own cap", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({ title: `A${i}`, company: "Figma", status: "Applied", fitScore: 5 })),
      ...Array.from({ length: 5 }, (_, i) => ({ title: `R${i}`, company: "Figma", status: "Researching", fitScore: 5 })),
    ];
    const models = loadRender(rows).getBoardCardModels();
    assert.equal(models.length, 10, "no upstream cap: 5 applied + 5 researching");
  });
});

describe("R5 · the opt-out kanban's \"+N hidden\" is a Show all toggle (pipeline-render.js)", () => {
  function mountLegacy(rows) {
    const env = createBoardEnv({ bodyClass: "", html: '<div id="jobCards"></div><div id="emptyState"></div><span id="roleCount"></span>' });
    const w = env.window;
    w.JobBoredApp = {
      core: {
        getPipelineData: () => rows,
        getViewedJobKeys: () => new Set(),
        getExpandedStages: () => new Set(),
        getCurrentSearch: () => "",
        getCurrentSort: () => "fit",
        getShowDismissed: () => false,
        getFavoritesOnly: () => false,
        getDataLoadFailed: () => false,
        host: { escapeHtml: (v) => String(v), isSignedIn: () => true },
      },
      companyLogo: { renderLogoHtml: () => "" },
      expiredReview: { renderExpiredReviewButton() {} },
    };
    for (const f of ["jb-text.js", "stage-registry.js", "company-cap.js", "pipeline-render.js"]) {
      vm.runInNewContext(read(f), w, { filename: f });
    }
    const render = w.JobBoredApp.pipelineRender;
    render.renderPipeline();
    const lane = (stage) => env.document.querySelector(`.stage-lane[data-stage="${stage}"]`);
    return { ...env, render, lane };
  }
  const figma = (status, n) => Array.from({ length: n }, (_, i) => ({ title: `${status} ${i}`, company: "Figma", status, fitScore: 5 }));

  it("should render the note as a button that expands and collapses the lane, keeping focus on it", () => {
    const l = mountLegacy(figma("Researching", 5));
    const cards = () => l.lane("Researching").querySelectorAll(".kanban-card").length;
    const toggle = () => l.document.querySelector('[data-action="toggle-show-all"]');
    assert.equal(cards(), 3, "capped to three per company");
    assert.ok(toggle() && toggle().tagName.toLowerCase() === "button", "the note is a button");
    assert.equal(toggle().getAttribute("aria-expanded"), "false");
    assert.match(toggle().textContent, /Show all \(\+2 from Figma hidden\)/);
    toggle().focus();
    l.fire(toggle(), "click");
    assert.equal(cards(), 5, "Show all shows every role");
    assert.equal(toggle().getAttribute("aria-expanded"), "true");
    assert.equal(toggle().textContent, "Show fewer");
    assert.ok(l.document.activeElement === toggle(), "focus is on the rebuilt toggle");
    l.fire(toggle(), "click");
    assert.equal(cards(), 3);
  });

  it("should show no toggle on a later-stage lane", () => {
    const l = mountLegacy(figma("Applied", 5));
    assert.equal(l.lane("Applied").querySelectorAll(".kanban-card").length, 5);
    assert.equal(l.document.querySelector('[data-action="toggle-show-all"]'), null);
  });
});

describe("B3 · the board says when the pipeline is loading or failed to load", () => {
  const status = (board) => board.region.querySelector("[data-pipeline-status]");

  it("should say it is loading instead of showing an empty board", () => {
    const board = mountBoard({ jobs: [] });
    board.fire(board.document, "jb:data:loading", { detail: { generation: 1 } });
    board.flush();
    assert.ok(status(board) && !status(board).hidden, "a status line is shown");
    assert.match(status(board).textContent, /Loading your pipeline/);
    assert.equal(board.region.getAttribute("data-load-state"), "loading");
    assert.equal(board.region.querySelector(".pipe-board").getAttribute("aria-busy"), "true");
  });

  it("should say the read failed instead of looking empty", () => {
    const board = mountBoard({ jobs: [] });
    board.fire(board.document, "jb:data:loading", { detail: { generation: 1 } });
    board.fire(board.document, "jb:data:failed", { detail: { generation: 1, status: 403, message: "forbidden" } });
    board.flush();
    assert.match(status(board).textContent, /didn.t load/);
    assert.equal(board.region.getAttribute("data-load-state"), "failed");
    assert.notEqual(board.region.querySelector(".pipe-board").getAttribute("aria-busy"), "true");
  });

  it("should accept today's jb:data:load-failed name too", () => {
    const board = mountBoard({ jobs: [] });
    board.fire(board.document, "jb:data:load-failed", { detail: { status: 0, kind: "offline" } });
    board.flush();
    assert.match(status(board).textContent, /didn.t load/);
  });

  it("should clear the status once rows load", () => {
    const board = mountBoard({ jobs: [] });
    board.fire(board.document, "jb:data:loading", { detail: { generation: 1 } });
    board.flush();
    board.state.jobs.push(job());
    board.fire(board.document, "jb:data:loaded", { detail: { generation: 1, rowCount: 1 } });
    board.api.scheduleRender();
    board.flush();
    assert.ok(status(board).hidden, "no status once the board has rows");
    assert.ok(card(board, "0"));
  });

  it("should ignore a loaded event from an older generation", () => {
    const board = mountBoard({ jobs: [] });
    board.fire(board.document, "jb:data:loading", { detail: { generation: 2 } });
    board.fire(board.document, "jb:data:loaded", { detail: { generation: 1, rowCount: 0 } });
    board.flush();
    assert.equal(board.region.getAttribute("data-load-state"), "loading", "generation 2 is still in flight");
  });

  it("should keep the board, not a failure line, when a refresh fails with rows on screen", () => {
    const board = mountBoard();
    board.fire(board.document, "jb:data:failed", { detail: { generation: 3, status: 503, message: "unavailable" } });
    board.flush();
    assert.ok(card(board, "0"), "the rows stay");
    assert.ok(status(board).hidden, "the sync banner owns a failed refresh; the board stays quiet");
  });

  it("should hear a loading event that fires before the board mounts", () => {
    const env = createBoardEnv({ bodyClass: "", html: '<section data-region="pipeline"></section>' });
    env.window.JobBoredDawn = { data: { getPipelineViewModel: () => viewModelFrom([]) } };
    env.window.JobBored = { getPipelineJobs: () => [] };
    vm.runInNewContext(pipelineJs, env.window, { filename: "pipeline.js" });
    env.fire(env.document, "jb:data:loading", { detail: { generation: 1 } });
    env.document.body.classList.add("jb-v2");
    env.flush();
    const region = env.document.querySelector('[data-region="pipeline"]');
    assert.match(region.querySelector("[data-pipeline-status]").textContent, /Loading your pipeline/);
  });
});
