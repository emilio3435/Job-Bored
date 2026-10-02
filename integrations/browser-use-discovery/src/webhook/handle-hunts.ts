/**
 * handle-hunts.ts — HOLES HUNT: the /hunts routes (saved hunts, run now, the
 * hitlist of past searches ranked by yield) and the dispatcher that sends a
 * saved hunt's run through the same in-process handler as POST /webhook.
 * Contract: docs/INTERFACE-HUNTS.md. The router authenticates every /hunts
 * request with the webhook secret before it reaches this module.
 */

import { randomUUID } from "node:crypto";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoverySearchPlan,
} from "../contracts.ts";
import {
  isValidTimeZone,
  nextHuntSlotAfter,
  settleHuntDispatch,
  type HuntDispatcher,
} from "../scheduler/hunt-scheduler.ts";
import {
  summarizeRun,
  type DiscoveryRunListSummary,
  type DiscoveryRunStatusStore,
} from "../state/run-status-store.ts";
import {
  applyHuntTweaks,
  buildSearchKey,
  buildSearchLabel,
  DEFAULT_HUNT_SCHEDULE,
  HUNT_STATUSES,
  HUNT_TWEAK_KEYS,
  isHuntSchedule,
  MAX_HUNTS,
  normalizeHuntSearchPlan,
  normalizeHuntTweaks,
  splitSearchList,
  type HuntRecord,
  type HuntRunRecord,
  type HuntStore,
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

export interface HuntsRouteRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  bodyText: string;
}

export interface HuntsRouteResponse {
  status: number;
  body: Record<string, unknown>;
  /** The `allow` header of a 405. */
  allow?: string;
}

export type HuntsRouteHandler = (request: HuntsRouteRequest) => Promise<HuntsRouteResponse>;

export interface HuntsRouteDependencies {
  store: HuntStore;
  runStatusStore: Pick<DiscoveryRunStatusStore, "get"> & Partial<Pick<DiscoveryRunStatusStore, "list">>;
  dispatch: HuntDispatcher;
  /** True while any discovery run is live in this worker. */
  isRunActive(): boolean;
  now(): Date;
  defaultExplorationShare?: number;
  defaultTimezone?: string;
  randomId?(): string;
}

const HUNT_PATH = /^\/hunts\/(hunt_[0-9a-f]{32})(?:\/(run|delete))?$/;
/** §0.10: the share a hunt reserves for exploration unless it sets its own. */
const FALLBACK_EXPLORATION_SHARE = 0.3;
const HITLIST_DEFAULT_LIMIT = 20;
const HITLIST_MAX_LIMIT = 50;
/** The worker keeps at most 500 run snapshots; read them in pages of 100. */
const HITLIST_MAX_PAGES = 5;
const RUN_PAGE_SIZE = 100;
const HUNT_VIEW_RUNS = 10;
const MAX_NAME_LENGTH = 120;
const MAX_TWEAK_LENGTH = 1000;
const MAX_SHEET_ID_LENGTH = 200;

type HuntFields = Partial<
  Pick<HuntRecord, "name" | "status" | "tweaks" | "explorationShare" | "schedule" | "timezone" | "sheetId">
>;

export function createHuntsRouteHandler(dependencies: HuntsRouteDependencies): HuntsRouteHandler {
  const { store } = dependencies;
  const newId = dependencies.randomId ?? (() => `hunt_${randomUUID().replace(/-/g, "")}`);
  const defaultTimezone =
    dependencies.defaultTimezone && isValidTimeZone(dependencies.defaultTimezone)
      ? dependencies.defaultTimezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const defaultShare = isShare(dependencies.defaultExplorationShare)
    ? dependencies.defaultExplorationShare
    : FALLBACK_EXPLORATION_SHARE;

  function view(record: HuntRecord): Record<string, unknown> {
    const effectivePlan = applyHuntTweaks(record.searchPlan, record.tweaks);
    const { queuedTrigger: _queuedTrigger, ...wire } = record;
    return {
      ...wire,
      effectivePlan,
      searchKey: buildSearchKey(effectivePlan),
      runs: store.listRuns(record.id, HUNT_VIEW_RUNS).map(runView),
    };
  }

  function runView(run: HuntRunRecord): Record<string, unknown> {
    const base = { runId: run.runId, trigger: run.trigger, dispatchedAt: run.dispatchedAt };
    const status = dependencies.runStatusStore.get(run.runId);
    if (!status) return base;
    const summary = summarizeRun(status);
    return {
      ...base,
      status: summary.status,
      ...(summary.completedAt ? { completedAt: summary.completedAt } : {}),
      ...(summary.headline.written !== undefined ? { written: summary.headline.written } : {}),
      ...(summary.headline.updated !== undefined ? { updated: summary.headline.updated } : {}),
      ...(summary.headline.fitAvg !== undefined ? { fitAvg: summary.headline.fitAvg } : {}),
      ...(summary.awaitingSheetWrite ? { awaitingSheetWrite: summary.awaitingSheetWrite.leads } : {}),
    };
  }

  function findBySearchKey(searchKey: string, exceptId = ""): HuntRecord | undefined {
    return store.list().find((record) => record.id !== exceptId && huntSearchKey(record) === searchKey);
  }

  function createHunt(bodyText: string): HuntsRouteResponse {
    const body = parseJsonObject(bodyText);
    if (!body) return failure(400, "invalid_json", "Request body must be a JSON object.");
    const fromRunId = typeof body.fromRunId === "string" ? body.fromRunId.trim() : "";
    if (body.fromRunId !== undefined && !fromRunId) return invalidHunt("fromRunId must be a run id.");
    if (!fromRunId && body.searchPlan === undefined) return invalidHunt("Send fromRunId or searchPlan.");
    const read = readHuntFields(body);
    if (!read.ok) return invalidHunt(read.detail);
    const fields = read.fields;

    let searchPlan: DiscoverySearchPlan | null = null;
    let runSheetId = "";
    if (fromRunId) {
      const run = dependencies.runStatusStore.get(fromRunId);
      if (!run) return failure(404, "run_not_found", "Run not found.");
      runSheetId = run.request.sheetId;
      if (body.searchPlan === undefined) {
        searchPlan = normalizeHuntSearchPlan(run.searchPlan);
        if (!searchPlan) {
          return failure(409, "run_has_no_search_plan", "That run recorded no search plan to save.", {
            nextStep: "Send the searchPlan to save in the request body.",
          });
        }
      }
    }
    if (body.searchPlan !== undefined) {
      searchPlan = normalizeHuntSearchPlan(body.searchPlan);
      if (!searchPlan) return invalidHunt("searchPlan must be a planVersion 1 search plan.");
    }
    if (!searchPlan) return invalidHunt("Send fromRunId or searchPlan.");
    const tweaks = fields.tweaks ?? {};
    const effectivePlan = applyHuntTweaks(searchPlan, tweaks);
    if (!hasSearchIntent(effectivePlan)) return invalidHunt("A hunt needs target roles or include keywords.");
    const existing = findBySearchKey(buildSearchKey(effectivePlan));
    if (existing) {
      return failure(409, "hunt_exists", "A saved hunt already runs this search.", { huntId: existing.id });
    }
    if (store.count() >= MAX_HUNTS) {
      return failure(409, "hunt_limit", `At most ${MAX_HUNTS} hunts can be saved.`, {
        nextStep: "Delete a hunt you no longer need, then save this one.",
      });
    }
    const now = dependencies.now();
    const nowIso = now.toISOString();
    const record: HuntRecord = {
      id: newId(),
      name: fields.name || buildSearchLabel(effectivePlan).slice(0, MAX_NAME_LENGTH) || "Saved hunt",
      status: fields.status ?? "active",
      searchPlan,
      tweaks,
      explorationShare: fields.explorationShare ?? defaultShare,
      schedule: fields.schedule ?? { ...DEFAULT_HUNT_SCHEDULE },
      timezone: fields.timezone ?? defaultTimezone,
      sheetId: fields.sheetId ?? runSheetId,
      sourceRunId: fromRunId || null,
      createdAt: nowIso,
      updatedAt: nowIso,
      nextRunAt: null,
      queuedAt: null,
      queuedTrigger: null,
      lastRunAt: null,
      lastRunId: null,
      lastError: null,
    };
    record.nextRunAt = scheduledNextRunAt(record, now);
    store.insert(record);
    return { status: 201, body: { ok: true, hunt: view(record) } };
  }

  function updateHunt(id: string, bodyText: string): HuntsRouteResponse {
    const record = store.get(id);
    if (!record) return huntNotFound();
    const body = parseJsonObject(bodyText);
    if (!body) return failure(400, "invalid_json", "Request body must be a JSON object.");
    const read = readHuntFields(body);
    if (!read.ok) return invalidHunt(read.detail);
    const fields = read.fields;
    const now = dependencies.now();
    const next: HuntRecord = { ...record, ...fields, updatedAt: now.toISOString() };
    if (fields.tweaks !== undefined) {
      const effectivePlan = applyHuntTweaks(next.searchPlan, next.tweaks);
      if (!hasSearchIntent(effectivePlan)) return invalidHunt("A hunt needs target roles or include keywords.");
      const clash = findBySearchKey(buildSearchKey(effectivePlan), id);
      if (clash) {
        return failure(409, "hunt_exists", "A saved hunt already runs this search.", { huntId: clash.id });
      }
    }
    if (fields.status !== undefined || fields.schedule !== undefined || fields.timezone !== undefined) {
      next.nextRunAt = scheduledNextRunAt(next, now);
    }
    if (fields.status === "paused") {
      next.queuedAt = null;
      next.queuedTrigger = null;
    }
    store.update(next);
    return { status: 200, body: { ok: true, hunt: view(next) } };
  }

  async function runHuntNow(id: string, bodyText: string): Promise<HuntsRouteResponse> {
    const record = store.get(id);
    if (!record) return huntNotFound();
    let googleAccessToken = "";
    if (bodyText.trim()) {
      const body = parseJsonObject(bodyText);
      if (!body) return failure(400, "invalid_json", "Request body must be a JSON object.");
      if (body.googleAccessToken !== undefined) {
        if (typeof body.googleAccessToken !== "string") return invalidHunt("googleAccessToken must be a string.");
        googleAccessToken = body.googleAccessToken.trim();
      }
    }
    const now = dependencies.now();
    if (dependencies.isRunActive()) return queueRunNow(record, now);
    const outcome = await dependencies.dispatch(record, "hunt", googleAccessToken ? { googleAccessToken } : {});
    const latest = store.get(id);
    if (latest) settleHuntDispatch(store, latest, "hunt", outcome, now);
    if (outcome.busy) return queueRunNow(store.get(id) ?? record, now);
    const body = outcome.body ?? { ok: false, message: outcome.message || "Run was refused." };
    return { status: outcome.status, body: { ...body, huntId: id } };
  }

  function queueRunNow(record: HuntRecord, now: Date): HuntsRouteResponse {
    const queuedAt = record.queuedAt ?? now.toISOString();
    store.update({ ...record, queuedAt, queuedTrigger: "hunt" });
    return {
      status: 202,
      body: {
        ok: true,
        kind: "queued",
        huntId: record.id,
        queuedAt,
        message: "Another discovery run is active; this hunt starts when it finishes.",
      },
    };
  }

  function hitlist(query: URLSearchParams): HuntsRouteResponse {
    const rawLimit = query.get("limit");
    const limit = rawLimit === null ? HITLIST_DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > HITLIST_MAX_LIMIT) {
      return failure(400, "invalid_limit", `limit must be an integer from 1 to ${HITLIST_MAX_LIMIT}.`);
    }
    const runs: DiscoveryRunListSummary[] = [];
    let before = "";
    for (let page = 0; page < HITLIST_MAX_PAGES; page += 1) {
      const result = dependencies.runStatusStore.list?.({ limit: RUN_PAGE_SIZE, before });
      if (!result) break;
      runs.push(...result.runs);
      if (!result.nextBefore) break;
      before = result.nextBefore;
    }
    const now = dependencies.now();
    const { runsConsidered, clusters } = buildHitlist({ runs, hunts: store.list(), now, limit });
    return {
      status: 200,
      body: { ok: true, generatedAt: now.toISOString(), runsConsidered, clusters },
    };
  }

  return async (request) => {
    const { method, path } = request;
    if (path === "/hunts") {
      if (method === "GET") return { status: 200, body: { ok: true, hunts: store.list().map(view) } };
      if (method === "POST") return createHunt(request.bodyText);
      return methodNotAllowed("GET,POST,OPTIONS");
    }
    if (path === "/hunts/hitlist") {
      return method === "GET" ? hitlist(request.query) : methodNotAllowed("GET,OPTIONS");
    }
    const match = HUNT_PATH.exec(path);
    if (!match) return huntNotFound();
    const [, id, action] = match;
    if (!action) {
      if (method === "GET") {
        const record = store.get(id);
        return record ? { status: 200, body: { ok: true, hunt: view(record) } } : huntNotFound();
      }
      if (method === "POST") return updateHunt(id, request.bodyText);
      return methodNotAllowed("GET,POST,OPTIONS");
    }
    if (method !== "POST") return methodNotAllowed("POST,OPTIONS");
    if (action === "run") return runHuntNow(id, request.bodyText);
    return store.delete(id)
      ? { status: 200, body: { ok: true, id, deleted: true } }
      : huntNotFound();
  };
}

function readHuntFields(body: Record<string, unknown>): { ok: true; fields: HuntFields } | { ok: false; detail: string } {
  const fields: HuntFields = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length > MAX_NAME_LENGTH) {
      return { ok: false, detail: `name must be a string of at most ${MAX_NAME_LENGTH} characters.` };
    }
    fields.name = body.name.trim();
  }
  if (body.status !== undefined) {
    if (!(HUNT_STATUSES as readonly unknown[]).includes(body.status)) {
      return { ok: false, detail: `status must be one of: ${HUNT_STATUSES.join(", ")}.` };
    }
    fields.status = body.status as HuntRecord["status"];
  }
  if (body.tweaks !== undefined) {
    const raw = body.tweaks;
    const valid =
      isRecord(raw) &&
      Object.keys(raw).every((key) => (HUNT_TWEAK_KEYS as readonly string[]).includes(key)) &&
      Object.values(raw).every((value) => typeof value === "string" && value.length <= MAX_TWEAK_LENGTH);
    const tweaks = valid ? normalizeHuntTweaks(raw) : null;
    if (!tweaks) {
      return {
        ok: false,
        detail: `tweaks may only set ${HUNT_TWEAK_KEYS.join(", ")}, each a string of at most ${MAX_TWEAK_LENGTH} characters.`,
      };
    }
    fields.tweaks = tweaks;
  }
  if (body.explorationShare !== undefined) {
    if (!isShare(body.explorationShare)) {
      return { ok: false, detail: "explorationShare must be a number from 0 to 1." };
    }
    fields.explorationShare = body.explorationShare;
  }
  if (body.schedule !== undefined) {
    if (!isHuntSchedule(body.schedule)) {
      return {
        ok: false,
        detail: "schedule must be { kind: off | daily | weekdays | every_n_hours, hour: 0-23, minute: 0-59 }, with everyHours 1-24 only for every_n_hours.",
      };
    }
    const { kind, hour, minute, everyHours } = body.schedule;
    fields.schedule = { kind, hour, minute, ...(everyHours !== undefined ? { everyHours } : {}) };
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimeZone(body.timezone)) {
      return { ok: false, detail: "timezone must be an IANA time zone such as America/Chicago." };
    }
    fields.timezone = body.timezone;
  }
  if (body.sheetId !== undefined) {
    if (typeof body.sheetId !== "string" || body.sheetId.length > MAX_SHEET_ID_LENGTH) {
      return { ok: false, detail: `sheetId must be a string of at most ${MAX_SHEET_ID_LENGTH} characters.` };
    }
    fields.sheetId = body.sheetId.trim();
  }
  return { ok: true, fields };
}

function scheduledNextRunAt(record: HuntRecord, now: Date): string | null {
  if (record.status !== "active" || record.schedule.kind === "off") return null;
  return nextHuntSlotAfter(record.schedule, record.timezone, now)?.toISOString() ?? null;
}

function huntSearchKey(record: Pick<HuntRecord, "searchPlan" | "tweaks">): string {
  return buildSearchKey(applyHuntTweaks(record.searchPlan, record.tweaks));
}

/** The worker refuses a run with blank intent; so does a hunt. */
function hasSearchIntent(plan: DiscoverySearchPlan): boolean {
  const query = plan.query || {};
  return splitSearchList(query.targetRoles).length > 0 || splitSearchList(query.keywordsInclude).length > 0;
}

function isShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function failure(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HuntsRouteResponse {
  return { status, body: { ok: false, code, message, ...extra } };
}

function invalidHunt(detail: string): HuntsRouteResponse {
  return failure(400, "invalid_hunt", "The hunt is not valid.", { detail });
}

function huntNotFound(): HuntsRouteResponse {
  return failure(404, "hunt_not_found", "Hunt not found.");
}

function methodNotAllowed(allow: string): HuntsRouteResponse {
  return { ...failure(405, "method_not_allowed", "Method not allowed"), allow };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    const key = huntSearchKey(hunt);
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
