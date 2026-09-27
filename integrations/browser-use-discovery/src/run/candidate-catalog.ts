import type {
  CandidateCatalogEntry,
  CandidateCatalogStatus,
  DiscoveryMemoryStore,
  ListingFingerprintRecord,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
} from "../contracts.ts";
import type { UserProfile } from "../contracts/user-profile.ts";
import {
  findMatchedKeywords,
  normalizeLeadUrl,
} from "../normalize/lead-normalizer.ts";
import { runPreFilter } from "../normalize/profile-aware-scorer.ts";
import { compareNormalizedLeads } from "./lead-ranking.ts";
import { normalizeCompanyKey } from "../discovery/company-keys.ts";
import {
  computeListingFingerprint,
  type ListingFingerprint,
} from "../discovery/listing-fingerprint.ts";

/**
 * DISCAT C1: the per-run candidate ledger. Every drop point of the funnel
 * (normalization rejection, dedupe, company scope, the write cap) reports
 * here, and the run persists one catalog row per unique listing at the end.
 */

export type RejectedCandidate = {
  sourceId: string;
  listing: RawListing;
  reason: string;
  detail: string;
};

/** D3: backlog rows older than this are not promoted. */
export const BACKLOG_PROMOTION_MAX_AGE_DAYS = 14;
/**
 * Fix-A: a backlog lead whose known fit score (1-10) is below this never
 * promotes; a lead without a fit score stays eligible and ranks last. Fresh
 * selection ranks by fit but has no low-fit cutoff of its own, so this is
 * the fallback floor.
 */
export const BACKLOG_MIN_FIT_SCORE = 5;
/**
 * A backlog row keeps this much of the posting's description so promotion
 * can re-run the description-based hard constraints (work authorization).
 */
export const BACKLOG_DESCRIPTION_MAX_CHARS = 4000;
/** Promotion reads the backlog in pages and stops after this many rows. */
export const BACKLOG_MAX_EXAMINED_ROWS = 500;

type CatalogLog = (event: string, details: Record<string, unknown>) => void;

// Within one run a key can hit several drop points (rejected on one source,
// kept on another). The most advanced fate wins.
const WITHIN_RUN_PRIORITY: Record<CandidateCatalogStatus, number> = {
  rejected: 1,
  expired: 1,
  duplicate: 2,
  backlog: 3,
  promoted: 4,
  written: 4,
};

type LedgerItem = {
  entry: CandidateCatalogEntry;
  fingerprint: ListingFingerprint;
  sourceIds: Set<string>;
};

export type RunCandidateLedger = {
  addRejected(candidate: RejectedCandidate): void;
  /**
   * Remembers a qualified lead's posting description (bounded) so a backlog
   * row can carry it. Keyed by the lead's normalized URL, which survives
   * dedupe merges and re-spreads of the lead object.
   */
  noteDescription(lead: NormalizedLead, descriptionText: string | undefined): void;
  addLeads(
    leads: NormalizedLead[],
    status: CandidateCatalogStatus,
    rejectReason?: string,
  ): void;
  entries(): CandidateCatalogEntry[];
  fingerprintRecords(input: {
    runId: string;
    sheetId: string;
    observedAt: string;
  }): ListingFingerprintRecord[];
};

export function leadFingerprintKey(lead: NormalizedLead): string {
  return computeListingFingerprint(lead).fingerprintKey;
}

function descriptionKey(lead: NormalizedLead): string {
  return normalizeLeadUrl(lead.url || "") || String(lead.url || "");
}

export function createRunCandidateLedger(): RunCandidateLedger {
  const items = new Map<string, LedgerItem>();
  const descriptions = new Map<string, string>();

  const add = (
    fingerprint: ListingFingerprint,
    sourceId: string,
    entry: Omit<CandidateCatalogEntry, "fingerprintKey">,
  ) => {
    const key = fingerprint.fingerprintKey;
    if (!key) return;
    const existing = items.get(key);
    if (existing) {
      existing.sourceIds.add(sourceId);
      if (
        WITHIN_RUN_PRIORITY[entry.status] <
        WITHIN_RUN_PRIORITY[existing.entry.status]
      ) {
        return;
      }
    }
    items.set(key, {
      entry: { fingerprintKey: key, ...entry },
      fingerprint,
      sourceIds: new Set([...(existing?.sourceIds || []), sourceId]),
    });
  };

  return {
    noteDescription(lead, descriptionText) {
      const key = descriptionKey(lead);
      const text = String(descriptionText || "").trim();
      if (!key || !text || descriptions.has(key)) return;
      descriptions.set(key, text.slice(0, BACKLOG_DESCRIPTION_MAX_CHARS));
    },

    addRejected(candidate) {
      const { listing } = candidate;
      add(computeListingFingerprint(listing), candidate.sourceId, {
        companyKey: normalizeCompanyKey(listing.company || ""),
        title: String(listing.title || "").trim(),
        url: String(listing.url || "").trim(),
        sourceId: candidate.sourceId,
        status: "rejected",
        rejectReason: candidate.reason,
        rejectDetail: String(candidate.detail || ""),
        fitScore: null,
        matchScore: null,
        leadPayload: null,
      });
    },

    addLeads(leads, status, rejectReason = "") {
      for (const lead of leads) {
        add(computeListingFingerprint(lead), lead.sourceId, {
          companyKey: normalizeCompanyKey(lead.company || ""),
          title: lead.title,
          url: lead.url,
          sourceId: lead.sourceId,
          status,
          rejectReason,
          rejectDetail: "",
          fitScore: finiteOrNull(lead.fitScore),
          matchScore: finiteOrNull(lead.matchScore),
          leadPayload:
            status === "backlog" ? backlogPayload(lead, descriptions.get(descriptionKey(lead))) : null,
        });
      }
    },

    entries() {
      return [...items.values()].map((item) => item.entry);
    },

    fingerprintRecords({ runId, sheetId, observedAt }) {
      const records: ListingFingerprintRecord[] = [];
      for (const item of items.values()) {
        const { fingerprint, entry } = item;
        if (!fingerprint.companyKey || !fingerprint.titleKey) continue;
        const written = entry.status === "written" || entry.status === "promoted";
        records.push({
          fingerprintKey: fingerprint.fingerprintKey,
          companyKey: fingerprint.companyKey,
          titleKey: fingerprint.titleKey,
          locationKey: fingerprint.locationKey,
          canonicalUrlKey: fingerprint.canonicalUrlKey,
          externalJobId: fingerprint.providerJobKey,
          remoteBucket: fingerprint.remoteBucket,
          employmentType: "",
          semanticKey: fingerprint.semanticKey,
          contentHash: fingerprint.contentHash,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          lastWrittenAt: written ? observedAt : "",
          lastRunId: runId,
          lastSheetId: sheetId,
          writeCount: written ? 1 : 0,
          sourceIdsJson: JSON.stringify([...item.sourceIds].filter(Boolean)),
        });
      }
      return records;
    },
  };
}

/** The stored backlog payload: the lead plus its bounded description. */
function backlogPayload(
  lead: NormalizedLead,
  descriptionText: string | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...lead };
  if (descriptionText) payload.descriptionText = descriptionText;
  return payload;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isNormalizedLeadPayload(value: unknown): value is NormalizedLead {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.title === "string" &&
    typeof record.company === "string" &&
    typeof record.url === "string" &&
    typeof record.sourceId === "string" &&
    Boolean(record.metadata) &&
    typeof record.metadata === "object"
  );
}

/** A selected lead's fate once the Pipeline writer has run. */
export type LeadWriteFate = {
  status: Extract<CandidateCatalogStatus, "written" | "rejected" | "duplicate" | "backlog">;
  reason: string;
};

const SHEET_SKIP_FATES: Record<string, LeadWriteFate> = {
  blacklisted: { status: "rejected", reason: "sheet_blacklisted" },
  duplicate: { status: "duplicate", reason: "sheet_duplicate" },
  identity_collision: { status: "duplicate", reason: "sheet_identity_collision" },
};

/**
 * Maps each lead offered to the Pipeline writer to what the Sheet actually
 * did with it. A writer that reports per-lead fate (writtenLinks /
 * skippedLinks) is followed link by link; a lead it neither wrote nor
 * skipped (a failed append, a row that moved) stays backlog for a retry.
 * A writer without per-lead fate falls back to all-or-nothing on writeError.
 */
export function resolveLeadWriteFates(
  leads: readonly NormalizedLead[],
  writeResult: PipelineWriteResult,
): Map<NormalizedLead, LeadWriteFate> {
  const fates = new Map<NormalizedLead, LeadWriteFate>();
  const backlog: LeadWriteFate = { status: "backlog", reason: "" };
  if (!Array.isArray(writeResult.writtenLinks)) {
    const fate: LeadWriteFate = writeResult.writeError
      ? backlog
      : { status: "written", reason: "" };
    for (const lead of leads) fates.set(lead, fate);
    return fates;
  }
  const written = new Set(writeResult.writtenLinks);
  const skipped = new Map<string, LeadWriteFate>();
  for (const entry of writeResult.skippedLinks || []) {
    const fate = SHEET_SKIP_FATES[entry.reason];
    if (fate && !skipped.has(entry.url)) skipped.set(entry.url, fate);
  }
  for (const lead of leads) {
    const link = normalizeLeadUrl(lead.url || "");
    if (link && written.has(link)) {
      fates.set(lead, { status: "written", reason: "" });
    } else {
      fates.set(lead, (link && skipped.get(link)) || backlog);
    }
  }
  return fates;
}

export type BacklogPromotion = {
  leads: NormalizedLead[];
  fingerprintKeys: string[];
};

/**
 * D3: fill `slots` free write slots from this sheet's backlog (last seen
 * within 14 days), skipping every key this run already holds. Only rows
 * saved under the run's own intent key are eligible. Each candidate is
 * revalidated before it is promoted: its title against today's exclude
 * keywords, the listing against the current profile's hard-constraint
 * prefilter, and its URL against the dead-link cache. A row whose known fit
 * score is in the low band never promotes. Survivors are ranked with the
 * same comparator as fresh selection (fit first, unknown fit last). The
 * backlog is read in pages until the slots fill or it runs out, examining
 * at most BACKLOG_MAX_EXAMINED_ROWS rows. Failures are logged and yield no
 * promotion.
 */
export async function selectBacklogPromotions(input: {
  store: DiscoveryMemoryStore | null | undefined;
  runId: string;
  sheetId: string;
  /** The current run's stable intent key; required for any promotion. */
  intentKey: string;
  /** The exclude keywords that apply to a lead now (global plus its company's). */
  excludeKeywordsFor?: (lead: NormalizedLead) => string[];
  /** The run's current user profile; its prefilter re-runs on every candidate. */
  userProfile?: UserProfile | null;
  now: string;
  slots: number;
  excludeFingerprintKeys: Iterable<string>;
  accept?: (lead: NormalizedLead) => boolean;
  log?: CatalogLog;
}): Promise<BacklogPromotion> {
  const empty: BacklogPromotion = { leads: [], fingerprintKeys: [] };
  const listBacklog = input.store?.listBacklogCandidates?.bind(input.store);
  if (!listBacklog || input.slots <= 0 || !input.sheetId || !input.intentKey) {
    return empty;
  }
  const isDeadLink = input.store?.isDeadLinkCoolingDown?.bind(input.store);
  try {
    const seenSince = new Date(
      Date.parse(input.now) - BACKLOG_PROMOTION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const excluded = new Set(input.excludeFingerprintKeys);
    const skipped: Record<string, number> = {};
    const skip = (reason: string) => {
      skipped[reason] = (skipped[reason] || 0) + 1;
    };
    // The description-based work-auth check needs the stored description; an
    // older row without one cannot be revalidated for this profile.
    const needsDescription =
      input.userProfile?.hardConstraints?.workAuth === "needs_sponsorship";
    const eligible: Array<{ lead: NormalizedLead; fingerprintKey: string }> = [];
    // Rows the run's own filters drop must not starve the slots, so the
    // backlog is read page by page (each page excludes every row already
    // examined) until the slots fill, the backlog runs out, or the cap hits.
    const pageSize = Math.max(input.slots * 3, 1);
    let considered = 0;
    while (eligible.length < input.slots && considered < BACKLOG_MAX_EXAMINED_ROWS) {
      const limit = Math.min(pageSize, BACKLOG_MAX_EXAMINED_ROWS - considered);
      const rows = await listBacklog({
        sheetId: input.sheetId,
        intentKey: input.intentKey,
        seenSince,
        excludeFingerprintKeys: [...excluded],
        minFitScore: BACKLOG_MIN_FIT_SCORE,
        limit,
      });
      const fresh = rows.filter((row) => !excluded.has(row.fingerprintKey));
      if (fresh.length === 0) break;
      for (const row of fresh) {
        excluded.add(row.fingerprintKey);
        considered += 1;
        if (!isNormalizedLeadPayload(row.leadPayload)) continue;
        const { descriptionText, ...stored } = row.leadPayload as NormalizedLead & {
          descriptionText?: unknown;
        };
        const lead = stored as NormalizedLead;
        const description = typeof descriptionText === "string" ? descriptionText : "";
        if (typeof lead.fitScore === "number" && lead.fitScore < BACKLOG_MIN_FIT_SCORE) {
          skip("low_fit");
          continue;
        }
        if (input.accept && !input.accept(lead)) continue;
        const excludeKeywords = input.excludeKeywordsFor?.(lead) || [];
        if (
          excludeKeywords.length > 0 &&
          findMatchedKeywords(String(lead.title || ""), excludeKeywords).length > 0
        ) {
          continue;
        }
        if (input.userProfile) {
          if (needsDescription && !description) {
            skip("work_auth_unverifiable");
            continue;
          }
          const preFilter = runPreFilter(
            backlogLeadAsListing(lead, description),
            input.userProfile,
          );
          if (!preFilter.pass) {
            skip(preFilter.reason);
            continue;
          }
        }
        if (isDeadLink && (await isDeadLink(lead.url, input.now))) {
          skip("dead_link");
          continue;
        }
        eligible.push({ lead, fingerprintKey: row.fingerprintKey });
      }
      // A short page means the backlog is exhausted.
      if (rows.length < limit) break;
    }
    if (Object.keys(skipped).length > 0) {
      input.log?.("discovery.run.backlog_revalidated", {
        runId: input.runId,
        sheetId: input.sheetId,
        considered,
        eligible: eligible.length,
        skipped,
      });
    }
    const chosen = eligible
      .sort((left, right) => compareNormalizedLeads(left.lead, right.lead))
      .slice(0, input.slots);
    return {
      leads: chosen.map((entry) => entry.lead),
      fingerprintKeys: chosen.map((entry) => entry.fingerprintKey),
    };
  } catch (error) {
    input.log?.("discovery.run.catalog_failed", {
      runId: input.runId,
      phase: "backlog_promotion",
      error: formatError(error),
    });
    return empty;
  }
}

/**
 * The listing shape the profile prefilter reads, rebuilt from a stored lead
 * and the bounded description saved with it. The lead's remote bucket was
 * inferred from the full posting when it was normalized.
 */
function backlogLeadAsListing(lead: NormalizedLead, descriptionText: string): RawListing {
  return {
    sourceId: lead.sourceId as RawListing["sourceId"],
    sourceLabel: String(lead.sourceLabel || ""),
    title: String(lead.title || ""),
    company: String(lead.company || ""),
    location: String(lead.location || ""),
    url: String(lead.url || ""),
    compensationText: String(lead.compensationText || ""),
    remoteBucket: lead.metadata?.remoteBucket,
    ...(descriptionText ? { descriptionText } : {}),
  };
}

/**
 * Fix-A: the subset of `leads` this sheet already wrote or promoted, by
 * listing fingerprint. Best-effort: a store without the lookup, or one that
 * throws, treats every lead as novel.
 */
export async function findPreviouslyWrittenLeads(input: {
  store: DiscoveryMemoryStore | null | undefined;
  runId: string;
  sheetId: string;
  leads: readonly NormalizedLead[];
  log?: CatalogLog;
}): Promise<Set<NormalizedLead>> {
  const lookup = input.store?.listWrittenCandidateKeys?.bind(input.store);
  if (!lookup || !input.sheetId || input.leads.length === 0) return new Set();
  try {
    const keyed = input.leads.map((lead) => ({ lead, key: leadFingerprintKey(lead) }));
    const written = new Set(
      await lookup({
        sheetId: input.sheetId,
        fingerprintKeys: keyed.map((entry) => entry.key).filter(Boolean),
      }),
    );
    return new Set(
      keyed.filter((entry) => written.has(entry.key)).map((entry) => entry.lead),
    );
  } catch (error) {
    input.log?.("discovery.run.catalog_failed", {
      runId: input.runId,
      phase: "novelty_lookup",
      error: formatError(error),
    });
    return new Set();
  }
}

/**
 * Persists the run's ledger: catalog rows, listing fingerprints, promoted
 * backlog, then retention (D4). Every step is best-effort; a failure logs
 * `discovery.run.catalog_failed` and never fails the run.
 */
export async function persistRunCandidateCatalog(input: {
  store: DiscoveryMemoryStore | null | undefined;
  ledger: RunCandidateLedger;
  runId: string;
  sheetId: string;
  intentKey?: string;
  observedAt: string;
  promotedKeys: string[];
  log?: CatalogLog;
}): Promise<void> {
  const { store, ledger, runId, sheetId, observedAt, log } = input;
  if (!store || !sheetId) return;
  const step = async (phase: string, fn: () => unknown): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      log?.("discovery.run.catalog_failed", {
        runId,
        phase,
        error: formatError(error),
      });
    }
  };

  let recorded = 0;
  if (store.recordCandidateCatalog) {
    await step("record", async () => {
      const result = await store.recordCandidateCatalog?.({
        runId,
        sheetId,
        intentKey: input.intentKey || "",
        observedAt,
        entries: ledger.entries(),
      });
      recorded = result?.recorded || 0;
    });
  }
  if (store.upsertListingFingerprints) {
    await step("listing_fingerprints", () =>
      store.upsertListingFingerprints?.(
        ledger.fingerprintRecords({ runId, sheetId, observedAt }),
      ),
    );
  }
  if (store.markCandidatesPromoted && input.promotedKeys.length > 0) {
    await step("mark_promoted", () =>
      store.markCandidatesPromoted?.({
        sheetId,
        runId,
        promotedAt: observedAt,
        fingerprintKeys: input.promotedKeys,
      }),
    );
  }
  let pruned: { expired: number; deleted: number } | null = null;
  if (store.pruneCandidateCatalog) {
    await step("retention", async () => {
      pruned = (await store.pruneCandidateCatalog?.({ now: observedAt })) || null;
    });
  }
  log?.("discovery.run.catalog_recorded", {
    runId,
    sheetId,
    recorded,
    promoted: input.promotedKeys.length,
    ...(pruned ? { pruned } : {}),
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
