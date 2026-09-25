/**
 * DS-08 (UX01 C4, second half of TR-20): the v2 surfaces read the pipeline
 * rows, not the hidden legacy .kanban-card board.
 *
 * Every page in these tests has an EMPTY document: no #jobCards, no
 * .kanban-card, no #briefStats. The v2 readers must still produce the board,
 * the Case, Dawn and the recents meta from the rows the legacy renderer wraps.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const SOURCES = {
  jbText: read("jb-text.js"),
  stages: read("stage-registry.js"),
  pipelineRender: read("pipeline-render.js"),
  dawnData: read("dawn-data.js"),
  dailyBrief: read("daily-brief.js"),
  flowingStore: read("flowing-store.js"),
  flowingWrites: read("flowing-writes.js"),
};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A document with nothing legacy in it. Any .kanban-card query finds nothing. */
function emptyDocument() {
  return {
    implementation: null,
    body: { classList: { contains: () => true } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
}

function row(over) {
  return {
    title: "Staff Engineer",
    company: "Chronicle",
    status: "Applied",
    link: "https://jobs.example.test/1",
    location: "Remote",
    source: "Ashby",
    salary: "$180k",
    priority: "",
    tags: "Go, Kubernetes, Postgres, Rust",
    notes: "Recruiter is Dana",
    followUpDate: "",
    responseFlag: "",
    favorite: false,
    fitScore: 8,
    dateFoundRaw: "2026-09-20",
    appliedDate: "2026-09-21",
    ...over,
  };
}

function loadApp(rows, opts = {}) {
  const win = {
    JobBoredApp: {
      core: {
        getPipelineData: () => rows,
        getViewedJobKeys: () => new Set(),
        getExpandedStages: () => new Set(),
        getCurrentSearch: () => opts.search || "",
        getCurrentSort: () => opts.sort || "fit",
        getShowDismissed: () => !!opts.showDismissed,
        getFavoritesOnly: () => !!opts.favoritesOnly,
        getDataLoadFailed: () => false,
        host: { escapeHtml },
      },
      companyLogo: { renderLogoHtml: () => "" },
      brief: {
        host: {
          escapeHtml,
          getPipelineData: () => rows,
          normalizeResponseFlag: (v) => String(v || ""),
        },
      },
    },
    JobBored: {
      getPipelineJobs: () => rows,
      getPipelineSheetRow: () => null,
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
  const context = vm.createContext({
    window: win,
    document: emptyDocument(),
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    Set, Map, Date, Number, Math, JSON, Object, String, Array, RegExp, Promise,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  vm.runInContext(SOURCES.jbText, context, { filename: "jb-text.js" });
  vm.runInContext(SOURCES.stages, context, { filename: "stage-registry.js" });
  vm.runInContext(SOURCES.dailyBrief, context, { filename: "daily-brief.js" });
  vm.runInContext(SOURCES.pipelineRender, context, { filename: "pipeline-render.js" });
  vm.runInContext(SOURCES.dawnData, context, { filename: "dawn-data.js" });
  return { win, context };
}

function decodeAttrValue(raw) {
  return String(raw)
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function articleDataAttrs(html) {
  const tag = /<article\b([^>]*)>/.exec(html);
  assert.ok(tag, "renderKanbanCard must emit an <article>");
  const out = {};
  const re = /(data-[\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag[1])) !== null) out[m[1]] = decodeAttrValue(m[2]);
  delete out["data-action"];
  return out;
}

describe("DS-08 · pipeline-render exposes the board as data", () => {
  it("should give each card model exactly the data-* attributes the legacy card renders", () => {
    const rows = [
      row({ fitAssessment: "Strong match", contact: "Dana Lee", matchScore: 82 }),
      row({ title: "Design Lead", company: "Meridian", status: "New", favorite: true }),
    ];
    const { win } = loadApp(rows);
    const pr = win.JobBoredApp.pipelineRender;
    assert.equal(typeof pr.getBoardCardModels, "function", "pipelineRender.getBoardCardModels is missing");
    const models = pr.getBoardCardModels();
    assert.equal(models.length, 2);
    for (const model of models) {
      const job = rows[model.dataIndex];
      const expected = articleDataAttrs(pr.renderKanbanCard(job, 0));
      assert.deepEqual({ ...model.attrs }, expected, `attrs drift for ${job.title}`);
      assert.equal(model.title, job.title);
      assert.equal(model.company, job.company);
    }
  });

  it("should apply the legacy board's filters and lane order to the models", () => {
    const rows = [
      row({ title: "A", status: "Applied" }),
      row({ title: "B", status: "New" }),
      row({ title: "C", status: "New", dismissedAt: "2026-09-22" }),
    ];
    const { win } = loadApp(rows);
    const keys = [...win.JobBoredApp.pipelineRender.getBoardCardModels().map((m) => m.stableKey)];
    assert.deepEqual(keys, [1, 0], "dismissed rows drop out and New precedes Applied");
    const withDismissed = [...loadApp(rows, { showDismissed: true }).win.JobBoredApp.pipelineRender
      .getBoardCardModels().map((m) => m.stableKey)];
    assert.deepEqual(withDismissed.sort(), [0, 1, 2]);
  });
});

describe("DS-08 · dawn-data reads rows when the document has no legacy cards", () => {
  const rows = [
    row({ title: "Staff Engineer", company: "Chronicle", status: "Applied" }),
    row({ title: "Product Engineer", company: "Kestrel", status: "New", fitScore: 6 }),
    row({ title: "Design Lead", company: "Meridian Labs", status: "Interviewing" }),
  ];

  it("should build the pipeline view model from the rows", () => {
    const { win } = loadApp(rows);
    const vm = win.JobBoredDawn.data.getPipelineViewModel();
    const byStage = Object.fromEntries(vm.stages.map((s) => [s.key, s.cards.map((c) => c.role)]));
    assert.equal(vm.empty, false);
    assert.deepEqual([...byStage.applied], ["Staff Engineer"]);
    assert.deepEqual([...byStage.interviewing], ["Design Lead"]);
    assert.deepEqual([...vm.untriaged.map((c) => c.jobKey)], ["1"]);
  });

  it("should build the Case view model for a key from the row", () => {
    const { win } = loadApp(rows);
    const job = JSON.parse(JSON.stringify(win.JobBoredDawn.data.getRoleViewModel("2").job));
    assert.equal(job.role, "Design Lead");
    assert.equal(job.company, "Meridian Labs");
    assert.equal(job.location, "Remote");
    assert.deepEqual(job.tags.slice(0, 2), ["Go", "Kubernetes"]);
    assert.equal(job.notes.body, "Recruiter is Dana");
  });

  it("should count Dawn's jobs from the rows", () => {
    const { win } = loadApp(rows);
    const vm = win.JobBoredDawn.data.getDawnViewModel();
    assert.equal(vm.total, 3);
    assert.equal(vm.isEmpty, false);
  });

  it("should read Dawn's hero numbers from the brief stats model, not #briefStats", () => {
    const { win } = loadApp(rows);
    win.JobBoredApp.brief.getBriefStats = () => ({
      discRecent: 3, discPrior: 1, appRecent: 2, appPrior: 2, inLoop: 1, offers: 1, medianDays: 4,
    });
    const hero = win.JobBoredDawn.data.getDawnViewModel().hero;
    assert.equal(hero.found.value, 3);
    assert.equal(hero.found.sub, "vs 1 prior week");
    assert.equal(hero.applied.sub, "vs 2 prior week");
    assert.equal(hero.inLoop.value, 1);
    assert.equal(hero.inLoop.sub, "interviewing + screens");
    assert.equal(hero.offers.sub, "4d median find → apply");
  });
});

describe("DS-08 · daily-brief exposes its stat numbers as data", () => {
  it("should compute in-loop and offers from the rows", () => {
    const rows = [
      row({ status: "Interviewing" }),
      row({ status: "Phone Screen" }),
      row({ status: "Offer" }),
      row({ status: "New" }),
    ];
    const { win } = loadApp(rows);
    assert.equal(typeof win.JobBoredApp.brief.getBriefStats, "function", "brief.getBriefStats is missing");
    const s = win.JobBoredApp.brief.getBriefStats();
    assert.equal(s.inLoop, 2);
    assert.equal(s.offers, 1);
    const empty = win.JobBoredApp.brief.getBriefStats([]);
    assert.deepEqual(
      JSON.parse(JSON.stringify(empty)),
      { discRecent: 0, discPrior: 0, appRecent: 0, appPrior: 0, inLoop: 0, offers: 0, medianDays: null },
    );
  });
});

describe("DS-08 · flowing-store and flowing-writes read rows", () => {
  function loadFlowing(rows) {
    const win = {
      JobBored: { getPipelineJobs: () => rows, getPipelineSheetRow: () => null },
      location: { hash: "", pathname: "/", search: "" },
      history: { replaceState() {}, pushState() {} },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
      requestAnimationFrame: (fn) => fn(),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };
    const context = vm.createContext({
      window: win,
      document: emptyDocument(),
      console: { log() {}, warn() {}, error() {} },
      CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
      localStorage: win.localStorage,
      requestAnimationFrame: win.requestAnimationFrame,
      location: win.location,
      history: win.history,
      Set, Map, Date, Number, Math, JSON, Object, String, Array, RegExp, Promise,
      parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
    });
    vm.runInContext(SOURCES.flowingStore, context, { filename: "flowing-store.js" });
    vm.runInContext(SOURCES.flowingWrites, context, { filename: "flowing-writes.js" });
    return win;
  }

  it("should record recents meta from the row when no legacy card exists", () => {
    const win = loadFlowing([row({ title: "Staff Engineer", company: "Chronicle" })]);
    const store = win.JobBoredFlowing;
    assert.equal(typeof store.lookupJobMeta, "function", "JobBoredFlowing.lookupJobMeta is missing");
    assert.deepEqual({ ...store.lookupJobMeta("0") }, { role: "Staff Engineer", company: "Chronicle" });
    assert.deepEqual({ ...store.lookupJobMeta("7") }, { role: "", company: "" });
  });

  it("should resolve a job's posting link from the row", () => {
    const win = loadFlowing([row({ link: "https://jobs.example.test/42" })]);
    const writes = win.JobBoredFlowing && win.JobBoredFlowing.writes;
    const hooks = writes && writes._internal;
    assert.ok(hooks && typeof hooks.readJobLinkFromApp === "function", "readJobLinkFromApp is missing");
    assert.equal(hooks.readJobLinkFromApp("0"), "https://jobs.example.test/42");
    assert.equal(hooks.readJobLinkFromApp("9"), "");
  });
});

describe("DS-08 · no v2 surface watches the legacy #jobCards board", () => {
  it("should not observe #jobCards from pipeline.js", () => {
    const pipelineJs = read("pipeline.js");
    assert.doesNotMatch(pipelineJs, /getElementById\("jobCards"\)/);
    assert.doesNotMatch(pipelineJs, /getElementById\("kanbanPipeline"\)/);
  });

  it("should gate the legacy board build on body.jb-v2 and still announce the render", () => {
    const src = read("pipeline-render.js");
    const body = src.slice(src.indexOf("function renderPipeline()"), src.indexOf("function renderCardActions"));
    assert.match(body, /isV2View\(\)/, "renderPipeline must check the v2 view before building #jobCards");
    assert.match(body, /emitPipelineRendered\(data\.length\)/);
  });
});

describe("DS-08 · jb-v2-legacy-hide.css drops the rules the gate made dead", () => {
  const css = read("jb-v2-legacy-hide.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("should not hide #pipelineSection or .pipeline-board on their own", () => {
    // #pipelineSection sits inside main.main-content, which stays hidden, and
    // .pipeline-board is no longer built under body.jb-v2.
    assert.doesNotMatch(css, /body\.jb-v2 #pipelineSection/);
    assert.doesNotMatch(css, /body\.jb-v2 \.pipeline-board/);
  });

  it("should keep hiding the static legacy chrome and the legacy letter modal", () => {
    // main.main-content still holds the legacy toolbar, empty and error states;
    // the brief panel is still drawn by daily-brief.js renderBrief.
    assert.match(css, /body\.jb-v2 #dashboard > main\.main-content/);
    assert.match(css, /body\.jb-v2 #dashboard > \.command-strip\.daily-brief-panel/);
    assert.match(css, /body\.jb-v2 #resumeGenerateModal/);
  });
});
