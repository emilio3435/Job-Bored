/**
 * The user's own resume: the only source of facts a draft may use (UX01 C11).
 *
 * The dashboard sends it with every materials request as
 *   resume: { source, filename, addedAt, text }
 * and the server refuses to draft without it (422 resume_required). The
 * drafter keeps a per-role snapshot (resume-source.json) so a repair can
 * redraft from the same resume the first draft used.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RESUME_REQUIRED_CODE = "resume_required";
export const RESUME_REQUIRED_MESSAGE = "Add your resume before drafting.";
export const RESUME_SNAPSHOT_FILE = "resume-source.json";

/** Plenty for a long CV; keeps a pasted book out of the prompt. */
const MAX_RESUME_TEXT = 60_000;

/**
 * @typedef {object} ResumeSource
 * @property {string} source   Where the dashboard got it: "portfolio", "profile", "upload", …
 * @property {string} filename Display name, e.g. "jordan-rivera.pdf"; may be "".
 * @property {string} addedAt  ISO time the user added it; may be "".
 * @property {string} text     Plain text of the resume. Never empty.
 */

/**
 * @typedef {ResumeSource & { usedAt: string }} ResumeSnapshot
 */

/**
 * @param {unknown} value
 * @param {number} max
 */
function cleanString(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\r/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * @returns {Error & { statusCode: number, code: string }}
 */
export function resumeRequiredError() {
  const err = /** @type {Error & { statusCode: number, code: string }} */ (
    new Error(RESUME_REQUIRED_MESSAGE)
  );
  err.statusCode = 422;
  err.code = RESUME_REQUIRED_CODE;
  return err;
}

/**
 * Normalise a request's resume. Returns null when there is no usable text.
 * @param {unknown} raw
 * @returns {ResumeSource | null}
 */
export function normalizeResumeSource(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const text = cleanString(record.text, MAX_RESUME_TEXT);
  if (!text) return null;
  return {
    source: cleanString(record.source, 40) || "unknown",
    filename: cleanString(record.filename, 200),
    addedAt: cleanString(record.addedAt, 40),
    text,
  };
}

/**
 * Metadata only — safe to show in pending.json and the UI provenance line.
 * @param {ResumeSource} resume
 */
export function resumeProvenance(resume) {
  return {
    source: resume.source,
    filename: resume.filename,
    addedAt: resume.addedAt,
  };
}

/**
 * One line for the QA report: "Drafted from: <file> (<source>, added <date>)".
 * @param {ResumeSource} resume
 */
export function formatProvenanceLine(resume) {
  const name = resume.filename || "your resume";
  const bits = [resume.source];
  const day = /^\d{4}-\d{2}-\d{2}/.exec(resume.addedAt);
  if (day) bits.push(`added ${day[0]}`);
  return `Drafted from: ${name} (${bits.join(", ")})`;
}

/**
 * @param {string} dir the role's application folder
 * @param {ResumeSource} resume
 * @param {string} usedAt
 */
export async function writeResumeSnapshot(dir, resume, usedAt) {
  /** @type {ResumeSnapshot} */
  const snapshot = { ...resume, usedAt };
  await writeFile(join(dir, RESUME_SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/**
 * @param {string} dir the role's application folder
 * @returns {Promise<ResumeSnapshot | null>}
 */
export async function readResumeSnapshot(dir) {
  let raw;
  try {
    raw = await readFile(join(dir, RESUME_SNAPSHOT_FILE), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const resume = normalizeResumeSource(parsed);
  if (!resume) return null;
  const usedAt = cleanString(/** @type {Record<string, unknown>} */ (parsed).usedAt, 40);
  return { ...resume, usedAt };
}

/**
 * Best-effort name from the first line of a plain-text resume. Used only
 * when the writer returns no header name.
 * @param {string} text
 */
export function candidateNameFromText(text) {
  const first = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return "";
  if (first.length > 60 || /[@\d:/]/.test(first)) return "";
  if (first.split(/\s+/).length > 6) return "";
  return first;
}
