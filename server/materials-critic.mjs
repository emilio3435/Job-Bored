import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { maskNonMetrics } from "./materials-numerals.mjs";
import { companyDisplayName } from "./materials-monogram.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { loadVoicePack } from "./materials-delint.mjs";
import { numerals, tagDraftMetrics } from "./materials-metric-tag.mjs";

const JD_ECHO_WINDOW = 8;
const HTML_IN_SLOT_RE = /<[a-z]/i;

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
        if (!ledgerTokens.includes(token)) {
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
 * @param {{ claims?: Array<{ id?: string, text?: string, metrics?: Array<{ token?: string }> }>, employers?: Array<{ name?: string }> }} [input.ledger]
 * @param {{ expectedEmployers?: string[], renderedEmployers?: string[], identity?: { expected?: Record<string, unknown>, actual?: Record<string, unknown> }, history?: { expected?: Array<Record<string, unknown>>, actual?: Array<Record<string, unknown>> } }} [input.protected]
 * @param {string | { text?: string }} [input.posting]
 * @param {string} [input.finalText]
 * @param {string} [input.html]
 */
export function criticHardChecks({ document, draft = {}, ledger = {}, protected: protectedFacts = {}, posting = "", finalText = "", html = "" }) {
  const claims = new Set((ledger.claims || []).map((claim) => claim.id));
  const slots = document === "resume" ? [...(draft.bullets || []), ...(draft.earlier || [])] : [];
  const unknown = slots.map((slot) => slot?.claimId).filter((id) => typeof id === "string" && !claims.has(id));
  const metrics = tagDraftMetrics({ draft: document === "letter" ? { letter: draft.letter || {} } : { statement: draft.statement, bullets: draft.bullets || [], earlier: draft.earlier || [] }, ledger, postingText: typeof posting === "string" ? posting : String(posting?.text || "") });
  const expectedEmployers = Array.isArray(protectedFacts.expectedEmployers) ? protectedFacts.expectedEmployers : [];
  const renderedEmployers = Array.isArray(protectedFacts.renderedEmployers) ? protectedFacts.renderedEmployers : [];
  const missing = expectedEmployers.filter((name) => !renderedEmployers.includes(name));
  const allowed = new Set((ledger.employers || []).map((employer) => employer.name));
  const invented = renderedEmployers.filter((name) => allowed.size && !allowed.has(name));
  const postingText = typeof posting === "string" ? posting : String(posting?.text || "");
  const metricTokens = new Set((ledger.claims || []).flatMap((claim) => (claim.metrics || []).map((metric) => String(metric.token || ""))));
  if (document === "letter") for (const token of numerals(postingText)) metricTokens.add(token);
  const renderedTexts = [finalText, visibleText(html)].filter(Boolean);
  const metricText = (/** @type {string} */ text) => text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, " ")
    .replace(/(?<!\w)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\w)/g, " ")
    .replace(/\b[\p{L}][\p{L}\p{N}]*\d[\p{L}\p{N}]*\b/gu, " ");
  const inventedMetrics = [...new Set(renderedTexts.flatMap((text) => numerals(metricText(text))))].filter((token) => !metricTokens.has(token));
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
    { id: "metric_mismatch", pass: metrics.issues.length === 0, reason: metrics.issues.length ? metrics.issues.map((issue) => issue.message).join(" ") : "Metrics trace to their own claims or the posting." },
    { id: "invented_fact", pass: inventedMetrics.length === 0, reason: inventedMetrics.length ? `Rendered metric(s) absent from approved evidence: ${inventedMetrics.join(", ")}.` : "Rendered metrics trace to approved evidence." },
    { id: "invented_employer", pass: inventedRenderedEmployers.length === 0, reason: inventedRenderedEmployers.length ? `Rendered employer(s) absent from approved evidence: ${inventedRenderedEmployers.join(", ")}.` : "Rendered employers trace to approved evidence." },
    { id: "protected_fact", pass: !missing.length && !invented.length && !changedProtected.length, reason: [...missing.map((name) => `Missing protected employer: ${name}.`), ...invented.map((name) => `Invented employer: ${name}.`), ...changedProtected.map((field) => `Changed protected field: ${field}.`)].join(" ") || "Protected facts are preserved." },
    { id: "html_in_slot", pass: !slotStrings.some((value) => HTML_IN_SLOT_RE.test(value)), reason: "Writer slots must contain plain text." },
  ];
}
