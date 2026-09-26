import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCoverLetter, auditResume } from "./materials-quality.mjs";
import { loadVoicePack } from "./materials-delint.mjs";

const JD_ECHO_WINDOW = 8;
const HTML_IN_SLOT_RE = /<[a-z]/i;

/* Fallback when the voice pack cannot load; the pack (30+ patterns) is
 * the real list. */
const FALLBACK_FILLER = ["leverage", "synergize", "passionate about", "results-driven", "proven track record"];

/** @type {RegExp | null} */
let cachedFillerRe = null;

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
      .map((rule) => (rule && typeof rule.pattern === "string" ? rule.pattern.trim() : ""))
      .filter((pattern) => pattern.length >= 3);
    if (listed.length) patterns = listed;
  } catch {
    // fall back to the five phrases
  }
  cachedFillerRe = new RegExp(
    `\\b(?:${patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "i",
  );
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
  const resumeText = visibleText(resumeSource);

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
    (name) => !resumeSource.includes(name),
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
      for (const match of String(text).matchAll(/((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g)) {
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
    const invented = composedEmployerStrings(resumeSource).filter(
      (name) => !sourceText.includes(name.toLowerCase()),
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
