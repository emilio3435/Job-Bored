// HOLES HUNT-FE: the Hunts sub-tab's markup and form logic (hunts-ui.js).
// The repo's DOM fakes do not parse HTML, so the renderers are pure strings
// and these assert on them; mount() is exercised with a minimal vm context.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// hunts-ui reads the trend from the hitlist module through the global.
globalThis.JobBoredHuntsHitlist = require("../hunts-hitlist.js");
const ui = require("../hunts-ui.js");

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

const PLAN = {
  planVersion: 1,
  generatedAt: "2026-10-01T08:00:00.000Z",
  seed: "a1",
  selected: { skill: "Figma", industry: "SaaS", companyType: "startup", adjacentTitle: "UX Designer" },
  facets: { roles: ["Product designer"], locations: ["Remote", "Chicago"], seniority: ["Senior"] },
  query: {
    targetRoles: "Product designer, UX Designer",
    locations: "Remote",
    seniority: "Senior",
    remotePolicy: "Remote only",
    keywordsInclude: "Figma, SaaS, startup, design systems",
    keywordsExclude: "agency",
  },
};

const REPEATING = {
  key: "sk_22819704278edfea",
  label: "product designer · remote, chicago · senior",
  searchPlan: PLAN,
  runCount: 3,
  repeating: true,
  leadsWritten: 12,
  leadsUpdated: 6,
  meanFit: 7,
  lastRunAt: "2026-10-02T08:00:00.000Z",
  lastRunId: "run_a3",
  score: 3,
  trend: [
    { runId: "run_a3", at: "2026-10-02T08:00:00.000Z", written: 6, updated: 2 },
    { runId: "run_a2", at: "2026-10-01T08:00:00.000Z", written: 4, updated: 3 },
    { runId: "run_a1", at: "2026-09-30T08:00:00.000Z", written: 2, updated: 1 },
    { runId: "run_a0", at: "2026-09-29T08:00:00.000Z", written: 0, updated: 0 },
  ],
  huntId: null,
};
const ONE_OFF = { ...REPEATING, key: "sk_once", label: "data analyst · denver", runCount: 1, repeating: false, trend: [] };

const HUNT = {
  id: "hunt_0123456789abcdef0123456789abcdef",
  name: "Product designer · remote",
  status: "active",
  searchPlan: PLAN,
  effectivePlan: PLAN,
  tweaks: {},
  searchKey: "sk_22819704278edfea",
  explorationShare: 0.3,
  schedule: { kind: "daily", hour: 8, minute: 0 },
  timezone: "America/Chicago",
  nextRunAt: "2026-10-02T15:00:00.000Z",
  lastRunAt: "2026-10-02T08:00:00.000Z",
  queuedAt: null,
  lastError: null,
  runs: [
    { runId: "run_h2", trigger: "scheduled-hunt", dispatchedAt: "2026-10-02T08:00:00.000Z", written: 5, updated: 2, fitAvg: 7.4 },
    { runId: "run_h1", trigger: "scheduled-hunt", dispatchedAt: "2026-10-01T08:00:00.000Z", written: 1, updated: 4 },
  ],
};

test("HUNT-FE-UI-1: the panel has two lists, repeating searches ranked in the hitlist and the saved hunts", () => {
  const parts = ui.renderPanelParts(
    { loaded: true, clusters: [REPEATING, ONE_OFF], hunts: [HUNT] },
    { now: NOW },
  );
  assert.match(parts.hitlist, /product designer · remote, chicago · senior/);
  assert.doesNotMatch(parts.hitlist, /data analyst/, "one-off searches are not on the hitlist");
  assert.match(parts.oneOffs, /data analyst · denver/);
  assert.equal(parts.oneOffCount, 1);
  assert.match(parts.hitlist, /Last run 4 h ago · 3 runs/);
  assert.match(parts.hitlist, /12 new<\/span><span class="hunts-count">6 seen/);
  assert.match(parts.hitlist, /Fit 7\.0/);
  assert.match(parts.hitlist, /hunts-trend--up/);
  assert.match(parts.hitlist, /New leads per run, oldest to newest: 0, 2, 4, 6\./);
  assert.match(parts.hitlist, /role="switch" aria-checked="false"[^>]*data-hunts-action="toggle-save"/);
  assert.match(parts.saved, /Product designer · remote/);
  assert.equal(parts.status, "", "online: no banner");
});

test("HUNT-FE-UI-2: a saved hunt shows its schedule, next run, exploration share, last-run counts and trend, and all its controls", () => {
  const html = ui.renderHuntHtml(HUNT, 0, { now: NOW });
  assert.match(html, /Daily at 8:00 AM · next in 3 h · exploring 30%/);
  assert.match(html, /Last run 4 h ago/);
  assert.match(html, /5 new<\/span><span class="hunts-count">2 seen/);
  assert.match(html, /Fit 7\.4/);
  assert.match(html, /hunts-trend--up/);
  for (const action of ["run", "pause", "edit", "delete"]) {
    assert.match(html, new RegExp(`data-hunts-action="${action}" data-hunt-id="${HUNT.id}"`));
  }
  assert.match(html, />Run now</);
  assert.match(html, /aria-describedby="hunts-h-0-title"/);
  assert.match(html, /aria-expanded="false" aria-controls="hunts-edit-0"/);

  const paused = ui.renderHuntHtml(
    { ...HUNT, status: "paused", queuedAt: null, lastError: "400 blank intent" },
    1,
    { now: NOW },
  );
  assert.match(paused, /hunts-badge--paused">Paused</);
  assert.match(paused, /data-hunts-action="resume"[^>]*>Resume</);
  assert.doesNotMatch(paused, /next in/, "a paused hunt has no next run");
  assert.match(paused, /Last run refused: 400 blank intent/);

  const queued = ui.renderHuntHtml(
    { ...HUNT, queuedAt: "2026-10-02T11:59:00.000Z", runs: [{ ...HUNT.runs[0], awaitingSheetWrite: 3 }] },
    2,
    { now: NOW },
  );
  assert.match(queued, /Queued: it runs when the current run finishes\./);
  assert.match(queued, /3 leads wait for your Sheet/);
});

test("HUNT-FE-UI-3: worker offline shows the banner with the cache age, and every change control is disabled", () => {
  const parts = ui.renderPanelParts(
    { offline: true, reason: "unreachable", cachedAt: "2026-10-02T10:00:00.000Z", clusters: [REPEATING], hunts: [HUNT] },
    { now: NOW },
  );
  assert.match(parts.status, /Worker offline/);
  assert.match(parts.status, /last saved copy \(2 h ago\)/);
  assert.match(parts.status, /data-hunts-action="refresh"/);
  const controls = parts.saved.match(/<button[^>]*data-hunts-action="(run|pause|edit|delete)"[^>]*>/g);
  assert.equal(controls.length, 4);
  for (const control of controls) assert.match(control, / disabled>$/);
  assert.match(parts.hitlist, /data-hunts-action="toggle-save"[^>]* disabled>/);

  const cold = ui.renderPanelParts({ offline: true, clusters: [], hunts: [] }, { now: NOW });
  assert.match(cold.status, /Nothing saved on this device yet/);

  const old = ui.renderPanelParts({ unsupported: true, loaded: true, clusters: [], hunts: [] }, { now: NOW });
  assert.match(old.status, /This worker predates hunts/);
});

test("HUNT-FE-UI-4: the picker offers off, daily, weekdays and every N hours at a time, with exploration at 30%", () => {
  const html = ui.renderPickerHtml({ label: "product designer · remote" });
  for (const kind of ["off", "daily", "weekdays", "every_n_hours"]) {
    assert.match(html, new RegExp(`type="radio" name="scheduleKind" value="${kind}"`));
  }
  assert.match(html, /value="daily" checked/);
  assert.match(html, /<legend>Schedule<\/legend>/);
  assert.match(html, /type="time" id="hunts-pick-time" name="scheduleTime" value="08:00"/);
  assert.match(html, /for="hunts-pick-every" data-hunts-every hidden>/);
  assert.match(html, /type="number" id="hunts-pick-every" name="everyHours" min="1" max="24"/);
  assert.match(html, /type="range" id="hunts-pick-share" name="explorationShare" min="0" max="100" step="5" value="30" aria-valuetext="30% exploring"/);
  assert.match(html, /<label for="hunts-pick-share">Exploration<\/label>/);
  assert.match(html, /role="alert" data-hunts-error hidden/);
  assert.match(html, /never repeat on their own/);
});

test("HUNT-FE-UI-5: picker and editor values become the documented request bodies", () => {
  const saved = ui.saveRequestFromValues(
    { fromRunId: "run_a3", searchPlan: PLAN },
    { name: "  My hunt ", scheduleKind: "every_n_hours", scheduleTime: "07:00", everyHours: "6", explorationShare: "45" },
    "America/Chicago",
  );
  assert.deepEqual(saved, {
    ok: true,
    body: {
      schedule: { kind: "every_n_hours", hour: 7, minute: 0, everyHours: 6 },
      explorationShare: 0.45,
      status: "active",
      fromRunId: "run_a3",
      searchPlan: PLAN,
      name: "My hunt",
      timezone: "America/Chicago",
    },
  });
  assert.equal(ui.scheduleFromValues({ scheduleKind: "every_n_hours", everyHours: "0" }).ok, false);
  assert.equal(ui.scheduleFromValues({ scheduleKind: "daily", scheduleTime: "25:00" }).ok, false);
  assert.equal(ui.scheduleFromValues({ scheduleKind: "hourly" }).ok, false);
  assert.deepEqual(ui.scheduleFromValues({ scheduleKind: "off" }).schedule, { kind: "off", hour: 8, minute: 0 });

  // The editor opens on what the user searched: no rotation picks.
  const terms = ui.searchTerms(PLAN);
  assert.deepEqual(terms, {
    targetRoles: "Product designer",
    keywordsInclude: "design systems",
    locations: "Remote, Chicago",
    seniority: "Senior",
    keywordsExclude: "agency",
  });
  const untouched = {
    name: HUNT.name,
    ...terms,
    scheduleKind: "daily",
    scheduleTime: "08:00",
    explorationShare: "30",
  };
  assert.deepEqual(ui.huntPatchFromValues(HUNT, untouched, "America/Chicago"), { ok: true, patch: {} });

  const tweaked = ui.huntPatchFromValues(
    { ...HUNT, tweaks: { remotePolicy: "Hybrid" } },
    { ...untouched, locations: "Austin", keywordsExclude: "agency, intern", scheduleKind: "weekdays", explorationShare: "50" },
    "America/Denver",
  );
  assert.deepEqual(tweaked.patch, {
    tweaks: { remotePolicy: "Hybrid", locations: "Austin", keywordsExclude: "agency, intern" },
    explorationShare: 0.5,
    schedule: { kind: "weekdays", hour: 8, minute: 0 },
    timezone: "America/Denver",
  });

  // Editing a tweaked field back to the saved search clears that tweak.
  const reverted = ui.huntPatchFromValues(
    { ...HUNT, tweaks: { locations: "Austin" }, effectivePlan: { ...PLAN, facets: { ...PLAN.facets, locations: ["Austin"] } } },
    { ...untouched, locations: "chicago,  remote" },
    "America/Chicago",
  );
  assert.deepEqual(reverted.patch, { tweaks: {} });
});

test("HUNT-FE-UI-6: worker strings are escaped, never injected as markup", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const html =
    ui.renderClusterHtml({ ...REPEATING, label: evil, key: evil }, 0, { now: NOW }) +
    ui.renderHuntHtml({ ...HUNT, name: evil, lastError: evil, id: evil }, 0, { now: NOW, editing: evil }) +
    ui.renderPickerHtml({ label: evil });
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("HUNT-FE-UI-7: the Runs-row switch shows whether the run is saved; rows without a run id get none", () => {
  const store = { huntForRun: (id) => (id === "run_saved" ? HUNT : null) };
  assert.match(
    ui.runToggleHtml({ runId: "run_saved" }, store),
    /role="switch" aria-checked="true" data-runs-save-hunt="run_saved">/,
  );
  assert.match(ui.runToggleHtml({ runId: "run_new" }, store), /aria-checked="false"/);
  assert.match(ui.runToggleHtml({ runId: "run_new" }, store), /Save as hunt/);
  assert.equal(ui.runToggleHtml({ runId: "" }, store), "");
  assert.equal(ui.runToggleHtml({ runId: "run_new" }, null), "", "no store loaded: no switch");
});

test("HUNT-FE-UI-8: schedules, clocks and times read naturally", () => {
  assert.equal(ui.scheduleLabel({ kind: "off", hour: 8, minute: 0 }), "Not scheduled");
  assert.equal(ui.scheduleLabel({ kind: "weekdays", hour: 7, minute: 30 }), "Weekdays at 7:30 AM");
  assert.equal(ui.scheduleLabel({ kind: "every_n_hours", hour: 19, minute: 0, everyHours: 6 }), "Every 6 h from 7:00 PM");
  assert.equal(ui.formatClock(0, 5), "12:05 AM");
  assert.equal(ui.formatClock(12, 0), "12:00 PM");
  assert.equal(ui.relativeTime("2026-10-02T11:59:30.000Z", NOW), "just now");
  assert.equal(ui.relativeTime("2026-09-30T12:00:00.000Z", NOW), "2 days ago");
  assert.equal(ui.relativeTime("2026-10-03T12:00:00.000Z", NOW), "in 1 day");
  assert.equal(ui.shareLabel(0.45), "45%");
});

function mountHarness() {
  const listeners = {};
  const make = (attrs = {}) => {
    const el = {
      attrs: { ...attrs },
      hidden: Boolean(attrs.hidden),
      innerHTML: "",
      textContent: "",
      handlers: {},
      getAttribute: (name) => (name in el.attrs ? el.attrs[name] : null),
      setAttribute: (name, value) => {
        el.attrs[name] = String(value);
      },
      addEventListener: (type, fn) => {
        el.handlers[type] = fn;
      },
      querySelector: (sel) => el.slots[sel] || null,
      slots: {},
    };
    return el;
  };
  const panel = make({ id: "dd-panel-hunts", hidden: true });
  for (const sel of [
    "[data-hunts-status]",
    "[data-hunts-hitlist]",
    "[data-hunts-oneoffs]",
    "[data-hunts-oneoffs-wrap]",
    "[data-hunts-oneoff-count]",
    "[data-hunts-saved]",
  ]) {
    panel.slots[sel] = make();
  }
  const drawer = make({ id: "discoveryDrawer" });
  const observers = [];
  let refreshes = 0;
  const store = {
    CHANGED_EVENT: "jb:hunts:changed",
    snapshot: () => ({ loaded: true, clusters: [REPEATING, ONE_OFF], hunts: [HUNT] }),
    refresh: async () => {
      refreshes += 1;
    },
  };
  const context = {
    document: { readyState: "complete", getElementById: () => null },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
    },
    JobBoredHuntsHitlist: globalThis.JobBoredHuntsHitlist,
    Intl,
    Date,
    Math,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(repoRoot, "hunts-ui.js"), "utf8"), context, {
    filename: "hunts-ui.js",
  });
  return { context, panel, drawer, store, observers, listeners, refreshes: () => refreshes };
}

test("HUNT-FE-UI-9: mount() paints the panel, re-renders on store changes, and refreshes when the tab is shown", async () => {
  const h = mountHarness();
  const controller = h.context.JobBoredHuntsUI.mount(h.panel, { store: h.store, drawer: h.drawer });
  assert.ok(controller);
  assert.equal(h.panel.getAttribute("data-hunts-mounted"), "true");
  assert.match(h.panel.slots["[data-hunts-hitlist]"].innerHTML, /product designer/);
  assert.match(h.panel.slots["[data-hunts-saved]"].innerHTML, /Run now/);
  assert.equal(h.panel.slots["[data-hunts-oneoffs-wrap]"].hidden, false);
  assert.equal(h.panel.slots["[data-hunts-oneoff-count]"].textContent, "1");
  assert.equal(h.refreshes(), 0, "a hidden panel does not fetch");
  assert.equal(typeof h.listeners["jb:hunts:changed"], "function");
  assert.equal(typeof h.panel.handlers.click, "function");
  assert.equal(typeof h.panel.handlers.submit, "function");

  h.panel.hidden = false;
  for (const observer of h.observers) observer.cb([]);
  assert.equal(h.refreshes(), 1, "showing the tab refreshes once");
  for (const observer of h.observers) observer.cb([]);
  assert.equal(h.refreshes(), 1, "staying visible does not refetch");
  assert.equal(h.context.JobBoredHuntsUI.mount(h.panel, { store: h.store }), null, "mounts once");
});
