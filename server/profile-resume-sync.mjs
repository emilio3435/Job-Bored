/**
 * The server copy of the user's resume (RESJ K1, K2).
 *
 *   PUT /profile/resume  { resumeText } → writes resume.txt beside
 *     profile.json, the canonical file drafts, the claim ledger and the
 *     contact suggestions read. No AI call. Atomic (temp file + rename),
 *     size-capped, and garbled PDF text is refused so it can never replace
 *     a good saved resume.
 *
 *   GET /profile/resume/read → what JobBored read from the saved resume
 *     (RESJ2-EXTRACT), for the Settings panel.
 *
 *   suggestContactFromSources() → what POST /profile/contact/suggest
 *     answers: garbled or empty request text falls back to the saved
 *     resume, and when both are usable each field comes from whichever
 *     source has it (the request's text wins a tie).
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getStoredResumeText } from "./profile-from-resume.mjs";
import { MAX_OTHER_LINKS, hostLabel, suggestIdentityFromResume, suggestionValues } from "./profile-identity.mjs";
import {
  CANONICAL_RESUME_FILE,
  RESUME_GARBLED_CODE,
  RESUME_GARBLED_MESSAGE,
  detectGarbledResume,
  readCanonicalResume,
} from "./materials-resume-source.mjs";
import { resolveProfilePath } from "./user-profile.mjs";
import { buildResumeRead, readSavedResumeRead } from "./resume-read.mjs";

/** Same cap every other resume reader uses. */
export const MAX_RESUME_SYNC_CHARS = 60_000;

/** The canonical resume.txt: beside profile.json (JOBBORED_PROFILE_PATH aware). */
export function canonicalResumePath() {
  return join(dirname(resolveProfilePath()), CANONICAL_RESUME_FILE);
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, text: string } | { ok: false, status: number, reason: string, message: string }}
 */
export function validateResumeSync(body) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : {};
  const text = typeof record.resumeText === "string" ? record.resumeText.replace(/\r/g, "").trim() : "";
  if (!text) {
    return { ok: false, status: 400, reason: "resume_empty", message: "Send the resume text to save." };
  }
  if (text.length > MAX_RESUME_SYNC_CHARS) {
    return {
      ok: false,
      status: 413,
      reason: "resume_too_long",
      message: `That resume is over ${MAX_RESUME_SYNC_CHARS.toLocaleString("en-US")} characters. Trim it and save again.`,
    };
  }
  if (detectGarbledResume(text).garbled) {
    return { ok: false, status: 422, reason: RESUME_GARBLED_CODE, message: RESUME_GARBLED_MESSAGE };
  }
  return { ok: true, text };
}

/**
 * Write the canonical resume atomically: a temp file in the same folder,
 * then rename over the old one, so a crash never leaves half a resume.
 * @param {string} text
 * @param {{ path?: string }} [options]
 * @returns {Promise<{ path: string, savedAt: string }>}
 */
export async function writeCanonicalResume(text, options = {}) {
  const path = options.path || canonicalResumePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${text}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  const { mtime } = await stat(path);
  return { path, savedAt: mtime.toISOString() };
}

/**
 * GET /profile/resume/read → { ok, read } for the "What JobBored read from
 * your resume" panel: the last AI read of the saved resume when it was made
 * from that exact text, otherwise a rules-only read of it (read.by is null).
 * read is null when no usable resume is saved. Never calls a model.
 * @param {{ readSaved?: () => Promise<string>, readSavedRead?: typeof readSavedResumeRead }} [deps]
 */
export async function currentResumeRead(deps = {}) {
  const text = await (deps.readSaved || readUsableSavedResume)();
  if (!text) return null;
  return (await (deps.readSavedRead || readSavedResumeRead)(text)) || buildResumeRead(text);
}

/** @typedef {(path: string, handler: (req: import("express").Request, res: import("express").Response) => unknown) => unknown} RouteMount */
/** @param {{ put: RouteMount, get: RouteMount }} app */
export function mountProfileResume(app) {
  app.get("/profile/resume/read", async (_req, res) => {
    try {
      return res.json({ ok: true, read: await currentResumeRead() });
    } catch {
      return res.status(500).json({
        ok: false,
        reason: "read_failed",
        message: "JobBored's server couldn't read your saved resume.",
      });
    }
  });
  app.put("/profile/resume", async (req, res) => {
    const checked = validateResumeSync(req.body);
    if (!checked.ok) {
      return res.status(checked.status).json({ ok: false, reason: checked.reason, message: checked.message });
    }
    try {
      const { savedAt } = await writeCanonicalResume(checked.text);
      return res.json({ ok: true, chars: checked.text.length, savedAt });
    } catch {
      return res.status(500).json({
        ok: false,
        reason: "write_failed",
        message: "JobBored's server couldn't save your resume file.",
      });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Contact suggestions from the request's text and the saved resume
 * ------------------------------------------------------------------ */

/** The saved resume, clean text only: resume.txt beside profile.json first. */
async function readUsableSavedResume() {
  const candidates = [
    () => readCanonicalResume(),
    () => getStoredResumeText(),
  ];
  for (const read of candidates) {
    let found = null;
    try {
      found = await read();
    } catch {
      found = null;
    }
    const text = found && typeof found.text === "string" ? found.text.trim() : "";
    if (text && !detectGarbledResume(text).garbled) return text.slice(0, MAX_RESUME_SYNC_CHARS);
  }
  return "";
}

/**
 * @typedef {ReturnType<typeof suggestIdentityFromResume>} IdentitySuggestions
 */

/**
 * Overflow links from both resumes, by URL, the first source's first,
 * capped where the extractor caps them.
 * @param {IdentitySuggestions["links"]["other"]} first
 * @param {IdentitySuggestions["links"]["other"]} second
 */
function unionOtherLinks(first, second) {
  /** @type {IdentitySuggestions["links"]["other"]} */
  const out = [];
  for (const link of [...first, ...second]) {
    if (out.length >= MAX_OTHER_LINKS) break;
    if (!out.some((o) => o.value.url === link.value.url)) out.push(link);
  }
  return out;
}

/**
 * The second source's website when the first source's took the one
 * website slot, as an other-link so it isn't dropped (K2-OTHER round 2).
 * @param {IdentitySuggestions["links"]["website"]} kept
 * @param {IdentitySuggestions["links"]["website"]} other
 * @returns {IdentitySuggestions["links"]["other"]}
 */
function displacedWebsite(kept, other) {
  if (!kept || !other || kept.value === other.value) return [];
  return [{ value: { label: hostLabel(other.value), url: other.value }, confidence: other.confidence }];
}

/**
 * Field by field: the first suggestion that has a value.
 * @param {IdentitySuggestions} primary
 * @param {IdentitySuggestions} secondary
 * @returns {{ suggestions: IdentitySuggestions, usedSecondary: boolean }}
 */
export function mergeSuggestions(primary, secondary) {
  let usedSecondary = false;
  /** @template T @param {T | null} a @param {T | null} b */
  const pick = (a, b) => {
    if (a) return a;
    if (b) usedSecondary = true;
    return b;
  };
  const suggestions = {
    fullName: pick(primary.fullName, secondary.fullName),
    headline: pick(primary.headline, secondary.headline),
    email: pick(primary.email, secondary.email),
    phone: pick(primary.phone, secondary.phone),
    location: pick(primary.location, secondary.location),
    links: {
      linkedin: pick(primary.links.linkedin, secondary.links.linkedin),
      website: pick(primary.links.website, secondary.links.website),
      github: pick(primary.links.github, secondary.links.github),
      other: unionOtherLinks(primary.links.other, [
        ...displacedWebsite(primary.links.website, secondary.links.website),
        ...secondary.links.other,
      ]),
    },
  };
  if (suggestions.links.other.length > primary.links.other.length) usedSecondary = true;
  return { suggestions, usedSecondary };
}

/**
 * What POST /profile/contact/suggest answers.
 *
 * source: "request"  — only the request's text had details
 *         "stored"   — the request's text was empty, garbled or had no
 *                      details; the saved resume filled the form
 *         "merged"   — both were usable and each added fields
 *         "none"     — nothing to read
 * requestGarbled tells the browser why it fell back.
 *
 * @param {unknown} body
 * @param {{ readSaved?: () => Promise<string> }} [deps]
 */
export async function suggestContactFromSources(body, deps = {}) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : {};
  const staged = typeof record.resumeText === "string" ? record.resumeText.trim().slice(0, MAX_RESUME_SYNC_CHARS) : "";
  const requestGarbled = Boolean(staged) && detectGarbledResume(staged).garbled;
  const requestText = requestGarbled ? "" : staged;
  const savedText = await (deps.readSaved || readUsableSavedResume)();

  const fromRequest = suggestIdentityFromResume(requestText);
  const fromSaved = suggestIdentityFromResume(savedText);
  /** @type {"request" | "stored" | "merged" | "none"} */
  let source;
  let suggestions;
  /* A readable request with no details at all (a note, not a resume)
   * adds nothing: the saved resume filled the form. */
  const requestHasDetails = Object.keys(suggestionValues(fromRequest)).length > 0;
  if (requestText && (requestHasDetails || !savedText)) {
    const merged = mergeSuggestions(fromRequest, fromSaved);
    suggestions = merged.suggestions;
    source = merged.usedSecondary ? "merged" : "request";
  } else if (savedText) {
    suggestions = fromSaved;
    source = "stored";
  } else {
    suggestions = fromRequest;
    source = "none";
  }
  return { ok: true, source, requestGarbled, suggestions, values: suggestionValues(suggestions) };
}
