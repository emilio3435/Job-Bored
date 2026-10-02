// HOLES HUNT-FE (spec §0.5, §0.10, §1b.3): buildSearchPlan reserves an
// exploration share for never-tried rotation picks, accepts a hunt's
// searchPlanOverride, and keeps the exploit picks on the seeded rotation.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const payload = require("../discovery-payload.js");

const ROTATION_KEYS = [
  "adjacentTitle",
  "skill",
  "industry",
  "location",
  "seniority",
  "companyType",
  "sourceLane",
];

function makeInput(overrides = {}) {
  return {
    requestedAt: "2026-05-26T11:00:00.000Z",
    trigger: "scheduled-local",
    discoveryProfile: {
      targetRoles: "Staff backend engineer, Platform engineer",
      locations: "Chicago, Remote",
      remotePolicy: "Remote-first",
      seniority: "Senior, Staff",
      keywordsInclude: "Postgres, distributed systems",
      keywordsExclude: "PHP",
      maxLeadsPerRun: "12",
      sourcePreset: "browser_plus_ats",
    },
    resume: {
      extractedText: "Built Python, Postgres, React, Kubernetes, and AI systems.",
      createdAt: "2026-05-20T00:00:00.000Z",
    },
    preferences: {
      tone: "warm",
      industriesToEmphasize: "Developer tools, AI",
      voiceNotes: "Prefer small teams and practical product work.",
    },
    ...overrides,
  };
}

// The rotation origin/main 048986a0 produced for makeInput(); pinned so the
// exploit half of the plan provably did not move.
const LEGACY_SELECTED = {
  role: "Platform engineer",
  adjacentTitle: "Platform Engineer",
  skill: "python",
  industry: "Developer tools",
  location: "Remote",
  seniority: "Senior",
  companyType: "remote-first",
  sourceLane: "ats_provider",
  alsoTrying: ["Platform Engineer"],
};

function lower(value) {
  return String(value || "").toLowerCase();
}

test("HUNT-FE-PLAN-1: with no history the plan reserves 30% (2 of 7 slots) and keeps the legacy rotation", () => {
  const plan = payload.buildSearchPlan(makeInput());
  assert.equal(plan.seed, "c549406f");
  assert.deepEqual(plan.selected, LEGACY_SELECTED);
  assert.equal(plan.planVersion, 1);
  assert.ok(plan.exploration, "plan carries an exploration block");
  assert.equal(plan.exploration.share, 0.3);
  assert.equal(plan.exploration.slotCount, 2);
  assert.equal(plan.exploration.slots.length, 2);
  for (const slot of plan.exploration.slots) {
    assert.ok(ROTATION_KEYS.includes(slot.facet), `unknown facet ${slot.facet}`);
    assert.equal(slot.value, plan.selected[slot.facet]);
    assert.equal(slot.novel, true, "nothing was tried yet, so every pick is novel");
  }
  assert.equal(plan.exploration.novelCombo, true);
  assert.equal(plan.exploration.historySize, 0);
  assert.deepEqual(
    [...plan.exploration.exploit, ...plan.exploration.slots.map((s) => s.facet)].sort(),
    [...ROTATION_KEYS].sort(),
  );
});

test("HUNT-FE-PLAN-2: reserved slots take never-tried values while exploit slots keep the seeded picks", () => {
  const legacy = payload.buildSearchPlan(makeInput());
  const plan = payload.buildSearchPlan(
    makeInput({ novelty: { history: [{ searchPlan: legacy }] } }),
  );
  assert.equal(plan.seed, legacy.seed, "history never moves the seed");
  assert.equal(plan.exploration.historySize, 1);
  const reserved = new Set(plan.exploration.slots.map((s) => s.facet));
  assert.equal(reserved.size, 2);
  for (const slot of plan.exploration.slots) {
    assert.notEqual(
      lower(slot.value),
      lower(legacy.selected[slot.facet]),
      `${slot.facet} should move off the tried value`,
    );
    assert.equal(slot.novel, true);
    assert.ok(plan.facets[facetList(slot.facet)].includes(slot.value));
  }
  for (const key of ROTATION_KEYS) {
    if (reserved.has(key)) continue;
    assert.equal(plan.selected[key], legacy.selected[key], `${key} is exploit`);
  }
  assert.equal(plan.selected.role, legacy.selected.role);
  assert.equal(plan.exploration.novelCombo, true);
  // The query is rebuilt from the final picks.
  if (reserved.has("skill")) {
    assert.match(plan.query.keywordsInclude, new RegExp(plan.selected.skill));
  }
  if (reserved.has("location")) {
    assert.equal(plan.query.locations, plan.selected.location);
  }
});

function facetList(key) {
  return {
    adjacentTitle: "adjacentTitles",
    skill: "skills",
    industry: "industries",
    location: "locations",
    seniority: "seniority",
    companyType: "companyTypes",
    sourceLane: "sourceLanes",
  }[key];
}

test("HUNT-FE-PLAN-3: the share never drops below one slot, caps at every slot, and reads percents", () => {
  const none = payload.buildSearchPlan(makeInput({ explorationShare: 0 }));
  assert.equal(none.exploration.share, 0);
  assert.equal(none.exploration.slotCount, 1, "never fewer than 1 exploration slot");
  const all = payload.buildSearchPlan(makeInput({ explorationShare: 1 }));
  assert.equal(all.exploration.slotCount, 7);
  assert.deepEqual(all.exploration.exploit, []);
  const pct = payload.buildSearchPlan(makeInput({ explorationShare: 45 }));
  assert.equal(pct.exploration.share, 0.45);
  assert.equal(pct.exploration.slotCount, 3);
  const junk = payload.buildSearchPlan(makeInput({ explorationShare: "lots" }));
  assert.equal(junk.exploration.share, 0.3);
  const fromNovelty = payload.buildSearchPlan(
    makeInput({ novelty: { explorationShare: 0.6, history: [] } }),
  );
  assert.equal(fromNovelty.exploration.share, 0.6);
  assert.equal(fromNovelty.exploration.slotCount, 4);
});

test("HUNT-FE-PLAN-4: scheduled-* stays deterministic: same day and same history give the same plan", () => {
  const legacy = payload.buildSearchPlan(makeInput());
  const history = { history: [{ selected: legacy.selected }] };
  const morning = payload.buildSearchPlan(makeInput({ novelty: history }));
  const night = payload.buildSearchPlan(
    makeInput({ novelty: history, requestedAt: "2026-05-26T23:45:00.000Z" }),
  );
  assert.equal(morning.seed, legacy.seed);
  assert.equal(night.seed, legacy.seed);
  assert.deepEqual(morning.selected, night.selected);
  assert.deepEqual(morning.exploration, night.exploration);
  assert.deepEqual(morning.query, night.query);
});

test("HUNT-FE-PLAN-5: when every reserved value was tried, the plan still looks for an untried combination", () => {
  const tiny = makeInput({
    discoveryProfile: {
      targetRoles: "Data analyst",
      locations: "Denver",
      seniority: "Senior",
      keywordsInclude: "",
      sourcePreset: "ats_only",
    },
    resume: { extractedText: "" },
    preferences: {},
    trigger: "manual",
    variationKey: "combo-a",
    explorationShare: 1,
  });
  const base = payload.buildSearchPlan(tiny);
  // Every single value has been tried, and so has the seeded combination.
  const history = [];
  const facets = base.facets;
  for (const key of ROTATION_KEYS) {
    for (const value of facets[facetList(key)]) {
      history.push({ selected: { ...base.selected, [key]: value } });
    }
  }
  const plan = payload.buildSearchPlan({ ...tiny, novelty: { history } });
  const triedCombos = new Set(
    history.map((h) => ROTATION_KEYS.map((k) => lower(h.selected[k])).join("|")),
  );
  const combo = ROTATION_KEYS.map((k) => lower(plan.selected[k])).join("|");
  const multiValued = ROTATION_KEYS.filter((k) => facets[facetList(k)].length > 1);
  assert.ok(multiValued.length >= 2, "fixture needs two multi-valued facets");
  assert.equal(plan.exploration.novelCombo, true);
  assert.equal(triedCombos.has(combo), false, "the run's combination is new");
  assert.ok(plan.exploration.slots.every((s) => s.novel === false));
});

const OVERRIDE_PLAN = {
  planVersion: 1,
  generatedAt: "2026-05-20T08:00:00.000Z",
  seed: "0badc0de",
  selected: { skill: "figma", industry: "saas", companyType: "startup" },
  facets: {
    roles: ["Product designer"],
    locations: ["Remote"],
    seniority: ["Senior"],
  },
  query: {
    targetRoles: "Product designer, UX Designer",
    locations: "Remote",
    seniority: "Senior",
    remotePolicy: "Remote only",
    keywordsInclude: "figma, saas, startup, design systems",
    keywordsExclude: "agency",
    sourcePreset: "ats_only",
  },
};

test("HUNT-FE-PLAN-6: searchPlanOverride replaces the search terms and drops the old rotation picks", () => {
  const plan = payload.buildSearchPlan(
    makeInput({ trigger: "hunt", variationKey: "hunt-run", searchPlanOverride: OVERRIDE_PLAN }),
  );
  assert.deepEqual(plan.facets.roles, ["Product designer"]);
  assert.deepEqual(plan.facets.locations, ["Remote"]);
  assert.deepEqual(plan.facets.seniority, ["Senior"]);
  assert.deepEqual(plan.facets.sourceLanes, ["ats_provider"]);
  assert.equal(plan.query.locations, "Remote");
  assert.equal(plan.query.seniority, "Senior");
  assert.equal(plan.query.remotePolicy, "Remote only");
  assert.equal(plan.query.keywordsExclude, "agency");
  assert.equal(plan.query.sourcePreset, "ats_only");
  assert.match(plan.query.targetRoles, /^Product designer/);
  assert.doesNotMatch(plan.query.targetRoles, /Staff backend engineer/);
  assert.match(plan.query.keywordsInclude, /design systems/);
  // The saved run's rotation picks are not the user's includes.
  assert.equal(plan.facets.skills.includes("figma"), false);
  assert.equal(plan.trigger, "hunt");
  assert.ok(plan.exploration.slotCount >= 1);
});

test("HUNT-FE-PLAN-7: a query-shaped override (hunt tweaks) also works", () => {
  const plan = payload.buildSearchPlan(
    makeInput({
      trigger: "manual",
      variationKey: "tweak",
      searchPlanOverride: {
        targetRoles: "Analytics engineer",
        locations: "Austin; Remote",
        seniority: "Lead",
        keywordsExclude: "crypto",
      },
    }),
  );
  assert.deepEqual(plan.facets.roles, ["Analytics engineer"]);
  assert.deepEqual(plan.facets.locations, ["Austin", "Remote"]);
  assert.equal(plan.query.seniority, "Lead");
  assert.equal(plan.query.keywordsExclude, "crypto");
  // Fields the override leaves out come from the profile.
  assert.equal(plan.query.remotePolicy, "Remote-first");
});

test("HUNT-FE-PLAN-8: the payload passes hunt.searchPlanOverride through, keeps the real profile snapshot, and sends no hunt reference", () => {
  const result = payload.buildDiscoveryWebhookPayload({
    ...makeInput({ trigger: "hunt" }),
    sheetId: "sheet_1234567890",
    hunt: { id: "hunt_0123456789abcdef0123456789abcdef", searchPlanOverride: OVERRIDE_PLAN },
  });
  assert.equal(result.trigger, "hunt");
  const plan = result.discoveryProfile.searchPlan;
  assert.equal(plan.query.locations, "Remote");
  assert.equal(plan.query.keywordsExclude, "agency");
  assert.deepEqual(result.discoveryProfile.profileSnapshot.targetRoles, [
    "Staff backend engineer",
    "Platform engineer",
  ]);
  assert.equal(result.discoveryProfile.targetRoles, "Staff backend engineer, Platform engineer");
  assert.doesNotMatch(JSON.stringify(result), /hunt_0123456789abcdef/);
  assert.equal("hunt" in result, false);
});

test("HUNT-FE-PLAN-9: in the browser the payload builder reads novelty history from JobBoredHuntsStore, and survives a broken store", () => {
  const legacy = payload.buildSearchPlan(makeInput());
  const prior = globalThis.JobBoredHuntsStore;
  try {
    globalThis.JobBoredHuntsStore = {
      noveltyContext() {
        return { history: [{ selected: legacy.selected }] };
      },
    };
    const result = payload.buildDiscoveryWebhookPayload(makeInput());
    const plan = result.discoveryProfile.searchPlan;
    assert.equal(plan.exploration.historySize, 1);
    for (const slot of plan.exploration.slots) {
      assert.notEqual(lower(slot.value), lower(legacy.selected[slot.facet]));
    }
    globalThis.JobBoredHuntsStore = {
      noveltyContext() {
        throw new Error("store exploded");
      },
    };
    const safe = payload.buildDiscoveryWebhookPayload(makeInput());
    assert.deepEqual(safe.discoveryProfile.searchPlan.selected, LEGACY_SELECTED);
    // An explicit novelty input wins over the store.
    const explicit = payload.buildDiscoveryWebhookPayload(
      makeInput({ novelty: { history: [] } }),
    );
    assert.equal(explicit.discoveryProfile.searchPlan.exploration.historySize, 0);
  } finally {
    if (prior === undefined) delete globalThis.JobBoredHuntsStore;
    else globalThis.JobBoredHuntsStore = prior;
  }
});
