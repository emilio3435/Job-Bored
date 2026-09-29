import { aliasesFor } from "./materials-resume-structure.mjs";
import { foldForMatch } from "./resume-text-fold.mjs";

/** Strip a source-site suffix before comparing either census or model names. @param {string} name */
export function employerAliases(name) {
  const bare = String(name || "").replace(/\s+[—–-]\s+[\w.-]+\.[a-z]{2,}(?=\s|$).*$/iu, "").replace(/\s+\([\w.-]+\.[a-z]{2,}\)\s*$/iu, "").trim();
  return aliasesFor(bare);
}

/** The source header, not the model, supplies an employer's alias key. @param {string} name */
export const employerKey = (name) => employerAliases(name)[0] || "";

/** @param {unknown} value */
export function normalizeReadDate(value) {
  const text = String(value ?? "").trim();
  if (/^(present|current|now)$/iu.test(text)) return "present";
  const year = /\b(?:19|20)\d{2}\b/u.exec(text)?.[0];
  if (!year || !/^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+|(?:0?[1-9]|1[0-2])\/|(?:Spring|Summer|Fall|Autumn|Winter|Early|Mid|Late)\s+)?(?:19|20)\d{2}$/iu.test(text)) return null;
  const slash = /^(0?[1-9]|1[0-2])\//u.exec(text);
  if (slash) return `${year}-${slash[1].padStart(2, "0")}`;
  const month = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/iu.exec(text)?.[1].toLowerCase();
  if (!month) return year;
  /** @type {Record<string,string>} */
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12" };
  return `${year}-${months[month]}`;
}

/** @param {number[]} a @param {number[]} b */
const overlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];
/** @param {string} value */
const folded = (value) => foldForMatch(value).text;
/** @param {import('./resume-ingest-census.mjs').CensusAnchor} anchor */
const dated = (anchor) => anchor.kind === "date_range" || anchor.kind === "fallback_date";

const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
const PHONE = /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/gu;
const URL = /(?:https?:\/\/|www\.)[^\s•|]+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/[^\s•|]*)?/giu;
const PERSON_NAME = /^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3}$/u;
/** @param {string} line */
function pureContact(line) {
  const hasEmailOrPhone = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/iu.test(line);
  const isBareUrl = /^(?:(?:https?:\/\/|www\.)[^\s•|]+|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/[^\s•|]*)?)$/iu.test(line.trim());
  if (!hasEmailOrPhone && !isBareUrl) return false;
  const rest = line.replace(EMAIL, " ").replace(PHONE, " ").replace(URL, " ").replace(/^[\s•|·;:—–-]+|[\s•|·;:—–-]+$/gu, "").trim();
  return !rest || /^[\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3},\s*[A-Z]{2}$/u.test(rest);
}

/** Page furniture is grounded in the document's own identity block or a complete running-header pattern. @param {string[]} lines @param {import('./resume-ingest-census.mjs').ResumeCensus} census */
function pageChromeLines(lines, census) {
  const firstEmployer = census.anchors.find((anchor) => anchor.kind === "employer_header")?.lines[0] ?? lines.length + 1;
  const chrome = new Set();
  const topContact = lines.findIndex((line, index) => index < Math.min(firstEmployer - 1, 8) && pureContact(line));
  const topName = topContact >= 2 && PERSON_NAME.test(lines[topContact - 2].trim()) ? topContact - 2 : topContact >= 1 && PERSON_NAME.test(lines[topContact - 1].trim()) ? topContact - 1 : -1;
  const topIdentity = new Set(topName < 0 ? [] : lines.slice(topName, topContact + 1).map((line) => folded(line).trim()).filter(Boolean));
  /** @param {string} line */
  const words = (line) => (folded(line).match(/[\p{L}\p{N}]+/gu) || []).filter((word) => word.length >= 4);
  for (let index = firstEmployer; index < lines.length; index += 1) {
    const number = index + 1;
    if (pureContact(lines[index]) || topIdentity.has(folded(lines[index]).trim())) chrome.add(number);
    if (index + 3 >= lines.length || !/^\s*—\s+/u.test(lines[index])) continue;
    const name = lines[index + 1].trim();
    if (!PERSON_NAME.test(name)) continue;
    if (!folded(lines[index]).replace(/^-\s*/u, "").startsWith(folded(name))) continue;
    if (!pureContact(lines[index + 3])) continue;
    const taglineWords = words(lines[index + 2]);
    const runningWords = new Set(words(lines[index]));
    if (taglineWords.length < 2 || taglineWords.filter((word) => runningWords.has(word)).length < Math.ceil(taglineWords.length / 2)) continue;
    for (let offset = 0; offset < 4; offset += 1) chrome.add(number + offset);
  }
  return chrome;
}

/** Pure Pass C: every experience anchor is closed or returned as a visible item.
 * @param {{lsrc:string,census:import('./resume-ingest-census.mjs').ResumeCensus,employers:Array<any>,nonJob?:Array<any>,quarantinedClaims?:Array<{lines:[number,number]}>,withheld?:Set<number>}} input
 */
export function reconcileRead({ lsrc, census, employers, nonJob = [], quarantinedClaims = [], withheld = new Set() }) {
  const lines = String(lsrc).split(/\r?\n/u);
  const chrome = pageChromeLines(lines, census);
  const headers = census.anchors.filter((anchor) => anchor.kind === "employer_header");
  const relevant = census.anchors.filter((anchor) => ["employer_header", "date_range", "fallback_date", "formerly_clause"].includes(anchor.kind) && anchor.sectionGuess !== "education" && !chrome.has(anchor.lines[0]));
  /** @type {any[]} */ const unaccounted = [];
  /** @type {any[]} */ const setAside = [];
  /** @type {any[]} */ const residual = [];
  const attributed = new Set();
  /** @param {number} line */
  const sectionFor = (line) => census.sections.find((section) => line >= section.lines[0] && line <= section.lines[1]);
  /** @param {number} number */
  const mark = (number) => { if (number > 0 && number <= lines.length) attributed.add(number); };
  /** @param {[number,number]} range */
  const markRange = (range) => { for (let n = range[0]; n <= range[1]; n += 1) mark(n); };
  /** @param {import('./resume-ingest-census.mjs').CensusAnchor} anchor @param {string} reason */
  const visible = (anchor, reason) => ({ id: anchor.id, kind: anchor.kind, lines: anchor.lines, ck: anchor.ck, excerpt: lines[anchor.lines[0] - 1]?.trim() || anchor.text, ...(anchor.kind === "employer_header" ? { aliasKey: employerKey(anchor.text) } : {}), reason });
  const associated = employers.map((employer) => {
    const head = headers.find((anchor) => overlap(anchor.lines, employer.lines) && employerAliases(anchor.text).some((alias) => employerAliases(employer.name).includes(alias)));
    return { employer, head };
  });
  for (const { employer, head } of associated) {
    if (head) markRange(head.lines);
    for (const role of employer.roles || []) if (Array.isArray(role.lines)) markRange(role.lines);
    for (const claim of employer.claims || []) if (Array.isArray(claim.lines)) markRange(claim.lines);
  }
  for (const claim of quarantinedClaims) if (Array.isArray(claim.lines)) markRange(claim.lines);
  for (const anchor of relevant) {
    const number = anchor.lines[0];
    if (withheld.has(number)) { unaccounted.push(visible(anchor, "looks_like_instructions")); continue; }
    const modelNonJob = nonJob.find((item) => Array.isArray(item.lines) && overlap(item.lines, anchor.lines));
    if (modelNonJob && ["experience", "unknown"].includes(anchor.sectionGuess)) {
      setAside.push({ ...visible(anchor, "model_non_job"), disposition: "non_job", nonJobReason: modelNonJob.reason });
      continue;
    }
    let closed = false;
    if (anchor.kind === "employer_header") closed = associated.some(({ head }) => head?.id === anchor.id);
    if (anchor.kind === "formerly_clause") closed = associated.some(({ employer, head }) => {
      if (head?.lines[0] !== number || typeof employer.aliasClause !== "string" || !employer.aliasClause) return false;
      const clause = folded(employer.aliasClause);
      const anchorClause = folded(anchor.text);
      return clause.includes(anchorClause) || anchorClause.includes(clause);
    });
    if (dated(anchor)) {
      const date = anchor.dateRange;
      if (date) closed = associated.some(({ employer, head }) => {
        if (!head) return false;
        const next = headers.find((candidate) => candidate.lines[0] > head.lines[0]);
        const section = sectionFor(head.lines[0]);
        const end = Math.min(next?.lines[0] ? next.lines[0] - 1 : lines.length, section?.lines[1] ?? lines.length);
        if (number < head.lines[0] || number > end) return false;
        const candidates = [employer, ...(employer.roles || [])];
        return candidates.some((item) => item.start === date.start && item.end === date.end && (item === employer || overlap(item.lines, anchor.lines)));
      });
      else closed = associated.some(({ employer, head }) => head && /** @type {any[]} */ (employer.roles || []).some((role) => overlap(role.lines, anchor.lines)));
    }
    if (closed) markRange(anchor.lines);
    else unaccounted.push(visible(anchor, "unaccounted_anchor"));
  }
  const experienceSections = census.sections.filter((section) => section.kind === "experience" || section.kind === "unknown");
  for (const section of experienceSections) {
    let run = [];
    /** @param {number[]} current */
    const flush = (current) => {
      if (!current.length) return;
      const size = current.reduce((sum, line) => sum + lines[line - 1].trim().length, 0);
      if (current.length >= 2 || size >= 80) residual.push({ id: `residual-${current[0]}`, kind: "residual", lines: [current[0], current.at(-1)], excerpt: lines[current[0] - 1].trim(), reason: "residual" });
    };
    for (let n = section.lines[0] + 1; n <= section.lines[1]; n += 1) {
      if (!lines[n - 1]?.trim() || attributed.has(n) || withheld.has(n) || chrome.has(n)) { flush(run); run = []; }
      else run.push(n);
    }
    flush(run);
  }
  const experienceLines = experienceSections.flatMap((section) => Array.from({ length: section.lines[1] - section.lines[0] }, (_, i) => section.lines[0] + i + 1)).filter((n) => lines[n - 1]?.trim() && !chrome.has(n));
  const accountedAnchors = relevant.length - unaccounted.length - setAside.length;
  const datedAnchors = relevant.filter(dated);
  const coveredDates = datedAnchors.filter((anchor) => !unaccounted.some((item) => item.id === anchor.id) && !setAside.some((item) => item.id === anchor.id));
  const coverage = { linesAttributed: experienceLines.filter((n) => attributed.has(n)).length, linesNonBlank: experienceLines.length, anchorsAccounted: accountedAnchors, anchorsTotal: relevant.length, datedAnchorsAccounted: coveredDates.length, datedAnchorsTotal: datedAnchors.length };
  const failures = [];
  if (experienceLines.some((n) => !attributed.has(n)) && !unaccounted.length && !residual.length && !setAside.length) failures.push("reconciliation_failed");
  return { unaccounted, setAside, residual, censusEmployerShortfall: headers.filter((anchor) => unaccounted.some((item) => item.id === anchor.id)).length, coverage, reconciliation: { ok: !failures.length, failures } };
}
