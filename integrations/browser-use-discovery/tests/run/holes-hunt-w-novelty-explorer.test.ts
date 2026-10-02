// HOLES HUNT (docs/INTERFACE-HUNTS.md §6): every run reserves a share of its
// ATS company slots for things never tried. These tests pin the pure
// selection: which slots explore, where they run, and what they yielded.
import assert from "node:assert/strict";
import test from "node:test";

import type { CareerSurfaceRecord, CompanyTarget } from "../../src/contracts.ts";
import {
  DEFAULT_EXPLORATION_SHARE,
  MAX_EXPLORATION_SLOTS,
  planNoveltySlots,
  reservedExplorationSlots,
  resolveExplorationShare,
  summarizeNoveltyYield,
  type NoveltyCandidate,
  type NoveltyKind,
} from "../../src/run/novelty-explorer.ts";

function named(...list: string[]): CompanyTarget[] {
  return list.map((name) => ({ name }));
}

function names(companies: readonly CompanyTarget[]): string[] {
  return companies.map((company) => company.name);
}

/** Keys listed per kind are tried; everything else was never tried. */
function triedOf(tried: Partial<Record<NoveltyKind, string[]>>) {
  return (kind: NoveltyKind, key: string): boolean =>
    (tried[kind] || []).includes(key);
}

function candidate(
  name: string,
  source: NoveltyCandidate["source"] = "candidate_catalog",
): NoveltyCandidate {
  return {
    companyKey: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    name,
    source,
  };
}

function surface(
  companyKey: string,
  providerType: CareerSurfaceRecord["providerType"],
  board: { boardToken?: string; canonicalUrl?: string },
  surfaceType: CareerSurfaceRecord["surfaceType"] = "provider_board",
): CareerSurfaceRecord {
  return {
    surfaceId: `${providerType}:${companyKey}`,
    companyKey,
    surfaceType,
    providerType,
    canonicalUrl: board.canonicalUrl || "",
    host: "",
    finalUrl: "",
    boardToken: board.boardToken || "",
    sourceLane: "ats_provider",
    verifiedStatus: "verified",
    lastVerifiedAt: "",
    lastSuccessAt: "",
    lastFailureAt: "",
    failureReason: "",
    failureStreak: 0,
    cooldownUntil: "",
    metadataJson: "{}",
  };
}

test("HUNT-W novelty: the default share is 0.3 and only finite numbers override it, clamped to [0, 1]", () => {
  assert.equal(DEFAULT_EXPLORATION_SHARE, 0.3);
  assert.equal(resolveExplorationShare(undefined), 0.3);
  assert.equal(resolveExplorationShare(null), 0.3);
  assert.equal(resolveExplorationShare("0.5"), 0.3);
  assert.equal(resolveExplorationShare(Number.NaN), 0.3);
  assert.equal(resolveExplorationShare(Number.POSITIVE_INFINITY), 0.3);
  assert.equal(resolveExplorationShare(0.45), 0.45);
  assert.equal(resolveExplorationShare(0), 0);
  assert.equal(resolveExplorationShare(1.7), 1);
  assert.equal(resolveExplorationShare(-0.2), 0);
  assert.equal(resolveExplorationShare(undefined, 0.1), 0.1);
  assert.equal(resolveExplorationShare(0.8, 0.1), 0.8);
});

test("HUNT-W novelty: reserved slots are max(1, round(share x slots))", () => {
  assert.equal(reservedExplorationSlots(10, 0.3), 3);
  assert.equal(reservedExplorationSlots(5, 0.3), 2, "1.5 rounds up");
  assert.equal(reservedExplorationSlots(4, 0.3), 1, "1.2 rounds down");
  assert.equal(reservedExplorationSlots(2, 0.3), 1);
  assert.equal(reservedExplorationSlots(0, 0.3), 1, "an empty plan still reserves one slot");
  assert.equal(reservedExplorationSlots(10, 0), 1, "share 0 still reserves one slot");
  assert.equal(reservedExplorationSlots(10, 1), 10);
});

test("HUNT-W novelty: share 0 still reserves one slot and runs one never-tried company first", () => {
  const plan = planNoveltySlots({
    companies: named("Acme", "Globex", "Initech"),
    share: 0,
    isTried: triedOf({ company: ["acme"] }),
  });
  assert.equal(plan.reservedSlots, 1);
  assert.deepEqual(names(plan.companies), ["Globex", "Acme", "Initech"]);
  // Initech was never tried either: it is marked explore but stays in place.
  assert.deepEqual(
    plan.slots.map((slot) => [slot.key, slot.mode]),
    [["globex", "explore"], ["acme", "exploit"], ["initech", "explore"]],
  );
});

test("HUNT-W novelty: never-tried planned companies are the explore picks, in list order, before any candidate", () => {
  const plan = planNoveltySlots({
    // 7 planned at 0.3 reserve round(2.1) = 2 slots.
    companies: named("A", "B", "C", "D", "E", "F", "G"),
    candidates: [candidate("Xenon")],
    share: 0.3,
    isTried: triedOf({ company: ["a", "c", "e", "f", "g"] }),
  });
  assert.equal(plan.reservedSlots, 2);
  // B and D fill the reservation; the first runs at 0, the next round(1/0.3) = 3 later.
  assert.deepEqual(names(plan.companies), ["B", "A", "C", "D", "E", "F", "G"]);
  assert.ok(!names(plan.companies).includes("Xenon"), "no candidate is needed");
});

test("HUNT-W novelty: candidates fill the rest of the reservation, deduped by normalizeCompanyKey", () => {
  const planned = named("A", "B", "C", "D", "E", "F", "G", "H", "I", "J");
  const plan = planNoveltySlots({
    companies: planned,
    candidates: [
      candidate("X Corp"),
      { companyKey: "x-corp", name: "XCorp", source: "listing_fingerprints" },
      candidate("A"),
      candidate("Yotta"),
      candidate("Zeta", "company_registry"),
      candidate("Wombat"),
    ],
    share: 0.3,
    isTried: triedOf({ company: planned.map((company) => company.name.toLowerCase()) }),
  });
  assert.equal(plan.reservedSlots, 3);
  // X Corp, Yotta and Zeta are added; the XCorp copy and planned "A" are
  // skipped, and Wombat waits because the reservation is full.
  assert.deepEqual(names(plan.companies), [
    "X Corp", "A", "B", "Yotta", "C", "D", "E", "Zeta", "F", "G", "H", "I", "J",
  ]);
  const added = plan.companies.filter((company) => !planned.includes(company));
  assert.deepEqual(
    added.map((company) => [company.name, company.companyKey]),
    [["X Corp", "xcorp"], ["Yotta", "yotta"], ["Zeta", "zeta"]],
  );
  assert.deepEqual(
    plan.slots.filter((slot) => slot.mode === "explore").map((slot) => slot.label),
    ["X Corp", "Yotta", "Zeta"],
  );
});

test("HUNT-W novelty: cooled-down, blocked, skipped, out-of-allowlist and tried candidates are never added", () => {
  const base = {
    companies: named("Acme", "Globex", "Initech"),
    share: 1,
    isTried: triedOf({ company: ["acme", "globex", "initech", "triedco"] }),
  };
  const blocked = planNoveltySlots({
    ...base,
    cooledDown: [{ name: "Cooled Co", companyKey: "cooled-co" }],
    scope: { companyBlocklist: ["Blocked Inc"], negativeCompanyKeys: ["skipped-llc"] },
    candidates: [
      candidate("Cooled Co"),
      candidate("Blocked Inc"),
      candidate("Skipped LLC"),
      candidate("Tried Co"),
      candidate("Fresh Co"),
    ],
  });
  assert.equal(blocked.reservedSlots, 3);
  assert.deepEqual(names(blocked.companies), ["Fresh Co", "Acme", "Globex", "Initech"]);

  const allowlisted = planNoveltySlots({
    ...base,
    scope: { companyAllowlist: ["Acme", "Globex", "Initech", "Fresh Co"] },
    candidates: [candidate("Other Co"), candidate("Fresh Co")],
  });
  assert.deepEqual(names(allowlisted.companies), ["Fresh Co", "Acme", "Globex", "Initech"]);
});

test("HUNT-W novelty: explore picks run first and spread out, exploit order holds and nothing is dropped", () => {
  const planned = named(...Array.from({ length: 20 }, (_, index) => `Co ${index}`));
  const tried = planned
    .filter((_, index) => index % 4 !== 3)
    .map((company) => company.name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const plan = planNoveltySlots({
    companies: planned,
    candidates: [candidate("Fresh One"), candidate("Fresh Two")],
    share: 0.3,
    isTried: triedOf({ company: tried }),
  });
  // 20 x 0.3 = 6 reserved: five never-tried planned companies, then one candidate.
  assert.equal(plan.reservedSlots, 6);
  assert.equal(plan.companies.length, 21);
  assert.equal(plan.slots[0]?.mode, "explore");
  assert.deepEqual(
    plan.slots.flatMap((slot, index) => (slot.mode === "explore" ? [index] : [])),
    [0, 3, 7, 10, 13, 17],
  );
  assert.deepEqual(
    names(plan.companies).filter((name) => /^Co /.test(name)).sort(),
    names(planned).sort(),
    "every planned company still runs",
  );
  const exploitOrder = plan.slots
    .filter((slot) => slot.mode === "exploit")
    .map((slot) => slot.label);
  assert.deepEqual(
    exploitOrder,
    names(planned).filter((name) => tried.includes(name.toLowerCase().replace(/[^a-z0-9]+/g, ""))),
  );
  assert.ok(names(plan.companies).includes("Fresh One"));
  assert.ok(!names(plan.companies).includes("Fresh Two"));
});

test("HUNT-W novelty: a never-tried ATS provider makes a tried company explore", () => {
  const plan = planNoveltySlots({
    companies: [
      { name: "Acme", boardHints: { lever: "acme" } },
      { name: "Globex", boardHints: { greenhouse: "globex" } },
      { name: "Hooli", boardHints: { ashby: "hooli", greenhouse: "hooli" } },
    ],
    share: 0.3,
    isTried: triedOf({
      company: ["acme", "globex", "hooli"],
      provider: ["greenhouse", "ashby"],
    }),
  });
  const byLabel = new Map(plan.slots.map((slot) => [slot.label, slot]));
  assert.equal(byLabel.get("Acme")?.provider, "lever");
  assert.equal(byLabel.get("Acme")?.mode, "explore");
  assert.equal(byLabel.get("Globex")?.provider, "greenhouse");
  assert.equal(byLabel.get("Globex")?.mode, "exploit");
  // The first board hint names the provider.
  assert.equal(byLabel.get("Hooli")?.provider, "ashby");
  assert.equal(byLabel.get("Hooli")?.mode, "exploit");
  assert.equal(names(plan.companies)[0], "Acme");
});

test("HUNT-W novelty: a company seeded from a career surface is a surface slot keyed by provider and board", () => {
  const plan = planNoveltySlots({
    companies: [
      { name: "Acme", companyKey: "acme", boardHints: { greenhouse: "AcmeBoard" } },
      { name: "Globex", companyKey: "globex", boardHints: { lever: "https://www.Jobs.Lever.co/Globex/?ref=feed" } },
      { name: "Initech", companyKey: "initech", boardHints: { ashby: "initech" } },
      { name: "Hooli" },
    ],
    careerSurfaces: [
      surface("acme", "greenhouse", { boardToken: "AcmeBoard" }),
      surface("globex", "lever", { canonicalUrl: "https://www.Jobs.Lever.co/Globex/?ref=feed" }),
      // Only provider boards seed the ATS lane.
      surface("initech", "ashby", { canonicalUrl: "https://initech.example/careers" }, "employer_careers"),
    ],
    share: 0.3,
    isTried: triedOf({
      surface: ["greenhouse:acmeboard"],
      company: ["initech", "hooli"],
      provider: ["greenhouse", "lever", "ashby"],
    }),
  });
  assert.deepEqual(
    plan.slots.map((slot) => [slot.label, slot.kind, slot.key, slot.provider, slot.mode]),
    [
      ["Globex", "surface", "lever:jobs.lever.co/globex", "lever", "explore"],
      ["Acme", "surface", "greenhouse:acmeboard", "greenhouse", "exploit"],
      ["Initech", "company", "initech", "ashby", "exploit"],
      ["Hooli", "company", "hooli", undefined, "exploit"],
    ],
  );
});

test("HUNT-W novelty: keepOrder marks the slots without moving or adding companies", () => {
  const plan = planNoveltySlots({
    companies: named("Acme", "Globex", "Initech"),
    candidates: [candidate("Fresh Co")],
    share: 0.3,
    isTried: triedOf({ company: ["acme", "initech"] }),
    keepOrder: true,
  });
  assert.equal(plan.reservedSlots, 1);
  assert.deepEqual(names(plan.companies), ["Acme", "Globex", "Initech"]);
  assert.deepEqual(plan.slots.map((slot) => slot.mode), ["exploit", "explore", "exploit"]);
});

test("HUNT-W novelty: the facet combination is one more slot after the ATS slots", () => {
  const facet = { key: "intent:abc", label: "Backend Engineer, node" };
  const fresh = planNoveltySlots({
    companies: named("Acme"),
    share: 0.3,
    isTried: triedOf({ company: ["acme"] }),
    facet,
  });
  assert.deepEqual(fresh.slots.at(-1), {
    index: 1,
    kind: "facet",
    key: "intent:abc",
    label: "Backend Engineer, node",
    mode: "explore",
    listingsSeen: 0,
    leadsWritten: 0,
  });
  const repeat = planNoveltySlots({
    companies: [],
    share: 0.3,
    isTried: triedOf({ facet: ["intent:abc"] }),
    facet,
  });
  assert.equal(repeat.reservedSlots, 1);
  assert.deepEqual(
    repeat.slots.map((slot) => [slot.index, slot.kind, slot.mode]),
    [[0, "facet", "exploit"]],
  );
});

test("HUNT-W novelty: yields fill per slot and totals split explore from exploit without the facet", () => {
  const plan = planNoveltySlots({
    companies: [{ name: "Scale AI", companyKey: "scale-ai" }, { name: "Acme" }],
    share: 0.3,
    isTried: triedOf({ company: ["scaleai"] }),
    facet: { key: "intent:abc", label: "Backend" },
  });
  const summary = summarizeNoveltyYield(plan, {
    listingsSeenByCompany: new Map([["scaleai", 5], ["acme", 3], ["other", 9]]),
    leadsWrittenByCompany: new Map([["scaleai", 2], ["acme", 1]]),
    totalListingsSeen: 17,
    totalLeadsWritten: 4,
  });
  assert.deepEqual(
    summary.slots.map((slot) => [slot.label, slot.mode, slot.listingsSeen, slot.leadsWritten]),
    [
      ["Acme", "explore", 3, 1],
      ["Scale AI", "exploit", 5, 2],
      // The facet slot carries the whole run.
      ["Backend", "explore", 17, 4],
    ],
  );
  assert.deepEqual(summary.exploration, {
    share: 0.3,
    reservedSlots: 1,
    slotCount: 2,
    slots: summary.slots,
    totals: {
      explore: { slots: 1, listingsSeen: 3, leadsWritten: 1 },
      exploit: { slots: 1, listingsSeen: 5, leadsWritten: 2 },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(summary.exploration)), summary.exploration);
});

test("HUNT-W novelty: lifecycle.exploration holds at most 200 slots and keeps the facet slot", () => {
  const companies = named(...Array.from({ length: 250 }, (_, index) => `Co ${index}`));
  const plan = planNoveltySlots({
    companies,
    share: 0.3,
    isTried: () => true,
    facet: { key: "intent:abc", label: "Backend" },
  });
  const summary = summarizeNoveltyYield(plan, {
    listingsSeenByCompany: new Map(),
    leadsWrittenByCompany: new Map(),
    totalListingsSeen: 0,
    totalLeadsWritten: 0,
  });
  assert.equal(MAX_EXPLORATION_SLOTS, 200);
  assert.equal(summary.slots.length, 251, "the ledger still gets every slot");
  assert.equal(summary.exploration.slotCount, 250);
  assert.equal(summary.exploration.slots.length, 200);
  assert.equal(summary.exploration.slots.at(-1)?.kind, "facet");
  assert.equal(summary.exploration.totals.exploit.slots, 250);
});
