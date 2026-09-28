/**
 * LEADTABS LF — leads.js, the Leads view's Filters mode.
 *
 * Loads leads-core.js (LC) and leads.js in a vm sandbox, the way
 * leads-core.test.mjs does, and drives the DOM-free controller and the pure
 * renderers. Every count, filter and store call here runs through the real
 * LC; the host stub records what the row actions hand the app's handlers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeIndexedDb, readRepoFile } from "./oneflow-l0-harness.mjs";

function stubParseWorkMode(text) {
  const t = String(text || "").toLowerCase();
  if (/remote/.test(t)) return "remote";
  if (/hybrid/.test(t)) return "hybrid";
  if (/on-?site/.test(t)) return "onsite";
  return "";
}

function load() {
  const doc = {
    readyState: "complete",
    addEventListener() {},
    querySelector() { return null; },
    body: { classList: { contains: () => false }, getAttribute: () => null },
  };
  const win = {
    document: doc,
    JobBoredApp: { sheetsRead: { parseWorkModeFromLocation: stubParseWorkMode } },
  };
  const ctx = {
    window: win,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    crypto: { randomUUID: () => `u${Math.random().toString(16).slice(2)}` },
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("leads-core.js"), ctx, { filename: "leads-core.js" });
  vm.runInContext(readRepoFile("leads.js"), ctx, { filename: "leads.js" });
  return { leads: win.JobBoredLeads, core: win.JobBoredApp.leadsCore, win };
}

const NOW = Date.UTC(2026, 8, 27, 12);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);

function lead(overrides) {
  return Object.assign(
    {
      title: "RevOps Manager",
      company: "Acme",
      location: "Remote - US",
      workMode: "",
      workModeSource: "",
      source: "greenhouse",
      salary: "$150k - $180k",
      fitScore: 8,
      matchScore: 80,
      status: "New",
      dateFound: daysAgo(2),
      fitAssessment: "Owns the forecast process end to end.",
      favorite: false,
      dismissedAt: null,
    },
    overrides,
  );
}

function sheet() {
  return [
    lead({ title: "Director, Revenue Operations", company: "Northwind", fitScore: 9 }),
    lead({ title: "RevOps Manager", company: "Acme", location: "Hybrid - Austin", fitScore: 7 }),
    lead({ title: "Sales Operations Lead", company: "Globex", location: "On-site - Denver", salary: "$95k - $110k", fitScore: 6 }),
    lead({ title: "Account Executive", company: "Initech", location: "Remote", fitScore: 4, status: "Applied" }),
    lead({ title: "RevOps Analyst", company: "Umbrella", salary: "$90k - $100k", fitScore: 5 }),
  ];
}

const PROFILE = {
  identity: { targetRoles: ["Revenue Operations", "Sales Operations"] },
  hardConstraints: { salaryFloor: 120000 },
  discoveryProfile: { companyBlocklist: [] },
};

/** A controller over `rows`, with every host call recorded. */
function setup({ rows = sheet(), profile = PROFILE, store, loaded = true } = {}) {
  const env = load();
  const calls = [];
  const host = {
    getJobs: () => rows,
    toggleFavorite: (key) => { calls.push(["star", key]); rows[key].favorite = !rows[key].favorite; },
    dismiss: (key) => calls.push(["dismiss", key]),
    moveStage: (key, from, to) => calls.push(["stage", key, from, to]),
    openCase: (key) => calls.push(["open", key]),
    draft: (key) => calls.push(["draft", key]),
    toast: (msg, undo) => calls.push(["toast", msg, typeof undo]),
  };
  const ctl = env.leads.createController({ host, store, now: () => NOW });
  if (profile) ctl.setProfile(profile);
  if (loaded) ctl.setLoaded(true);
  return Object.assign(env, { ctl, rows, calls, host });
}

/** Plain copies, so deepEqual does not trip over the vm realm boundary. */
const plain = (v) => JSON.parse(JSON.stringify(v));
const titles = (m) => plain(m.rows.map((r) => r.title));

describe("Leads mode toggle", () => {
  it("starts on Filters, switches to Chat, and ignores unknown modes", () => {
    const { ctl } = setup();
    const heard = [];
    ctl.subscribe((reason) => heard.push(reason));
    assert.equal(ctl.getMode(), "filters");
    assert.equal(ctl.setMode("chat"), true);
    assert.equal(ctl.getMode(), "chat");
    assert.equal(ctl.model().mode, "chat");
    assert.equal(ctl.setMode("chat"), false, "re-selecting the current mode is a no-op");
    assert.equal(ctl.setMode("tune"), false);
    assert.deepEqual(heard, ["mode"]);
  });

  it("the shell hands LT a Chat region beside the Filters panel, one toggle for both", () => {
    const { leads } = setup();
    const html = leads.shellHtml();
    assert.match(html, /data-leads-mode="filters" aria-pressed="true"/);
    assert.match(html, /data-leads-mode="chat" aria-pressed="false"/);
    assert.match(html, /id="leadsFilters" data-leads-panel="filters"/);
    assert.match(html, /id="leadsChat" data-leads-panel="chat" hidden/);
    assert.match(html, /data-leads-chat-placeholder/);
    assert.deepEqual([...leads.MODES], ["filters", "chat"]);
    assert.equal(leads.MODE_EVENT, "jb:leads:mode");
  });
});

describe("Search", () => {
  it("filters through LC and marks every hit, synonyms included", () => {
    const { ctl, leads } = setup();
    ctl.setQuery("revops");
    const m = ctl.model();
    assert.deepEqual(titles(m).sort(), ["Director, Revenue Operations", "RevOps Manager"]);
    const html = leads.render(m).rows;
    assert.match(html, /<mark>RevOps<\/mark> Manager/);
    assert.match(html, /Director, <mark>Revenue Operations<\/mark>/);
    assert.deepEqual(plain(m.chips.map((c) => c[0])), ["q"]);
  });

  it("escapes sheet text instead of rendering it as markup", () => {
    const rows = [lead({ title: "<img src=x onerror=alert(1)> RevOps", company: "A&B" })];
    const { ctl, leads } = setup({ rows });
    ctl.setQuery("revops");
    const html = leads.render(ctl.model()).rows;
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; <mark>RevOps<\/mark>/);
    assert.match(html, /A&amp;B/);
  });

  it("clearing the search chip restores the list", () => {
    const { ctl } = setup();
    ctl.setQuery("northwind");
    assert.equal(ctl.model().rows.length, 1);
    ctl.removeChip("q");
    assert.equal(ctl.model().view.q, "");
    assert.equal(ctl.model().rows.length, 2, "salary floor still hides two of the four target-role rows");
  });
});

describe("Facets, lens and sort", () => {
  it("work-mode counts come from LC and ticking one narrows the list", () => {
    const { ctl, leads } = setup();
    const html = leads.render(ctl.model()).modes;
    assert.match(html, /value="remote">\s*<span class="jbl-opt__label">Remote<\/span><span class="jbl-opt__count">1<\/span>/);
    assert.match(html, /value="hybrid">\s*<span class="jbl-opt__label">Hybrid<\/span><span class="jbl-opt__count">1<\/span>/);
    ctl.toggleFacet("workModes", "hybrid", true);
    assert.deepEqual(titles(ctl.model()), ["RevOps Manager"]);
    assert.deepEqual(plain(ctl.model().chips.map((c) => c[1])), ["Hybrid"]);
  });

  it("a fit floor is a segmented control with the pressed step", () => {
    const { ctl, leads } = setup();
    ctl.setMin("fitMin", 8);
    const m = ctl.model();
    assert.deepEqual(titles(m), ["Director, Revenue Operations"]);
    assert.match(leads.render(m).fit, /data-value="8" aria-pressed="true">8\+/);
  });

  it("the lens shows each target role with its count, and outside-targets separately", () => {
    const { ctl, leads } = setup();
    const lens = leads.render(ctl.model()).lens;
    assert.match(lens, /data-lens="targets" aria-pressed="true"[\s\S]*?jbl-lens__count">2</);
    assert.match(lens, /data-lens="Revenue Operations"[\s\S]*?jbl-lens__count">2</);
    assert.match(lens, /data-lens="other"[\s\S]*?jbl-lens__count">1</);
    ctl.setLens("other");
    assert.deepEqual(titles(ctl.model()), ["Account Executive"]);
  });

  it("with no target roles the lens is a single All leads tab and nothing is lost", () => {
    const { ctl, leads } = setup({ profile: { identity: { targetRoles: [] } } });
    const m = ctl.model();
    assert.equal(m.view.lens, "all");
    assert.equal(m.rows.length, 5);
    assert.match(leads.render(m).lens, /All leads/);
  });

  it("sort goes through LC and the split line names it", () => {
    const { ctl, leads } = setup({ profile: null });
    ctl.setSort("company");
    const m = ctl.model();
    assert.deepEqual(plain(m.rows.map((r) => r.company)), ["Acme", "Globex", "Initech", "Northwind", "Umbrella"]);
    assert.match(leads.render(m).split, /sorted by company a–z/);
  });
});

describe("Hidden-by-profile footer", () => {
  it("counts the hidden rows by reason and offers Show them", () => {
    const { ctl, leads } = setup();
    const m = ctl.model();
    assert.equal(m.hidden.length, 2);
    const footer = leads.render(m).footer;
    assert.match(footer, /<b>2 hidden<\/b> by your profile: under your salary floor \(2\)/);
    assert.match(footer, /data-hidden="show">Show them/);
    assert.match(footer, /data-leads-mode="chat">Change in Chat/);
  });

  it("Show them adds the hidden rows, dimmed with their reason, and keeps the visible count honest", () => {
    const { ctl, leads } = setup();
    ctl.setShowHidden(true);
    const m = ctl.model();
    assert.equal(m.rows.length, 4);
    assert.equal(m.visibleCount, 2);
    const parts = leads.render(m);
    assert.equal((parts.rows.match(/jbl-row--hidden/g) || []).length, 2);
    assert.match(parts.rows, /jbl-hide-why">Under your salary floor</);
    assert.match(parts.footer, /Including <b>2<\/b> leads your profile normally hides/);
  });

  it("when the profile hides everything in view, the page says so instead of 'no match'", () => {
    const rows = [lead({ salary: "$60k - $70k" })];
    const { ctl, leads } = setup({ rows });
    const m = ctl.model();
    assert.equal(m.status, "all-hidden");
    assert.match(leads.render(m).rows, /Your profile hides every lead here/);
  });
});

describe("States", () => {
  it("shows skeleton rows until the pipeline has loaded", () => {
    const { ctl, leads } = setup({ rows: [], loaded: false });
    const m = ctl.model();
    assert.equal(m.status, "loading");
    const parts = leads.render(m);
    assert.equal((parts.rows.match(/jbl-skel/g) || []).length, 7);
    assert.equal(parts.count, "Loading leads…");
  });

  it("an empty sheet invites a discovery run", () => {
    const { ctl, leads } = setup({ rows: [] });
    assert.equal(ctl.model().status, "empty");
    assert.match(leads.render(ctl.model()).rows, /No leads yet[\s\S]*data-empty="discover">Run discovery/);
  });

  it("no matches offers loosen buttons with what each one would add, plus Clear filters", () => {
    const { ctl, leads } = setup();
    ctl.setMin("fitMin", 8);
    ctl.toggleFacet("workModes", "hybrid", true);
    const m = ctl.model();
    assert.equal(m.status, "no-match");
    const loosen = ctl.loosenOptions();
    assert.deepEqual(JSON.parse(JSON.stringify(loosen.chips)), [
      { id: "fitMin", label: "Fit 8+", gain: 1 },
      { id: "workModes:hybrid", label: "Hybrid", gain: 1 },
    ]);
    const html = leads.render(m, { loosen }).rows;
    assert.match(html, /data-chip="fitMin">Remove Fit 8\+ \(\+1\)/);
    assert.match(html, /data-lens="all">Search all roles \(0\)/);
    assert.match(html, /data-chip="__all">Clear filters/);
    ctl.clearFilters();
    assert.equal(ctl.model().status, "list");
    assert.equal(ctl.model().view.lens, "targets", "clearing filters keeps the lens");
  });
});

describe("Saved views (LC store)", () => {
  it("saves the current view, lists it with a live count, and re-applies it", async () => {
    const { core } = load();
    const store = core.createStore({ indexedDB: makeFakeIndexedDb() });
    const { ctl, leads } = setup({ store: () => store });
    await ctl.loadViews();
    assert.equal(ctl.model().viewsStatus, "ready");
    ctl.setMin("fitMin", 7);
    const record = await ctl.saveView("Strong fits");
    const m = ctl.model();
    assert.equal(m.views.length, 1);
    assert.equal(m.views[0].count, 2);
    assert.equal(m.views[0].active, true);
    assert.match(leads.render(m).views, /Strong fits<\/span><span class="jbl-view__count">2</);

    ctl.clearFilters();
    assert.equal(ctl.model().views[0].active, false, "changing the view deselects the saved one");
    ctl.applySavedView(record.id);
    assert.equal(ctl.model().view.fitMin, 7);

    const persisted = await store.listViews();
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].view.fitMin, 7);

    await ctl.deleteView(record.id);
    assert.equal(ctl.model().views.length, 0);
    assert.equal((await store.listViews()).length, 0);
  });

  it("with IndexedDB unavailable, views are disabled with a note and the list still works", async () => {
    const broken = { listViews: () => Promise.reject(new Error("IndexedDB open timed out")) };
    const { ctl, leads } = setup({ store: () => broken });
    await ctl.loadViews();
    const m = ctl.model();
    assert.equal(m.viewsStatus, "unavailable");
    assert.match(leads.render(m).views, /Saved views need browser storage, which is off here\. Filters still work\./);
    await assert.rejects(ctl.saveView("Anything"), /unavailable/);
    assert.equal(m.rows.length, 2);
  });

  it("no store at all reads as unavailable, not as loading forever", async () => {
    const { ctl } = setup();
    await ctl.loadViews();
    assert.equal(ctl.model().viewsStatus, "unavailable");
  });
});

describe("Row actions", () => {
  it("write through _source on a revealed hidden row, never the copy", () => {
    const { ctl, rows, calls } = setup();
    ctl.setShowHidden(true);
    const copy = ctl.model().rows.find((r) => r.company === "Globex");
    assert.ok(copy._hiddenReason, "the Globex row is a revealed copy");
    assert.notEqual(copy, rows[2]);
    assert.equal(copy._source, rows[2]);

    ctl.act("star", copy);
    ctl.act("stage", copy, "Phone Screen");
    ctl.act("dismiss", copy);
    ctl.act("open", copy);
    ctl.act("draft", copy);
    const writes = calls.filter((c) => c[0] !== "toast");
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [
      ["star", 2],
      ["stage", 2, "new", "phone-screen"],
      ["dismiss", 2],
      ["open", 2],
      ["draft", 2],
    ]);
    assert.equal(rows[2].favorite, true, "the sheet row changed");
    assert.equal(copy.favorite, false, "the copy did not");
  });

  it("star and stage moves are undoable; dismiss leaves undo to the app's own toast", () => {
    const { ctl, calls } = setup();
    const row = ctl.model().rows[0];
    ctl.act("star", row);
    ctl.act("stage", row, "Applied");
    ctl.act("dismiss", row);
    const toasts = calls.filter((c) => c[0] === "toast");
    assert.deepEqual(toasts.map((t) => t[2]), ["function", "function"], "star and stage carry an Undo; dismiss adds no second toast");
    assert.equal(ctl.undo(), true);
    assert.deepEqual(calls.filter((c) => c[0] === "stage").at(-1), ["stage", 0, "applied", "new"]);
    assert.equal(ctl.undo(), true);
    assert.deepEqual(calls.filter((c) => c[0] === "star").length, 2);
    assert.equal(ctl.undo(), false);
  });

  it("moving to the current stage writes nothing", () => {
    const { ctl, calls } = setup();
    ctl.act("stage", ctl.model().rows[0], "New");
    assert.equal(calls.filter((c) => c[0] === "stage").length, 0);
  });

  it("each rendered row carries its sheet key and a readable label", () => {
    const { ctl, leads } = setup();
    const html = leads.render(ctl.model()).rows;
    assert.match(html, /data-key="0" tabindex="-1" aria-label="Director, Revenue Operations at Northwind, fit 9, New"/);
    assert.match(html, /data-act="star" aria-pressed="false" aria-label="Star RevOps Manager"/);
  });
});
