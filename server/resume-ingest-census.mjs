import { createHash } from "node:crypto";
import { foldForMatch } from "./resume-text-fold.mjs";

/**
 * @typedef {{ raw: string, start: string, end: string | null }} CensusDateRange
 * @typedef {{ id: string, kind: "date_range" | "fallback_date" | "employer_header" | "formerly_clause" | "section_heading" | "descriptor" | "umbrella_tail", lines: [number, number], ck: string, text: string, dateRange?: CensusDateRange, sectionGuess: string }} CensusAnchor
 * @typedef {{ anchors: CensusAnchor[], sections: { kind: string, lines: [number, number] }[] }} ResumeCensus
 */

/** @type {Record<string, string>} */
const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12" };
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{4}";
const SEASON = "(?:Spring|Summer|Fall|Autumn|Winter|Early|Mid|Late)\\s+\\d{4}";
const NUMERIC_MONTH = "(?:0?[1-9]|1[0-2])\\/\\d{4}";
const YEAR = "(?:19|20)\\d{2}";
const DATE_PART = `(?:${MONTH}|${NUMERIC_MONTH}|${SEASON}|${YEAR})`;
const DATE_RANGE_RE = new RegExp(`\\b(${DATE_PART})\\s*(?:[–—-]|\\bto\\b)\\s*(${DATE_PART}|Present|Current|Now)\\b|\\b(${SEASON})\\b`, "iu");
const FALLBACK_YEAR_RE = /\b(?:19[5-9]\d|20\d\d)\b/gu;
const SITE_RE = /^(.+?)\s+[—–-]\s+[\w.-]+\.[a-z]{2,}(?=\s|$)/iu;
const PAREN_SITE_RE = /\s*\((?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/[^)\s]*)?\)/iu;
const TITLE_RE = /\b(?:Co-?founder|Founder|Chief|Director|Manager|Executive|Engineer|Designer|Analyst|Specialist|President|Officer|Consultant|Developer|Lead|Strategist)\b/iu;
const ALIAS_RE = /\((?:formerly|now|acquired by|f\/k\/a|fka|previously)\s+[^)]+\)|\b(?:formerly|now|acquired by|f\/k\/a|fka|previously)\s+[^,;•]+/giu;

/** @param {string} part */
function normalizeDate(part) {
  if (/^(?:present|current|now)$/iu.test(part)) return "present";
  const year = /\b(?:19|20)\d{2}\b/u.exec(part)?.[0];
  if (!year) return "";
  const slash = /^(0?[1-9]|1[0-2])\/\d{4}$/u.exec(part);
  if (slash) return `${year}-${slash[1].padStart(2, "0")}`;
  const month = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/iu.exec(part)?.[1]?.toLowerCase();
  return month ? `${year}-${MONTHS[month]}` : year;
}

/** @param {string} line @returns {(CensusDateRange & {index: number}) | null} */
function dateRange(line) {
  const match = DATE_RANGE_RE.exec(line);
  if (!match) return null;
  const raw = match[0].trim();
  return { raw, start: normalizeDate(match[1] ?? match[3]), end: match[2] ? normalizeDate(match[2]) : null, index: match.index };
}

/** @param {string} line @param {string} [next] */
function sectionHeading(line, next) {
  const trimmed = line.trim();
  const spaced = /^(?:[A-Z]\s+){2,}[A-Z](?:\s+\d{1,3})?$/u.test(trimmed);
  const plain = /^(?:EXPERIENCE|EDUCATION|SKILLS|SUMMARY|VENTURES|PROJECTS|EMPLOYMENT)(?:\s+\d{1,3})?$/iu.test(trimmed);
  const caps = /^(?:(?:[A-Z][A-Z/-]*|&)\s+){1,5}[A-Z][A-Z/-]*(?:\s+\d{1,3})?$/u.test(trimmed);
  if (!spaced && !plain && !caps) return null;
  if (caps && !spaced && /@|\b\d{3}[-.)\s]\d{3}[-.\s]\d{4}\b/u.test(next || "")) return null;
  const word = trimmed.replace(/\s|\d/g, "").toLowerCase();
  if (/experience|employment|workhistory|careerhistory/u.test(word)) return "experience";
  if (word.includes("education")) return "education";
  if (/skill|competenc/u.test(word)) return "skills";
  if (/certification|language/u.test(word)) return "credentials";
  if (word.includes("summary")) return "summary";
  return "unknown";
}

/** @param {string} line @param {(CensusDateRange & {index: number}) | null} date @param {string | undefined} next @param {string | undefined} afterNext @param {boolean} previousHeader */
function employerName(line, date, next, afterNext, previousHeader) {
  if (!line || /^(?:summary|profile|objective)\s*:/iu.test(line) || /@|\b\d{3}-\d{3}-\d{4}\b/u.test(line)) return null;
  const beforeDate = date ? line.slice(0, date.index).trim() : line;
  const earlierRole = /^(.+?),\s+(.+?)\s+[—–]\s+\S/u.exec(beforeDate);
  if (earlierRole && TITLE_RE.test(earlierRole[1])) return earlierRole[2].trim();
  if (date && date.index > 0) {
    const before = beforeDate;
    const roleAndEmployer = /^(.+?)\s+\|\s+(.+)$/u.exec(before);
    if (roleAndEmployer && TITLE_RE.test(roleAndEmployer[1])) {
      const employer = roleAndEmployer[2].replace(PAREN_SITE_RE, "").split(/\s+[—–]\s+/u)[0].trim();
      if (employer) return employer;
    }
    const umbrella = /^(.+?\((?:formerly|previously|now|f\/k\/a|fka|acquired by)\s+[^)]+\))\s+[—–]\s+.+$/iu.exec(before);
    if (umbrella && !TITLE_RE.test(umbrella[1])) return umbrella[1].trim();
  }
  const site = SITE_RE.exec(line);
  if (site) return site[1].trim();
  if (PAREN_SITE_RE.test(line)) return employerName(line.replace(PAREN_SITE_RE, ""), date, next, afterNext, previousHeader);
  if (date && date.index > 0 && /[•·|]/u.test(line.slice(0, date.index))) {
    const before = line.slice(0, date.index).replace(/[•·|\s]+$/gu, "").trim();
    const title = TITLE_RE.exec(before);
    if (title && title.index > 0) return before.slice(0, title.index).replace(/[•·|,\s]+$/gu, "").trim();
    return null;
  }
  const nearDate = (next && dateRange(next)?.index === 0) || (afterNext && dateRange(afterNext)?.index === 0);
  if (!previousHeader && !date && nearDate && /^[A-Z][\p{L}\p{N}()&.,'’\s/-]{2,79}$/u.test(line) && !TITLE_RE.test(line) && !/[.!?]$/u.test(line)) return line;
  return null;
}

/** Deterministic source census. It reports anchors only; it never builds an employer or a role. @param {string} source @returns {ResumeCensus} */
export function censusResume(source) {
  const lines = String(source ?? "").split(/\r?\n/u);
  /** @type {CensusAnchor[]} */
  const anchors = [];
  /** @type {ResumeCensus["sections"]} */
  const sections = [];
  let sectionGuess = "unknown";
  let previousHeader = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    const number = index + 1;
    const ck = createHash("sha256").update(foldForMatch(raw).text).digest("hex").slice(0, 12);
    /** @param {CensusAnchor["kind"]} kind @param {string} text @param {{dateRange?: CensusDateRange}} [extra] */
    const add = (kind, text, extra = {}) => anchors.push({ id: `a-${number}-${kind}-${anchors.length}`, kind, lines: [number, number], ck, text, sectionGuess, ...extra });
    const heading = sectionHeading(line, lines[index + 1]);
    if (heading) {
      if (sections.length) sections[sections.length - 1].lines[1] = number - 1;
      sectionGuess = heading;
      sections.push({ kind: heading, lines: [number, lines.length] });
      add("section_heading", line);
      previousHeader = false;
      continue;
    }
    if (!line) { previousHeader = false; continue; }
    const date = dateRange(line);
    if (date) {
      add("date_range", date.raw, { dateRange: { raw: date.raw, start: date.start, end: date.end } });
      if (date.index === 0) {
        const tail = line.slice(date.raw.length).replace(/^[\s•·|-]+/u, "").trim();
        if (tail) add("umbrella_tail", tail);
      }
    } else {
      const years = [...line.matchAll(FALLBACK_YEAR_RE)];
      if (years.length >= 2 || (years.length >= 1 && /\b(?:present|current|now)\b/iu.test(line))) add("fallback_date", line);
    }
    /** @type {string | null} */
    const name = ["experience", "unknown"].includes(sectionGuess) ? employerName(line, date, lines[index + 1]?.trim(), lines[index + 2]?.trim(), previousHeader) : null;
    if (name) add("employer_header", name);
    for (const alias of line.matchAll(ALIAS_RE)) add("formerly_clause", alias[0].replace(/^\(|\)$/gu, ""));
    if (previousHeader && !date && !name) add("descriptor", line);
    previousHeader = Boolean(name);
  }
  return { anchors, sections };
}
