import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";

const KEYWORD_MIN_LENGTH = 5;
const KEYWORD_MIN_HITS = 3;
const JD_ECHO_WINDOW = 8;
const STOP_LIST = new Set(["about", "their", "would", "should", "other", "which"]);
const BANNED_FILLER_RE = /leverage|synergize|passionate about|results-driven|proven track record/i;
const HTML_IN_SLOT_RE = /<[a-z]/i;

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

/** @param {unknown} jdText */
function jdKeywords(jdText) {
  /** @type {string[]} */
  const keywords = [];
  const seen = new Set();
  for (const raw of tokenize(jdText)) {
    const word = raw.toLowerCase();
    if (word.length < KEYWORD_MIN_LENGTH) continue;
    if (STOP_LIST.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    keywords.push(word);
  }
  return keywords;
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
  if (source.includes("Audacy")) employers.add("Audacy");

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
 * Word budgets stay in materials-quality; HTML is staged so auditCoverLetter
 * / auditResume read the same 325–475 and resume section rules.
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
 * @param {unknown} [input.writerJson]
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
  writerJson,
} = {}) {
  const letterSource = typeof letterHtml === "string" ? letterHtml : "";
  const resumeSource = typeof resumeHtml === "string" ? resumeHtml : "";
  const { letter, resume } = await auditStagedHtml(letterSource, resumeSource);

  /** @type {CriticIssue[]} */
  const issues = [...(letter.issues || []), ...(resume.issues || [])];

  const letterText = visibleText(letterSource);
  const resumeText = visibleText(resumeSource);
  const combinedText = `${letterText} ${resumeText}`.toLowerCase();
  const keywords = jdKeywords(jdText);
  const keywordHits = keywords.filter((word) => combinedText.includes(word));
  if (keywordHits.length < KEYWORD_MIN_HITS) {
    issues.push(issue(
      "keyword_coverage_low",
      `Letter and resume use ${keywordHits.length} job-description keywords of length ≥ ${KEYWORD_MIN_LENGTH}; need at least ${KEYWORD_MIN_HITS}.`,
    ));
  }

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

  if (BANNED_FILLER_RE.test(letterSource)) {
    issues.push(issue(
      "banned_filler",
      "Cover letter uses banned filler phrasing.",
    ));
  }

  const missingEmployers = extractEmployerStrings(masterResumeHtml).filter(
    (name) => !resumeSource.includes(name),
  );
  if (missingEmployers.length) {
    issues.push(issue(
      "frozen_fact_broken",
      `Composed resume dropped frozen employer fact(s): ${missingEmployers.join(", ")}.`,
      "fail",
    ));
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
