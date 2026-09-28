/**
 * "Your voice": the voice guide the materials pipeline reads, stored as
 * Markdown at ~/.jobbored/profile/voice.md.
 *
 * The path is the one server/materials-pipeline.mjs readVoiceOverride()
 * reads (homedir() + .jobbored/profile/voice.md), so a guide saved here is
 * the guide drafting uses. This module only captures and stores it; how a
 * draft uses it lives in the pipeline.
 *
 * Writes never lose a guide:
 *   - a save goes to a temp file beside the target and is renamed over it
 *     (atomic on one filesystem, POSIX and Windows alike);
 *   - any previous guide is first copied to voice.md.bak.<timestamp>;
 *   - a caller that read the guide can pass the `updatedAt` it saw and the
 *     save is refused (409) if the file changed since;
 *   - removing moves the file to a backup instead of deleting it.
 * Backup names use a filesystem-safe timestamp (no ":"; Windows refuses it).
 */
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import "./profile-voice-shared.js";

/**
 * @typedef {object} ProfileVoiceShared
 * @property {number} MAX_VOICE_BYTES
 * @property {string} VOICE_GUIDE_PROMPT
 * @property {(value: unknown) => string} normalizeVoiceText
 * @property {(text: string) => number} byteLength
 * @property {(text: string) => boolean} looksBinary
 * @property {(text: string) => number} countWords
 * @property {(value: unknown) => "" | "empty" | "too_large" | "binary"} voiceProblem
 */
/** @type {ProfileVoiceShared} */
const shared = /** @type {any} */ (globalThis).JobBoredProfileVoiceShared;

export const MAX_VOICE_BYTES = shared.MAX_VOICE_BYTES;
export const { normalizeVoiceText, countWords, voiceProblem } = shared;

/** Where the guide lives: the path the materials pipeline reads. */
export function resolveVoicePath() {
  return join(homedir(), ".jobbored", "profile", "voice.md");
}

/**
 * A timestamp that is safe in a file name on every OS.
 * @param {Date} [date]
 */
function backupStamp(date = new Date()) {
  return date.toISOString().replace(/:/g, "-");
}

/**
 * The next free backup path for `path`: voice.md.bak.<stamp>, with a
 * counter when two land in the same millisecond.
 * @param {string} path
 */
function backupPathFor(path) {
  const base = `${path}.bak.${backupStamp()}`;
  if (!existsSync(base)) return base;
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${process.pid}-${Date.now()}`;
}

/**
 * @param {string} path
 * @returns {Promise<{ mtime: string } | null>}
 */
async function statOrNull(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { mtime: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

/**
 * The file a save writes: the guide itself, or what it links to when the
 * user keeps voice.md as a symlink (replacing the link with a copy would
 * quietly detach it from their own file).
 * @param {string} path
 */
async function writeTarget(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return await realpath(path);
  } catch {
    // Missing: write the path itself.
  }
  return path;
}

/**
 * The saved guide.
 * @returns {Promise<{ exists: boolean, text: string, updatedAt: string | null, words: number }>}
 */
export async function readVoice() {
  const path = resolveVoicePath();
  const info = await statOrNull(path);
  if (!info) return { exists: false, text: "", updatedAt: null, words: 0 };
  const text = await readFile(path, "utf8");
  return { exists: true, text, updatedAt: info.mtime, words: countWords(text) };
}

/**
 * An error a route can answer with a status and a reason code.
 * @param {number} status
 * @param {string} reason
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function voiceError(status, reason, message, extra = {}) {
  const err = /** @type {Error & { status: number, reason: string, extra: Record<string, unknown> }} */ (
    new Error(message)
  );
  err.status = status;
  err.reason = reason;
  err.extra = extra;
  return err;
}

const PROBLEM_MESSAGES = Object.freeze({
  empty: "The voice guide is empty. Paste or upload the guide, then save.",
  binary: "That doesn't look like text. Save the guide as Markdown (.md) or plain text (.txt).",
  too_large: `The voice guide is over ${Math.round(MAX_VOICE_BYTES / 1024)} KB. Trim it and save again.`,
});

/**
 * Save `text` as the guide.
 *
 * @param {unknown} text
 * @param {{ ifUpdatedAt?: string | null }} [options] the `updatedAt` the
 *   caller read (null: it saw no guide). When given and the file has
 *   changed since, nothing is written and a 409 `changed` error is thrown.
 * @returns {Promise<{ exists: true, updatedAt: string, words: number, backup: string | null, unchanged: boolean }>}
 */
export async function saveVoice(text, options = {}) {
  const problem = voiceProblem(text);
  if (problem) {
    throw voiceError(problem === "too_large" ? 413 : 400, problem, PROBLEM_MESSAGES[problem], {
      maxBytes: MAX_VOICE_BYTES,
    });
  }
  const body = `${normalizeVoiceText(text)}\n`;
  const path = await writeTarget(resolveVoicePath());
  const current = await statOrNull(path);
  if (options.ifUpdatedAt !== undefined) {
    const seen = options.ifUpdatedAt || null;
    const now = current ? current.mtime : null;
    if (seen !== now) {
      throw voiceError(
        409,
        "changed",
        "Your voice guide changed since this page loaded. Reload it, then save again.",
        { updatedAt: now },
      );
    }
  }
  await mkdir(dirname(path), { recursive: true });
  let backup = null;
  if (current) {
    const previous = await readFile(path, "utf8");
    if (previous === body) {
      return { exists: true, updatedAt: current.mtime, words: countWords(body), backup: null, unchanged: true };
    }
    const target = backupPathFor(path);
    await copyFile(path, target);
    backup = basename(target);
  }
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, path);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
  const saved = await statOrNull(path);
  return {
    exists: true,
    updatedAt: saved ? saved.mtime : new Date().toISOString(),
    words: countWords(body),
    backup,
    unchanged: false,
  };
}

/**
 * Remove the guide by moving it to a backup. Throws a 404 `not_found`
 * error when there is none.
 * @returns {Promise<{ exists: false, backup: string }>}
 */
export async function removeVoice() {
  const path = resolveVoicePath();
  if (!(await statOrNull(path))) {
    throw voiceError(404, "not_found", "There is no voice guide to remove.");
  }
  const target = backupPathFor(path);
  await rename(path, target);
  return { exists: false, backup: basename(target) };
}

/**
 * @param {unknown} err
 * @returns {err is Error & { status: number, reason: string, extra: Record<string, unknown> }}
 */
export function isVoiceError(err) {
  return !!err && typeof err === "object" && typeof (/** @type {any} */ (err).status) === "number" &&
    typeof (/** @type {any} */ (err).reason) === "string";
}
