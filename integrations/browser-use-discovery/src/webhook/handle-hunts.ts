/**
 * handle-hunts.ts — HOLES HUNT: the hitlist (past searches ranked by yield)
 * and the dispatcher that sends a saved hunt's run through the same
 * in-process handler as POST /webhook. Contract: docs/INTERFACE-HUNTS.md.
 */

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoverySearchPlan,
} from "../contracts.ts";
import type { HuntDispatcher } from "../scheduler/hunt-scheduler.ts";
import type { DiscoveryRunListSummary } from "../state/run-status-store.ts";
import {
  applyHuntTweaks,
  buildSearchKey,
  buildSearchLabel,
  type HuntRecord,
} from "../state/hunt-store.ts";
import {
  deriveIdempotentRunId,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

export interface HuntRunDispatcherDependencies {
  webhookSecret: string;
  /** The in-process POST /webhook handler (built with allowMissingSheetsCredential). */
  handleDiscovery(request: WebhookRequestLike): Promise<WebhookResponseLike>;
  now(): Date;
  /** A last check right before posting, so a hunt never starts over a live run. */
  isRunActive?(): boolean;
  /** Hands the hunt's exploration share to the run, keyed by its run id. */
  rememberRunShare?(runId: string, share: number): void;
}

const PROFILE_QUERY_KEYS = [
  "targetRoles",
  "locations",
  "remotePolicy",
  "seniority",
  "keywordsInclude",
  "keywordsExclude",
] as const;

export function createHuntRunDispatcher(dependencies: HuntRunDispatcherDependencies): HuntDispatcher {
  return async (hunt, trigger, options = {}) => {
    if (dependencies.isRunActive?.()) {
      return { ok: false, status: 409, busy: true, message: "A discovery run is active; the hunt stays queued." };
    }
    const requestedAt = dependencies.now().toISOString();
    // One key per schedule slot (a re-fire of the same slot is the same run);
    // one per click for run-now.
    const idempotencyKey =
      trigger === "scheduled-hunt"
        ? `hunt:${hunt.id}:${options.slotAt || requestedAt}`
        : `hunt:${hunt.id}:now:${requestedAt}`;
    const effectivePlan = applyHuntTweaks(hunt.searchPlan, hunt.tweaks);
    const query = effectivePlan.query || {};
    const discoveryProfile: Record<string, unknown> = {};
    for (const key of PROFILE_QUERY_KEYS) {
      const value = query[key];
      if (typeof value === "string" && value.trim()) discoveryProfile[key] = value;
    }
    if (query.sourcePreset) discoveryProfile.sourcePreset = query.sourcePreset;
    discoveryProfile.searchPlan = { ...effectivePlan, generatedAt: requestedAt, trigger };
    const body = {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: hunt.sheetId,
      variationKey: `hunt-${hunt.id}-${requestedAt.replace(/[^0-9]/g, "").slice(0, 12)}`,
      requestedAt,
      trigger,
      idempotencyKey,
      discoveryProfile,
      ...(options.googleAccessToken ? { googleAccessToken: options.googleAccessToken } : {}),
    };
    // The webhook handler derives this same id; the share must be in place
    // before the run starts planning.
    const runId = deriveIdempotentRunId({ sheetId: hunt.sheetId, idempotencyKey });
    if (runId) dependencies.rememberRunShare?.(runId, hunt.explorationShare);
    const response = await dependencies.handleDiscovery({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": dependencies.webhookSecret,
      },
      bodyText: JSON.stringify(body),
    });
    const parsed = parseJsonObject(response.body);
    const ackRunId = typeof parsed?.runId === "string" ? parsed.runId : "";
    const accepted = response.status >= 200 && response.status < 300 && parsed?.ok === true && !!ackRunId;
    return {
      ok: accepted,
      status: response.status,
      ...(ackRunId ? { runId: ackRunId } : {}),
      ...(accepted
        ? {}
        : {
            message:
              typeof parsed?.message === "string" && parsed.message
                ? parsed.message
                : `Run was refused with HTTP ${response.status}.`,
          }),
      ...(parsed ? { body: parsed } : {}),
    };
  };
}

/** Finished runs whose yield is known; a failed run measured nothing. */
const HITLIST_RUN_STATUSES = new Set<string>(["completed", "partial", "empty", "write_failed"]);
const HITLIST_TREND_POINTS = 10;
const RECENCY_HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HitlistTrendPoint {
  runId: string;
  at: string;
  written: number;
  updated: number;
  fitAvg?: number;
}

export interface HitlistCluster {
  key: string;
  label: string;
  searchPlan: DiscoverySearchPlan;
  runCount: number;
  repeating: boolean;
  leadsWritten: number;
  leadsUpdated: number;
  meanFit: number | null;
  lastRunAt: string;
  lastRunId: string;
  score: number;
  trend: HitlistTrendPoint[];
  huntId: string | null;
}

/**
 * docs/INTERFACE-HUNTS.md §3.3, §7: clusters finished runs by search key and
 * ranks them by leads per run, scaled by mean fit, decayed by a 14-day
 * half-life since the cluster last ran. Ties favour repeating searches,
 * then the newest.
 */
export function buildHitlist(input: {
  runs: readonly DiscoveryRunListSummary[];
  hunts: readonly Pick<HuntRecord, "id" | "searchPlan" | "tweaks">[];
  now: Date;
  limit: number;
}): { runsConsidered: number; clusters: HitlistCluster[] } {
  const huntIdByKey = new Map<string, string>();
  for (const hunt of input.hunts) {
    const key = buildSearchKey(applyHuntTweaks(hunt.searchPlan, hunt.tweaks));
    if (!huntIdByKey.has(key)) huntIdByKey.set(key, hunt.id);
  }
  const groups = new Map<string, Array<{ run: DiscoveryRunListSummary; plan: DiscoverySearchPlan; at: string }>>();
  let runsConsidered = 0;
  for (const run of input.runs) {
    const at = run.completedAt || run.startedAt || "";
    if (!run.searchPlan || !at || !HITLIST_RUN_STATUSES.has(run.status)) continue;
    const key = run.searchKey || buildSearchKey(run.searchPlan);
    runsConsidered += 1;
    const group = groups.get(key) ?? [];
    group.push({ run, plan: run.searchPlan, at });
    groups.set(key, group);
  }
  const clusters: HitlistCluster[] = [];
  for (const [key, entries] of groups) {
    entries.sort((left, right) => right.at.localeCompare(left.at) || right.run.runId.localeCompare(left.run.runId));
    const newest = entries[0];
    const fits = entries
      .map((entry) => entry.run.headline.fitAvg)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const leadsWritten = sum(entries.map((entry) => entry.run.headline.written ?? 0));
    const meanFit = fits.length ? roundTo(sum(fits) / fits.length, 2) : null;
    const daysSinceLastRun = Math.max(0, (input.now.getTime() - Date.parse(newest.at)) / DAY_MS);
    const fitFactor = meanFit === null ? 1 : 0.5 + meanFit / 10;
    clusters.push({
      key,
      label: buildSearchLabel(newest.plan),
      searchPlan: newest.plan,
      runCount: entries.length,
      repeating: entries.length >= 2,
      leadsWritten,
      leadsUpdated: sum(entries.map((entry) => entry.run.headline.updated ?? 0)),
      meanFit,
      lastRunAt: newest.at,
      lastRunId: newest.run.runId,
      score: roundTo(
        (leadsWritten / entries.length) * fitFactor * 0.5 ** (daysSinceLastRun / RECENCY_HALF_LIFE_DAYS),
        4,
      ),
      trend: entries.slice(0, HITLIST_TREND_POINTS).map(({ run, at }) => ({
        runId: run.runId,
        at,
        written: run.headline.written ?? 0,
        updated: run.headline.updated ?? 0,
        ...(run.headline.fitAvg !== undefined ? { fitAvg: run.headline.fitAvg } : {}),
      })),
      huntId: huntIdByKey.get(key) ?? null,
    });
  }
  clusters.sort(
    (left, right) =>
      right.score - left.score ||
      Number(right.repeating) - Number(left.repeating) ||
      right.lastRunAt.localeCompare(left.lastRunAt),
  );
  return { runsConsidered, clusters: clusters.slice(0, input.limit) };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
