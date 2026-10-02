// HOLES HUNT (docs/INTERFACE-HUNTS.md §6): every discovery run reserves a
// share of its ATS company slots for things never tried (companies, career
// surfaces, ATS providers and the run's facet combination) and records each
// slot as explore or exploit with its yield. Pure apart from the injected
// NoveltyMemory; run-discovery.ts wires it into the ATS lane.
import type {
  CareerSurfaceRecord,
  CompanyTarget,
  DiscoveryExplorationSlot,
  DiscoveryExplorationYield,
  DiscoveryMemorySnapshot,
  DiscoveryRunExploration,
} from "../contracts.ts";
import { normalizeCompanyKey } from "../discovery/company-keys.ts";
import { resolveEffectiveCompanyPools } from "../discovery/effective-intent.ts";
import { atsCompanyIdentityKey, companyYieldKeys } from "./ats-yield-steering.ts";

export const DEFAULT_EXPLORATION_SHARE = 0.3;
/** lifecycle.exploration.slots holds at most this many entries (§6). */
export const MAX_EXPLORATION_SLOTS = 200;
/** Candidates read per run: enough that scope filtering cannot starve the reservation. */
const MIN_CANDIDATE_POOL = 50;

const NOVELTY_KINDS = ["company", "surface", "provider", "facet"] as const;
export type NoveltyKind = (typeof NOVELTY_KINDS)[number];

export interface NoveltyCandidate {
  companyKey: string;
  name: string;
  source: "candidate_catalog" | "listing_fingerprints" | "company_registry";
}

export interface NoveltyCandidateQuery {
  sheetId: string;
  now: string;
  limit: number;
  excludeCompanyKeys: readonly string[];
}

export interface NoveltySlotsRecord {
  runId: string;
  recordedAt: string;
  share: number;
  slots: readonly DiscoveryExplorationSlot[];
}

/** The exploration ledger; the raw discovery memory store implements it. */
export interface NoveltyMemory {
  /** The subset of `keys` ever tried as `kind`. */
  listTriedNoveltyKeys(kind: NoveltyKind, keys: readonly string[]): Set<string>;
  /** Never-tried, not-cooling companies the run did not plan, newest first. */
  listNoveltyCandidates(query: NoveltyCandidateQuery): NoveltyCandidate[];
  recordNoveltySlots(input: NoveltySlotsRecord): void;
  listNoveltySlots(runId: string): DiscoveryExplorationSlot[];
}

export interface NoveltyScope {
  companyAllowlist?: readonly string[] | null;
  companyBlocklist?: readonly string[] | null;
  negativeCompanyKeys?: readonly string[] | null;
}

export interface NoveltyPlanInput {
  /** The run's ATS companies, merged (D7) and yield-ordered (D6). */
  companies: readonly CompanyTarget[];
  /** Companies the D6 cooldown skipped this run: never added back. */
  cooledDown?: readonly CompanyTarget[];
  /** Never-tried companies the run did not plan, newest first. */
  candidates?: readonly NoveltyCandidate[];
  /** The run's allow/blocklist: candidates outside it are never added. */
  scope?: NoveltyScope;
  share: number;
  isTried(kind: NoveltyKind, key: string): boolean;
  /** Career surfaces that seeded a target on their own: those run as surface slots. */
  careerSurfaces?: readonly CareerSurfaceRecord[];
  /** The run's facet combination (its intent key): one more slot, after the ATS slots. */
  facet?: { key: string; label: string };
  /** Mark the slots only: no reordering and no candidates. */
  keepOrder?: boolean;
}

export interface NoveltyPlan {
  share: number;
  reservedSlots: number;
  /** The ATS companies in run order. */
  companies: CompanyTarget[];
  /** One slot per company (index = run position), then the facet slot. Yields are 0 until summarized. */
  slots: DiscoveryExplorationSlot[];
  /** Normalized company keys each ATS slot's yield is read under, by slot index. */
  yieldKeys: string[][];
}

export interface NoveltyYieldInput {
  /** Listings seen per normalized company key on the ATS lanes. */
  listingsSeenByCompany: ReadonlyMap<string, number>;
  /** ATS leads the Sheet wrote per normalized company key. */
  leadsWrittenByCompany: ReadonlyMap<string, number>;
  totalListingsSeen: number;
  totalLeadsWritten: number;
}

/** A finite share clamped to [0, 1]; anything else falls back. */
export function resolveExplorationShare(
  value: unknown,
  fallback: number = DEFAULT_EXPLORATION_SHARE,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** §6: reserved = max(1, round(share x slots)), never fewer than one. */
export function reservedExplorationSlots(slotCount: number, share: number): number {
  const slots = Number.isFinite(slotCount) ? Math.max(0, Math.floor(slotCount)) : 0;
  return Math.max(1, Math.round(resolveExplorationShare(share) * slots));
}

/** The facet slot's label: the run's roles, keywords and locations. */
export function noveltyFacetLabel(config: {
  targetRoles?: readonly string[];
  includeKeywords?: readonly string[];
  locations?: readonly string[];
}): string {
  const terms = [
    ...(config.targetRoles || []),
    ...(config.includeKeywords || []),
    ...(config.locations || []),
  ]
    .map((term) => String(term || "").trim())
    .filter(Boolean);
  return [...new Set(terms)].join(", ").slice(0, 120);
}

interface SurfaceBoard {
  key: string;
  provider: string;
}

interface SlotIdentity {
  company: CompanyTarget;
  kind: "company" | "surface";
  key: string;
  label: string;
  /** "" when the target carries no board hint. */
  provider: string;
  yieldKeys: string[];
  explore: boolean;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** provider:board, a board URL reduced the way atsBoardKey reduces one. */
function surfaceSlotKey(provider: string, board: string): string {
  const reduced = board
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return `${provider}:${reduced}`;
}

/** The provider boards the ATS lane seeds from, by company: the first board wins. */
function buildSurfaceBoards(
  surfaces: readonly CareerSurfaceRecord[],
): Map<string, SurfaceBoard> {
  const boards = new Map<string, SurfaceBoard>();
  for (const surface of surfaces) {
    const companyKey = normalizeCompanyKey(surface.companyKey);
    const board = String(surface.boardToken || surface.canonicalUrl || "").trim();
    if (surface.surfaceType !== "provider_board" || !surface.providerType) continue;
    if (!board || !companyKey || boards.has(companyKey)) continue;
    boards.set(companyKey, {
      key: surfaceSlotKey(surface.providerType, board),
      provider: surface.providerType,
    });
  }
  return boards;
}

function firstHintProvider(company: CompanyTarget): string {
  const hints = Object.entries(company.boardHints || {});
  return hints.find(([, hint]) => Boolean(hint))?.[0] || "";
}

/**
 * A slot explores when its company or surface key, or its ATS provider,
 * was never tried. A company counts as tried under any of its yield keys.
 */
function identifySlot(
  company: CompanyTarget,
  boards: ReadonlyMap<string, SurfaceBoard>,
  isTried: NoveltyPlanInput["isTried"],
): SlotIdentity {
  const yieldKeys = companyYieldKeys(company);
  const board = boards.get(atsCompanyIdentityKey(company));
  const provider = board?.provider || firstHintProvider(company);
  const keyTried = board
    ? isTried("surface", board.key)
    : yieldKeys.some((key) => isTried("company", key));
  return {
    company,
    kind: board ? "surface" : "company",
    key: board?.key || normalizeCompanyKey(company.name) || atsCompanyIdentityKey(company),
    label: String(company.name || "").trim() || yieldKeys[0] || "",
    provider,
    yieldKeys,
    explore: !keyTried || (provider !== "" && !isTried("provider", provider)),
  };
}

function isInScope(company: CompanyTarget, scope: NoveltyScope | undefined): boolean {
  if (!scope) return true;
  return (
    resolveEffectiveCompanyPools({
      companies: [company],
      companyAllowlist: scope.companyAllowlist,
      companyBlocklist: scope.companyBlocklist,
      negativeCompanyKeys: scope.negativeCompanyKeys,
    }).companies.length > 0
  );
}

/** Never-tried candidates the run may add: not planned, not cooled down, in scope, deduped. */
function admitCandidates(input: NoveltyPlanInput, wanted: number): CompanyTarget[] {
  if (wanted <= 0) return [];
  const taken = new Set(
    [...input.companies, ...(input.cooledDown || [])].flatMap(companyYieldKeys),
  );
  const admitted: CompanyTarget[] = [];
  for (const candidate of input.candidates || []) {
    if (admitted.length >= wanted) break;
    const company: CompanyTarget = {
      name: candidate.name || candidate.companyKey,
      companyKey: candidate.companyKey,
    };
    const keys = companyYieldKeys(company);
    if (keys.length === 0) continue;
    if (keys.some((key) => taken.has(key) || input.isTried("company", key))) continue;
    if (!isInScope(company, input.scope)) continue;
    for (const key of keys) taken.add(key);
    admitted.push(company);
  }
  return admitted;
}

/** Explore picks run at 0, then about every 1/share positions; the rest keep their order. */
function spreadPicks<T>(picks: readonly T[], rest: readonly T[], share: number): T[] {
  const order: T[] = [];
  let pick = 0;
  let next = 0;
  while (pick < picks.length || next < rest.length) {
    const due = pick === 0 ? 0 : Math.round(pick / share);
    if (pick < picks.length && (next >= rest.length || order.length >= due)) {
      order.push(picks[pick++]);
    } else {
      order.push(rest[next++]);
    }
  }
  return order;
}

/**
 * Reserve max(1, round(share x planned)) slots for exploration. Never-tried
 * planned companies are the first picks, in list order; never-tried
 * candidates fill the rest. Picks are spread from position 0 so they run
 * before the low-yield tail; every planned company still runs, and the
 * others keep their relative order.
 */
export function planNoveltySlots(input: NoveltyPlanInput): NoveltyPlan {
  const share = resolveExplorationShare(input.share);
  const reservedSlots = reservedExplorationSlots(input.companies.length, share);
  const boards = buildSurfaceBoards(input.careerSurfaces || []);
  const identify = (company: CompanyTarget) => identifySlot(company, boards, input.isTried);
  const planned = input.companies.map(identify);
  let order = planned;
  if (!input.keepOrder) {
    const picks = planned.filter((entry) => entry.explore).slice(0, reservedSlots);
    picks.push(...admitCandidates(input, reservedSlots - picks.length).map(identify));
    const picked = new Set(picks);
    order = spreadPicks(picks, planned.filter((entry) => !picked.has(entry)), share);
  }
  const slots: DiscoveryExplorationSlot[] = order.map((entry, index) => ({
    index,
    kind: entry.kind,
    key: entry.key,
    label: entry.label,
    ...(entry.provider ? { provider: entry.provider } : {}),
    mode: entry.explore ? "explore" : "exploit",
    listingsSeen: 0,
    leadsWritten: 0,
  }));
  if (input.facet) {
    slots.push({
      index: slots.length,
      kind: "facet",
      key: input.facet.key,
      label: input.facet.label || input.facet.key,
      mode: input.isTried("facet", input.facet.key) ? "exploit" : "explore",
      listingsSeen: 0,
      leadsWritten: 0,
    });
  }
  return {
    share,
    reservedSlots,
    companies: order.map((entry) => entry.company),
    slots,
    yieldKeys: order.map((entry) => entry.yieldKeys),
  };
}

function emptyYield(): DiscoveryExplorationYield {
  return { slots: 0, listingsSeen: 0, leadsWritten: 0 };
}

/**
 * Fill each slot's yield and build lifecycle.exploration. `slots` (for the
 * ledger) keeps every slot; the lifecycle copy keeps at most 200, the facet
 * slot always among them. The facet slot carries the whole run, so the
 * explore/exploit totals leave it out rather than count the run twice.
 */
export function summarizeNoveltyYield(
  plan: NoveltyPlan,
  input: NoveltyYieldInput,
): { slots: DiscoveryExplorationSlot[]; exploration: DiscoveryRunExploration } {
  const sum = (counts: ReadonlyMap<string, number>, keys: readonly string[]) =>
    keys.reduce((total, key) => total + (counts.get(key) || 0), 0);
  const slots = plan.slots.map((slot): DiscoveryExplorationSlot => {
    if (slot.kind === "facet") {
      return {
        ...slot,
        listingsSeen: input.totalListingsSeen,
        leadsWritten: input.totalLeadsWritten,
      };
    }
    const keys = plan.yieldKeys[slot.index] || [];
    return {
      ...slot,
      listingsSeen: sum(input.listingsSeenByCompany, keys),
      leadsWritten: sum(input.leadsWrittenByCompany, keys),
    };
  });
  const atsSlots = slots.filter((slot) => slot.kind !== "facet");
  const facetSlots = slots.filter((slot) => slot.kind === "facet");
  const totals = { explore: emptyYield(), exploit: emptyYield() };
  for (const slot of atsSlots) {
    const bucket = totals[slot.mode];
    bucket.slots += 1;
    bucket.listingsSeen += slot.listingsSeen;
    bucket.leadsWritten += slot.leadsWritten;
  }
  return {
    slots,
    exploration: {
      share: plan.share,
      reservedSlots: plan.reservedSlots,
      slotCount: atsSlots.length,
      slots: [
        ...atsSlots.slice(0, MAX_EXPLORATION_SLOTS - facetSlots.length),
        ...facetSlots,
      ],
      totals,
    },
  };
}

export interface RunNoveltyInput {
  memory?: NoveltyMemory | null;
  companies: readonly CompanyTarget[];
  cooledDown: readonly CompanyTarget[];
  /** The run's configured ATS companies: never surface slots. */
  configuredCompanies: readonly CompanyTarget[];
  snapshot: DiscoveryMemorySnapshot | null;
  share: number;
  sheetId: string;
  now: string;
  facet: { key: string; label: string };
  scope: NoveltyScope;
  /** Without ATS lanes, reserve the facet only; never admit ATS candidates. */
  atsEnabled?: boolean;
}

/**
 * Plan one run's slots. With the ledger, tried checks and candidates come
 * from memory. Without it the run keeps its order and adds nothing: the
 * snapshot's intent coverage judges companies and the facet, and surfaces
 * and providers count as tried because nothing shows they are new.
 */
export function planRunNovelty(input: RunNoveltyInput): NoveltyPlan {
  // A surface makes a surface slot only when it seeded its target alone, so
  // a configured or registry company keeps one stable key once its boards
  // are known.
  const seeded = new Set([
    ...input.configuredCompanies.map(atsCompanyIdentityKey),
    ...(input.snapshot?.companies || []).map((company) =>
      normalizeCompanyKey(company.companyKey),
    ),
  ]);
  const careerSurfaces = (input.snapshot?.careerSurfaces || []).filter(
    (surface) => !seeded.has(normalizeCompanyKey(surface.companyKey)),
  );
  const base = {
    companies: input.companies,
    cooledDown: input.cooledDown,
    scope: input.scope,
    share: input.share,
    careerSurfaces,
    facet: input.facet,
  };
  const memory = input.memory;
  if (!memory) {
    const coverage = input.snapshot?.intentCoverage || [];
    const companies = new Set(coverage.map((row) => normalizeCompanyKey(row.companyKey)));
    const intents = new Set(coverage.map((row) => row.intentKey));
    return planNoveltySlots({
      ...base,
      keepOrder: true,
      isTried: (kind, key) =>
        kind === "company" ? companies.has(key) : kind === "facet" ? intents.has(key) : true,
    });
  }
  // One ledger read per kind, covering every key a planned slot is judged by.
  const boards = [...buildSurfaceBoards(careerSurfaces).values()];
  const lookups: Record<NoveltyKind, string[]> = {
    company: input.companies.flatMap(companyYieldKeys),
    surface: boards.map((board) => board.key),
    provider: [
      ...input.companies.map(firstHintProvider),
      ...boards.map((board) => board.provider),
    ],
    facet: [input.facet.key],
  };
  const tried = new Map<NoveltyKind, Set<string>>();
  for (const kind of NOVELTY_KINDS) {
    tried.set(kind, memory.listTriedNoveltyKeys(kind, unique(lookups[kind])));
  }
  const reserved = reservedExplorationSlots(input.companies.length, input.share);
  const candidates = input.atsEnabled === false ? [] : memory.listNoveltyCandidates({
    sheetId: input.sheetId,
    now: input.now,
    limit: Math.max(MIN_CANDIDATE_POOL, reserved * 4),
    excludeCompanyKeys: unique(
      [...input.companies, ...input.cooledDown].flatMap(companyYieldKeys),
    ),
  });
  return planNoveltySlots({
    ...base,
    candidates,
    keepOrder: input.atsEnabled === false,
    isTried: (kind, key) => tried.get(kind)?.has(key) === true,
  });
}
