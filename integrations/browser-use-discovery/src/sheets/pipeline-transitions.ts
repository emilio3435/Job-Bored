/**
 * Worker port of the browser's pipeline-transitions.js planner (BEAUDIT D7,
 * D10, spec §7.4). A stage move returns the cells it changes, so every
 * worker writer (the /pipeline-update patcher, expired cleanup) applies one
 * cell set per stage:
 *
 * - Applied: Status, Applied Date (given, else the row's, else today), a
 *   Follow-up Date 7 days later when the row has none, and a dated note.
 * - Phone Screen / Interviewing: Applied Date backfilled to today, Follow-up
 *   +3 / +5 days.
 * - Offer / Rejected / Passed / Expired: Follow-up cleared; Expired always
 *   leaves an audit line.
 * - New: Applied Date and Follow-up cleared.
 *
 * Pure; no network.
 */
import { PIPELINE_COL } from "./sheets-client.ts";

export const PIPELINE_STATUS_VALUES = [
  "New", "Researching", "Applied", "Phone Screen",
  "Interviewing", "Offer", "Rejected", "Passed", "Expired",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUS_VALUES)[number];

export type CellPatch = { index: number; value: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    date.getUTCFullYear() === Number(m[1]) &&
    date.getUTCMonth() === Number(m[2]) - 1 &&
    date.getUTCDate() === Number(m[3])
  );
}

export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function plusDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Prepend `[date] text` to a Notes cell unless that exact line is present. */
export function prependDatedNote(existing: string, text: string, date: string): string {
  const entry = `[${date}] ${text}`;
  if (!existing) return entry;
  if (existing.split("\n").some((line) => line.trim() === entry)) return existing;
  return `${entry}\n${existing}`;
}

function followUpDaysFor(status: PipelineStatus): number {
  if (status === "Applied") return 7;
  if (status === "Phone Screen") return 3;
  if (status === "Interviewing") return 5;
  return 0;
}

export type StageMoveInput = {
  to: PipelineStatus;
  now: Date;
  /** Applied only: the date the application went in (YYYY-MM-DD). */
  appliedDate?: string;
  /** Applied only: where it was submitted ("Company portal", "Referral"). */
  source?: string;
  note?: string;
  /** Expired only: the audit line to write instead of "Marked Expired". */
  auditNote?: string;
};

/**
 * Plan a stage move over a full Pipeline row. Returns the working row with
 * the move applied; the caller diffs it against the original to write only
 * the changed cells.
 */
export function planStageMove(row: string[], input: StageMoveInput): string[] {
  const next = row.slice();
  const today = isoDay(input.now);
  const note = (input.note || "").trim();
  const to = input.to;
  next[PIPELINE_COL.status] = to;

  if (to === "Applied") {
    const applied =
      (input.appliedDate || "").trim() || next[PIPELINE_COL.appliedDate] || today;
    next[PIPELINE_COL.appliedDate] = applied;
    if (!next[PIPELINE_COL.followUpDate]) {
      next[PIPELINE_COL.followUpDate] = isIsoDate(applied)
        ? plusDaysIso(applied, followUpDaysFor("Applied"))
        : plusDaysIso(today, followUpDaysFor("Applied"));
    }
    const source = (input.source || "").trim();
    const head = source ? `Applied via ${source}` : "Applied";
    next[PIPELINE_COL.notes] = prependDatedNote(
      next[PIPELINE_COL.notes] || "",
      note ? `${head}: ${note}` : head,
      today,
    );
    return next;
  }

  if (to === "Phone Screen" || to === "Interviewing") {
    if (!next[PIPELINE_COL.appliedDate]) next[PIPELINE_COL.appliedDate] = today;
    next[PIPELINE_COL.followUpDate] = plusDaysIso(today, followUpDaysFor(to));
  } else if (to === "Offer" || to === "Rejected" || to === "Passed" || to === "Expired") {
    next[PIPELINE_COL.followUpDate] = "";
  } else if (to === "New") {
    next[PIPELINE_COL.appliedDate] = "";
    next[PIPELINE_COL.followUpDate] = "";
  }

  if (to === "Expired" && input.auditNote) {
    const current = (next[PIPELINE_COL.notes] || "").trim();
    next[PIPELINE_COL.notes] = current ? `${current}\n${input.auditNote}` : input.auditNote;
    return next;
  }
  const text = note || (to === "Expired" ? "Marked Expired" : "");
  if (text) {
    next[PIPELINE_COL.notes] = prependDatedNote(next[PIPELINE_COL.notes] || "", text, today);
  }
  return next;
}
