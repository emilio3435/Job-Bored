import { aliasesFor } from "./materials-resume-structure.mjs";
import { foldForMatch } from "./resume-text-fold.mjs";

/** The source header, not the model, supplies an employer's alias key. @param {string} name */
export function employerKey(name) {
  const bare = String(name || "").replace(/\s+[—–-]\s+[\w.-]+\.[a-z]{2,}(?=\s|$).*$/iu, "").replace(/\s+\([\w.-]+\.[a-z]{2,}\)\s*$/iu, "").trim();
  return aliasesFor(bare)[0] || "";
}

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

/** Pure Pass C: every experience anchor is closed or returned as a visible item.
 * @param {{lsrc:string,census:import('./resume-ingest-census.mjs').ResumeCensus,employers:Array<any>,nonJob?:Array<any>,quarantinedClaims?:Array<{lines:[number,number]}>,withheld?:Set<number>}} input
 */
export function reconcileRead({ lsrc, census, employers, nonJob = [], quarantinedClaims = [], withheld = new Set() }) {
  const lines = String(lsrc).split(/\r?\n/u);
  const headers = census.anchors.filter((anchor) => anchor.kind === "employer_header");
  const relevant = census.anchors.filter((anchor) => ["employer_header", "date_range", "fallback_date", "formerly_clause"].includes(anchor.kind) && anchor.sectionGuess !== "education");
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
    const head = headers.find((anchor) => overlap(anchor.lines, employer.lines) && aliasesFor(anchor.text).some((alias) => aliasesFor(employer.name).includes(alias)));
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
    if (anchor.kind === "formerly_clause") closed = associated.some(({ employer, head }) => head?.lines[0] === number && typeof employer.aliasClause === "string" && employer.aliasClause && folded(anchor.text).includes(folded(employer.aliasClause)));
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
      if (!lines[n - 1]?.trim() || attributed.has(n) || withheld.has(n)) { flush(run); run = []; }
      else run.push(n);
    }
    flush(run);
  }
  const experienceLines = experienceSections.flatMap((section) => Array.from({ length: section.lines[1] - section.lines[0] }, (_, i) => section.lines[0] + i + 1)).filter((n) => lines[n - 1]?.trim());
  const accountedAnchors = relevant.length - unaccounted.length - setAside.length;
  const datedAnchors = relevant.filter(dated);
  const coveredDates = datedAnchors.filter((anchor) => !unaccounted.some((item) => item.id === anchor.id) && !setAside.some((item) => item.id === anchor.id));
  const coverage = { linesAttributed: experienceLines.filter((n) => attributed.has(n)).length, linesNonBlank: experienceLines.length, anchorsAccounted: accountedAnchors, anchorsTotal: relevant.length, datedAnchorsAccounted: coveredDates.length, datedAnchorsTotal: datedAnchors.length };
  const failures = [];
  if (experienceLines.some((n) => !attributed.has(n)) && !unaccounted.length && !residual.length && !setAside.length) failures.push("reconciliation_failed");
  return { unaccounted, setAside, residual, censusEmployerShortfall: headers.filter((anchor) => unaccounted.some((item) => item.id === anchor.id)).length, coverage, reconciliation: { ok: !failures.length, failures } };
}
