import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { maskNonMetrics } from "./materials-numerals.mjs";
import { companyDisplayName } from "./materials-monogram.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { loadVoicePack } from "./materials-delint.mjs";
import { numerals } from "./materials-metric-tag.mjs";

const JD_ECHO_WINDOW = 8;
const HTML_IN_SLOT_RE = /<[a-z]/i;

/**
 * A metric is supported only by an exact source value or its one-significant-
 * digit downward rounding. Rank numbers run in the opposite direction: a
 * larger rank number is equal or worse, never an upgrade.
 * @param {string} token
 * @param {string[]} sources
 */
function metricHasSource(token, sources) {
  const parse = (/** @type {string} */ value) => {
    const match = String(value).trim().match(/^([$#]|top-)?(\d[\d,]*(?:\.\d+)?)([kKmMbB])?(\+|%|x)?$/i);
    if (!match) return null;
    const suffix = String(match[3] || "").toLowerCase();
    const multiplier = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
    const trailing = String(match[4] || "").toLowerCase();
    return {
      prefix: String(match[1] || "").toLowerCase(),
      unit: trailing === "%" ? "%" : trailing === "x" ? "x" : "quantity",
      value: Number(String(match[2]).replace(/,/g, "")) * multiplier,
    };
  };
  const candidate = parse(token);
  if (!candidate || !Number.isFinite(candidate.value)) return false;
  const sameValue = (/** @type {number} */ left, /** @type {number} */ right) =>
    Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;
  return sources.some((source) => {
    const approved = parse(source);
    if (!approved) return false;
    if (approved.prefix !== candidate.prefix || approved.unit !== candidate.unit) return false;
    if (sameValue(candidate.value, approved.value)) return true;

    if (candidate.prefix === "#" || candidate.prefix === "top-") {
      return candidate.value > approved.value;
    }
    if (approved.value <= 0) return false;
    const place = 10 ** Math.floor(Math.log10(approved.value));
    const roundedDown = Math.floor(approved.value / place) * place;
    return roundedDown < approved.value && sameValue(candidate.value, roundedDown);
  });
}

/** @param {string} text */
function splitMetricSentences(text) {
  return String(text || "").split(/\r?\n+|(?<=[!?])\s+|\.(?!\d)\s+(?=[A-Z0-9“"$])/)
    .map((part) => part.trim()).filter(Boolean);
}

/**
 * Sentence matching ignores numbers so a rounded rendering still maps to the
 * writer's sourceRef for that sentence.
 * @param {string} text
 */
function evidenceSentenceKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(?:top-|[$#])?\d[\d,]*(?:\.\d+)?(?:%|x\b|[kKmMbB]\+?|\+)?/gi, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} left @param {string} right */
function sentenceMatches(left, right) {
  const a = evidenceSentenceKey(left);
  const b = evidenceSentenceKey(right);
  if (!a || !b) return false;
  return a === b;
}

/** @param {string} text */
function exactSentenceKey(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** @param {Array<{ sentence?: string, claimIds?: string[] }>} refs */
function unambiguousRefClaimIds(refs) {
  if (!refs.length) return null;
  const sets = new Set(refs.map((ref) => JSON.stringify([...new Set(Array.isArray(ref.claimIds) ? ref.claimIds : [])].sort())));
  if (sets.size !== 1) return [];
  const ids = refs[0].claimIds;
  return [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => typeof id === "string");
}

/** @param {string} text @param {string} phrase */
function sentenceContainsPhrase(text, phrase) {
  const a = evidenceSentenceKey(text);
  const b = evidenceSentenceKey(phrase);
  return Boolean(a && b && (` ${a} `).includes(` ${b} `));
}

/** M3: unverified evidence (verified:false) never grounds a number.
 * @param {string[]} claimIds @param {{ claims?: Array<{ id?: string, verified?: boolean, metrics?: Array<{ token?: string }> }> }} ledger */
function metricTokensForClaims(claimIds, ledger) {
  const wanted = new Set(claimIds.filter((id) => typeof id === "string"));
  return (ledger.claims || [])
    .filter((claim) => typeof claim.id === "string" && wanted.has(claim.id) && claim.verified !== false)
    .flatMap((claim) => (claim.metrics || []).map((metric) => String(metric.token || "")))
    .filter(Boolean);
}

/**
 * @param {string} sentence
 * @param {{ employers?: Array<{ id?: string, name?: string }>, claims?: Array<{ id?: string, employerId?: string, text?: string, metrics?: Array<{ token?: string }> }> }} ledger
 */
function sameEmployerClaimIds(sentence, ledger) {
  const mentioned = (ledger.employers || []).filter((employer) => {
    if (typeof employer.id !== "string" || typeof employer.name !== "string") return false;
    const aliases = [employer.name, companyDisplayName(employer.name)].filter(Boolean);
    return aliases.some((alias) => sentenceContainsPhrase(sentence, alias));
  });
  const employerIds = [...new Set(mentioned.map((employer) => employer.id))];
  if (employerIds.length !== 1) return [];
  const employer = mentioned.find((item) => item.id === employerIds[0]);
  const employerName = employer?.name;
  const aliases = typeof employerName === "string" ? [employerName, companyDisplayName(employerName)] : [];
  return (ledger.claims || [])
    .filter((claim) => claim.employerId === employerIds[0]
      || (!claim.employerId && aliases.some((alias) => sentenceContainsPhrase(String(claim.text || ""), alias))))
    .map((claim) => claim.id)
    .filter((id) => typeof id === "string");
}

/**
 * Resume bullets carry an explicit claimId even in older/degraded drafts
 * without sentence sourceRefs. Use that single claim only when the rendered
 * sentence maps unambiguously to one bullet.
 * @param {string} sentence
 * @param {{ bullets?: Array<{ claimId?: string, text?: string }>, earlier?: Array<{ claimId?: string, text?: string }> }} draft
 * @returns {string[] | null}
 */
function resumeSlotClaimIds(sentence, draft) {
  const matches = [...(draft.bullets || []), ...(draft.earlier || [])]
    .filter((slot) => typeof slot.text === "string" && splitMetricSentences(slot.text).some((part) => sentenceMatches(sentence, part)))
    .map((slot) => slot.claimId)
    .filter((id) => typeof id === "string");
  const ids = [...new Set(matches)];
  return ids.length === 1 ? ids : matches.length ? [] : null;
}

/**
 * A resume bullet or earlier line is grounded by its own claim (M4: a
 * writer sourceRef cannot lend it another claim's number). Otherwise
 * sourceRefs take priority; then only claims from the sentence's uniquely
 * named employer may ground a metric.
 * @param {string} sentence
 * @param {Array<{ sentence?: string, claimIds?: string[] }>} sourceRefs
 * @param {{ statement?: string, bullets?: Array<{ claimId?: string, text?: string }>, earlier?: Array<{ claimId?: string, text?: string }>, letter?: Record<string, string> }} draft
 * @param {{ employers?: Array<{ id?: string, name?: string }>, claims?: Array<{ id?: string, employerId?: string, text?: string, metrics?: Array<{ token?: string }> }> }} ledger
 * @param {"letter" | "resume"} document
 * @param {string} [directClaimId]
 * @returns {string[]}
 */
function sourceClaimIdsForSentence(sentence, sourceRefs, draft, ledger, document, directClaimId) {
  if (document === "resume") {
    if (typeof directClaimId === "string") return [directClaimId];
    const slotIds = resumeSlotClaimIds(sentence, draft);
    if (slotIds?.length) return slotIds;
  }
  const exactKey = exactSentenceKey(sentence);
  const exactRefs = sourceRefs.filter((ref) => typeof ref.sentence === "string" && exactSentenceKey(String(ref.sentence || "")) === exactKey);
  if (exactRefs.length) return unambiguousRefClaimIds(exactRefs) || [];

  const fuzzyRefs = sourceRefs.filter((ref) => typeof ref.sentence === "string" && sentenceMatches(sentence, String(ref.sentence || "")));
  if (fuzzyRefs.length) {
    const sourceSentences = new Set(fuzzyRefs.map((ref) => exactSentenceKey(String(ref.sentence || ""))));
    return sourceSentences.size === 1 ? unambiguousRefClaimIds(fuzzyRefs) || [] : [];
  }

  if (document === "resume") {
    const slotIds = resumeSlotClaimIds(sentence, draft);
    if (slotIds !== null) return slotIds;
  }
  return sameEmployerClaimIds(sentence, ledger);
}

/** @param {"letter" | "resume"} document @param {{ statement?: string, bullets?: Array<{ claimId?: string, text?: string }>, earlier?: Array<{ claimId?: string, text?: string }>, letter?: Record<string, string> }} draft @returns {Array<{ field: string, text: string, claimId?: string }>} */
function draftMetricEntries(document, draft) {
  if (document === "letter") {
    return Object.entries(draft.letter || {}).map(([beat, text]) => ({ field: `letter.${beat}`, text: String(text || "") }));
  }
  return [
    { field: "statement", text: String(draft.statement || "") },
    ...(draft.bullets || []).map((slot) => ({ field: `bullets.${slot.claimId || "?"}`, text: String(slot.text || ""), claimId: slot.claimId })),
    ...(draft.earlier || []).map((slot) => ({ field: `earlier.${slot.claimId || "?"}`, text: String(slot.text || ""), claimId: slot.claimId })),
  ];
}

/* Fallback when the voice pack cannot load; the pack (30+ patterns) is
 * the real list. */
const FALLBACK_FILLER = ["leverage", "synergize", "passionate about", "results-driven", "proven track record"];

/**
 * The rendered HTML escapes "&" and quotes; an employer named
 * "Cedar Lantern & JobBored" is still present.
 * @param {string} html
 */
function decodeEntities(html) {
  return String(html || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** @type {RegExp | null} */
let cachedFillerRe = null;
/** @type {string[]} regex-typed banned rules (variants and inflections) */
let regexRules = [];

/**
 * Slice 5: filler detection is pack-driven. The banned patterns from
 * materials-voice.json become one case-insensitive matcher, cached for
 * the process.
 */
async function fillerPattern() {
  if (cachedFillerRe) return cachedFillerRe;
  let patterns = FALLBACK_FILLER;
  try {
    const pack = await loadVoicePack();
    const banned = Array.isArray(pack.banned) ? pack.banned : [];
    const listed = banned
      .filter((rule) => rule && !rule.regex)
      .map((rule) => (rule && typeof rule.pattern === "string" ? rule.pattern.trim() : ""))
      .filter((pattern) => pattern.length >= 3);
    if (listed.length) patterns = listed;
    regexRules = banned
      .filter((rule) => rule && rule.regex && typeof rule.pattern === "string")
      .map((rule) => rule.pattern);
  } catch {
    // fall back to the five phrases
  }
  const literal = patterns.map((p) => `\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const variants = regexRules.filter((p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  });
  cachedFillerRe = new RegExp(`(?:${[...literal, ...variants].join("|")})`, "i");
  return cachedFillerRe;
}

/**
 * @typedef {object} CriticIssue
 * @property {string} code
 * @property {string} message
 * @property {"review" | "fail"} severity
 */

/** @typedef {NonNullable<Awaited<ReturnType<typeof auditCoverLetter>>>} DocumentAudit */

/** @type {DocumentAudit} */
const EMPTY_AUDIT = {
  status: "pass",
  pageCount: 0,
  words: 0,
  pageWords: [],
  issues: [],
};

/**
 * @param {string} code
 * @param {string} message
 * @param {"review" | "fail"} [severity]
 * @returns {CriticIssue}
 */
function issue(code, message, severity = "review") {
  return { code, message, severity };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {CriticIssue[]} issues */
function statusFor(issues) {
  if (issues.some((item) => item.severity === "fail")) return "fail";
  if (issues.length) return "review";
  return "pass";
}

/** @param {unknown} html */
function visibleText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, " ")
    .replace(/&ndash;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {unknown} text */
function tokenize(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/**
 * @param {unknown} value
 * @param {string[]} out
 */
function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/** @param {unknown} html */
function extractEmployerStrings(html) {
  const source = String(html ?? "");
  const employers = new Set();

  for (const match of source.matchAll(/<!--\s*COMPANY:\s*([^>]+?)\s*-->/gi)) {
    const name = match[1].trim();
    if (name) employers.add(name);
  }
  for (const match of source.matchAll(/<h2\b[^>]*\bcompany-name\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const primary = visibleText(match[1]).split(/\s+\(/)[0].trim();
    if (primary) employers.add(primary);
  }

  return [...employers];
}

/**
 * Employer names as rendered in the composed resume (h2.company-name).
 * @param {string} html
 */
function composedEmployerStrings(html) {
  const employers = new Set();
  for (const match of html.matchAll(/<h2\b[^>]*\bcompany-name\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const name = visibleText(match[1]).trim();
    if (name) employers.add(name);
  }
  return [...employers];
}

/**
 * Word budgets stay in materials-quality; HTML is staged so auditCoverLetter
 * / auditResume read the same budget-band and resume section rules.
 *
 * @param {string} letterHtml
 * @param {string} resumeHtml
 */
async function auditStagedHtml(letterHtml, resumeHtml) {
  const dir = await mkdtemp(join(tmpdir(), "jb-critic-"));
  try {
    const letterPath = join(dir, "cover-letter.html");
    const resumePath = join(dir, "resume.html");
    await writeFile(letterPath, letterHtml, "utf8");
    await writeFile(resumePath, resumeHtml, "utf8");
    const [letter, resume] = await Promise.all([
      auditCoverLetter({ htmlPath: letterPath, pdfPath: join(dir, "cover-letter.pdf") }),
      auditResume({ htmlPath: resumePath, pdfPath: join(dir, "resume.pdf") }),
    ]);
    return {
      letter: letter ?? EMPTY_AUDIT,
      resume: resume ?? EMPTY_AUDIT,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * @param {object} [input]
 * @param {unknown} [input.letterHtml]
 * @param {unknown} [input.resumeHtml]
 * @param {unknown} [input.jdText]
 * @param {unknown} [input.masterResumeHtml]
 * @param {unknown} [input.sourceResumeText] the user's own resume (C11); every
 *   employer in the composed resume must appear in it
 * @param {unknown} [input.writerJson]
 * @param {string[]} [input.keptEmployers] slice 5: employers the selection
 *   featured — frozen_fact_broken narrows to these instead of the master
 * @param {string[]} [input.ledgerMetrics] slice 5: metric tokens from the
 *   ledger — any other numeral in the draft is an invented fact
 * @returns {Promise<{
 *   status: "pass" | "review" | "fail",
 *   letter: DocumentAudit,
 *   resume: DocumentAudit,
 *   issues: CriticIssue[],
 * }>}
 */
export async function critiqueMaterials({
  letterHtml,
  resumeHtml,
  jdText,
  masterResumeHtml,
  sourceResumeText,
  writerJson,
  keptEmployers,
  ledgerMetrics,
} = {}) {
  const letterSource = typeof letterHtml === "string" ? letterHtml : "";
  const resumeSource = typeof resumeHtml === "string" ? resumeHtml : "";
  const { letter, resume } = await auditStagedHtml(letterSource, resumeSource);

  /** @type {CriticIssue[]} */
  const issues = [...(letter.issues || []), ...(resume.issues || [])];

  const letterText = visibleText(letterSource);

  const jdWords = tokenize(jdText);
  if (jdWords.length >= JD_ECHO_WINDOW) {
    for (let i = 0; i <= jdWords.length - JD_ECHO_WINDOW; i += 1) {
      const window = jdWords.slice(i, i + JD_ECHO_WINDOW).join(" ");
      if (letterText.includes(window)) {
        issues.push(issue(
          "jd_echo",
          "Cover letter echoes an 8-word job-description window verbatim.",
        ));
        break;
      }
    }
  }

  /* F2: scan the writer's letter strings — never the composed HTML, whose
   * template guidance comments list the banned phrases verbatim. Without a
   * writer letter, fall back to visible text (comments stripped). */
  /** @type {string[]} */
  const letterStrings = [];
  if (isRecord(writerJson) && writerJson.letter !== undefined) {
    collectStrings(writerJson.letter, letterStrings);
  }
  const fillerHaystack = letterStrings.length
    ? letterStrings.join("\n")
    : visibleText(letterSource);
  const fillerRe = await fillerPattern();
  if (fillerRe.test(fillerHaystack)) {
    issues.push(issue(
      "banned_filler",
      "Cover letter uses banned filler phrasing.",
    ));
  }

  /* Slice 5: frozen facts narrow to the kept claims. The master-HTML path
   * stays for the sample harness, which has no selection. */
  const keptList = Array.isArray(keptEmployers)
    ? keptEmployers.filter((name) => typeof name === "string" && name)
    : [];
  const frozenNames = keptList.length
    ? keptList
    : extractEmployerStrings(masterResumeHtml);
  const missingEmployers = frozenNames.filter(
    (name) => !resumeSource.includes(name) && !decodeEntities(resumeSource).includes(name),
  );
  if (missingEmployers.length) {
    issues.push(issue(
      "frozen_fact_broken",
      `Composed resume dropped frozen employer fact(s): ${missingEmployers.join(", ")}.`,
      "fail",
    ));
  }

  /* Slice 5: numerals that do not trace to the ledger are invented. */
  const ledgerTokens = Array.isArray(ledgerMetrics)
    ? ledgerMetrics.filter((token) => typeof token === "string" && token)
    : null;
  if (ledgerTokens) {
    /** @type {string[]} */
    const slotStrings = [];
    collectStrings(writerJson, slotStrings);
    for (const text of slotStrings) {
      for (const match of maskNonMetrics(String(text)).matchAll(/((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g)) {
        const token = match[1];
        if (/^(?:19|20)\d\d(?:[–-](?:19|20)\d\d)?$/.test(token)) continue;
        if (!metricHasSource(token, ledgerTokens)) {
          issues.push(issue(
            "invented_fact",
            `Draft numeral ${token} does not trace to a ledger metric.`,
            "fail",
          ));
          break;
        }
      }
      if (issues.some((item) => item.code === "invented_fact")) break;
    }
  }

  const sourceText = typeof sourceResumeText === "string" ? sourceResumeText.toLowerCase() : "";
  if (sourceText) {
    /* "Meridian Insights Group — meridian.example.org" is the resume's own
     * "Meridian Insights Group (meridian.example.org)": compare the company's name
     * without its domain or "formerly" asides too. */
    const invented = composedEmployerStrings(resumeSource).filter(
      (name) => !sourceText.includes(name.toLowerCase()) && !sourceText.includes(companyDisplayName(name).toLowerCase()),
    );
    if (invented.length) {
      issues.push(issue(
        "invented_employer",
        `Composed resume names employer(s) that are not in your resume: ${invented.join(", ")}.`,
        "fail",
      ));
    }
  }

  /** @type {string[]} */
  const writerStrings = [];
  collectStrings(writerJson, writerStrings);
  if (writerStrings.some((value) => HTML_IN_SLOT_RE.test(value))) {
    issues.push(issue(
      "html_in_slot",
      "Writer JSON contains HTML markup in a slot string.",
      "fail",
    ));
  }

  return {
    status: statusFor(issues),
    letter,
    resume,
    issues,
  };
}

/**
 * The deterministic critic's factual checks, without an HTML staging side effect.
 * @param {object} input
 * @param {"letter" | "resume"} input.document
 * @param {{ statement?: string, bullets?: Array<{ claimId?: string, text?: string }>, earlier?: Array<{ claimId?: string, text?: string }>, letter?: Record<string, string> }} [input.draft]
 * @param {{ claims?: Array<{ id?: string, employerId?: string, text?: string, metrics?: Array<{ token?: string }> }>, employers?: Array<{ id?: string, name?: string }> }} [input.ledger]
 * @param {Array<{ sentence?: string, claimIds?: string[] }>} [input.sourceRefs]
 * @param {{ expectedEmployers?: string[], renderedEmployers?: string[], identity?: { expected?: Record<string, unknown>, actual?: Record<string, unknown> }, history?: { expected?: Array<Record<string, unknown>>, actual?: Array<Record<string, unknown>> } }} [input.protected]
 * @param {string | { text?: string }} [input.posting]
 * @param {string} [input.finalText]
 * @param {string} [input.html]
 */
export function criticHardChecks({ document, draft = {}, ledger = {}, sourceRefs = [], protected: protectedFacts = {}, posting = "", finalText = "", html = "" }) {
  const claims = new Set((ledger.claims || []).map((claim) => claim.id));
  const slots = document === "resume" ? [...(draft.bullets || []), ...(draft.earlier || [])] : [];
  const unknown = slots.map((slot) => slot?.claimId).filter((id) => typeof id === "string" && !claims.has(id));
  const postingText = typeof posting === "string" ? posting : String(posting?.text || "");
  const metricText = (/** @type {string} */ text) => text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, " ")
    .replace(/(?<!\w)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\w)/g, " ")
    .replace(/\b[\p{L}][\p{L}\p{N}]*\d[\p{L}\p{N}]*\b/gu, " ");
  const metricIssues = [];
  for (const entry of draftMetricEntries(document, draft)) {
    for (const sentence of splitMetricSentences(entry.text)) {
      for (const token of numerals(metricText(sentence))) {
        const claimIds = sourceClaimIdsForSentence(sentence, sourceRefs, draft, ledger, document, entry.claimId);
        if (!metricHasSource(token, metricTokensForClaims(claimIds, ledger))) {
          metricIssues.push({ field: entry.field, token, message: `${entry.field}: ${token} is not grounded by this sentence's source claim.` });
        }
      }
    }
  }
  const expectedEmployers = Array.isArray(protectedFacts.expectedEmployers) ? protectedFacts.expectedEmployers : [];
  const renderedEmployers = Array.isArray(protectedFacts.renderedEmployers) ? protectedFacts.renderedEmployers : [];
  const missing = expectedEmployers.filter((name) => !renderedEmployers.includes(name));
  const allowed = new Set((ledger.employers || []).map((employer) => employer.name));
  const invented = renderedEmployers.filter((name) => allowed.size && !allowed.has(name));
  const renderedTexts = [finalText, visibleText(html)].filter(Boolean);
  const inventedMetrics = [];
  for (const text of renderedTexts) {
    for (const sentence of splitMetricSentences(text)) {
      for (const token of numerals(metricText(sentence))) {
        const claimIds = sourceClaimIdsForSentence(sentence, sourceRefs, draft, ledger, document);
        if (!metricHasSource(token, metricTokensForClaims(claimIds, ledger))) inventedMetrics.push(token);
      }
    }
  }
  const uniqueInventedMetrics = [...new Set(inventedMetrics)];
  const employerPattern = /\b(?:at|for|with)\s+([A-Z][\p{L}\p{N}'&.-]*(?:\s+[A-Z][\p{L}\p{N}'&.-]*){0,3}\s+(?:Corp(?:oration)?|Labs|Inc\.?|LLC|Ltd\.?|Company|Technologies|Systems|Group))\b/gu;
  const namedInText = renderedTexts.flatMap((text) => [...text.matchAll(employerPattern)].map((match) => match[1]));
  const namedInHtml = composedEmployerStrings(html);
  const knownEmployers = new Set([...(ledger.employers || []).map((employer) => employer.name), ...expectedEmployers, ...renderedEmployers].filter((/** @type {string | undefined} */ name) => typeof name === "string" && name.length > 0).map((name) => String(name).toLowerCase()));
  const inventedRenderedEmployers = [...new Set([...namedInText, ...namedInHtml])].filter((name) => !knownEmployers.has(name.toLowerCase()) && !postingText.toLowerCase().includes(name.toLowerCase()));
  const changedProtected = [];
  const identity = protectedFacts.identity;
  if (identity?.expected) {
    for (const [field, value] of Object.entries(identity.expected)) {
      if (identity.actual?.[field] !== value) changedProtected.push(`identity.${field}`);
    }
  }
  const history = protectedFacts.history;
  if (history?.expected) {
    for (const [index, row] of history.expected.entries()) {
      for (const [field, value] of Object.entries(row)) {
        if (history.actual?.[index]?.[field] !== value) changedProtected.push(`history.${index}.${field}`);
      }
    }
  }
  /** @type {string[]} */
  const slotStrings = [];
  collectStrings(draft, slotStrings);
  return [
    { id: "known_source_ids", pass: unknown.length === 0, reason: unknown.length ? `Unknown claim ids: ${unknown.join(", ")}.` : "All claim ids exist." },
    { id: "metric_mismatch", pass: metricIssues.length === 0, reason: metricIssues.length ? metricIssues.map((issue) => issue.message).join(" ") : "Metrics trace to their sentence-linked claim or same-employer fallback." },
    { id: "invented_fact", pass: uniqueInventedMetrics.length === 0, reason: uniqueInventedMetrics.length ? `Rendered metric(s) absent from sentence-linked evidence: ${uniqueInventedMetrics.join(", ")}.` : "Rendered metrics trace to sentence-linked evidence." },
    { id: "invented_employer", pass: inventedRenderedEmployers.length === 0, reason: inventedRenderedEmployers.length ? `Rendered employer(s) absent from approved evidence: ${inventedRenderedEmployers.join(", ")}.` : "Rendered employers trace to approved evidence." },
    { id: "protected_fact", pass: !missing.length && !invented.length && !changedProtected.length, reason: [...missing.map((name) => `Missing protected employer: ${name}.`), ...invented.map((name) => `Invented employer: ${name}.`), ...changedProtected.map((field) => `Changed protected field: ${field}.`)].join(" ") || "Protected facts are preserved." },
    { id: "html_in_slot", pass: !slotStrings.some((value) => HTML_IN_SLOT_RE.test(value)), reason: "Writer slots must contain plain text." },
  ];
}
