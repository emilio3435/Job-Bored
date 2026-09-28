/**
 * The user's own resume: the only source of facts a draft may use (UX01 C11).
 *
 * The dashboard sends it with every materials request as
 *   resume: { source, filename, addedAt, text }
 * and the server refuses to draft without it (422 resume_required). The
 * drafter keeps a per-role snapshot (resume-source.json) so a repair can
 * redraft from the same resume the first draft used.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveProfilePath } from "./user-profile.mjs";

export const RESUME_REQUIRED_CODE = "resume_required";
export const RESUME_REQUIRED_MESSAGE = "Add your resume before drafting.";
export const RESUME_SNAPSHOT_FILE = "resume-source.json";
export const RESUME_GARBLED_CODE = "resume_garbled";
export const RESUME_GARBLED_MESSAGE =
  "Your resume text looks garbled (it was probably copied out of a PDF). Re-add it as a .docx or plain text before drafting.";
export const RESUME_GARBLED_FALLBACK_MESSAGE = "Resume text looked garbled; used your saved resume instead.";

/** Plenty for a long CV; keeps a pasted book out of the prompt. */
const MAX_RESUME_TEXT = 60_000;

/**
 * @typedef {object} ResumeSource
 * @property {string} source   Where the dashboard got it: "portfolio", "profile", "upload", …
 * @property {string} filename Display name, e.g. "jordan-rivera.pdf"; may be "".
 * @property {string} addedAt  ISO time the user added it; may be "".
 * @property {string} text     Plain text of the resume. Never empty.
 * @property {boolean} [pinned] the user chose this exact resume for drafts;
 *   it wins over a newer saved resume (never over the garbled-text guard)
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
  /** @type {ResumeSource} */
  const out = {
    source: cleanString(record.source, 40) || "unknown",
    filename: cleanString(record.filename, 200),
    addedAt: cleanString(record.addedAt, 40),
    text,
  };
  if (record.pinned === true) out.pinned = true;
  return out;
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

/* A nickname set off in paired quotes or parentheses on the name line
 * ("JORDAN “JO” RIVERA", 'Robert "Bob" Smith', 'Ana (Annie) Ruiz').
 * Straight single quotes count only as a whole word ("ALEX 'SANDY' QUINN"),
 * so the apostrophe in O'Brien and D'Angelo survives. */
const NICKNAME_RE =
  /\s*(?:“[^”\n]{1,24}”|"[^"\n]{1,24}"|‘[^’\n]{1,24}’|\([^)\n]{1,24}\)|(?<!\S)'[^'\s][^'\n]{0,23}'(?!\S))\s*/gu;

/**
 * The candidate's legal display name: nicknames are never rendered.
 * @param {string} name
 */
export function stripNickname(name) {
  return String(name || "").replace(NICKNAME_RE, " ").replace(/\s+/g, " ").trim();
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
  return stripNickname(first);
}

/* ------------------------------------------------------------------ *
 * Garbled text: a resume copied out of a PDF whose text layer splits
 * words and figures ("S ummary", "$ 10 M +", "top -3", "Search , YouTube").
 * Drafting from it prints split figures and loses the name line.
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} GarbleReport
 * @property {boolean} garbled
 * @property {number} score weighted signal count
 * @property {number} words
 * @property {boolean} nameLine the first line reads as a person's name
 * @property {{ splitWords: number, spacedPunctuation: number, spacedMetrics: number, orphanLetters: number }} signals
 */

/** @param {string} text @param {RegExp} re */
function count(text, re) {
  return (text.match(re) || []).length;
}

/* Words a PDF text layer splits after their capital ("S ummary",
 * "E xperience", "M anaged"): resume headings, verbs and titles. A lone
 * capital before anything else is a real token ("C programming",
 * "Plan B", "C for"), not damage (RESJ K3-FP/K3-FN). Mirrored in
 * resume-ingest.js; tests pin the two detectors equal. */
/* Section headings: two split ones are decisive (RESJ K3-LEN). */
const SPLIT_HEADING_WORDS = new Set(
  "summary experience skills education profile projects certifications certificates languages awards objective employment leadership achievements accomplishments professional technical competencies volunteer publications interests references contact highlights career history training tools qualifications expertise responsibilities strengths selected work core key about honors activities affiliations memberships courses coursework portfolio overview background research teaching speaking patents".split(" "),
);
const SPLIT_JOINED_WORDS = new Set([
  ...SPLIT_HEADING_WORDS,
  ..."managed led built grew drove launched created developed designed owned delivered increased reduced improved implemented directed established executed generated negotiated oversaw partnered produced scaled shipped spearheaded streamlined supervised trained wrote analyzed coordinated mentored optimized senior director manager marketing product engineer engineering analyst specialist consultant president present company university college bachelor master associate performance growth strategy sales operations".split(" "),
]);

/**
 * Capitals split off their word, wherever they sit: the joined form is a
 * known resume word ("S ummary" → summary). `headings` counts the ones
 * that are section headings.
 * @param {string} text
 * @returns {{ words: number, headings: number }}
 */
function countSplitWords(text) {
  let words = 0;
  let headings = 0;
  /* A and I too ("A wards", "I nterests"); "Type A", "A/B" and
   * "I managed" never join into a listed word (RESJ K3-AI). */
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])([A-Z]) ([a-z]{2,})/gu)) {
    const joined = (m[1] + m[2]).toLowerCase();
    if (!SPLIT_JOINED_WORDS.has(joined)) continue;
    words += 1;
    if (SPLIT_HEADING_WORDS.has(joined)) headings += 1;
  }
  return { words, headings };
}

/**
 * Score a resume's text for PDF split-glyph damage. Clean text scores 0;
 * the damaged shape scores in the hundreds, so the threshold has room.
 * @param {string} text
 * @returns {GarbleReport}
 */
export function detectGarbledResume(text) {
  const t = String(text || "");
  const words = t.split(/\s+/).filter(Boolean).length;
  const split = countSplitWords(t);
  const signals = {
    /* A capital glyph split off a listed resume word: "S ummary",
     * "A wards" (countSplitWords). */
    splitWords: split.words,
    /* Space before a comma, semicolon, colon, full stop or closing paren,
     * or after an opening paren: "Search , YouTube", "( Search". */
    spacedPunctuation:
      count(t, /[\p{L}\p{N}] [,;:)](?=\s|$)/gu) + count(t, /[\p{L}\p{N}] \.(?=\s|$)/gu) + count(t, /\( [\p{L}\p{N}]/gu),
    /* Figures split from their unit: "$ 10", "10 M +", "top -3", "12 %". */
    spacedMetrics: count(t, /\$ \d|\d [KMB](?![\w&])|\btop -\d|\d \+(?=\s|$)|\d %|# \d/g),
    /* Lone lowercase letters that are not words ("t o", "a n d" leave b-z
     * orphans). A lone capital is either a split capital, scored above, or
     * a real token ("Plan B", "Gen X"). */
    orphanLetters: count(t, /(?<=\s)[b-hj-z](?=\s)/g),
  };
  const score =
    signals.splitWords * 3 + signals.spacedPunctuation + signals.spacedMetrics * 3 + signals.orphanLetters;
  const nameLine = Boolean(candidateNameFromText(t));
  const density = words ? (score / words) * 100 : 0;
  /* Two split section headings are damage at any length (RESJ K3-LEN). */
  const garbled = split.headings >= 2 || (score >= 12 && density >= 2) || (score >= 6 && !nameLine);
  return { garbled, score, words, nameLine, signals };
}

/**
 * Re-join figures a PDF text layer split apart: "$ 10 M +" → "$12M+",
 * "top -3" → "top-4", "2.4 M" → "2.4M", "12 %" → "12%", "# 19" → "#17".
 * Clean text passes through unchanged.
 * @param {string} text
 */
export function desplitMetricTokens(text) {
  return String(text || "")
    .replace(/\$\s+(?=\d)/g, "$")
    .replace(/#\s+(?=\d)/g, "#")
    .replace(/\b(top)\s*-\s*(?=\d)/gi, "$1-")
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/(\d)\s+([KMB])(?![\w&])(\s*\+)?/g, (_m, digit, unit, plus) => `${digit}${unit}${plus ? "+" : ""}`)
    .replace(/(\d)\s+\+(?=\s|$|[,.;:)])/g, "$1+");
}

/* ------------------------------------------------------------------ *
 * Which resume a draft uses
 * ------------------------------------------------------------------ */

export const CANONICAL_RESUME_FILE = "resume.txt";

/**
 * The user's saved resume: resume.txt beside profile.json (the file every
 * resume upload is cached to), with its modification time as addedAt.
 * @param {{ path?: string }} [options]
 * @returns {Promise<ResumeSource | null>}
 */
export async function readCanonicalResume(options = {}) {
  let path = options.path;
  if (!path) {
    try {
      path = join(dirname(resolveProfilePath()), CANONICAL_RESUME_FILE);
    } catch {
      return null;
    }
  }
  let raw;
  let mtime;
  try {
    [raw, mtime] = await Promise.all([readFile(path, "utf8"), stat(path).then((s) => s.mtime)]);
  } catch {
    return null;
  }
  const text = cleanString(raw, MAX_RESUME_TEXT);
  if (!text) return null;
  return { source: "saved", filename: CANONICAL_RESUME_FILE, addedAt: mtime.toISOString(), text };
}

/**
 * @typedef {"current" | "pinned" | "saved_newer" | "request_newer" | "request_garbled" | "saved_garbled" | "request_only" | "saved_only"} ResumeChoiceReason
 */

/**
 * @typedef {object} ResumeChoice
 * @property {"request" | "saved"} used which resume the draft uses
 * @property {ResumeChoiceReason} reason
 * @property {string} [message] a line for the user when the draft chose
 * @property {{ code: string, message: string }} [degraded] a named degraded reason
 * @property {{ source: string, filename: string, addedAt: string, garbled: boolean } | null} requested
 * @property {{ source: string, filename: string, addedAt: string, garbled: boolean } | null} saved
 */

/** @param {string} text */
function sameText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** @param {string} iso */
function dayOf(iso) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(iso || "");
  return m ? m[0] : "an earlier date";
}

/**
 * @returns {Error & { statusCode: number, code: string }}
 */
export function resumeGarbledError() {
  const err = /** @type {Error & { statusCode: number, code: string }} */ (new Error(RESUME_GARBLED_MESSAGE));
  err.statusCode = 422;
  err.code = RESUME_GARBLED_CODE;
  return err;
}

/**
 * Pick the resume a draft uses: the user's current one, never garbled text
 * and never an older copy when a newer saved resume exists.
 *
 *   1. Garbled text is never used; the other source wins, and the choice
 *      carries the named degraded reason. Both garbled → 422 resume_garbled.
 *   2. A resume the user pinned wins.
 *   3. Same text → the request's (nothing to choose).
 *   4. Otherwise the newer one: the request's addedAt against the saved
 *      resume's modification time. A request with no date loses.
 *
 * @param {{ requested: ResumeSource | null, saved: ResumeSource | null }} input
 * @returns {{ resume: ResumeSource, choice: ResumeChoice }}
 */
export function chooseResumeSource({ requested, saved }) {
  const reqGarbled = requested ? detectGarbledResume(requested.text).garbled : false;
  const savGarbled = saved ? detectGarbledResume(saved.text).garbled : false;
  /** @param {ResumeSource | null} r @param {boolean} garbled */
  const meta = (r, garbled) => (r ? { source: r.source, filename: r.filename, addedAt: r.addedAt, garbled } : null);
  const base = { requested: meta(requested, reqGarbled), saved: meta(saved, savGarbled) };
  const reqOk = Boolean(requested) && !reqGarbled;
  const savOk = Boolean(saved) && !savGarbled;
  const req = /** @type {ResumeSource} */ (requested);
  const sav = /** @type {ResumeSource} */ (saved);

  if (!reqOk && !savOk) {
    if (reqGarbled || savGarbled) throw resumeGarbledError();
    throw resumeRequiredError();
  }
  if (!reqOk && savOk) {
    if (reqGarbled) {
      const degraded = { code: RESUME_GARBLED_CODE, message: RESUME_GARBLED_FALLBACK_MESSAGE };
      return { resume: sav, choice: { used: "saved", reason: "request_garbled", message: degraded.message, degraded, ...base } };
    }
    return { resume: sav, choice: { used: "saved", reason: "saved_only", ...base } };
  }
  if (reqOk && !savOk) {
    return { resume: req, choice: { used: "request", reason: savGarbled ? "saved_garbled" : "request_only", ...base } };
  }
  if (req.pinned) return { resume: req, choice: { used: "request", reason: "pinned", ...base } };
  if (sameText(req.text) === sameText(sav.text)) return { resume: req, choice: { used: "request", reason: "current", ...base } };
  const reqAt = Date.parse(req.addedAt);
  const savAt = Date.parse(sav.addedAt);
  if (!Number.isFinite(reqAt) || (Number.isFinite(savAt) && savAt > reqAt)) {
    return {
      resume: sav,
      choice: {
        used: "saved",
        reason: "saved_newer",
        message: `Used your newer saved resume (updated ${dayOf(sav.addedAt)}) instead of the older copy this browser sent (added ${dayOf(req.addedAt)}).`,
        ...base,
      },
    };
  }
  return { resume: req, choice: { used: "request", reason: "request_newer", ...base } };
}

/**
 * @typedef {object} RunResumeBlock
 * @property {string} [source]
 * @property {string} [filename]
 * @property {string} [addedAt]
 * @property {"request" | "saved"} used
 * @property {ResumeChoiceReason} reason
 * @property {string} [message]
 * @property {{ code: string, message: string }} [degraded]
 */

/**
 * run.json's `resume` block: the resume the draft used and why.
 * @param {ResumeSource} resume the resume the draft used
 * @param {ResumeChoice | undefined} choice
 * @returns {RunResumeBlock}
 */
export function runResumeBlock(resume, choice) {
  /** @type {RunResumeBlock} */
  const block = {
    source: resume.source,
    filename: resume.filename,
    addedAt: resume.addedAt,
    used: choice ? choice.used : "request",
    reason: choice ? choice.reason : "request_only",
  };
  if (choice?.message) block.message = choice.message;
  if (choice?.degraded) block.degraded = { ...choice.degraded };
  return block;
}
