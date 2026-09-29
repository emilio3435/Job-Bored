import { aliasesFor } from "./materials-resume-structure.mjs";
import { foldForMatch } from "./resume-text-fold.mjs";

/** @param {string} name */
const withoutSite = (name) => String(name || "").replace(/\s+[—–-]\s+[\w.-]+\.[a-z]{2,}(?=\s|$).*$/iu, "").replace(/\s+\([\w.-]+\.[a-z]{2,}\)\s*$/iu, "").trim();
/** Strip a source-site suffix before comparing either census or model names. @param {string} name */
export const employerAliases = (name) => aliasesFor(withoutSite(name));

/** The source header, not the model, supplies an employer's alias key. @param {string} name */
export const employerKey = (name) => aliasesFor(withoutSite(name).replace(/\s*\((?:formerly|previously|now|fka|f\/k\/a|aka|a\.k\.a\.|acquired by|part of)\s+[^)]+\)/giu, " "))[0] || "";

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
  for (const anchor of census.anchors) for (let n = anchor.lines[0]; n <= anchor.lines[1]; n += 1) chrome.delete(n);
  return chrome;
}

/** Remove only source-grounded identity text from a dated line before checking its role words.
 * @param {string} line @param {string} rawDate @param {any} employer
 * @param {import('./resume-ingest-census.mjs').CensusAnchor | undefined} head @param {string} headerLine @param {string[]} sourceAliases
 */
function datedLineRemainder(line, rawDate, employer, head, headerLine, sourceAliases) {
  let remainder = folded(line).replace(folded(rawDate), " ");
  const afterName = head && folded(headerLine).startsWith(folded(head.text)) ? folded(headerLine).slice(folded(head.text).length) : "";
  const headerSite = /^\s*-\s*([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})(?=\s|$)/iu.exec(afterName)?.[1] || "";
  const host = headerSite.split(".")[0];
  const ownBareSite = host && head && employerAliases(head.text).some((alias) => alias.split(/\s+/u).some(/** @param {string} word */ (word) => word.length >= 3 && host.includes(word))) ? headerSite : "";
  /** @type {string[]} */
  const ownSites = (line.match(URL) || []).filter((value) => /^(?:https?:\/\/|www\.)/iu.test(value));
  if (ownBareSite) ownSites.push(ownBareSite);
  const site = String(employer.site || "");
  const siteMatches = /** @type {string[]} */ (site.match(URL) || []);
  if (site && siteMatches.includes(site) && (/^(?:https?:\/\/|www\.)/iu.test(site) || folded(site) === ownBareSite)) ownSites.push(site);
  const ownText = [head?.text, employer.name, ...(head ? employerAliases(head.text) : []), ...employerAliases(employer.name), ...sourceAliases, ...ownSites];
  for (const term of [...new Set(ownText.map((value) => folded(String(value || "")).trim()).filter(Boolean))].sort((a, b) => b.length - a.length)) remainder = remainder.replace(term, " ");
  return remainder;
}

/** Pure Pass C: every experience anchor is closed or returned as a visible item.
 * @param {{lsrc:string,census:import('./resume-ingest-census.mjs').ResumeCensus,employers:Array<any>,nonJob?:Array<any>,quarantinedClaims?:Array<{lines:[number,number]}>,withheld?:Set<number>}} input
 */
export function reconcileRead({ lsrc, census, employers, nonJob = [], quarantinedClaims = [], withheld = new Set() }) {
  const lines = String(lsrc).split(/\r?\n/u);
  const chrome = pageChromeLines(lines, census);
  const headers = census.anchors.filter((anchor) => anchor.kind === "employer_header" && !employers.some((employer) =>
    /** @type {any[]} */ (employer.roles || []).some((role) => anchor.lines[0] > employer.lines[0] && overlap(role.lines, anchor.lines) && folded(role.title).startsWith(folded(anchor.text)))));
  const relevant = census.anchors.filter((anchor) => ["employer_header", "date_range", "fallback_date", "formerly_clause"].includes(anchor.kind) && ["experience", "unknown"].includes(anchor.sectionGuess));
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
    const head = headers.find((anchor) => overlap(anchor.lines, employer.lines) && employerKey(anchor.text) && employerKey(anchor.text) === employerKey(employer.name));
    return { employer, head };
  });
  for (const { employer, head } of associated) {
    if (head) markRange(head.lines);
    for (const role of employer.roles || []) if (Array.isArray(role.lines)) markRange(role.lines);
    for (const claim of employer.claims || []) if (Array.isArray(claim.lines)) markRange(claim.lines);
  }
  for (const claim of quarantinedClaims) if (Array.isArray(claim.lines)) markRange(claim.lines);
  const usedRoleDates = new Set();
  const usedEmployerDates = new Set();
  for (const anchor of relevant) {
    const number = anchor.lines[0];
    if (withheld.has(number)) { unaccounted.push(visible(anchor, "looks_like_instructions")); continue; }
    const inBlock = dated(anchor) ? associated.filter(({ head }) => {
      if (!head) return false;
      const next = headers.find((candidate) => candidate.lines[0] > head.lines[0]);
      const section = sectionFor(head.lines[0]);
      const end = Math.min(next?.lines[0] ? next.lines[0] - 1 : lines.length, section?.lines[1] ?? lines.length);
      return number >= head.lines[0] && number <= end;
    }) : [];
    const roleOwners = [...new Set([...inBlock.map(({ employer }) => employer), ...associated.filter(({ employer, head }) => !head && employer.lines[0] <= number && number <= employer.lines[1] + 2).map(({ employer }) => employer)])];
    const tail = census.anchors.find((candidate) => candidate.kind === "umbrella_tail" && candidate.lines[0] === number)?.text.trim();
    const umbrellaContext = tail && /\b(?:progressive|multiple|several)\s+roles?\b/iu.test(tail) && (!/^\p{Lu}/u.test(tail) || /^[^•·|]+,\s*[A-Z]{2}(?:\s*[•·|]|$)/u.test(tail));
    const dateRange = anchor.dateRange;
    const groundedUmbrellaContext = umbrellaContext && dateRange && inBlock.some(({ employer, head }) => head && number === head.lines[1] + 1 && employer.start === dateRange.start && employer.end === dateRange.end && /** @type {any[]} */ (employer.roles || []).length >= 2);
    const backgroundNote = tail && /^background\s+tenure\s+note$/iu.test(tail);
    const modelNonJob = nonJob.find((item) => Array.isArray(item.lines) && overlap(item.lines, anchor.lines));
    const groundedRole = dated(anchor) && roleOwners.some((employer) => /** @type {any[]} */ (employer.roles || []).some((role) => overlap(role.lines, anchor.lines) && (!anchor.dateRange || (role.start === anchor.dateRange.start && role.end === anchor.dateRange.end))));
    if (modelNonJob && !groundedRole && ["experience", "unknown"].includes(anchor.sectionGuess)) {
      const roleLevel = anchor.kind === "date_range" && inBlock.some(({ head }) => head && (tail ? !groundedUmbrellaContext && !backgroundNote : anchor.sectionGuess === "experience" && number > head.lines[1]));
      setAside.push({ ...visible(anchor, "model_non_job"), disposition: "non_job", nonJobReason: modelNonJob.reason, reviewLevel: roleLevel ? "role" : "claim" });
      continue;
    }
    let closed = false;
    if (anchor.kind === "employer_header") closed = associated.some(({ employer, head }) => head?.id === anchor.id ||
      /** @type {any[]} */ (employer.roles || []).some((role) => overlap(role.lines, anchor.lines) && folded(role.title).startsWith(folded(anchor.text)) &&
        (!anchor.dateRange || (role.start === anchor.dateRange.start && role.end === anchor.dateRange.end))));
    if (anchor.kind === "formerly_clause") closed = associated.some(({ employer, head }) => {
      if (head?.lines[0] !== number || typeof employer.aliasClause !== "string" || !employer.aliasClause) return false;
      const clause = folded(employer.aliasClause).trim().replace(/^\(+|\)+$/gu, "");
      return clause === folded(anchor.text).trim();
    });
    if (dated(anchor)) {
      const date = anchor.dateRange;
      const sourceAliases = census.anchors.filter((candidate) => candidate.kind === "formerly_clause" && candidate.lines[0] === number).map((candidate) => candidate.text);
      const roleEntries = roleOwners.flatMap((employer) => /** @type {any[]} */ (employer.roles || []).filter((role) => overlap(role.lines, anchor.lines) && (!date || (role.start === date.start && role.end === date.end))).map((role) => ({ employer, role })));
      if (!date && roleEntries.length === 1 && !usedRoleDates.has(roleEntries[0].role)) { closed = true; usedRoleDates.add(roleEntries[0].role); }
      if (date && roleEntries.length && new Set(roleEntries.map((item) => item.employer)).size === 1 && roleEntries.every((item) => !usedRoleDates.has(item.role))) {
        const owner = roleEntries[0].employer;
        const head = associated.find((item) => item.employer === owner)?.head;
        let remainder = datedLineRemainder(lines[number - 1], date.raw, owner, head, head ? lines[head.lines[0] - 1] : "", sourceAliases);
        if (owner.location) remainder = remainder.replace(folded(owner.location), " ");
        /** @param {string} value */
        const normalizedSegment = (value) => folded(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
        const segments = remainder.split(/[,;•|]/u).map(normalizedSegment).filter(Boolean).sort();
        const titles = roleEntries.map(({ role }) => normalizedSegment(role.title)).sort();
        if (segments.length === titles.length && segments.every((segment, index) => segment === titles[index])) { closed = true; for (const { role } of roleEntries) usedRoleDates.add(role); }
      }
      if (!closed && groundedUmbrellaContext) {
        setAside.push({ ...visible(anchor, "employer_umbrella_context"), disposition: "umbrella_context", reviewLevel: "claim" });
        continue;
      }
      if (!closed && date && !roleEntries.length && /\b\d+\+?\s+years?\b.*\broles?\b/iu.test(lines[number - 1])) {
        const umbrella = inBlock.find(({ employer, head }) => head?.lines[0] === number &&
          folded(lines[number - 1]).startsWith(folded(head.text)) && employer.start === date.start &&
          employer.end === date.end && !usedEmployerDates.has(employer));
        if (umbrella) { closed = true; usedEmployerDates.add(umbrella.employer); }
      }
      if (!closed && date && !roleEntries.length) {
        const umbrellas = inBlock.filter(({ employer, head }) => head && employer.start === date.start && employer.end === date.end && number <= head.lines[1] + 1 && !usedEmployerDates.has(employer) && !/[\p{L}\p{N}]/u.test(datedLineRemainder(lines[number - 1], date.raw, employer, head, lines[head.lines[0] - 1], sourceAliases)));
        if (umbrellas.length === 1) { closed = true; usedEmployerDates.add(umbrellas[0].employer); }
      }
      if (!closed) closed = associated.some(({ employer }) => /** @type {any[]} */ (employer.claims || []).some((claim) => !claim.quarantined && overlap(claim.lines, anchor.lines))) ||
        quarantinedClaims.some((claim) => overlap(claim.lines, anchor.lines));
    }
    if (closed) markRange(anchor.lines);
    else unaccounted.push(visible(anchor, "unaccounted_anchor"));
  }
  const experienceSections = census.sections.filter((section) => section.kind === "experience" || section.kind === "unknown");
  const disposed = new Set([...unaccounted, ...setAside].flatMap((item) => Array.from({ length: item.lines[1] - item.lines[0] + 1 }, (_, index) => item.lines[0] + index)));
  for (const item of nonJob) if (Array.isArray(item.lines)) for (let n = item.lines[0]; n <= item.lines[1]; n += 1) {
    if (!experienceSections.some((section) => n > section.lines[0] && n <= section.lines[1]) || !lines[n - 1]?.trim() || chrome.has(n) || attributed.has(n) || disposed.has(n)) continue;
    setAside.push({ id: `non-job-${n}`, kind: "claim", lines: [n, n], excerpt: lines[n - 1].trim(), reason: "model_non_job", disposition: "non_job", nonJobReason: item.reason });
    disposed.add(n);
  }
  for (const section of experienceSections) {
    let run = [];
    /** @param {number[]} current */
    const flush = (current) => {
      if (!current.length) return;
      const size = current.reduce((sum, line) => sum + lines[line - 1].trim().length, 0);
      if (current.length >= 2 || size >= 80) residual.push({ id: `residual-${current[0]}`, kind: "residual", lines: [current[0], current.at(-1)], excerpt: lines[current[0] - 1].trim(), reason: "residual" });
    };
    for (let n = section.lines[0] + 1; n <= section.lines[1]; n += 1) {
      if (chrome.has(n)) continue;
      if (!lines[n - 1]?.trim() || attributed.has(n) || withheld.has(n)) { flush(run); run = []; }
      else run.push(n);
    }
    flush(run);
  }
  const experienceLines = experienceSections.flatMap((section) => Array.from({ length: section.lines[1] - section.lines[0] }, (_, i) => section.lines[0] + i + 1)).filter((n) => lines[n - 1]?.trim() && !chrome.has(n) && !withheld.has(n));
  const unresolvedAside = setAside.filter((item) => item.disposition !== "umbrella_context");
  const accountedAnchors = relevant.length - unaccounted.length - unresolvedAside.length;
  const datedAnchors = relevant.filter(dated);
  const coveredDates = datedAnchors.filter((anchor) => !unaccounted.some((item) => item.id === anchor.id) && !unresolvedAside.some((item) => item.id === anchor.id));
  const coverage = { linesAttributed: experienceLines.filter((n) => attributed.has(n)).length, linesNonBlank: experienceLines.length, anchorsAccounted: accountedAnchors, anchorsTotal: relevant.length, datedAnchorsAccounted: coveredDates.length, datedAnchorsTotal: datedAnchors.length };
  const failures = [];
  const explained = new Set(attributed);
  for (const item of [...unaccounted, ...residual, ...setAside]) for (let n = item.lines[0]; n <= item.lines[1]; n += 1) explained.add(n);
  if (experienceLines.some((n) => !explained.has(n))) failures.push("reconciliation_failed");
  return { unaccounted, setAside, residual, censusEmployerShortfall: headers.filter((anchor) => unaccounted.some((item) => item.id === anchor.id)).length, coverage, reconciliation: { ok: !failures.length, failures } };
}
