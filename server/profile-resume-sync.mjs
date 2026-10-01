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
 *     answers (JOBQA): the request's text alone when it sends one — never
 *     mixed with, or swapped for, the saved resume, which may be another
 *     person's — and the saved resume only on an explicit
 *     `source: "saved"` with no text (Settings' "Re-fill").
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getStoredResumeText } from "./profile-from-resume.mjs";
import { suggestIdentityFromResume, suggestionValues } from "./profile-identity.mjs";
import {
  CANONICAL_RESUME_FILE,
  RESUME_GARBLED_CODE,
  RESUME_GARBLED_MESSAGE,
  detectGarbledResume,
  readCanonicalResume,
} from "./materials-resume-source.mjs";
import { resolveProfilePath } from "./user-profile.mjs";
import { readSavedResumeRead } from "./resume-read.mjs";

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
 * your resume" panel: the last quote-grounded model read of the saved resume
 * when it was made from that exact text. Missing or stale reads return null.
 * Never calls a model.
 * @param {{ readSaved?: () => Promise<string>, readSavedRead?: typeof readSavedResumeRead }} [deps]
 */
export async function currentResumeRead(deps = {}) {
  const text = await (deps.readSaved || readUsableSavedResume)();
  if (!text) return null;
  return (await (deps.readSavedRead || readSavedResumeRead)(text)) || null;
}

/** @typedef {(path: string, handler: (req: import("express").Request, res: import("express").Response) => unknown) => unknown} RouteMount */
/** @typedef {(req: import("express").Request, res: import("express").Response) => unknown} ResumeHandler */
/**
 * @param {{ put: RouteMount, get: RouteMount }} app
 * @param {{ guard?: (handler: ResumeHandler) => any }} [options] `guard` wraps
 *   the resume save so it never interleaves with onboarding's commit (JOBQA).
 */
export function mountProfileResume(app, options = {}) {
  const guard = options.guard || ((/** @type {ResumeHandler} */ handler) => handler);
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
  app.put("/profile/resume", guard(async (req, res) => {
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
  }));
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
 * What POST /profile/contact/suggest answers.
 *
 * source: "request"  — the request's text had details
 *         "stored"   — an explicit `source: "saved"` request with no text;
 *                      the saved resume filled the form
 *         "none"     — nothing to read: no text, garbled text, a note with
 *                      no details, or no saved resume
 * requestGarbled tells the browser why its text gave nothing. A request's
 * text is never mixed with or swapped for the saved resume: on a machine
 * whose saved resume belongs to someone else, that filled a new person's
 * form with the old person's phone and links (JOBQA).
 *
 * @param {unknown} body
 * @param {{ readSaved?: () => Promise<string> }} [deps]
 */
export async function suggestContactFromSources(body, deps = {}) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : {};
  const staged = typeof record.resumeText === "string" ? record.resumeText.trim().slice(0, MAX_RESUME_SYNC_CHARS) : "";
  const requestGarbled = Boolean(staged) && detectGarbledResume(staged).garbled;
  /** @type {"request" | "stored" | "none"} */
  let source = "none";
  let text = "";
  if (staged) {
    text = requestGarbled ? "" : staged;
  } else if (record.source === "saved") {
    text = await (deps.readSaved || readUsableSavedResume)();
  }
  const suggestions = suggestIdentityFromResume(text);
  const values = suggestionValues(suggestions);
  if (Object.keys(values).length) source = staged ? "request" : "stored";
  return { ok: true, source, requestGarbled, suggestions, values };
}
