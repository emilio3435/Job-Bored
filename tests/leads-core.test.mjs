/**
 * LEADTABS LC — leads-core.js, the logic behind Leads → Filters and Chat.
 *
 * Loads the browser script in a vm sandbox (as oneflow-l0-harness does) with
 * an in-memory IndexedDB and a stub of K0's parseWorkModeFromLocation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeIndexedDb, readRepoFile } from "./oneflow-l0-harness.mjs";

/** deepEqual across the vm realm boundary: compare plain JSON values. */
function same(actual, expected, message) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
}

/** Same signature as K0's sheets-read-load.js parser. */
function stubParseWorkMode(text) {
  const t = String(text || "").toLowerCase();
  if (/remote|work from home/.test(t)) return "remote";
  if (/hybrid/.test(t)) return "hybrid";
  if (/on-?site|in office/.test(t)) return "onsite";
  return "";
}

function loadCore({ withParser = true } = {}) {
  const win = {};
  if (withParser) {
    win.JobBoredApp = { sheetsRead: { parseWorkModeFromLocation: stubParseWorkMode } };
  }
  const indexedDB = makeFakeIndexedDb();
  const ctx = {
    window: win,
    indexedDB,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    crypto: { randomUUID: () => `u${Math.random().toString(16).slice(2)}` },
  };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("leads-core.js"), ctx, { filename: "leads-core.js" });
  return { core: win.JobBoredApp.leadsCore, win, indexedDB };
}

const NOW = Date.UTC(2026, 8, 27, 12);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);

function row(overrides) {
  return Object.assign(
    {
      title: "Director, Revenue Operations",
      company: "Acme",
      location: "Remote (US)",
      source: "greenhouse",
      salary: "$150k - $180k",
      fitScore: 8,
      matchScore: 80,
      status: "New",
      fitAssessment: "",
      dateFound: daysAgo(1),
      favorite: false,
      dismissedAt: null,
      workMode: "",
    },
    overrides,
  );
}

const PROFILE = {
  identity: { targetRoles: ["Director, Revenue Operations", "Sales Operations Manager"] },
  hardConstraints: { workMode: "any", skipTitles: [], salaryRequired: false },
  discoveryProfile: { companyBlocklist: [] },
};

function profileWith(hc, discovery) {
  return {
    identity: PROFILE.identity,
    hardConstraints: Object.assign({}, PROFILE.hardConstraints, hc),
    discoveryProfile: Object.assign({}, PROFILE.discoveryProfile, discovery),
  };
}

describe("leads-core: module shape", () => {
  it("should attach to window.JobBoredApp.leadsCore with every export", () => {
    const { core } = loadCore();
    for (const name of [
      "workModeFor",
      "parseSalaryMax",
      "hideReason",
      "tokenize",
      "matchesQuery",
      "highlightRanges",
      "roleMatches",
      "roleIndexFor",
      "normalizeView",
      "passView",
      "filterLeads",
      "countsFor",
      "facetCounts",
      "sortLeads",
      "createStore",
      "store",
    ]) {
      assert.equal(typeof core[name], "function", name);
    }
    assert.equal(core.DB_NAME, "jobbored-leads");
    assert.equal(core.STORE_NAME, "records");
    assert.equal(core.HISTORY_LIMIT, 50);
  });

  it("should not touch localStorage or the user-content database", () => {
    const src = readRepoFile("leads-core.js");
    assert.doesNotMatch(src, /localStorage/);
    assert.doesNotMatch(src, /command-center-user-content/);
    assert.doesNotMatch(src, /document\./);
  });
});

describe("leads-core: work mode", () => {
  it("should use column Z when it holds remote, hybrid or onsite", () => {
    const { core } = loadCore();
    assert.equal(core.workModeFor(row({ workMode: "hybrid", workModeSource: "column", location: "Remote" })), "hybrid");
    assert.equal(core.workModeFor(row({ workMode: "ONSITE", workModeSource: "column", location: "Remote" })), "onsite");
  });

  it("should parse the location when column Z is blank or a foreign word", () => {
    const { core } = loadCore();
    assert.equal(core.workModeFor(row({ workMode: "", location: "Hybrid - Austin" })), "hybrid");
    assert.equal(core.workModeFor(row({ workMode: "unknown", workModeSource: "column", location: "On-site, NYC" })), "onsite");
    assert.equal(core.workModeFor(row({ workMode: "", location: "Chicago, IL" })), "");
  });

  it("should read the parser at call time and return blank when K0 is not loaded", () => {
    const { core, win } = loadCore({ withParser: false });
    assert.equal(core.workModeFor(row({ location: "Remote" })), "");
    win.JobBoredApp.sheetsRead = { parseWorkModeFromLocation: stubParseWorkMode };
    assert.equal(core.workModeFor(row({ location: "Remote" })), "remote");
  });
});

describe("leads-core: profile layer mirrors runPreFilter", () => {
  it("should hide a title containing a skip phrase, case-insensitively", () => {
    const { core } = loadCore();
    const why = core.hideReason(row({ title: "Revenue Operations Intern" }), profileWith({ skipTitles: ["intern"] }));
    assert.equal(why.reason, "skip_title_match");
    assert.equal(why.matchedPhrase, "intern");
  });

  it("should reject on work mode only for remote_only and a non-remote bucket", () => {
    const { core } = loadCore();
    const remoteOnly = profileWith({ workMode: "remote_only" });
    assert.equal(core.hideReason(row({ location: "Hybrid - Austin" }), remoteOnly).reason, "work_mode_mismatch");
    assert.equal(core.hideReason(row({ location: "Chicago, IL" }), remoteOnly).remoteBucket, "unknown");
    assert.equal(core.hideReason(row({ location: "Remote" }), remoteOnly), null);
    // hybrid_ok and onsite_ok never reject on the remote bucket.
    assert.equal(core.hideReason(row({ location: "On-site, NYC" }), profileWith({ workMode: "hybrid_ok" })), null);
    assert.equal(core.hideReason(row({ location: "Remote" }), profileWith({ workMode: "onsite_ok" })), null);
  });

  it("should read inferRemoteBucket's wider haystack for remote_only when Z is blank", () => {
    const { core } = loadCore();
    const remoteOnly = profileWith({ workMode: "remote_only" });
    const r = row({ location: "United States", title: "Director, Revenue Operations (Remote)" });
    assert.equal(core.hideReason(r, remoteOnly), null);
    // Column Z wins over the text.
    assert.equal(core.hideReason(row({ workMode: "onsite", workModeSource: "column", location: "Remote" }), remoteOnly).reason, "work_mode_mismatch");
  });

  it("should not treat K0's location-parsed workMode as column Z (LC-BUCKET)", () => {
    const { core } = loadCore();
    // The row K0's parsePipelineCSV emits for a blank Z: workMode already
    // holds the location parse. inferRemoteBucket checks remote before
    // hybrid over location + title, so the worker keeps this lead.
    const blankZ = row({
      location: "Hybrid - Austin",
      title: "Director, Revenue Operations (Remote)",
      workMode: "hybrid",
      workModeSource: "location",
    });
    assert.equal(core.hideReason(blankZ, profileWith({ workMode: "remote_only" })), null);
    // The facet still reads the location only.
    assert.equal(core.workModeFor(blankZ), "hybrid");
  });

  it("should constrain location for hybrid_ok and onsite_ok when acceptableLocations is set", () => {
    const { core } = loadCore();
    const hybrid = profileWith({ workMode: "hybrid_ok", acceptableLocations: ["Austin", "Remote"] });
    assert.equal(core.hideReason(row({ location: "Hybrid - Austin, TX" }), hybrid), null);
    assert.equal(core.hideReason(row({ location: "New York, NY" }), hybrid).reason, "location_outside_acceptable");
    const onsite = profileWith({ workMode: "onsite_ok", acceptableLocations: ["Denver"] });
    assert.equal(core.hideReason(row({ location: "Boston" }), onsite).reason, "location_outside_acceptable");
    // Empty list or remote_only/any never apply the location check.
    assert.equal(core.hideReason(row({ location: "Boston" }), profileWith({ workMode: "hybrid_ok", acceptableLocations: [] })), null);
    assert.equal(core.hideReason(row({ location: "Boston" }), profileWith({ workMode: "any", acceptableLocations: ["Denver"] })), null);
  });

  it("should reject missing salary only when salaryRequired is set", () => {
    const { core } = loadCore();
    const r = row({ salary: "" });
    assert.equal(core.hideReason(r, profileWith({ salaryRequired: false, salaryFloor: 200000 })), null);
    assert.equal(core.hideReason(r, profileWith({ salaryRequired: true })).reason, "salary_missing_but_required");
  });

  it("should reject a parsed salary under the floor without salaryRequired", () => {
    const { core } = loadCore();
    const why = core.hideReason(row({ salary: "$110k - $120k" }), profileWith({ salaryFloor: 130000, salaryRequired: false }));
    assert.equal(why.reason, "salary_below_floor");
    assert.equal(core.hideReason(row({ salary: "$110k - $140k" }), profileWith({ salaryFloor: 130000 })), null);
  });

  it("should reject needs_sponsorship when the description has a deny phrase", () => {
    const { core } = loadCore();
    const needs = profileWith({ workAuth: "needs_sponsorship" });
    assert.equal(core.hideReason(row({ descriptionText: "Sorry, No Visa Sponsorship." }), needs).reason, "work_auth_mismatch");
    assert.equal(core.hideReason(row({ description: "US citizens only" }), needs).reason, "work_auth_mismatch");
    // Pipeline rows without a description still pass.
    assert.equal(core.hideReason(row({}), needs), null);
    assert.equal(core.hideReason(row({ descriptionText: "no sponsorship" }), profileWith({ workAuth: "authorized" })), null);
  });

  it("should return the first violation in runPreFilter's order", () => {
    const { core } = loadCore();
    const all = profileWith({ skipTitles: ["director"], workMode: "remote_only", salaryRequired: true });
    const r = row({ location: "On-site", salary: "" });
    assert.equal(core.hideReason(r, all).reason, "skip_title_match");
  });

  it("should hide blocklisted companies case-insensitively, capped at 50", () => {
    const { core } = loadCore();
    const p = profileWith({}, { companyBlocklist: [" ACME "] });
    assert.equal(core.hideReason(row({ company: "acme" }), p).reason, "company_blocklist");
    const long = Array.from({ length: 60 }, (_, i) => `Co${i}`);
    const capped = profileWith({}, { companyBlocklist: long });
    assert.equal(core.hideReason(row({ company: "co49" }), capped).reason, "company_blocklist");
    assert.equal(core.hideReason(row({ company: "co50" }), capped), null);
  });

  it("should port parseSalaryMax", () => {
    const { core } = loadCore();
    assert.equal(core.parseSalaryMax("$150K - $180K"), 180000);
    assert.equal(core.parseSalaryMax("$150,000"), 150000);
    assert.equal(core.parseSalaryMax("150-180k"), 180000);
    assert.equal(core.parseSalaryMax("Competitive"), null);
    assert.equal(core.parseSalaryMax(""), null);
  });
});

describe("leads-core: hidden rows carry reasons and show-hidden re-includes them", () => {
  const rows = [
    row({ company: "Acme" }),
    row({ company: "Blocked Co" }),
    row({ company: "Cheap", salary: "$90k" }),
  ];
  const p = profileWith({ salaryFloor: 120000 }, { companyBlocklist: ["blocked co"] });

  it("should list each hidden row with its reason", () => {
    const { core } = loadCore();
    const out = core.filterLeads(rows, p, { lens: "all" }, { now: NOW });
    same(out.rows.map((r) => r.company), ["Acme"]);
    same(
      out.hidden.map((h) => [h.row.company, h.reason]),
      [["Blocked Co", "company_blocklist"], ["Cheap", "salary_below_floor"]],
    );
  });

  it("should re-include hidden rows, marked, when showHidden is set", () => {
    const { core } = loadCore();
    const out = core.filterLeads(rows, p, { lens: "all" }, { now: NOW, showHidden: true });
    assert.equal(out.rows.length, 3);
    const cheap = out.rows.find((r) => r.company === "Cheap");
    assert.equal(cheap._hiddenReason, "salary_below_floor");
    assert.equal(rows[2]._hiddenReason, undefined, "input rows are not mutated");
  });

  it("should point each revealed copy at the original row (SHOW-COPY)", () => {
    const { core } = loadCore();
    const out = core.filterLeads(rows, p, { lens: "all" }, { showHidden: true });
    const cheap = out.rows.find((r) => r.company === "Cheap");
    assert.notEqual(cheap, rows[2]);
    assert.equal(cheap._source, rows[2], "a star or stage write goes through _source");
    assert.equal(out.rows.find((r) => r.company === "Acme")._source, undefined);
  });

  it("should drop dismissed rows from both layers", () => {
    const { core } = loadCore();
    const out = core.filterLeads([row({ dismissedAt: "2026-09-20" })], PROFILE, { lens: "all" });
    assert.equal(out.rows.length, 0);
    assert.equal(out.hidden.length, 0);
  });
});

describe("leads-core: countsFor", () => {
  it("should return visible, hidden-by-profile and the per-reason split", () => {
    const { core } = loadCore();
    const rows = [
      row({}),
      row({ company: "Other" }),
      row({ location: "On-site, NYC" }),
      row({ location: "Hybrid" }),
      row({ salary: "$80k" }),
      row({ title: "Revenue Operations Intern" }),
    ];
    const p = profileWith({ workMode: "remote_only", salaryFloor: 100000, skipTitles: ["intern"] });
    const counts = core.countsFor(rows, p, { lens: "all" });
    same(counts, {
      visible: 2,
      hidden: 4,
      byReason: { work_mode_mismatch: 2, salary_below_floor: 1, skip_title_match: 1 },
    });
  });

  it("should count only hidden rows the view and lens would otherwise show", () => {
    const { core } = loadCore();
    const rows = [row({ company: "Acme", salary: "$80k" }), row({ company: "Zed", salary: "$80k" })];
    const p = profileWith({ salaryFloor: 100000 });
    const counts = core.countsFor(rows, p, { lens: "all", companies: ["Acme"] });
    assert.equal(counts.visible, 0);
    assert.equal(counts.hidden, 1);
  });

  it("should default the view to the target-roles lens", () => {
    const { core } = loadCore();
    const rows = [row({}), row({ title: "Account Executive" })];
    assert.equal(core.countsFor(rows, PROFILE).visible, 1);
    assert.equal(core.countsFor(rows, PROFILE, { lens: "other" }).visible, 1);
  });
});

describe("leads-core: view filters", () => {
  const { core } = loadCore();
  const opts = { now: NOW };

  it("should apply fit and match floors, failing null scores", () => {
    const v = core.normalizeView({ fitMin: 7 });
    assert.equal(core.passView(row({ fitScore: 7 }), v, opts), true);
    assert.equal(core.passView(row({ fitScore: 6.5 }), v, opts), false);
    assert.equal(core.passView(row({ fitScore: null }), v, opts), false);
    const m = core.normalizeView({ matchMin: 75 });
    assert.equal(core.passView(row({ matchScore: 75 }), m, opts), true);
    assert.equal(core.passView(row({ matchScore: null }), m, opts), false);
  });

  it("should filter salary by the parsed upper bound, failing unposted salary", () => {
    const v = core.normalizeView({ salaryMin: 170000 });
    assert.equal(core.passView(row({ salary: "$150k - $180k" }), v, opts), true);
    assert.equal(core.passView(row({ salary: "$150k" }), v, opts), false);
    assert.equal(core.passView(row({ salary: "" }), v, opts), false);
  });

  it("should filter found by days", () => {
    const v = core.normalizeView({ foundWithinDays: 7 });
    assert.equal(core.passView(row({ dateFound: daysAgo(3) }), v, opts), true);
    assert.equal(core.passView(row({ dateFound: daysAgo(9) }), v, opts), false);
    assert.equal(core.passView(row({ dateFound: null }), v, opts), false);
  });

  it("should filter source, work mode, stage and company lists case-insensitively", () => {
    assert.equal(core.passView(row({ source: "lever" }), core.normalizeView({ sources: ["greenhouse"] }), opts), false);
    assert.equal(core.passView(row({ location: "Hybrid" }), core.normalizeView({ workModes: ["hybrid"] }), opts), true);
    assert.equal(core.passView(row({ location: "Remote" }), core.normalizeView({ workModes: ["hybrid"] }), opts), false);
    assert.equal(core.passView(row({ status: "Applied" }), core.normalizeView({ stages: ["applied"] }), opts), true);
    assert.equal(core.passView(row({ company: "Acme" }), core.normalizeView({ companies: ["Zed"] }), opts), false);
    assert.equal(core.passView(row({ favorite: false }), core.normalizeView({ starred: true }), opts), false);
  });

  it("should match lenses by every role word, first match in rank order", () => {
    const roles = PROFILE.identity.targetRoles;
    assert.equal(core.roleIndexFor(row({ title: "Director of RevOps" }), roles), 0);
    assert.equal(core.roleIndexFor(row({ title: "Sales Ops Manager, West" }), roles), 1);
    assert.equal(core.roleIndexFor(row({ title: "Director, Operations" }), roles), -1);
    const rows = [
      row({ title: "Director, Revenue Operations" }),
      row({ title: "Sales Operations Manager" }),
      row({ title: "Account Executive" }),
    ];
    const titles = (lens) => core.filterLeads(rows, PROFILE, { lens }).rows.map((r) => r.title);
    same(titles("Sales Operations Manager"), ["Sales Operations Manager"]);
    assert.equal(titles("targets").length, 2);
    same(titles("other"), ["Account Executive"]);
    assert.equal(titles("all").length, 3);
  });
});

describe("leads-core: tokenizer, synonyms and highlights", () => {
  const { core } = loadCore();

  it("should expand revops and sales ops to their long forms", () => {
    same(core.tokenize("RevOps  lead"), ["revenue", "operations", "lead"]);
    same(core.tokenize("sales ops"), ["sales", "operations"]);
  });

  it("should AND tokens across title, company, location, source, stage and why", () => {
    const r = row({ title: "Director, Revenue Operations", company: "Acme", fitAssessment: "Strong CRM fit" });
    assert.equal(core.matchesQuery(r, "revops acme"), true);
    assert.equal(core.matchesQuery(row({ title: "RevOps Lead" }), "revenue operations"), true);
    assert.equal(core.matchesQuery(row({ title: "Sales Ops Manager" }), "sales operations"), true);
    assert.equal(core.matchesQuery(row({ title: "Sales Operations Manager" }), "sales ops"), true);
    assert.equal(core.matchesQuery(r, "crm"), true);
    assert.equal(core.matchesQuery(r, "greenhouse new"), true);
    assert.equal(core.matchesQuery(r, "revops zed"), false);
    assert.equal(core.matchesQuery(row({ title: "RevOps Lead" }), "ops"), true);
  });

  it("should return merged highlight ranges, including the other synonym spelling", () => {
    const text = "Director, Revenue Operations";
    const ranges = core.highlightRanges(text, "revops").map((r) => text.slice(r.start, r.end));
    same(ranges, ["Revenue Operations"]);
    const back = core.highlightRanges("RevOps Lead", "revenue operations").map((r) => "RevOps Lead".slice(r.start, r.end));
    same(back, ["RevOps"]);
    const plain = core.highlightRanges("Acme Remote", "acme");
    same(plain, [{ start: 0, end: 4 }]);
    same(core.highlightRanges("Acme", ""), []);
  });
});

describe("leads-core: facet counts", () => {
  it("should count each list facet with its own filter skipped", () => {
    const { core } = loadCore();
    const rows = [
      row({ location: "Remote", source: "greenhouse", status: "New" }),
      row({ location: "Hybrid", source: "lever", status: "Applied" }),
      row({ location: "Hybrid", source: "lever", status: "New" }),
    ];
    const f = core.facetCounts(rows, PROFILE, { lens: "all", workModes: ["hybrid"] }, { now: NOW });
    same(f.workModes, { remote: 1, hybrid: 2, onsite: 0 });
    same(f.sources, { lever: 2 });
    same(f.stages, { Applied: 1, New: 1 });
  });

  it("should keep a padded cell selectable after counting it (FACET-TRIM)", () => {
    const { core } = loadCore();
    const rows = [row({ company: "Acme " }), row({ company: "Zed" })];
    const f = core.facetCounts(rows, PROFILE, { lens: "all" });
    assert.equal(f.companies.Acme, 1);
    const picked = core.filterLeads(rows, PROFILE, { lens: "all", companies: ["Acme"] }).rows;
    same(picked.map((r) => r.company), ["Acme "]);
  });

  it("should give lens counts and fit bands, and leave hidden rows out unless shown", () => {
    const { core } = loadCore();
    const rows = [
      row({ title: "Director, Revenue Operations", fitScore: 9 }),
      row({ title: "Sales Operations Manager", fitScore: 6 }),
      row({ title: "Account Executive", fitScore: 3 }),
      row({ title: "Revenue Operations Director", company: "Blocked", fitScore: 9 }),
    ];
    const p = profileWith({}, { companyBlocklist: ["blocked"] });
    const f = core.facetCounts(rows, p, {}, { now: NOW });
    assert.equal(f.lens.all, 3);
    assert.equal(f.lens.targets, 2);
    assert.equal(f.lens.other, 1);
    assert.equal(f.lens.byRole["Director, Revenue Operations"], 1);
    same(f.lens.fitBands.targets, { high: 1, mid: 1, low: 0 });
    const shown = core.facetCounts(rows, p, {}, { now: NOW, showHidden: true });
    assert.equal(shown.lens.byRole["Director, Revenue Operations"], 2);
  });
});

describe("leads-core: sorts", () => {
  const { core } = loadCore();
  const rows = [
    row({ company: "b", fitScore: 8, matchScore: 70, dateFound: daysAgo(5), salary: "$200k" }),
    row({ company: "a", fitScore: 8, matchScore: 90, dateFound: daysAgo(9), salary: "" }),
    row({ company: "C", fitScore: 8, matchScore: 90, dateFound: daysAgo(1), salary: "$150k" }),
    row({ company: "d", fitScore: null, matchScore: 95, dateFound: daysAgo(0), salary: "$120k" }),
  ];
  const order = (sort) => core.sortLeads(rows, sort).map((r) => r.company).join("");

  it("should sort best fit by fit, then match, then newest, null fit last", () => {
    assert.equal(order("fit"), "Cabd");
  });
  it("should sort newest, highest salary, match score and company A–Z", () => {
    assert.equal(order("newest"), "dCba");
    assert.equal(order("salary"), "bCda");
    assert.equal(order("match"), "daCb");
    assert.equal(order("company"), "abCd");
  });
  it("should take 'new' as newest and keep the order for an unknown key (SORT-KEY)", () => {
    assert.equal(order("new"), "dCba");
    assert.equal(order("bogus"), "baCd");
    assert.equal(order(undefined), "baCd");
  });
  it("should never pin a favoured company", () => {
    const p = Object.assign({}, PROFILE, { tieBreakers: { favoredCompanies: ["d"] } });
    const out = core.filterLeads(rows, p, { lens: "all", sort: "fit" }).rows;
    assert.equal(out[0].company, "C");
    assert.doesNotMatch(readRepoFile("leads-core.js"), /favoredCompanies|favouredCompanies/);
  });
});

describe("leads-core: IndexedDB records store", () => {
  function storeFor(indexedDB) {
    let t = 1000;
    const { core } = loadCore();
    return { core, store: core.createStore({ indexedDB, now: () => ++t }) };
  }

  it("should open jobbored-leads/records and round-trip saved views", async () => {
    const indexedDB = makeFakeIndexedDb();
    const { store } = storeFor(indexedDB);
    const saved = await store.saveView({ name: "Remote RevOps", view: { workModes: ["remote"], fitMin: 7 } });
    assert.equal(saved.kind, "view");
    assert.equal(saved.view.fitMin, 7);
    assert.equal(saved.view.lens, "targets", "missing fields take the defaults");
    assert.ok(indexedDB._databases.get("jobbored-leads").stores.has("records"));

    const renamed = await store.saveView({ id: saved.id, name: "Renamed", view: saved.view });
    assert.equal(renamed.createdAt, saved.createdAt);
    const views = await store.listViews();
    same(views.map((v) => v.name), ["Renamed"]);

    assert.equal(await store.deleteView(saved.id), true);
    assert.equal((await store.listViews()).length, 0);
    await assert.rejects(store.saveView({ name: "  ", view: {} }), /needs a name/);
  });

  it("should keep history newest first and only the last 50", async () => {
    const indexedDB = makeFakeIndexedDb();
    const { store } = storeFor(indexedDB);
    await store.saveView({ name: "Keep me", view: {} });
    for (let i = 0; i < 53; i++) {
      await store.appendHistory({ by: "you", summary: `change ${i}` });
    }
    const history = await store.listHistory();
    assert.equal(history.length, 50);
    assert.equal(history[0].summary, "change 52");
    assert.equal(history[49].summary, "change 3");
    assert.ok(history.every((h) => h.kind === "history"));
    assert.equal((await store.listViews()).length, 1, "trimming never deletes views");
  });

  it("should surface an IndexedDB open failure instead of hanging", async () => {
    const { core } = loadCore();
    const store = core.createStore({ indexedDB: { open() { throw new Error("blocked"); } } });
    await assert.rejects(store.listViews(), /blocked/);
  });

  it("should wait out onblocked, close a success after the watchdog, and drop the handle on versionchange (IDB-OPEN)", async () => {
    const { core } = loadCore();
    const requests = [];
    const fakeDb = () => ({
      closed: false,
      close() { this.closed = true; },
      objectStoreNames: { contains: () => true },
      transaction() {
        return { objectStore: () => ({ getAll() { const r = {}; queueMicrotask(() => { r.result = []; r.onsuccess(); }); return r; } }) };
      },
    });
    const factory = { open() { const req = {}; requests.push(req); return req; } };
    const store = core.createStore({ indexedDB: factory, openTimeoutMs: 20 });

    // Blocked, then the other tab lets go: the open succeeds and stays open.
    const first = store.listViews();
    requests[0].onblocked();
    const blockedThenOpen = fakeDb();
    requests[0].result = blockedThenOpen;
    requests[0].onsuccess();
    same(await first, []);
    assert.equal(blockedThenOpen.closed, false, "a blocked request that later succeeds stays open");

    // versionchange closes that connection; the next call opens a new one.
    blockedThenOpen.onversionchange();
    assert.equal(blockedThenOpen.closed, true);
    const second = store.listViews();
    assert.equal(requests.length, 2);

    // Still pending at the watchdog: reject, then close the late success.
    await assert.rejects(second, /timed out/);
    const late = fakeDb();
    requests[1].result = late;
    requests[1].onsuccess();
    assert.equal(late.closed, true, "a success after the watchdog is closed");
  });
});
