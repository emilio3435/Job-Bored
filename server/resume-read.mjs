/**
 * Model-grounded "what JobBored read from the resume" projection.
 *
 * The profile model supplies quote-grounded contact, headline, summary,
 * skills, certifications, awards, projects and languages. The resume
 * structure model supplies quote-grounded employers, roles, dates, claims,
 * education and credentials. This module projects those validated outputs;
 * it never classifies or extracts facts from resume text.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { extractMetrics } from "./materials-ledger-build.mjs";
import { ALIAS_CLAUSE_RE } from "./materials-resume-structure.mjs";
import "./profile-draft-shared.js";
import { resolveProfilePath } from "./user-profile.mjs";

/**
 * @typedef {object} ValidatedResumeFacts
 * @property {{ name: string, email: string, phone: string, location: string, links: Array<{label:string,url:string}> }} contact
 * @property {string} headline
 * @property {string} summary
 * @property {{ hard: string[], tools: string[], soft: string[] }} skills
 * @property {string[]} certifications
 * @property {string[]} awards
 * @property {Array<{name:string,url:string}>} projects
 * @property {string[]} languages
 * @property {number} dropped
 */

const profileDraft = /** @type {{ validateResumeFacts: (facts: unknown, text: string) => ValidatedResumeFacts } | undefined} */ (
  /** @type {any} */ (globalThis).JobBoredProfileDraft
);

export const RESUME_READ_VERSION = 2;
export const RESUME_READ_FILE = "resume-read.json";
const MAX_ITEMS = 60;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} [max] */
function clean(value, max = 200) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** @param {unknown} value */
function openDate(value) {
  return value == null || /^(?:present|current|now|today)$/i.test(String(value).trim());
}

/** Format an alias that the structure model included in the company name. */
/** @param {unknown} value */
function employerDisplayName(value) {
  const original = clean(value);
  const formerly = [];
  for (const match of original.matchAll(/\((?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+([^)]+)\)/gi)) {
    formerly.push(clean(match[1]));
  }
  let name = clean(original.replace(/\([^)]*\)/g, " ")) || original;
  const clause = ALIAS_CLAUSE_RE.exec(name);
  if (clause) {
    formerly.push(clean(clause[1]));
    name = clean(name.slice(0, clause.index));
  }
  return { name, formerly: dedupe(formerly) };
}

/** @param {string} text */
export function resumeTextSha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

/** @param {string} text */
function achievement(text) {
  const value = clean(text, 600);
  return { text: value, metrics: extractMetrics(value).map((metric) => metric.token) };
}

/** @param {unknown[]} values @returns {string[]} */
function dedupe(values) {
  /** @type {string[]} */
  const out = [];
  for (const raw of values.slice(0, MAX_ITEMS)) {
    const value = clean(raw);
    if (value && !out.some((entry) => entry.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

/**
 * Project only quote-validated profile facts and the structure model's
 * already-validated structure. Missing model output remains empty.
 * @param {string} resumeText
 * @param {{ facts?: unknown, structure?: unknown, by?: { provider: string, model: string } | null, now?: () => Date }} [opts]
 */
export function buildResumeRead(resumeText, opts = {}) {
  const text = String(resumeText || "").replace(/\r/g, "").trim();
  const facts = /** @type {ValidatedResumeFacts} */ (profileDraft?.validateResumeFacts(opts.facts, text) || {
    contact: { name: "", email: "", phone: "", location: "", links: [] },
    headline: "",
    summary: "",
    skills: { hard: [], tools: [], soft: [] },
    certifications: [],
    awards: [],
    projects: [],
    languages: [],
    dropped: 0,
  });
  const structure = isRecord(opts.structure) && opts.structure.source === "model" ? opts.structure : {};
  const modelEmployers = Array.isArray(structure.employers) ? structure.employers : [];
  const employers = modelEmployers.slice(0, MAX_ITEMS).filter(isRecord).map((employer) => {
    const roles = Array.isArray(employer.roles) ? employer.roles.slice(0, MAX_ITEMS) : [];
    const claims = Array.isArray(employer.claims) ? employer.claims.slice(0, MAX_ITEMS) : [];
    const displayName = employerDisplayName(employer.name);
    return {
      name: displayName.name,
      formerly: displayName.formerly,
      location: clean(employer.location),
      start: typeof employer.start === "string" ? employer.start : null,
      end: typeof employer.end === "string" && !openDate(employer.end) ? employer.end : null,
      roles: roles.filter(isRecord).map((role) => ({
        title: clean(role.title),
        start: typeof role.start === "string" ? role.start : null,
        end: typeof role.end === "string" && !openDate(role.end) ? role.end : null,
        present: typeof role.start === "string" && openDate(role.end),
      })).filter((role) => role.title),
      achievements: claims.filter(isRecord).map((claim) => achievement(String(claim.text || ""))).filter((claim) => claim.text),
    };
  }).filter((employer) => employer.name);
  const looseClaims = Array.isArray(structure.looseClaims) ? structure.looseClaims : [];
  const highlights = looseClaims.slice(0, MAX_ITEMS).map((claim) => achievement(String(claim || ""))).filter((claim) => claim.text);
  const education = dedupe(Array.isArray(structure.education) ? structure.education : []);
  const structureCredentials = dedupe(Array.isArray(structure.credentials) ? structure.credentials : []);
  const certifications = dedupe([...facts.certifications, ...structureCredentials]);
  const achievements = employers.flatMap((employer) => employer.achievements).concat(highlights);
  const skills = {
    hard: dedupe(facts.skills.hard),
    tools: dedupe(facts.skills.tools),
    soft: dedupe(facts.skills.soft),
  };
  const contact = {
    name: clean(facts.contact.name),
    email: clean(facts.contact.email),
    phone: clean(facts.contact.phone),
    location: clean(facts.contact.location),
    links: Array.isArray(facts.contact.links) ? facts.contact.links.slice(0, 30) : [],
  };
  /** @type {Array<{ name: string, url: string }>} */
  const projects = Array.isArray(facts.projects)
    ? facts.projects.slice(0, MAX_ITEMS).map((project) => ({ name: clean(project.name), url: clean(project.url, 500) })).filter((project) => project.name)
    : [];
  const read = {
    version: RESUME_READ_VERSION,
    textSha256: resumeTextSha256(text),
    chars: text.length,
    readAt: (opts.now ? opts.now() : new Date()).toISOString(),
    by: opts.by && opts.by.model ? { provider: String(opts.by.provider || ""), model: String(opts.by.model) } : null,
    contact,
    headline: clean(facts.headline),
    summary: clean(facts.summary, 1200),
    employers,
    highlights,
    skills,
    education,
    certifications,
    awards: dedupe(facts.awards),
    projects,
    languages: dedupe(facts.languages),
    counts: {
      employers: employers.length,
      roles: employers.reduce((count, employer) => count + employer.roles.length, 0),
      achievements: achievements.length,
      withNumbers: achievements.filter((item) => item.metrics.length > 0).length,
      skills: skills.hard.length + skills.tools.length + skills.soft.length,
      education: education.length,
      certifications: certifications.length,
      awards: facts.awards.length,
      projects: projects.length,
      languages: facts.languages.length,
      links: contact.links.length,
    },
    dropped: facts.dropped,
  };
  return read;
}

/** resume-read.json beside profile.json (JOBBORED_PROFILE_PATH aware). */
export function resumeReadPath() {
  return join(dirname(resolveProfilePath()), RESUME_READ_FILE);
}

/**
 * Keep the last model read so the panel can show it after a reload. Atomic,
 * best-effort, and independent of profile persistence.
 * @param {ReturnType<typeof buildResumeRead>} read
 * @param {{ path?: string }} [options]
 */
export async function saveResumeRead(read, options = {}) {
  const path = options.path || resumeReadPath();
  const tmp = path + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, JSON.stringify(read, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
    return path;
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
    return null;
  }
}

/**
 * The saved model read, when it was made from this exact resume text.
 * Older parser-based version 1 records are deliberately ignored.
 * @param {string} resumeText
 * @param {{ path?: string }} [options]
 */
export async function readSavedResumeRead(resumeText, options = {}) {
  try {
    const parsed = JSON.parse(await readFile(options.path || resumeReadPath(), "utf8"));
    if (!isRecord(parsed) || parsed.version !== RESUME_READ_VERSION) return null;
    if (parsed.textSha256 !== resumeTextSha256(String(resumeText || "").replace(/\r/g, "").trim())) return null;
    return parsed;
  } catch {
    return null;
  }
}
