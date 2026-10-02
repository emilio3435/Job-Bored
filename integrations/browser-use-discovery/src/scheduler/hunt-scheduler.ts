/**
 * hunt-scheduler.ts — HOLES HUNT §0.9: fires saved hunts from inside the
 * discovery worker. It ticks every minute while the worker is alive, never
 * starts a hunt while another run is live (a due hunt is queued in SQLite,
 * not dropped), coalesces missed slots, and reads all of its state from the
 * hunt store, so a restart loses nothing. Contract: docs/INTERFACE-HUNTS.md §4.
 */

import {
  type HuntRecord,
  type HuntRunTrigger,
  type HuntSchedule,
  type HuntStore,
} from "../state/hunt-store.ts";

export const DEFAULT_HUNT_TICK_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** What one dispatch attempt answered (the in-process /webhook handler's view). */
export interface HuntDispatchOutcome {
  ok: boolean;
  status: number;
  runId?: string;
  /** Another run became live first; the hunt stays queued. */
  busy?: boolean;
  message?: string;
  /** The handler's JSON body, for the run-now route to pass through. */
  body?: unknown;
}

export type HuntDispatcher = (
  hunt: HuntRecord,
  trigger: HuntRunTrigger,
  options?: { googleAccessToken?: string; slotAt?: string },
) => Promise<HuntDispatchOutcome>;

export interface HuntSchedulerDependencies {
  store: HuntStore;
  dispatch: HuntDispatcher;
  /** True while any discovery run is live in this worker. */
  isRunActive(): boolean;
  now(): Date;
  tickMs?: number;
  log?(event: string, details: Record<string, unknown>): void;
  setInterval?(handler: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
}

export interface HuntTickResult {
  fired: string | null;
  queued: string[];
}

export interface HuntScheduler {
  /** Ticks once now (the boot tick), then every `tickMs`. */
  start(): void;
  stop(): void;
  tick(): Promise<HuntTickResult>;
}

export function createHuntScheduler(dependencies: HuntSchedulerDependencies): HuntScheduler {
  const tickMs = dependencies.tickMs ?? DEFAULT_HUNT_TICK_MS;
  let timer: unknown = null;
  let ticking = false;

  async function tick(): Promise<HuntTickResult> {
    // A slow dispatch must not let the next tick start a second hunt.
    if (ticking) return { fired: null, queued: [] };
    ticking = true;
    try {
      return await runTick();
    } finally {
      ticking = false;
    }
  }

  async function runTick(): Promise<HuntTickResult> {
    const now = dependencies.now();
    const nowIso = now.toISOString();
    const due = dependencies.store.list().filter((record) => isHuntDue(record, nowIso));
    if (!due.length) return { fired: null, queued: [] };

    if (dependencies.isRunActive()) {
      const queued: string[] = [];
      for (const record of due) {
        if (record.queuedAt) continue;
        dependencies.store.update({ ...record, queuedAt: nowIso, queuedTrigger: "scheduled-hunt" });
        queued.push(record.id);
      }
      if (queued.length) dependencies.log?.("hunts.scheduler.queued", { huntIds: queued });
      return { fired: null, queued };
    }

    const [next] = due.sort(compareDueHunts);
    const trigger: HuntRunTrigger = next.queuedTrigger ?? "scheduled-hunt";
    let outcome: HuntDispatchOutcome;
    try {
      outcome = await dependencies.dispatch(next, trigger, { slotAt: next.nextRunAt ?? nowIso });
    } catch (error) {
      outcome = { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
    }
    // The user may have edited or deleted the hunt while the dispatch ran.
    const latest = dependencies.store.get(next.id);
    if (latest) settleHuntDispatch(dependencies.store, latest, trigger, outcome, now);
    dependencies.log?.(outcome.ok ? "hunts.scheduler.fired" : "hunts.scheduler.not_fired", {
      huntId: next.id,
      trigger,
      status: outcome.status,
      ...(outcome.runId ? { runId: outcome.runId } : {}),
      ...(outcome.ok ? {} : { busy: outcome.busy === true, message: outcome.message }),
    });
    return { fired: outcome.ok ? next.id : null, queued: outcome.busy ? [next.id] : [] };
  }

  function safeTick(): void {
    tick().catch((error: unknown) => {
      dependencies.log?.("hunts.scheduler.tick_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    start() {
      if (timer !== null) return;
      safeTick();
      const schedule = dependencies.setInterval ?? ((handler: () => void, ms: number) => setInterval(handler, ms));
      timer = schedule(safeTick, tickMs);
      // The worker's HTTP listener keeps the process alive, not this timer.
      (timer as { unref?: () => void } | null)?.unref?.();
    },
    stop() {
      if (timer === null) return;
      const clear = dependencies.clearInterval ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
      clear(timer);
      timer = null;
    },
    tick,
  };
}

/** A queued hunt is due whatever its status; a scheduled one only while active. */
export function isHuntDue(record: HuntRecord, nowIso: string): boolean {
  if (record.queuedAt) return true;
  return (
    record.status === "active" &&
    record.schedule.kind !== "off" &&
    !!record.nextRunAt &&
    record.nextRunAt <= nowIso
  );
}

/** Queued first (oldest queue entry first), then the most overdue slot. */
function compareDueHunts(left: HuntRecord, right: HuntRecord): number {
  if (!!left.queuedAt !== !!right.queuedAt) return left.queuedAt ? -1 : 1;
  return (
    (left.queuedAt ?? "").localeCompare(right.queuedAt ?? "") ||
    (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Applies one dispatch outcome to the hunt: a started run is logged and the
 * schedule moves past now (missed slots coalesce); a busy worker keeps the
 * hunt queued; a refusal records why and also moves on, so a broken hunt
 * never retries every minute. Shared by the scheduler and run-now.
 */
export function settleHuntDispatch(
  store: HuntStore,
  record: HuntRecord,
  trigger: HuntRunTrigger,
  outcome: HuntDispatchOutcome,
  now: Date,
): HuntRecord {
  const nowIso = now.toISOString();
  let next: HuntRecord;
  if (outcome.ok && outcome.runId) {
    store.recordRun({ huntId: record.id, runId: outcome.runId, trigger, dispatchedAt: nowIso });
    next = {
      ...record,
      lastRunAt: nowIso,
      lastRunId: outcome.runId,
      lastError: null,
      queuedAt: null,
      queuedTrigger: null,
      nextRunAt: advanceNextRunAt(record, now),
    };
  } else if (outcome.busy) {
    next = { ...record, queuedAt: record.queuedAt ?? nowIso, queuedTrigger: trigger };
  } else {
    next = {
      ...record,
      lastError: outcome.message || `Run was refused with HTTP ${outcome.status}.`,
      queuedAt: null,
      queuedTrigger: null,
      nextRunAt: advanceNextRunAt(record, now),
    };
  }
  store.update(next);
  return next;
}

/** The hunt's next slot: kept while still ahead of now, else the first after now. */
export function advanceNextRunAt(record: HuntRecord, now: Date): string | null {
  if (record.status !== "active" || record.schedule.kind === "off") return null;
  if (record.nextRunAt && record.nextRunAt > now.toISOString()) return record.nextRunAt;
  return nextHuntSlotAfter(record.schedule, record.timezone, now)?.toISOString() ?? null;
}

/**
 * First slot strictly after `after`, in `timeZone` (docs/INTERFACE-HUNTS.md
 * §4.2). `every_n_hours` slots are the local times of day congruent to
 * hour:minute modulo N hours, so they line up the same way every day.
 */
export function nextHuntSlotAfter(schedule: HuntSchedule, timeZone: string, after: Date): Date | null {
  if (schedule.kind === "off") return null;
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const slots = slotMinutesOfDay(schedule);
  const afterMs = after.getTime();
  const start = zonedParts(afterMs, zone);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + dayOffset));
    const weekday = day.getUTCDay();
    if (schedule.kind === "weekdays" && (weekday === 0 || weekday === 6)) continue;
    for (const minuteOfDay of slots) {
      const at = localTimeToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), minuteOfDay, zone);
      if (at > afterMs) return new Date(at);
    }
  }
  return null;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function slotMinutesOfDay(schedule: HuntSchedule): number[] {
  const base = schedule.hour * 60 + schedule.minute;
  if (schedule.kind !== "every_n_hours") return [base];
  const step = Math.max(1, schedule.everyHours ?? 24) * 60;
  const slots: number[] = [];
  for (let minute = base % step; minute < MINUTES_PER_DAY; minute += step) slots.push(minute);
  return slots;
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(ms: number, timeZone: string) {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
  };
}

/** Wall-clock minutes the zone is ahead of UTC at `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return wallAsUtc - Math.floor(ms / 60_000) * 60_000;
}

/** Local date + minute of day in `timeZone` → UTC ms (two passes settle DST). */
function localTimeToUtcMs(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return wallAsUtc - zoneOffsetMs(firstGuess, timeZone);
}
