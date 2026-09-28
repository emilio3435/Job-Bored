/**
 * LEADTABS LT — leads-tune.js, the Leads view's Chat mode.
 *
 * Loads leads-core.js (LC) and leads-tune.js in a vm sandbox and drives the
 * DOM-free controller and the pure renderers. Counts run through the real
 * LC countsFor; the host stub records every profile GET, POST, discovery
 * save and view write, so each test can pin the PLAN LT-SAVE rules.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { makeFakeIndexedDb, readRepoFile } from "./oneflow-l0-harness.mjs";

/* vm-realm arrays and objects are not deepStrictEqual to this realm's. */
const plain = (x) => JSON.parse(JSON.stringify(x));

function stubParseWorkMode(text) {
  const t = String(text || "").toLowerCase();
  if (/remote/.test(t)) return "remote";
  if (/hybrid/.test(t)) return "hybrid";
  if (/on-?site/.test(t)) return "onsite";
  return "";
}

function load() {
  const doc = { readyState: "complete", addEventListener() {} };
  const win = {
    document: doc,
    JobBoredApp: { sheetsRead: { parseWorkModeFromLocation: stubParseWorkMode } },
  };
  const ctx = { window: win, setTimeout, clearTimeout, queueMicrotask, crypto: { randomUUID: () => `u${Math.random().toString(16).slice(2)}` } };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("leads-core.js"), ctx, { filename: "leads-core.js" });
  vm.runInContext(readRepoFile("leads-tune.js"), ctx, { filename: "leads-tune.js" });
  return { tuneApi: win.JobBoredLeadsTune, core: win.JobBoredApp.leadsCore, win };
}

/* A UserProfile the schema would accept: the fields LT must never drop. */
function userProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Director, Revenue Operations", "RevOps Manager"],
      targetSeniority: "director",
      primaryNarrative: "I run revenue systems for B2B SaaS.",
    },
    strengths: [{ name: "Forecasting", evidence: "Built the forecast at Acme" }],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: [],
      salaryFloor: 120000,
      salaryRequired: false,
      skipTitles: ["Intern"],
      workAuth: "us_citizen",
    },
    wants: ["Owning forecasting"],
    avoids: ["Pure people management"],
    experiences: [{ company: "Acme", title: "RevOps Lead" }],
  };
}

function discoveryProfile() {
  return {
    targetRoles: "Director, Revenue Operations, RevOps Manager",
    locations: "",
    remotePolicy: "",
    seniority: "Director",
    keywordsInclude: "RevOps, Salesforce",
    keywordsExclude: "intern, staffing",
    maxLeadsPerRun: "15",
    groundedWebEnabled: true,
    sourcePreset: "browser_plus_ats",
    companyAllowlist: [],
    companyBlocklist: ["Brightpath Agency"],
  };
}

const NOW = Date.UTC(2026, 8, 27, 12);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);

function lead(o) {
  return Object.assign({
    title: "RevOps Manager", company: "Acme", location: "Remote - US", workMode: "", workModeSource: "",
    source: "greenhouse", salary: "$150k - $180k", fitScore: 8, matchScore: 80, status: "New",
    dateFound: daysAgo(2), fitAssessment: "Owns the forecast.", favorite: false, dismissedAt: null,
  }, o);
}

function sheet() {
  return [
    lead({ title: "Director, Revenue Operations", company: "Northwind", fitScore: 9 }),
    lead({ title: "RevOps Manager", company: "Acme", location: "Hybrid - Austin, TX", fitScore: 7 }),
    lead({ title: "RevOps Manager", company: "Globex", location: "On-site - Denver", salary: "$95k - $110k", fitScore: 6 }),
    lead({ title: "RevOps Manager", company: "Brightpath Agency", fitScore: 5 }),
    lead({ title: "RevOps Manager", company: "Initech", salary: "$130k - $140k", fitScore: 6 }),
    lead({ title: "Account Executive", company: "Umbrella", fitScore: 4 }),
  ];
}

/* The host LT talks to: records every call, answers like the app would. */
function makeHost(core, over) {
  const o = over || {};
  const calls = { getProfile: 0, sync: [], saveDiscovery: [], setView: [], published: [], toasts: [] };
  let stored = discoveryProfile();
  let doc = userProfile();
  let view = core.normalizeView(null);
  const host = {
    calls,
    rows: () => o.rows || sheet(),
    rowsLoaded: () => o.rowsLoaded !== false,
    view: () => view,
    setView: (v) => { calls.setView.push(JSON.parse(JSON.stringify(v))); view = core.normalizeView(v); },
    getProfile: () => {
      calls.getProfile++;
      if (o.profileStatus) return Promise.resolve({ status: o.profileStatus });
      return Promise.resolve({ status: "ok", profile: JSON.parse(JSON.stringify(doc)) });
    },
    getDiscoveryProfile: () => Promise.resolve(JSON.parse(JSON.stringify(stored))),
    saveDiscoveryProfile: (partial) => {
      calls.saveDiscovery.push(JSON.parse(JSON.stringify(partial)));
      stored = Object.assign({}, stored, partial);
      return Promise.resolve(JSON.parse(JSON.stringify(stored)));
    },
    syncProfile: (d) => {
      calls.sync.push(JSON.parse(JSON.stringify(d)));
      const res = o.sync || { ok: true, synced: true, status: 200, reason: "synced" };
      if (res.synced) doc = JSON.parse(JSON.stringify(d));
      return Promise.resolve(res);
    },
    publishProfile: (p) => calls.published.push(p),
    localProfile: () => null,
    toast: (m) => calls.toasts.push(m),
  };
  return host;
}

async function ready(over, opts) {
  const env = load();
  const host = makeHost(env.core, over);
  const fake = makeFakeIndexedDb();
  const store = env.core.createStore({ indexedDB: fake, now: () => NOW });
  const tune = env.tuneApi.createTune(host, Object.assign({ store: () => store, now: () => NOW }, opts));
  await tune.load();
  await tune.loadHistory();
  return Object.assign(env, { host, tune, store });
}

describe("leads-tune: settings from the profile", () => {
  it("reads the UserProfile and the string-typed discovery profile into one flat set", async () => {
    const { tune } = await ready();
    const s = tune.getState().settings;
    assert.deepEqual(plain(s.targetRoles), ["Director, Revenue Operations", "RevOps Manager"]);
    assert.equal(s.targetSeniority, "director");
    assert.equal(s.workMode, "any");
    assert.equal(s.salaryFloor, 120000);
    assert.deepEqual(plain(s.keywordsInclude), ["RevOps", "Salesforce"], "comma string splits into a list");
    assert.deepEqual(plain(s.keywordsExclude), ["intern", "staffing"]);
    assert.deepEqual(plain(s.companyBlocklist), ["Brightpath Agency"]);
    assert.equal(s.sourcePreset, "browser_plus_ats");
    assert.equal(s.groundedWebEnabled, true);
    assert.equal(s.maxLeadsPerRun, 15);
    assert.equal(tune.getState().status, "ready");
  });

  it("offers no favoured-companies field and no enabledSources (D5, LT-HIDE)", () => {
    const { tuneApi } = load();
    const paths = Array.from(tuneApi.FIELDS, (f) => f.path);
    assert.ok(!paths.some((p) => /favoredCompanies|enabledSources/.test(p)), paths.join(","));
    assert.ok(paths.includes("discoveryProfile.sourcePreset"));
    assert.ok(paths.includes("discoveryProfile.groundedWebEnabled"));
    assert.ok(!tuneApi.ALLOWLIST.some((p) => /favoredCompanies|experiences|primaryNarrative|workAuth/.test(p)));
  });
});

describe("leads-tune: LT-SAVE", () => {
  it("GETs the profile, patches only the changed field, POSTs the full document, then writes one history entry", async () => {
    const { tune, host, store } = await ready();
    tune.setDraft("salaryFloor", "150000");
    const out = await tune.applyDraft();
    assert.equal(out.ok, true);
    assert.equal(host.calls.getProfile, 2, "one GET at load, one fresh GET at apply");
    assert.equal(host.calls.sync.length, 1);
    const posted = host.calls.sync[0];
    const expected = userProfile();
    expected.hardConstraints.salaryFloor = 150000;
    assert.deepEqual(posted, expected, "primaryNarrative, strengths, experiences and every other field stay as loaded");
    assert.equal(host.calls.saveDiscovery.length, 0, "salaryFloor has no discovery key, so nothing is saved there");
    const history = await store.listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].by, "You");
    assert.equal(history[0].rows[0].key, "salaryFloor");
    assert.deepEqual(plain(tune.reviewRows()), [], "the draft is closed after a synced save");
  });

  it("treats local_only as a save error: the diff stays open and no history is written", async () => {
    const { tune, host, store } = await ready({ sync: { ok: true, synced: false, status: 404, reason: "local_only", message: "Saved on this device." } });
    tune.setDraft("salaryFloor", "150000");
    const out = await tune.applyDraft();
    assert.equal(out.ok, false);
    assert.match(tune.getState().saveError, /^Couldn't save: .*Nothing changed\.$/);
    assert.equal(tune.reviewRows().length, 1, "the diff stays open");
    assert.equal((await store.listHistory()).length, 0);
    assert.equal(host.calls.saveDiscovery.length, 0, "discovery is saved only after a synced profile");
    assert.equal(tune.getState().settings.salaryFloor, 120000, "the applied settings did not move");
  });

  it("surfaces a rejected profile's own message and writes nothing", async () => {
    const { tune, store } = await ready({ sync: { ok: false, synced: false, status: 400, reason: "rejected", message: "/identity/targetRoles must NOT have more than 8 items" } });
    tune.setDraft("salaryRequired", true);
    await tune.applyDraft();
    assert.equal(tune.getState().saveError, "Couldn't save: /identity/targetRoles must NOT have more than 8 items. Nothing changed.");
    assert.equal((await store.listHistory()).length, 0);
  });

  it("maps work mode through remotePolicyFor and sends only the discovery keys that changed", async () => {
    const { tuneApi } = load();
    assert.equal(tuneApi.remotePolicyFor("remote_only"), "remote");
    assert.equal(tuneApi.remotePolicyFor("hybrid_ok"), "hybrid");
    assert.equal(tuneApi.remotePolicyFor("onsite_ok"), "onsite");
    assert.equal(tuneApi.remotePolicyFor("any"), "");
    const { tune, host } = await ready();
    tune.setDraft("workMode", "remote_only");
    await tune.applyDraft();
    assert.equal(host.calls.sync[0].hardConstraints.workMode, "remote_only");
    assert.deepEqual(host.calls.saveDiscovery, [{ remotePolicy: "remote" }], "locations were already blank, so only remotePolicy is sent");
  });

  it("unions skip titles into keywordsExclude and leaves avoids on avoids[]", async () => {
    const { tune, host } = await ready();
    assert.equal(tune.addItem("skipTitles", "SDR"), "");
    assert.equal(tune.addItem("avoids", "Cold calling"), "");
    const rows = tune.reviewRows();
    assert.deepEqual(Array.from(rows, (r) => r.key), ["skipTitles", "avoids", "keywordsExclude"], "the union shows up in the diff");
    await tune.applyDraft();
    const posted = host.calls.sync[0];
    assert.deepEqual(posted.hardConstraints.skipTitles, ["Intern", "SDR"]);
    assert.deepEqual(posted.avoids, ["Pure people management", "Cold calling"]);
    assert.deepEqual(host.calls.saveDiscovery, [{ keywordsExclude: "intern, staffing, SDR" }], "avoids are not added to keywordsExclude; keywordsInclude is untouched");
  });

  it("writes seniority as the identity enum, in the profile and the discovery mirror (LT-SEN)", async () => {
    const { tune, host } = await ready();
    tune.setDraft("targetSeniority", "ic_mid");
    await tune.applyDraft();
    assert.equal(host.calls.sync[0].identity.targetSeniority, "ic_mid");
    assert.deepEqual(host.calls.saveDiscovery, [{ seniority: "ic_mid" }], "the enum, never the label \"Mid\"");
  });

  it("keeps discovery fields drafted and out of history when saveDiscoveryProfile rejects (LT-DISC)", async () => {
    const { tune, host, store } = await ready();
    host.saveDiscoveryProfile = () => Promise.reject(new Error("IndexedDB is full"));
    tune.setDraft("salaryFloor", "150000");
    tune.addItem("companyBlocklist", "Globex");
    const out = await tune.applyDraft();
    assert.equal(out.ok, true, "the synced profile field still applies");
    const st = tune.getState();
    assert.equal(st.settings.salaryFloor, 150000);
    assert.deepEqual(plain(st.settings.companyBlocklist), ["Brightpath Agency"], "the refused discovery field did not advance");
    assert.deepEqual(plain(tune.reviewRows().map((r) => r.key)), ["companyBlocklist"], "it stays in the draft");
    const history = await store.listHistory();
    assert.deepEqual(plain(history[0].rows.map((r) => r.key)), ["salaryFloor"], "history holds only what was saved");
    assert.match(st.saveError, /couldn't save the discovery settings: IndexedDB is full\. They're still in your unapplied changes\./);
  });

  it("saves boards as sourcePreset and groundedWebEnabled, never enabledSources", async () => {
    const { tune, host } = await ready();
    tune.setDraft("sourcePreset", "ats_only");
    tune.setDraft("groundedWebEnabled", false);
    await tune.applyDraft();
    assert.deepEqual(host.calls.saveDiscovery, [{ sourcePreset: "ats_only", groundedWebEnabled: false }]);
  });

  it("patches keywordsInclude only when the search keywords changed, never from strengths", async () => {
    const { tune, host } = await ready();
    tune.addItem("targetRoles", "VP Revenue Operations");
    await tune.applyDraft();
    const partial = host.calls.saveDiscovery[0];
    assert.equal(partial.targetRoles, "Director, Revenue Operations, RevOps Manager, VP Revenue Operations");
    assert.ok(!("keywordsInclude" in partial));
  });

  it("refuses to save while the profile API is unreachable", async () => {
    const { tune, host } = await ready({ profileStatus: "unreachable" });
    assert.equal(tune.getState().status, "unreachable");
    assert.equal(tune.editable(), false);
    assert.equal(tune.setDraft("salaryFloor", "1"), false, "controls are read-only");
    assert.equal(host.calls.sync.length, 0);
  });
});

describe("leads-tune: view-only and mixed changes", () => {
  function transport(changes, reply) {
    return { propose: () => Promise.resolve({ ok: true, reply: reply || "Here is what I'd change.", changes }) };
  }

  it("applies a view-only proposal to Filters with one history entry and no profile POST", async () => {
    const { tune, host, store } = await ready(null, { transport: transport([{ field: "view.fit", op: "set", value: 7 }]) });
    const bot = await tune.ask("only strong fits");
    assert.equal(bot.proposal.rows[0].kind, "view");
    const out = await tune.applyProposal(bot.id);
    assert.equal(out.ok, true);
    assert.equal(host.calls.getProfile, 1, "only the load-time GET");
    assert.equal(host.calls.sync.length, 0);
    assert.equal(host.calls.setView.length, 1);
    assert.equal(host.calls.setView[0].fitMin, 7);
    const history = await store.listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].by, "Agent");
  });

  it("a mixed change whose POST fails writes no history and leaves the view alone", async () => {
    const t = transport([{ field: "hardConstraints.salaryFloor", op: "set", value: 150000 }, { field: "view.found", op: "set", value: 14 }]);
    const { tune, host, store } = await ready({ sync: { ok: true, synced: false, reason: "local_only" } }, { transport: t });
    const bot = await tune.ask("nothing under 150k, last two weeks");
    const out = await tune.applyProposal(bot.id);
    assert.equal(out.ok, false);
    assert.equal(host.calls.setView.length, 0);
    assert.equal((await store.listHistory()).length, 0);
    assert.equal(bot.proposal.status, "open", "the card stays open to retry");
    assert.match(bot.proposal.error, /^Couldn't save/);
  });
});

describe("leads-tune: the agent transport", () => {
  it("without a transport answers the typed not-connected error and applies nothing", async () => {
    const { tune, host, store, tuneApi } = await ready();
    const bot = await tune.ask("more remote roles");
    assert.equal(bot.error.code, "agent_not_connected");
    assert.equal(bot.error.message, "The chat agent isn't connected yet");
    assert.equal(host.calls.sync.length + host.calls.saveDiscovery.length + host.calls.setView.length, 0);
    assert.equal((await store.listHistory()).length, 0);
    const html = tuneApi.render(tune).chat;
    assert.match(html, /The chat agent isn(’|&#39;)t connected yet/);
    assert.match(html, /No settings were changed/);
  });

  it("uses window.JobBoredLeadsAgent when LA ships it, with no UI change", async () => {
    const env = await ready();
    const seen = [];
    env.win.JobBoredLeadsAgent = { propose: (req) => { seen.push(req); return Promise.resolve({ ok: true, reply: "Done.", changes: [] }); } };
    const bot = await env.tune.ask("hello");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].message, "hello");
    assert.ok(seen[0].allowlist.includes("hardConstraints.salaryFloor"));
    assert.equal(seen[0].counts.visible, env.core.countsFor(sheet(), env.tuneApi.countsProfile(env.tune.getState().settings), env.core.normalizeView(null)).visible, "context counts come from countsFor");
    assert.equal(bot.reply, "Done.");
    assert.equal(bot.proposal, undefined, "no changes means no card");
  });

  it("validates every change against the allowlist and schema limits, folds repeats and drops no-ops", async () => {
    const changes = [
      { field: "tieBreakers.favoredCompanies", op: "add", value: ["Acme"] },
      { field: "experiences", op: "set", value: [] },
      { field: "identity.targetRoles", op: "add", value: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"] },
      { field: "hardConstraints.salaryFloor", op: "set", value: 120000 },
      { field: "hardConstraints.workMode", op: "set", value: "fully_remote" },
      { field: "discoveryProfile.companyBlocklist", op: "add", value: ["Globex"] },
      { field: "discoveryProfile.companyBlocklist", op: "add", value: ["Initech"] },
      { field: "view.source", op: "set", value: ["greenhouse"], default: false },
    ];
    const { tune } = await ready(null, { transport: { propose: () => Promise.resolve({ ok: true, reply: "ok", changes }) } });
    const bot = await tune.ask("tidy up");
    const p = bot.proposal;
    assert.deepEqual(Array.from(p.rows, (r) => r.key), ["companyBlocklist", "sources"]);
    assert.deepEqual(plain(p.rows[0].after), ["Brightpath Agency", "Globex", "Initech"], "two adds fold into one row");
    assert.deepEqual(Array.from(p.mask), [true, false], "default:false starts unticked");
    assert.equal(p.dropped, 4, "favoured companies, experiences, a 9th target role and an unknown enum are dropped; the salary no-op is silent");
  });

  it("computes the card's counts in code and recounts when a row is unticked", async () => {
    const changes = [{ field: "discoveryProfile.companyBlocklist", op: "add", value: ["Northwind"] }, { field: "view.fit", op: "set", value: 7 }];
    const { tune, core, tuneApi } = await ready(null, { transport: { propose: () => Promise.resolve({ ok: true, reply: "ok", changes }) } });
    const bot = await tune.ask("x");
    const s = tune.getState().settings;
    const v = core.normalizeView(null);
    const base = core.countsFor(sheet(), tuneApi.countsProfile(s), v).visible;
    const both = core.countsFor(sheet(), tuneApi.countsProfile(Object.assign({}, s, { companyBlocklist: ["Brightpath Agency", "Northwind"] })), Object.assign({}, v, { fitMin: 7 })).visible;
    assert.deepEqual(plain(tune.proposalImpact(bot.proposal)), { before: base, after: both });
    assert.ok(both < base, "the fixture makes the change visible");
    tune.toggleProposalRow(bot.id, 1, false);
    const blockOnly = core.countsFor(sheet(), tuneApi.countsProfile(Object.assign({}, s, { companyBlocklist: ["Brightpath Agency", "Northwind"] })), v).visible;
    assert.equal(tune.proposalImpact(bot.proposal).after, blockOnly);
  });

  it("turns a failed or thrown transport into the error card with Try again", async () => {
    let n = 0;
    const t = { propose: () => { n++; if (n === 1) return Promise.reject(new Error("Your AI provider returned a timeout after 30 seconds")); return Promise.resolve({ ok: false, error: { code: "http_429", message: "Rate limited", status: 429 } }); } };
    const { tune, tuneApi, host } = await ready(null, { transport: t });
    const first = await tune.ask("x");
    assert.equal(first.error.code, "agent_error");
    const html = tuneApi.render(tune).chat;
    assert.match(html, /The agent didn(’|&#39;)t answer\.<\/b> Your AI provider returned a timeout after 30 seconds\. No settings were changed\./);
    assert.match(html, /data-jbt-retry=/);
    const second = await tune.retry(first.id);
    assert.equal(second.error.code, "http_429", "the status code is kept, not rewritten");
    assert.match(tuneApi.render(tune).chat, /\(HTTP 429\)/);
    assert.equal(tune.getState().messages.length, 2, "retry replaces the failed exchange");
    assert.equal(host.calls.sync.length, 0);
  });

  it("refuses to apply a proposal over a field edited since it was proposed (LT-STALE)", async () => {
    const t = { propose: () => Promise.resolve({ ok: true, reply: "ok", changes: [{ field: "hardConstraints.salaryFloor", op: "set", value: 150000 }] }) };
    const { tune, host, store } = await ready(null, { transport: t });
    const bot = await tune.ask("x");
    tune.setDraft("salaryFloor", "170000");
    await tune.applyDraft();
    const out = await tune.applyProposal(bot.id);
    assert.equal(out.ok, false);
    assert.equal(tune.getState().settings.salaryFloor, 170000, "the newer edit is not overwritten");
    assert.match(bot.proposal.error, /changed since this proposal \(salary floor\)\. Nothing was applied/);
    assert.equal(bot.proposal.status, "open");
    assert.equal(host.calls.sync.length, 1, "only the hand apply POSTed");
    assert.equal((await store.listHistory()).length, 1);
  });

  it("unions only the committed skip titles into keywordsExclude (LT-UNION)", async () => {
    const changes = [
      { field: "hardConstraints.skipTitles", op: "add", value: ["SDR"], default: false },
      { field: "discoveryProfile.keywordsExclude", op: "add", value: ["agency"] },
    ];
    const t = { propose: () => Promise.resolve({ ok: true, reply: "ok", changes }) };
    const first = await ready(null, { transport: t });
    const bot = await first.tune.ask("x");
    assert.deepEqual(plain(bot.proposal.rows.map((r) => r.key)), ["skipTitles", "keywordsExclude"], "no synthetic union row on the card");
    assert.deepEqual(plain(bot.proposal.rows[1].after), ["intern", "staffing", "agency"], "the exclude row carries only its own op");
    await first.tune.applyProposal(bot.id);
    assert.deepEqual(first.host.calls.saveDiscovery, [{ keywordsExclude: "intern, staffing, agency" }], "the unticked SDR never lands");
    assert.deepEqual(plain(first.host.calls.sync[0].hardConstraints.skipTitles), ["Intern"]);

    const second = await ready(null, { transport: { propose: () => Promise.resolve({ ok: true, reply: "ok", changes: [{ field: "hardConstraints.skipTitles", op: "add", value: ["SDR"] }] }) } });
    const bot2 = await second.tune.ask("x");
    assert.deepEqual(plain(bot2.proposal.rows.map((r) => r.key)), ["skipTitles"]);
    const out = await second.tune.applyProposal(bot2.id);
    assert.deepEqual(second.host.calls.saveDiscovery, [{ keywordsExclude: "intern, staffing, SDR" }], "a ticked skip title is unioned at save time");
    assert.deepEqual(plain(out.entry.rows.map((r) => r.key)), ["skipTitles", "keywordsExclude"], "history records the union");
  });

  it("rejects a reply that is not the contract shape", async () => {
    const { tune } = await ready(null, { transport: { propose: () => Promise.resolve({ ok: true, changes: "salary 150k" }) } });
    const bot = await tune.ask("x");
    assert.equal(bot.error.code, "invalid_reply");
  });
});

describe("leads-tune: history and undo", () => {
  it("undo reverts only the fields its entry touched and is logged itself", async () => {
    const { tune, host, store } = await ready();
    tune.setDraft("salaryFloor", "150000");
    const a = await tune.applyDraft();
    tune.setDraft("salaryRequired", true);
    await tune.applyDraft();
    const out = await tune.undo(a.entry.id);
    assert.equal(out.ok, true);
    const s = tune.getState().settings;
    assert.equal(s.salaryFloor, 120000, "the undone field is back");
    assert.equal(s.salaryRequired, true, "the later, unrelated change stays");
    assert.equal(host.calls.sync[2].hardConstraints.salaryRequired, true);
    const history = await store.listHistory();
    assert.equal(history.length, 3);
    assert.equal(history[0].undoOf, a.entry.id);
    assert.ok(tune.isUndone(tune.getState().history.find((h) => h.id === a.entry.id)));
    assert.equal((await tune.undo(a.entry.id)).ok, false, "an entry is undone once");
  });

  it("blocks undo when a later entry changed the same field", async () => {
    const { tune, tuneApi } = await ready();
    tune.setDraft("salaryFloor", "150000");
    const a = await tune.applyDraft();
    tune.setDraft("salaryFloor", "160000");
    await tune.applyDraft();
    const entry = tune.getState().history.find((h) => h.id === a.entry.id);
    assert.ok(tune.laterTouched(entry));
    assert.equal((await tune.undo(a.entry.id)).ok, false);
    assert.equal(tune.getState().settings.salaryFloor, 160000, "no silent clobber");
    assert.match(tuneApi.render(tune).history, /Changed again later, undo that first/);
  });

  it("an applied agent card offers Undo, and undoing flips it to Undone", async () => {
    const { tune, tuneApi } = await ready(null, { transport: { propose: () => Promise.resolve({ ok: true, reply: "ok", changes: [{ field: "hardConstraints.salaryFloor", op: "set", value: 150000 }] }) } });
    const bot = await tune.ask("x");
    await tune.applyProposal(bot.id);
    assert.equal(bot.proposal.status, "applied");
    assert.match(tuneApi.render(tune).chat, /Applied 1 change/);
    assert.match(tuneApi.render(tune).chat, /See it in Filters/);
    await tune.undo(bot.proposal.entryId);
    assert.equal(bot.proposal.status, "undone");
  });
});

describe("leads-tune: states and copy", () => {
  it("renders the read-only note and a disabled fieldset when the profile API is unreachable", async () => {
    const { tune, tuneApi } = await ready({ profileStatus: "unreachable" });
    const html = tuneApi.render(tune).controls;
    assert.match(html, /These settings are read-only here/);
    assert.match(html, /<fieldset class="jbt-fieldset" disabled>/);
  });

  it("says so when there is no fit profile yet", async () => {
    const { tune, tuneApi } = await ready({ profileStatus: "missing" });
    assert.match(tuneApi.render(tune).controls, /don(’|')t have a fit profile yet/);
  });

  it("shows the loading note and … counts until rows load", async () => {
    const env = load();
    const host = makeHost(env.core, { rowsLoaded: false });
    host.getProfile = () => new Promise(() => {});
    const tune = env.tuneApi.createTune(host, {});
    tune.load();
    const out = env.tuneApi.render(tune);
    assert.match(out.controls, /Loading your profile…/);
    assert.match(out.nownext, /data-jbt="nn-find">…</);
  });

  it("shows the empty-history invitation", async () => {
    const { tune, tuneApi } = await ready();
    assert.match(tuneApi.render(tune).history, /No changes yet\. Everything you apply here, by hand or through the agent, is listed with an undo\./);
  });

  it("states D8 plainly: existing fit scores stay until a lead is rescored", async () => {
    const { tune, tuneApi } = await ready();
    assert.ok(tuneApi.render(tune).controls.includes("Existing fit scores don&#39;t change until a lead is rescored"));
    tune.addItem("wants", "Hands-on AI work");
    assert.ok(tuneApi.renderReviewDialog(tune).includes("Existing fit scores don&#39;t change until a lead is rescored"), "the review says it when must-haves change");
  });

  it("the review bar reads before → after counts from countsFor", async () => {
    const { tune, tuneApi, core } = await ready();
    tune.addItem("companyBlocklist", "Northwind");
    const s = tune.getState().settings;
    const v = core.normalizeView(null);
    const before = core.countsFor(sheet(), tuneApi.countsProfile(s), v).visible;
    const after = core.countsFor(sheet(), tuneApi.countsProfile(Object.assign({}, s, { companyBlocklist: ["Brightpath Agency", "Northwind"] })), v).visible;
    const rv = tuneApi.render(tune).review;
    assert.equal(rv.on, true);
    assert.ok(rv.html.includes("1 unapplied change"));
    assert.ok(rv.html.includes(`Find: ${before} → ${after} leads · Future runs: 1 setting change`), rv.html);
  });

  it("refuses list items outside the schema limits with a reason", async () => {
    const { tune } = await ready();
    for (let i = 0; i < 6; i++) tune.addItem("targetRoles", `Role ${i}`);
    assert.match(tune.addItem("targetRoles", "Ninth"), /most this list can hold \(8\)/);
    assert.match(tune.addItem("skipTitles", "x"), /at least 2 characters/);
    assert.equal(tune.addItem("skipTitles", "intern"), "Already on the list.");
    tune.discard();
    tune.removeItem("targetRoles", 0);
    assert.equal(tune.removeItem("targetRoles", 0), false, "at least one target role stays");
  });
});

describe("leads-tune: wiring", () => {
  it("every Chat rule in leads.css is scoped under .jb-leads", () => {
    const css = readRepoFile("leads.css");
    const start = css.indexOf("*/", css.indexOf("Chat mode (lane LT")) + 2;
    const end = css.indexOf("/* ---- end of Chat mode", start);
    assert.ok(start > 2 && end > start);
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [];
    block.replace(/([^{}]+)\{/g, (_, sel) => { selectors.push(sel.trim()); return ""; });
    const TOAST_LIFT = 'body.jb-v2[data-jb-view="leads"]:has(.jb-leads .jbt-grid[data-mtab="ask"]) .toast-container';
    const bad = selectors
      .filter((s) => !/^@media|^@keyframes|^(from|to|\d+%)$/.test(s))
      .flatMap((s) => s.split(",").map((x) => x.trim()))
      .filter((s) => !s.startsWith(".jb-leads .jbt") && s !== TOAST_LIFT);
    assert.deepEqual(bad, [], "only the named toast lift sits outside .jb-leads");
  });

  function phoneBlock() {
    const css = readRepoFile("leads.css");
    const chat = css.slice(css.indexOf("Chat mode (lane LT"));
    const at = chat.indexOf("@media (max-width: 900px)");
    return chat.slice(at, chat.indexOf("/* ---- end of Chat mode", at));
  }

  it("gives the chip add field a 44px target on a phone (LT-HIT)", () => {
    assert.match(phoneBlock(), /\.jb-leads \.jbt-chipset__input \{\s*min-height: 44px;/);
  });

  it("reserves room for the fixed review bar and lifts toasts above the composer (LT-BAR)", () => {
    const css = readRepoFile("leads.css");
    assert.match(css, /\.jb-leads \.jbt \{[^}]*padding-bottom: var\(--jbt-review-space, 0px\);/);
    assert.match(readRepoFile("leads-tune.js"), /setProperty\("--jbt-review-space"/);
    assert.match(phoneBlock(), /\.jbt-grid\[data-mtab="ask"\]\) \.toast-container \{\s*bottom: 84px;/);
  });

  it("index.html loads leads-tune.js right after leads.js", () => {
    const html = readRepoFile("index.html");
    assert.match(html, /<script src="leads\.js" defer><\/script>\s*<script src="leads-tune\.js" defer><\/script>/);
  });
});
