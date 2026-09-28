/**
 * What JobBored read from the resume (RESJ2-EXTRACT).
 *
 * One structured record the upload status line and the "What JobBored read
 * from your resume" panel both show: contact block, headline, summary,
 * every employer with its roles and dated achievements, skills, education,
 * certifications, awards, projects and languages, plus counts.
 *
 * The parsers are the only writers of its text (Grok review, round 3):
 *   - materials-resume-structure: employers, former names, roles, dates,
 *     achievements, education;
 *   - profile-identity: the contact block and headline;
 *   - profile-draft-shared.js readResumeLists (shared with the browser, one
 *     heading classifier): skills, certifications, awards, languages,
 *     projects, summary. It gives each skill an id.
 * The model's `resumeFacts` may only label those skill ids hard, tools or
 * soft. Any other string or id it writes is counted in `dropped` and
 * discarded. Nothing is invented: an unknown field stays empty.
 *
 * Pure except saveResumeRead / readSavedResumeRead, which keep the last AI
 * read beside profile.json so the panel can show it later.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { extractMetrics } from "./materials-ledger-build.mjs";
import { ALIAS_CLAUSE_RE, parseResumeStructure } from "./materials-resume-structure.mjs";
import { suggestIdentityFromResume, suggestionValues } from "./profile-identity.mjs";
import { resolveProfilePath } from "./user-profile.mjs";
/* The model-facts checker, shared with the browser-direct draft. A
 * classic-script global, as in profile-from-resume.mjs. */
import "./profile-draft-shared.js";

/**
 * @type {{
 *   readResumeLists: (text: string) => any,
 *   applyModelLabels: (lists: any, facts: unknown) => { skills: { hard: string[], tools: string[], soft: string[] }, dropped: number },
 * }}
 */
const profileDraft = /** @type {any} */ (globalThis).JobBoredProfileDraft;

export const RESUME_READ_VERSION = 1;
export const RESUME_READ_FILE = "resume-read.json";

const MAX_ITEMS = 60;
const MAX_ITEM_CHARS = 200;

/**
 * @typedef {{ text: string, metrics: string[] }} ReadAchievement
 * @typedef {{ title: string, start: string | null, end: string | null, present: boolean }} ReadRole
 * @typedef {{
 *   name: string,
 *   formerly: string[],
 *   location: string,
 *   start: string | null,
 *   end: string | null,
 *   roles: ReadRole[],
 *   achievements: ReadAchievement[],
 * }} ReadEmployer
 * @typedef {{
 *   version: number,
 *   textSha256: string,
 *   chars: number,
 *   readAt: string,
 *   by: { provider: string, model: string } | null,
 *   contact: { name: string, email: string, phone: string, location: string, links: Array<{ label: string, url: string }> },
 *   headline: string,
 *   summary: string,
 *   employers: ReadEmployer[],
 *   highlights: ReadAchievement[],
 *   skills: { hard: string[], tools: string[], soft: string[] },
 *   education: string[],
 *   certifications: string[],
 *   awards: string[],
 *   projects: Array<{ name: string, url: string }>,
 *   languages: string[],
 *   counts: Record<string, number>,
 *   dropped: number,
 * }} ResumeRead
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} [max] */
function clean(value, max = MAX_ITEM_CHARS) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** @param {string} text */
export function resumeTextSha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}


/* ─── The rules read ───────────────────────────────────────────────────── */

/**
 * @param {string} resumeText
 */
function readByRules(resumeText) {
  const text = String(resumeText || "").replace(/\r/g, "");
  const identity = suggestionValues(suggestIdentityFromResume(text));
  const loc = isRecord(identity.location) ? /** @type {{ city?: string, state?: string }} */ (identity.location) : {};
  const links = isRecord(identity.links) ? /** @type {Record<string, unknown>} */ (identity.links) : {};
  /** @type {Array<{ label: string, url: string }>} */
  const linkList = [];
  if (typeof links.linkedin === "string") linkList.push({ label: "LinkedIn", url: links.linkedin });
  if (typeof links.github === "string") linkList.push({ label: "GitHub", url: links.github });
  if (typeof links.website === "string") linkList.push({ label: "Website", url: links.website });
  if (Array.isArray(links.other)) {
    for (const o of links.other) {
      if (isRecord(o) && typeof o.url === "string") linkList.push({ label: clean(o.label) || "Link", url: o.url });
    }
  }

  const structure = parseResumeStructure(text);
  /** @type {ReadEmployer[]} */
  const employers = structure.employers.map((e) => {
    const formerly = [];
    for (const m of e.name.matchAll(/\((?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+([^)]+)\)/gi)) {
      formerly.push(clean(m[1]));
    }
    let name = clean(e.name.replace(/\([^)]*\)/g, " ")) || clean(e.name);
    /* "Contoso Health, formerly Litware Clinics" (Grok review, formerly-comma). */
    const clause = ALIAS_CLAUSE_RE.exec(name);
    if (clause) {
      formerly.push(clean(clause[1]));
      name = clean(name.slice(0, clause.index));
    }
    return {
      name,
      formerly,
      location: clean(e.location || ""),
      start: e.start,
      end: e.end,
      /* An open range ("– Present") is the only way a role is current. */
      roles: e.roles.map((r) => ({ title: clean(r.title), start: r.start, end: r.end, present: r.start !== null && r.end === null })),
      achievements: e.claims.map((c) => achievement(c.text)),
    };
  });

  /* Skills, certifications, awards, languages, projects and the summary
   * come from the shared list reader: one heading classifier for the
   * server and the browser, and the only writer of their text. */
  const lists = profileDraft.readResumeLists(text);
  const projectLines = new Set(lists.projectLines);
  const highlights = structure.looseClaims
    .filter((claim) => !projectLines.has(clean(claim)))
    .map((claim) => achievement(claim));

  return {
    contact: {
      name: typeof identity.fullName === "string" ? identity.fullName : "",
      email: typeof identity.email === "string" ? identity.email : "",
      phone: typeof identity.phone === "string" ? identity.phone : "",
      location: [loc.city, loc.state].filter(Boolean).join(", "),
      links: linkList,
    },
    headline: typeof identity.headline === "string" ? identity.headline : "",
    summary: lists.summary,
    employers,
    highlights,
    lists,
    education: structure.education.map((e) => clean(e)),
    certifications: lists.certifications,
    awards: lists.awards,
    projects: lists.projects,
    languages: lists.languages,
  };
}

/** @param {string} text @returns {ReadAchievement} */
function achievement(text) {
  const t = clean(text, 600);
  return { text: t, metrics: extractMetrics(t).map((m) => m.token) };
}

/* ─── Public ───────────────────────────────────────────────────────────── */

/**
 * @param {string[]} list
 */
function dedupe(list) {
  /** @type {string[]} */
  const out = [];
  for (const item of list) {
    const c = clean(item);
    if (c && !out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out.slice(0, MAX_ITEMS);
}

/**
 * Build the "what we read" record from resume text, optionally folding in
 * the model's `resumeFacts`.
 *
 * @param {string} resumeText
 * @param {{ facts?: unknown, by?: { provider: string, model: string } | null, now?: () => Date }} [opts]
 * @returns {ResumeRead}
 */
export function buildResumeRead(resumeText, opts = {}) {
  const text = String(resumeText || "").replace(/\r/g, "").trim();
  const { lists, ...rules } = readByRules(text);
  /* The model's part: labels for the parser's skill ids. Its text is never
   * stored; anything else it wrote is counted in `dropped` (Grok review,
   * round 3). */
  const { skills, dropped } = profileDraft.applyModelLabels(lists, opts.facts);
  const read = {
    ...rules,
    skills,
    certifications: dedupe(rules.certifications),
    awards: dedupe(rules.awards),
    languages: dedupe(rules.languages),
    education: dedupe(rules.education),
  };

  const achievements = read.employers.flatMap((e) => e.achievements).concat(read.highlights);
  const counts = {
    employers: read.employers.length,
    roles: read.employers.reduce((n, e) => n + e.roles.length, 0),
    achievements: achievements.length,
    withNumbers: achievements.filter((a) => a.metrics.length > 0).length,
    skills: read.skills.hard.length + read.skills.tools.length + read.skills.soft.length,
    education: read.education.length,
    certifications: read.certifications.length,
    awards: read.awards.length,
    projects: read.projects.length,
    languages: read.languages.length,
    links: read.contact.links.length,
  };
  return {
    version: RESUME_READ_VERSION,
    textSha256: resumeTextSha256(text),
    chars: text.length,
    readAt: (opts.now ? opts.now() : new Date()).toISOString(),
    by: opts.by && opts.by.model ? { provider: String(opts.by.provider || ""), model: String(opts.by.model) } : null,
    ...read,
    counts,
    dropped,
  };
}


/** resume-read.json beside profile.json (JOBBORED_PROFILE_PATH aware). */
export function resumeReadPath() {
  return join(dirname(resolveProfilePath()), RESUME_READ_FILE);
}

/**
 * Keep the last read so the panel can show it after a reload. Atomic, and
 * best-effort: a refused write never fails the upload.
 * @param {ResumeRead} read
 * @param {{ path?: string }} [options]
 */
export async function saveResumeRead(read, options = {}) {
  const path = options.path || resumeReadPath();
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, `${JSON.stringify(read, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
    return path;
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
    return null;
  }
}

/**
 * The saved read, when it was made from `resumeText`; otherwise null.
 * @param {string} resumeText
 * @param {{ path?: string }} [options]
 * @returns {Promise<ResumeRead | null>}
 */
export async function readSavedResumeRead(resumeText, options = {}) {
  try {
    const parsed = JSON.parse(await readFile(options.path || resumeReadPath(), "utf8"));
    if (!isRecord(parsed) || parsed.version !== RESUME_READ_VERSION) return null;
    if (parsed.textSha256 !== resumeTextSha256(String(resumeText || "").replace(/\r/g, "").trim())) return null;
    return /** @type {ResumeRead} */ (parsed);
  } catch {
    return null;
  }
}
