// DISCAT C2 (D6, D7): steer the ATS lane by past yield and list each board
// once per run. Pure helpers; run-discovery.ts wires them into the loop.
import type {
  AtsSourceId,
  CompanyTarget,
  DetectionResult,
  IntentCoverageRecord,
} from "../contracts.ts";
import { normalizeCompanyKey } from "../discovery/company-keys.ts";

/** Most recent intent_coverage rows per company that feed its yield. */
export const ATS_YIELD_HISTORY_ROWS = 10;
/** Cooldown: a company needs at least this many distinct runs of history. */
export const ATS_COOLDOWN_MIN_RUNS = 2;
/** Cooldown: and at least this many listings seen across that history. */
export const ATS_COOLDOWN_MIN_LISTINGS_SEEN = 150;
/** Cooldown: skip window, measured from the company's last tried run. */
export const ATS_COOLDOWN_DAYS = 7;
/** Cooled companies still admitted per run, oldest-last-tried first. */
export const ATS_EXPLORATION_SLOTS = 1;
/** A company with no history scores this fraction of the mean known yield. */
export const ATS_UNKNOWN_YIELD_PRIOR_FACTOR = 0.5;
/** Stand-in mean yield when no company has a positive known yield. */
export const ATS_UNKNOWN_YIELD_FALLBACK_MEAN = 0.01;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CompanyYieldStats {
  /** Distinct run ids across the rows read. */
  runs: number;
  listingsSeen: number;
  listingsWritten: number;
  /** Listings that passed the filters (eligible, whether or not written). */
  listingsAccepted: number;
  /** listingsWritten / listingsSeen (0 when nothing was seen). */
  yield: number;
  /** Latest startedAt among the rows read; "" when none carried one. */
  lastTriedAt: string;
}

/**
 * Per-company write yield from intent coverage, aggregated over each
 * company's most recent `maxRows` rows (newest first by startedAt; rows
 * without a timestamp keep their snapshot order after dated ones). Keys
 * are normalizeCompanyKey form, so "scale-ai" and "scaleai" share a row.
 * Rows from every intent key count: the snapshot carries a company's
 * history across query rotations.
 */
export function buildCompanyYieldStats(
  coverage: readonly IntentCoverageRecord[],
  maxRows: number = ATS_YIELD_HISTORY_ROWS,
): Map<string, CompanyYieldStats> {
  const ordered = coverage
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const byTime = String(right.row.startedAt || "").localeCompare(
        String(left.row.startedAt || ""),
      );
      return byTime || left.index - right.index;
    });
  const rowsByCompany = new Map<string, IntentCoverageRecord[]>();
  for (const { row } of ordered) {
    const key = normalizeCompanyKey(row.companyKey);
    if (!key) continue;
    const rows = rowsByCompany.get(key) || [];
    if (rows.length >= maxRows) continue;
    rows.push(row);
    rowsByCompany.set(key, rows);
  }
  const stats = new Map<string, CompanyYieldStats>();
  for (const [key, rows] of rowsByCompany) {
    const runIds = new Set<string>();
    let listingsSeen = 0;
    let listingsWritten = 0;
    let listingsAccepted = 0;
    let lastTriedAt = "";
    rows.forEach((row, index) => {
      runIds.add(String(row.runId || "") || `row:${index}`);
      listingsSeen += Math.max(0, Number(row.listingsSeen) || 0);
      listingsWritten += Math.max(0, Number(row.listingsWritten) || 0);
      listingsAccepted += Math.max(0, Number(row.listingsAccepted) || 0);
      const startedAt = String(row.startedAt || "");
      if (startedAt > lastTriedAt) lastTriedAt = startedAt;
    });
    stats.set(key, {
      runs: runIds.size,
      listingsSeen,
      listingsWritten,
      listingsAccepted,
      yield: listingsSeen > 0 ? listingsWritten / listingsSeen : 0,
      lastTriedAt,
    });
  }
  return stats;
}

/** Normalized keys a company can match coverage rows under. */
export function companyYieldKeys(company: CompanyTarget): string[] {
  return [
    ...new Set(
      [company.companyKey, company.name, company.normalizedName]
        .map((value) => normalizeCompanyKey(value))
        .filter(Boolean),
    ),
  ];
}

export function lookupCompanyYield(
  company: CompanyTarget,
  stats: ReadonlyMap<string, CompanyYieldStats>,
): CompanyYieldStats | undefined {
  for (const key of companyYieldKeys(company)) {
    const entry = stats.get(key);
    if (entry) return entry;
  }
  return undefined;
}

/** The normalized key D6 logs and D7 merges a company under. */
export function atsCompanyIdentityKey(company: CompanyTarget): string {
  return normalizeCompanyKey(company.companyKey) || normalizeCompanyKey(company.name);
}

function richness(company: CompanyTarget): number {
  return (
    (company.aliases?.length || 0) +
    (company.domains?.length || 0) +
    (company.geoTags?.length || 0) +
    (company.roleTags?.length || 0) +
    (company.includeKeywords?.length || 0) +
    (company.excludeKeywords?.length || 0) +
    Object.values(company.boardHints || {}).filter(Boolean).length +
    (company.normalizedName ? 1 : 0)
  );
}

function unionList(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  if (!left?.length && !right?.length) return left || right;
  return [...new Set([...(left || []), ...(right || [])])];
}

function mergeHints(
  base: CompanyTarget["boardHints"],
  extra: CompanyTarget["boardHints"],
): CompanyTarget["boardHints"] {
  if (!extra) return base;
  const merged: Partial<Record<AtsSourceId, string>> = { ...(base || {}) };
  for (const [sourceId, hint] of Object.entries(extra) as Array<
    [AtsSourceId, string | undefined]
  >) {
    if (!hint) continue;
    // buildDetectionHints splits on commas, so a merged hint keeps every
    // board the separate targets pointed at.
    const values = [merged[sourceId], hint]
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    merged[sourceId] = [...new Set(values)].join(",");
  }
  return merged;
}

export interface MergedAtsCompanies {
  companies: CompanyTarget[];
  /** Targets folded into an earlier target for the same company. */
  mergedCount: number;
}

/**
 * D7: fold ATS targets for the same company (normalizeCompanyKey of the
 * companyKey, else the name) into one. Memory seeding emits one target per
 * company_registry row and one per career_surfaces row, and detection is
 * name-driven, so each copy used to detect and list the same boards. The
 * richest entry supplies the metadata; lists and board hints are unioned,
 * so two boards of one company both survive. First-seen order is kept.
 */
export function mergeAtsCompanyTargets(
  companies: readonly CompanyTarget[],
): MergedAtsCompanies {
  const slots: Array<CompanyTarget[]> = [];
  const slotByKey = new Map<string, CompanyTarget[]>();
  for (const company of companies) {
    const key = atsCompanyIdentityKey(company);
    const existing = key ? slotByKey.get(key) : undefined;
    if (existing) {
      existing.push(company);
      continue;
    }
    const slot = [company];
    slots.push(slot);
    if (key) slotByKey.set(key, slot);
  }
  let mergedCount = 0;
  const merged = slots.map((group) => {
    mergedCount += group.length - 1;
    const richest = group.reduce((best, company) =>
      richness(company) > richness(best) ? company : best,
    );
    let result: CompanyTarget = { ...richest };
    for (const company of group) {
      if (company === richest) continue;
      result = {
        ...result,
        aliases: unionList(result.aliases, company.aliases),
        domains: unionList(result.domains, company.domains),
        geoTags: unionList(result.geoTags, company.geoTags),
        roleTags: unionList(result.roleTags, company.roleTags),
        boardHints: mergeHints(result.boardHints, company.boardHints),
      };
    }
    return result;
  });
  return { companies: merged, mergedCount };
}

/**
 * D7: the (sourceId, normalized board token) a detection lists, or "" when
 * the detection carries neither a token nor a URL.
 */
export function atsBoardKey(detection: DetectionResult): string {
  const token = String(detection.boardToken || "").trim().toLowerCase();
  if (token) return `${detection.sourceId}:${token}`;
  const url = String(detection.canonicalUrl || detection.boardUrl || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return url ? `${detection.sourceId}:${url}` : "";
}

export interface AtsCompanyPlan {
  /** Companies to search, highest yield first (stable on ties). */
  companies: CompanyTarget[];
  /** Companies skipped this run by the cooldown. */
  cooledDown: CompanyTarget[];
  /** The cooled company let through as this run's exploration slot. */
  explorationAdmitted: CompanyTarget | null;
  /** Score given to companies with no coverage history. */
  priorYield: number;
}

function isCoolingDown(stats: CompanyYieldStats, nowMs: number): boolean {
  if (stats.runs < ATS_COOLDOWN_MIN_RUNS) return false;
  if (stats.listingsSeen < ATS_COOLDOWN_MIN_LISTINGS_SEEN) return false;
  if (stats.listingsWritten > 0) return false;
  // Listings that passed the filters but lost at selection (or were written
  // under another intent's cap) prove the board is on target: never cool it.
  if (stats.listingsAccepted > 0) return false;
  const lastTriedMs = Date.parse(stats.lastTriedAt);
  // No usable timestamp: treat as recent; the exploration slot still
  // rotates it back in.
  if (!Number.isFinite(lastTriedMs)) return true;
  return nowMs - lastTriedMs < ATS_COOLDOWN_DAYS * DAY_MS;
}

/**
 * D6: order ATS companies by written/seen yield and cool down proven
 * zero-yield companies (>= 2 runs, >= 150 seen, nothing written and nothing
 * accepted by the filters). A company with no history scores
 * ATS_UNKNOWN_YIELD_PRIOR_FACTOR x the mean known yield of this list (or of
 * ATS_UNKNOWN_YIELD_FALLBACK_MEAN when no known yield is positive), so new
 * companies rank above proven zeros and below proven producers.
 */
export function planAtsCompanyOrder(
  companies: readonly CompanyTarget[],
  stats: ReadonlyMap<string, CompanyYieldStats>,
  nowMs: number,
): AtsCompanyPlan {
  const entries = companies.map((company, index) => ({
    company,
    index,
    stats: lookupCompanyYield(company, stats),
  }));
  const knownYields = entries.flatMap((entry) =>
    entry.stats ? [entry.stats.yield] : [],
  );
  const meanKnown = knownYields.length
    ? knownYields.reduce((sum, value) => sum + value, 0) / knownYields.length
    : 0;
  const priorYield =
    ATS_UNKNOWN_YIELD_PRIOR_FACTOR *
    (meanKnown > 0 ? meanKnown : ATS_UNKNOWN_YIELD_FALLBACK_MEAN);

  const cooled = entries.filter(
    (entry) => entry.stats !== undefined && isCoolingDown(entry.stats, nowMs),
  );
  const explorers = [...cooled]
    .sort((left, right) => {
      const byAge = (left.stats?.lastTriedAt || "").localeCompare(
        right.stats?.lastTriedAt || "",
      );
      return byAge || left.index - right.index;
    })
    .slice(0, ATS_EXPLORATION_SLOTS);
  const skipped = new Set(
    cooled
      .filter((entry) => !explorers.includes(entry))
      .map((entry) => entry.index),
  );

  const ordered = entries
    .filter((entry) => !skipped.has(entry.index))
    .map((entry) => ({
      ...entry,
      score: entry.stats ? entry.stats.yield : priorYield,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return {
    companies: ordered.map((entry) => entry.company),
    cooledDown: entries
      .filter((entry) => skipped.has(entry.index))
      .map((entry) => entry.company),
    explorationAdmitted: explorers[0]?.company || null,
    priorYield,
  };
}
