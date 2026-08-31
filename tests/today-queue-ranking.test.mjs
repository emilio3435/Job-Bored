/* UX-01 — the default v2 surface ranked by fit alone.

   Dawn's lead carousel sorts by fitScore desc and nothing else
   (dawn-data.js buildLeads), so a role you have never touched outranks
   a recruiter who replied this morning. The engine that knows better
   — daily-brief.js overdueFollowUps / waitingOnReplyJobs / stale-applied —
   is display:none under body.jb-v2.

   The Today queue is the attention surface: reply > interview prep >
   overdue follow-up > staleness > fit, one primary next action per item,
   and no side effects on where the boards are scrolled. */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/* stage-registry.js is the boards lane's file and lands on a different branch.
   today-data.js / today.js each carry a documented local fallback for exactly
   this case (today-data.js stageKeyOf/isArchivedStage), so the ranking rules
   below hold with or without the registry in the page — and once the registry
   is merged this loads it, so the composed page is what the test exercises. */
function loadStageRegistry(env) {
  const rel = "stage-registry.js";
  if (!existsSync(join(repoRoot, rel))) return false;
  vm.runInNewContext(read(rel), env);
  return true;
}

const NOW = Date.parse("2026-05-20T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW + offsetDays * day).toISOString().slice(0, 10);

/** One job per band, deliberately fit-inverted: the most urgent item has the
 *  worst fit score, so a fit-first ranking cannot accidentally pass. */
const JOBS = [
  { title: "Replied role", company: "Acme", status: "Applied", fitScore: 2,
    appliedDate: iso(-19), responseFlag: "Yes" },
  { title: "Screen tomorrow", company: "Bravo", status: "Phone Screen", fitScore: 3,
    appliedDate: iso(-12), followUpDate: iso(1) },
  { title: "Overdue nudge", company: "Charlie", status: "Applied", fitScore: 4,
    appliedDate: iso(-9), followUpDate: iso(-4) },
  { title: "Gone quiet", company: "Delta", status: "Applied", fitScore: 5,
    appliedDate: iso(-21) },
  { title: "Shiny new", company: "Echo", status: "New", fitScore: 10 },
  { title: "Rejected", company: "Foxtrot", status: "Rejected", fitScore: 10 },
  { title: "Expired", company: "Golf", status: "Expired", fitScore: 10 },
  { title: "Dismissed", company: "Hotel", status: "New", fitScore: 10, dismissedAt: iso(-1) },
];

function loadTodayData(opts = {}) {
  const env = makeEnv({ bodyClass: "jb-v2", regions: ["today"] });
  env.JobBored = { getPipelineJobs: () => (opts.jobs || JOBS) };
  vm.runInNewContext(read("dawn-data.js"), env);
  loadStageRegistry(env);
  vm.runInNewContext(read("today-data.js"), env);
  return { env, api: env.JobBoredToday.data };
}

function queue(opts = {}) {
  const { api } = loadTodayData(opts);
  return api.getTodayQueue({ now: NOW, ...opts });
}

describe("Today attention queue — ranking (UX-01)", () => {
  it("ranks reply over prep over overdue follow-up over staleness over fit", () => {
    const model = queue();
    assert.deepEqual(
      Array.from(model.items, (i) => i.company),
      ["Acme", "Bravo", "Charlie", "Delta", "Echo"],
      "the ranking bands, not fitScore, decide the order",
    );
    assert.deepEqual(
      Array.from(model.items, (i) => i.reason),
      ["reply", "prep", "follow-up", "stale", "fit"],
    );
  });

  it("puts the best-fit untouched role last, not first", () => {
    const model = queue();
    const shiny = model.items[model.items.length - 1];
    assert.equal(shiny.company, "Echo");
    assert.equal(shiny.fitScore, 10);
  });

  it("leaves closed and dismissed rows out entirely", () => {
    const companies = Array.from(queue().items, (i) => i.company);
    for (const gone of ["Foxtrot", "Golf", "Hotel"]) {
      assert.equal(companies.includes(gone), false, `${gone} has nothing to act on today`);
    }
  });

  it("gives every item exactly one primary next action", () => {
    for (const item of queue().items) {
      assert.ok(!!item.action, `${item.company} needs a next action`);
      assert.ok(item.action.label, "the action needs a human label");
      assert.ok(item.action.event, "the action must be an intent-bus event, not a direct write");
      assert.equal(item.action.detail.jobKey, item.jobKey);
      assert.equal(Array.isArray(item.actions), false, "one action, not a menu");
    }
  });

  it("routes every action through an existing intent event", () => {
    const allowed = new Set(["jb:role:writeback", "jb:pipeline:move", "jb:role:open"]);
    for (const item of queue().items) {
      assert.ok(
        allowed.has(item.action.event),
        `${item.action.event} is not one of the contracted intents`,
      );
    }
  });

  it("orders within the staleness band by how long it has been quiet", () => {
    const jobs = [
      { title: "Quiet 15d", company: "Q15", status: "Applied", fitScore: 9, appliedDate: iso(-15) },
      { title: "Quiet 40d", company: "Q40", status: "Applied", fitScore: 1, appliedDate: iso(-40) },
    ];
    const model = queue({ jobs });
    assert.deepEqual(Array.from(model.items, (i) => i.company), ["Q40", "Q15"]);
  });

  it("keeps an unscored role unscored instead of scoring it zero", () => {
    const jobs = [{ title: "No fit yet", company: "Unknown", status: "New" }];
    const item = queue({ jobs }).items[0];
    assert.equal(item.fitScore, null);
    assert.ok(
      /[Uu]nknown|not scored|Unscored/.test(item.detail + item.headline),
      "an unscored role should say so in words",
    );
  });

  it("reports an honest empty state rather than inventing work", () => {
    const model = queue({ jobs: [] });
    assert.equal(model.empty, true);
    assert.equal(model.items.length, 0);
  });

  it("counts each band so the surface can say why it is short", () => {
    const model = queue();
    assert.deepEqual({ ...model.counts }, { reply: 1, prep: 1, "follow-up": 1, stale: 1, fit: 1 });
  });

  it("reuses the shared flag vocabulary rather than minting a second one", () => {
    // dawn-data.computeFlag already classifies reply/prep/scheduled/stale for
    // the pipeline VM; Today must agree with it or the two surfaces will
    // disagree about the same card. Proved by behaviour, not by a source
    // regex: a source match cannot tell dawn-data's public `computeFlag`
    // export apart from the `_internal` copy, so it would pass on a page
    // where Today is in fact running its own private classifier.
    const jobs = [{ title: "Untouched", company: "Zulu", status: "New", fitScore: 6 }];
    const { env, api } = loadTodayData({ jobs });

    const seen = [];
    env.JobBoredDawn.data.computeFlag = (rec, nowMs) => {
      seen.push({ rec, nowMs });
      return "reply";
    };

    const model = api.getTodayQueue({ jobs, now: NOW });
    assert.equal(seen.length, 1, "Today must ask dawn-data to classify the card");
    assert.equal(seen[0].rec.stage, "new", "and must hand it the shared record shape");
    assert.equal(seen[0].nowMs, NOW, "with the same clock the rest of the queue uses");
    assert.equal(
      model.items[0].reason,
      "reply",
      "dawn-data's verdict decides the band — Today must not re-decide it locally",
    );
  });
});

describe("Today attention queue — renderer", () => {
  function renderToday(jobs = JOBS) {
    const env = makeEnv({
      bodyClass: "jb-v2",
      regions: ["today"],
      localStorage: {
        "jb-v2-lattice-scroll": "420",
        "jb-v2-lattice-show-closed": "1",
        jb_pipelineCollapsedColumns: '["offer"]',
      },
    });
    env.JobBored = { getPipelineJobs: () => jobs };
    vm.runInNewContext(read("dawn-data.js"), env);
    loadStageRegistry(env);
    vm.runInNewContext(read("today-data.js"), env);
    vm.runInNewContext(read("today.js"), env);
    env.flushTimers();
    return env;
  }

  it("renders one row per queue item into the today region", () => {
    const env = renderToday();
    const region = env.document.querySelector('[data-region="today"]');
    const rows = region.querySelectorAll("[data-today-reason]");
    assert.equal(rows.length, 5, "one row per queue item");
    assert.equal(rows[0].getAttribute("data-today-reason"), "reply");
  });

  it("renders nothing at all when jb-v2 is off", () => {
    const env = makeEnv({ regions: ["today"] });
    env.JobBored = { getPipelineJobs: () => JOBS };
    vm.runInNewContext(read("dawn-data.js"), env);
    loadStageRegistry(env);
    vm.runInNewContext(read("today-data.js"), env);
    vm.runInNewContext(read("today.js"), env);
    env.flushTimers();
    assert.equal(env.document.querySelector('[data-region="today"]').children.length, 0);
  });

  it("dispatches the item's intent when its action is clicked", () => {
    const env = renderToday();
    const seen = [];
    env.document.addEventListener("jb:role:writeback", (e) => seen.push(e));
    const region = env.document.querySelector('[data-region="today"]');
    const btn = region.querySelector('[data-today-action="log-follow-up"]');
    assert.ok(!!btn, "the overdue follow-up row should offer a log-follow-up action");
    btn.dispatchEvent({ type: "click", target: btn, preventDefault() {}, stopPropagation() {} });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].detail.field, "heardBack");
  });

  it("leaves all three board position stores untouched when an action runs", () => {
    const env = renderToday();
    const before = new Map(env.localStorage._store);
    const region = env.document.querySelector('[data-region="today"]');
    const btn = region.querySelector("[data-today-action]");
    btn.dispatchEvent({ type: "click", target: btn, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual([...env.localStorage._store], [...before]);

    // Board position lives in three uncoordinated stores. Today must not read
    // or write any of them, and must not force a board re-render either —
    // that is how a "quick action" loses your scroll position and reopens
    // every column you collapsed.
    // Comments legitimately name these stores to explain the rule.
    const src = read("today.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const key of [
      "jb-v2-lattice-scroll",
      "jb-v2-lattice-show-closed",
      "jb_pipelineCollapsedColumns",
      "jb_viewedKeys",
      "renderPipeline",
    ]) {
      assert.equal(src.includes(key), false, `today.js must not touch ${key}`);
    }
  });

  it("never observes the body subtree (dawn/pipeline render-loop rule)", () => {
    const env = renderToday();
    const bad = env.document._observers.filter(
      (r) => r.target === env.document.body && r.options.subtree,
    );
    assert.equal(bad.length, 0);
  });

  it("scopes its stylesheet under body.jb-v2 [data-region=today] and uses tokens only", () => {
    const css = read("today.css");
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = bare
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("{") && !l.startsWith("@") && !l.startsWith("}"))
      .map((l) => l.slice(0, l.indexOf("{")).trim())
      .filter(Boolean);
    assert.ok(selectors.length > 10, "the extractor should actually find rules");
    for (const sel of selectors) {
      // Every rule is either scoped to the flag or is the off-flag guard.
      assert.ok(
        /body(\.jb-v2|:not\(\.jb-v2\))/.test(sel),
        `today.css rule must stay scoped: ${sel}`,
      );
    }
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, "today.css must use tokens-v2 vars, not raw hex");
  });
});
