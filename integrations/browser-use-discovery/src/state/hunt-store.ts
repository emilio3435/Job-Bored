/**
 * hunt-store.ts — HOLES HUNT: saved hunts (a past search with a schedule) and
 * the runs each hunt dispatched, persisted in worker-state.sqlite so the
 * in-worker scheduler survives restarts. Contract: docs/INTERFACE-HUNTS.md.
 *
 * Also holds the pure search-plan helpers the hunts routes, the hitlist and
 * run summaries share: plan normalization, tweak application, and the search
 * key that names one search across the dashboard's daily facet rotation.
 *
 * Backed by node:sqlite (DatabaseSync) on its own connection, the same way
 * listing-score-cache.ts is.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DiscoverySearchPlan } from "../contracts.ts";

export const HUNT_STATUSES = ["active", "paused"] as const;
export type HuntStatus = (typeof HUNT_STATUSES)[number];

export const HUNT_SCHEDULE_KINDS = ["off", "daily", "weekdays", "every_n_hours"] as const;
export type HuntScheduleKind = (typeof HUNT_SCHEDULE_KINDS)[number];

export const HUNT_RUN_TRIGGERS = ["hunt", "scheduled-hunt"] as const;
export type HuntRunTrigger = (typeof HUNT_RUN_TRIGGERS)[number];

/** The searchPlan.query fields a user may tweak (sourcePreset is not one). */
export const HUNT_TWEAK_KEYS = [
  "targetRoles",
  "keywordsInclude",
  "locations",
  "remotePolicy",
  "seniority",
  "keywordsExclude",
] as const;
export type HuntTweakKey = (typeof HUNT_TWEAK_KEYS)[number];
export type HuntTweaks = Partial<Record<HuntTweakKey, string>>;

export interface HuntSchedule {
  kind: HuntScheduleKind;
  hour: number;
  minute: number;
  everyHours?: number;
}

export interface HuntRecord {
  id: string;
  name: string;
  status: HuntStatus;
  searchPlan: DiscoverySearchPlan;
  tweaks: HuntTweaks;
  explorationShare: number;
  schedule: HuntSchedule;
  timezone: string;
  sheetId: string;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  queuedAt: string | null;
  /** Which trigger a queued run fires with; internal, not on the wire. */
  queuedTrigger: HuntRunTrigger | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
}

export interface HuntRunRecord {
  huntId: string;
  runId: string;
  trigger: HuntRunTrigger;
  dispatchedAt: string;
}

export interface HuntStore {
  list(): HuntRecord[];
  get(id: string): HuntRecord | null;
  count(): number;
  insert(record: HuntRecord): void;
  update(record: HuntRecord): void;
  delete(id: string): boolean;
  recordRun(run: HuntRunRecord): void;
  listRuns(huntId: string, limit?: number): HuntRunRecord[];
  close(): void;
}

export const MAX_HUNTS = 50;
export const DEFAULT_HUNT_SCHEDULE: HuntSchedule = { kind: "off", hour: 8, minute: 0 };
/** Dispatch log rows kept per hunt; the API shows the newest 10. */
const MAX_HUNT_RUNS_KEPT = 200;
const MAX_PLAN_STRING_LENGTH = 1000;
const MAX_PLAN_LIST_ENTRIES = 50;

const SELECTED_KEYS = [
  "role",
  "adjacentTitle",
  "skill",
  "industry",
  "location",
  "seniority",
  "companyType",
  "sourceLane",
] as const;
const FACET_KEYS = [
  "roles",
  "adjacentTitles",
  "skills",
  "industries",
  "locations",
  "seniority",
  "companyTypes",
  "sourceLanes",
] as const;
const QUERY_KEYS = [...HUNT_TWEAK_KEYS, "sourcePreset"] as const;

type HuntRow = {
  hunt_id: string;
  name: string;
  status: string;
  search_plan_json: string;
  tweaks_json: string;
  exploration_share: number;
  schedule_json: string;
  timezone: string;
  sheet_id: string;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
  next_run_at: string | null;
  queued_at: string | null;
  queued_trigger: string | null;
  last_run_at: string | null;
  last_run_id: string | null;
  last_error: string | null;
};

type HuntRunRow = {
  hunt_id: string;
  run_id: string;
  trigger: string;
  dispatched_at: string;
};

export function openHuntStore(databasePath?: string): HuntStore {
  const resolvedPath = String(databasePath || "").trim() || ":memory:";
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }
  const database = new DatabaseSync(resolvedPath);
  if (resolvedPath !== ":memory:") {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
    `);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS hunts (
      hunt_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      search_plan_json TEXT NOT NULL,
      tweaks_json TEXT NOT NULL,
      exploration_share REAL NOT NULL,
      schedule_json TEXT NOT NULL,
      timezone TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      source_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      next_run_at TEXT,
      queued_at TEXT,
      queued_trigger TEXT,
      last_run_at TEXT,
      last_run_id TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS hunt_runs (
      hunt_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      dispatched_at TEXT NOT NULL,
      PRIMARY KEY (hunt_id, run_id)
    );
    CREATE INDEX IF NOT EXISTS hunt_runs_by_hunt
      ON hunt_runs (hunt_id, dispatched_at);
  `);

  const columns = `hunt_id, name, status, search_plan_json, tweaks_json,
    exploration_share, schedule_json, timezone, sheet_id, source_run_id,
    created_at, updated_at, next_run_at, queued_at, queued_trigger,
    last_run_at, last_run_id, last_error`;
  const listStatement = database.prepare(
    `SELECT ${columns} FROM hunts ORDER BY created_at DESC, hunt_id DESC`,
  );
  const getStatement = database.prepare(
    `SELECT ${columns} FROM hunts WHERE hunt_id = ?`,
  );
  const countStatement = database.prepare("SELECT COUNT(*) AS total FROM hunts");
  const insertStatement = database.prepare(
    `INSERT INTO hunts (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStatement = database.prepare(`
    UPDATE hunts SET name = ?, status = ?, search_plan_json = ?, tweaks_json = ?,
      exploration_share = ?, schedule_json = ?, timezone = ?, sheet_id = ?,
      source_run_id = ?, created_at = ?, updated_at = ?, next_run_at = ?,
      queued_at = ?, queued_trigger = ?, last_run_at = ?, last_run_id = ?,
      last_error = ?
    WHERE hunt_id = ?
  `);
  const deleteHuntStatement = database.prepare("DELETE FROM hunts WHERE hunt_id = ?");
  const deleteRunsStatement = database.prepare("DELETE FROM hunt_runs WHERE hunt_id = ?");
  const recordRunStatement = database.prepare(`
    INSERT OR IGNORE INTO hunt_runs (hunt_id, run_id, trigger, dispatched_at)
    VALUES (?, ?, ?, ?)
  `);
  const pruneRunsStatement = database.prepare(`
    DELETE FROM hunt_runs WHERE hunt_id = ? AND run_id NOT IN (
      SELECT run_id FROM hunt_runs WHERE hunt_id = ?
      ORDER BY dispatched_at DESC, run_id DESC LIMIT ${MAX_HUNT_RUNS_KEPT}
    )
  `);
  const listRunsStatement = database.prepare(`
    SELECT hunt_id, run_id, trigger, dispatched_at FROM hunt_runs
    WHERE hunt_id = ? ORDER BY dispatched_at DESC, run_id DESC LIMIT ?
  `);

  return {
    list() {
      return (listStatement.all() as HuntRow[])
        .map(rowToHunt)
        .filter((record): record is HuntRecord => record !== null);
    },
    get(id) {
      const row = getStatement.get(String(id || "")) as HuntRow | undefined;
      return row ? rowToHunt(row) : null;
    },
    count() {
      const row = countStatement.get() as { total?: number } | undefined;
      return Number(row?.total || 0);
    },
    insert(record) {
      insertStatement.run(record.id, ...huntValues(record));
    },
    update(record) {
      updateStatement.run(...huntValues(record), record.id);
    },
    delete(id) {
      const key = String(id || "");
      database.exec("BEGIN");
      try {
        deleteRunsStatement.run(key);
        const result = deleteHuntStatement.run(key);
        database.exec("COMMIT");
        return Number(result.changes) > 0;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    recordRun(run) {
      recordRunStatement.run(run.huntId, run.runId, run.trigger, run.dispatchedAt);
      pruneRunsStatement.run(run.huntId, run.huntId);
    },
    listRuns(huntId, limit = 10) {
      return (listRunsStatement.all(String(huntId || ""), limit) as HuntRunRow[])
        .filter((row) => isHuntRunTrigger(row.trigger))
        .map((row) => ({
          huntId: row.hunt_id,
          runId: row.run_id,
          trigger: row.trigger as HuntRunTrigger,
          dispatchedAt: row.dispatched_at,
        }));
    },
    close() {
      database.close();
    },
  };
}

function huntValues(record: HuntRecord): Array<string | number | null> {
  return [
    record.name,
    record.status,
    JSON.stringify(record.searchPlan),
    JSON.stringify(record.tweaks),
    record.explorationShare,
    JSON.stringify(record.schedule),
    record.timezone,
    record.sheetId,
    record.sourceRunId,
    record.createdAt,
    record.updatedAt,
    record.nextRunAt,
    record.queuedAt,
    record.queuedTrigger,
    record.lastRunAt,
    record.lastRunId,
    record.lastError,
  ];
}

/** A row that no longer parses is skipped rather than breaking every read. */
function rowToHunt(row: HuntRow): HuntRecord | null {
  const searchPlan = normalizeHuntSearchPlan(parseJson(row.search_plan_json));
  const tweaks = normalizeHuntTweaks(parseJson(row.tweaks_json));
  const schedule = parseJson(row.schedule_json);
  if (!searchPlan || !tweaks || !isHuntSchedule(schedule)) return null;
  if (!(HUNT_STATUSES as readonly string[]).includes(row.status)) return null;
  return {
    id: row.hunt_id,
    name: row.name,
    status: row.status as HuntStatus,
    searchPlan,
    tweaks,
    explorationShare: Number(row.exploration_share),
    schedule,
    timezone: row.timezone,
    sheetId: row.sheet_id,
    sourceRunId: row.source_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    queuedAt: row.queued_at,
    queuedTrigger: isHuntRunTrigger(row.queued_trigger) ? row.queued_trigger : null,
    lastRunAt: row.last_run_at,
    lastRunId: row.last_run_id,
    lastError: row.last_error,
  };
}

export function isHuntRunTrigger(value: unknown): value is HuntRunTrigger {
  return typeof value === "string" && (HUNT_RUN_TRIGGERS as readonly string[]).includes(value);
}

export function isHuntSchedule(value: unknown): value is HuntSchedule {
  if (!isRecord(value)) return false;
  if (!(HUNT_SCHEDULE_KINDS as readonly string[]).includes(String(value.kind))) return false;
  if (!isIntegerInRange(value.hour, 0, 23) || !isIntegerInRange(value.minute, 0, 59)) return false;
  if (value.kind === "every_n_hours") return isIntegerInRange(value.everyHours, 1, 24);
  return value.everyHours === undefined;
}

/** Keeps only the documented tweak keys; null when the value is not tweak-shaped. */
export function normalizeHuntTweaks(value: unknown): HuntTweaks | null {
  if (!isRecord(value)) return null;
  const tweaks: HuntTweaks = {};
  for (const key of HUNT_TWEAK_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") return null;
    tweaks[key] = capString(value[key]);
  }
  return tweaks;
}

/**
 * Keeps only DiscoverySearchPlan fields (the same shape the webhook parser
 * accepts), so nothing else a client sends is ever stored or replayed.
 */
export function normalizeHuntSearchPlan(value: unknown): DiscoverySearchPlan | null {
  if (!isRecord(value) || value.planVersion !== 1) return null;
  const plan: DiscoverySearchPlan = {
    planVersion: 1,
    generatedAt: capString(typeof value.generatedAt === "string" ? value.generatedAt : ""),
    seed: capString(typeof value.seed === "string" ? value.seed : ""),
  };
  if (typeof value.trigger === "string") plan.trigger = capString(value.trigger);
  if (typeof value.rotationKey === "string") plan.rotationKey = capString(value.rotationKey);
  if (typeof value.rotationIndex === "number" && Number.isFinite(value.rotationIndex)) {
    plan.rotationIndex = value.rotationIndex;
  }
  if (typeof value.profileHash === "string") plan.profileHash = capString(value.profileHash);
  if (isRecord(value.selected)) {
    const selected: NonNullable<DiscoverySearchPlan["selected"]> = {};
    for (const key of SELECTED_KEYS) {
      if (typeof value.selected[key] === "string") selected[key] = capString(value.selected[key]);
    }
    if (Object.keys(selected).length) plan.selected = selected;
  }
  if (isRecord(value.facets)) {
    const facets: NonNullable<DiscoverySearchPlan["facets"]> = {};
    for (const key of FACET_KEYS) {
      const raw = value.facets[key];
      if (!Array.isArray(raw)) continue;
      facets[key] = raw
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, MAX_PLAN_LIST_ENTRIES)
        .map(capString);
    }
    if (Object.keys(facets).length) plan.facets = facets;
  }
  if (isRecord(value.query)) {
    const query: NonNullable<DiscoverySearchPlan["query"]> = {};
    for (const key of QUERY_KEYS) {
      const raw = value.query[key];
      if (typeof raw !== "string") continue;
      if (key === "sourcePreset") {
        query.sourcePreset = capString(raw) as NonNullable<DiscoverySearchPlan["query"]>["sourcePreset"];
      } else {
        query[key] = capString(raw);
      }
    }
    if (Object.keys(query).length) plan.query = query;
  }
  return plan;
}

/**
 * The plan a hunt actually runs: the saved plan with the user's tweaks laid
 * over its query. A tweaked list also replaces the matching facet list, and
 * a tweaked include list drops the rotation's include picks, so the search
 * key (and the worker's effective intent) follow the tweak.
 */
export function applyHuntTweaks(plan: DiscoverySearchPlan, tweaks: HuntTweaks): DiscoverySearchPlan {
  const next: DiscoverySearchPlan = JSON.parse(JSON.stringify(plan));
  const query = { ...(next.query || {}) };
  const facets = { ...(next.facets || {}) };
  const selected = { ...(next.selected || {}) };
  for (const key of HUNT_TWEAK_KEYS) {
    const value = tweaks[key];
    if (value === undefined) continue;
    query[key] = value;
    if (key === "targetRoles") {
      facets.roles = splitPlanList(value);
      delete selected.role;
      delete selected.adjacentTitle;
    } else if (key === "locations") {
      facets.locations = splitPlanList(value);
      delete selected.location;
    } else if (key === "seniority") {
      facets.seniority = splitPlanList(value);
      delete selected.seniority;
    } else if (key === "keywordsInclude") {
      delete selected.skill;
      delete selected.industry;
      delete selected.companyType;
    }
  }
  next.query = query;
  if (Object.keys(facets).length) next.facets = facets;
  if (Object.keys(selected).length) next.selected = selected;
  else delete next.selected;
  return next;
}

/** docs/INTERFACE-HUNTS.md §7: `sk_` + 16 hex of the normalized search. */
export function buildSearchKey(plan: DiscoverySearchPlan): string {
  const parts = searchKeyParts(plan);
  const canonical = JSON.stringify({
    roles: [...parts.roles].sort(),
    locations: [...parts.locations].sort(),
    seniority: [...parts.seniority].sort(),
    includes: [...parts.includes].sort(),
    excludes: [...parts.excludes].sort(),
    remotePolicy: parts.remotePolicy,
    sourcePreset: parts.sourcePreset,
  });
  return `sk_${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/** "roles · locations · seniority", lowercased, in the plan's own order. */
export function buildSearchLabel(plan: DiscoverySearchPlan): string {
  const parts = searchKeyParts(plan);
  return [
    parts.roles.slice(0, 3).join(", "),
    parts.locations.slice(0, 3).join(", "),
    parts.seniority.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function searchKeyParts(plan: DiscoverySearchPlan) {
  const query = plan.query || {};
  const facets = plan.facets || {};
  const selected = plan.selected || {};
  const rotationPicks = new Set(
    [selected.skill, selected.industry, selected.companyType]
      .map((value) => normalizeSearchTerm(value || ""))
      .filter(Boolean),
  );
  return {
    roles: facetOrQuery(facets.roles, query.targetRoles),
    locations: facetOrQuery(facets.locations, query.locations),
    seniority: facetOrQuery(facets.seniority, query.seniority),
    includes: splitSearchList(query.keywordsInclude).filter((term) => !rotationPicks.has(term)),
    excludes: splitSearchList(query.keywordsExclude),
    remotePolicy: normalizeSearchTerm(query.remotePolicy || ""),
    sourcePreset: normalizeSearchTerm(query.sourcePreset || ""),
  };
}

function facetOrQuery(facet: readonly string[] | undefined, queryValue: string | undefined): string[] {
  const fromFacet = dedupe((facet || []).map(normalizeSearchTerm).filter(Boolean));
  return fromFacet.length ? fromFacet : splitSearchList(queryValue);
}

/** Splits on `,` `;` and newlines; lowercased, trimmed, deduped, order kept. */
export function splitSearchList(value: string | undefined): string[] {
  return dedupe(
    String(value || "")
      .split(/[,;\n]/)
      .map(normalizeSearchTerm)
      .filter(Boolean),
  );
}

/** Facet values keep the user's casing; the search key normalizes them. */
function splitPlanList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value.split(/[,;\n]/)) {
    const term = entry.trim().replace(/\s+/g, " ");
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(capString(term));
  }
  return out;
}

function normalizeSearchTerm(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function capString(value: string): string {
  return value.length > MAX_PLAN_STRING_LENGTH ? value.slice(0, MAX_PLAN_STRING_LENGTH) : value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
