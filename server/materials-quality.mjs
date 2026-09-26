import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const QUALITY_VERSION = "materials-quality.v1";

const RESUME_TWO_PAGE_MIN_WORDS = 750;
const RESUME_TWO_PAGE_MIN_PAGE_WORDS = 240;
const COVER_MIN_WORDS = 325;
const COVER_MAX_WORDS = 475;

/**
 * @typedef {object} QualityIssue
 * @property {string} code
 * @property {string} message
 * @property {"review" | "fail"} severity
 */

/**
 * @typedef {object} DocumentAudit
 * @property {string} status
 * @property {number} pageCount
 * @property {number} words
 * @property {number[]} pageWords
 * @property {string[]} [sections]
 * @property {QualityIssue[]} issues
 */

/** @param {unknown} html */
function stripHtml(html) {
  return String(html || "")
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
function countWords(text) {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** @param {unknown} html */
function extractPageHtml(html) {
  const pages = [];
  const re = /<article\b[^>]*class=["'][^"']*\bpage\b[^"']*["'][^>]*>[\s\S]*?(?=<article\b[^>]*class=["'][^"']*\bpage\b[^"']*["']|<\/body>|$)/gi;
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    pages.push(match[0]);
  }
  return pages.length ? pages : [html];
}

/** @param {unknown} html */
function extractSections(html) {
  const sections = new Set();
  const re = /data-section=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    sections.add(match[1]);
  }
  return Array.from(sections);
}

/**
 * A template letter declares its body word band in
 * <meta name="materials-letter-words" content="180-260">.
 * @param {string} html
 * @returns {[number, number] | null}
 */
export function letterWordBandFromHtml(html) {
  const match = /<meta\s+name="materials-letter-words"\s+content="(\d+)-(\d+)"/i.exec(html);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/**
 * Words in the letter body: the text of every element carrying
 * data-paragraph (nested inline markup included), chrome excluded.
 * @param {string} html
 */
export function letterBodyWords(html) {
  let words = 0;
  const open = /<(p|span|div)\b[^>]*\bdata-paragraph="[^"]*"[^>]*>/gi;
  let match;
  while ((match = open.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    tagRe.lastIndex = match.index + match[0].length;
    let depth = 1;
    let end = html.length;
    let t;
    while ((t = tagRe.exec(html)) !== null) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
    }
    words += countWords(stripHtml(html.slice(match.index + match[0].length, end)));
    open.lastIndex = end;
  }
  return words;
}

/** @param {unknown} buffer */
export function countPdfPages(buffer) {
  if (!buffer) return 0;
  const text = Buffer.isBuffer(buffer)
    ? buffer.toString("latin1")
    : Buffer.from(String(buffer), "latin1").toString("latin1");
  return (text.match(/\/Type\s*\/Page\b/g) || []).length;
}

/** @param {unknown} html */
export function analyzeHtml(html) {
  const pageHtml = extractPageHtml(html);
  const pageWords = pageHtml.map((page) => countWords(stripHtml(page)));
  const text = stripHtml(html);
  return {
    words: countWords(text),
    pageWords,
    sections: extractSections(html),
  };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {"review" | "fail"} [severity]
 * @returns {QualityIssue}
 */
function issue(code, message, severity = "review") {
  return { code, message, severity };
}

/** @param {QualityIssue[]} issues */
function statusFor(issues) {
  if (issues.some((item) => item.severity === "fail")) return "fail";
  if (issues.length) return "review";
  return "pass";
}

/**
 * @param {import("node:fs").PathLike | undefined} path
 * @param {BufferEncoding} [encoding]
 */
async function readOptional(path, encoding) {
  const checkedPath = /** @type {import("node:fs").PathLike} */ (path);
  if (!existsSync(checkedPath)) return null;
  return encoding ? readFile(checkedPath, encoding) : readFile(checkedPath);
}

/**
 * @param {string[]} sections
 * @param {string[]} names
 */
function hasAnySection(sections, names) {
  return names.some((name) => sections.includes(name));
}

/**
 * @param {{ htmlPath?: import("node:fs").PathLike, pdfPath?: import("node:fs").PathLike }} [paths]
 * @returns {Promise<DocumentAudit | null>}
 */
export async function auditResume({ htmlPath, pdfPath } = {}) {
  const html = await readOptional(htmlPath, "utf8");
  const pdf = await readOptional(pdfPath);
  if (!html && !pdf) return null;

  const htmlStats = html ? analyzeHtml(html) : { words: 0, pageWords: [], sections: [] };
  const pdfPages = pdf ? countPdfPages(pdf) : 0;
  const pageCount = pdfPages || htmlStats.pageWords.length || 0;
  const issues = [];

  if (pageCount > 2) {
    issues.push(issue(
      "resume_page_count_high",
      `Resume renders to ${pageCount} pages; target an intentional one-page or two-page resume.`,
      "fail",
    ));
  }
  if (pageCount === 2 && htmlStats.words < RESUME_TWO_PAGE_MIN_WORDS) {
    issues.push(issue(
      "resume_two_page_sparse",
      `Two-page resume has ${htmlStats.words} words; fill the second page with relevant evidence or tighten to one page.`,
    ));
  }
  if (pageCount === 2 && htmlStats.pageWords[1] < RESUME_TWO_PAGE_MIN_PAGE_WORDS) {
    issues.push(issue(
      "resume_second_page_sparse",
      `Second page has ${htmlStats.pageWords[1] || 0} words; expand with relevant evidence or collapse to one page.`,
    ));
  }
  if (!hasAnySection(htmlStats.sections, ["summary"])) {
    issues.push(issue("resume_summary_missing", "Resume is missing a summary section.", "fail"));
  }
  if (!hasAnySection(htmlStats.sections, ["experience", "experience-continued"])) {
    issues.push(issue("resume_experience_missing", "Resume is missing an experience section.", "fail"));
  }
  if (!hasAnySection(htmlStats.sections, ["education"])) {
    issues.push(issue("resume_education_missing", "Resume is missing education.", "review"));
  }
  if (!hasAnySection(htmlStats.sections, ["capabilities", "skills"])) {
    issues.push(issue("resume_capabilities_missing", "Resume is missing capabilities or skills.", "review"));
  }

  return {
    status: statusFor(issues),
    pageCount,
    words: htmlStats.words,
    pageWords: htmlStats.pageWords,
    sections: htmlStats.sections,
    issues,
  };
}

/**
 * @param {{ htmlPath?: import("node:fs").PathLike, pdfPath?: import("node:fs").PathLike }} [paths]
 * @returns {Promise<DocumentAudit | null>}
 */
export async function auditCoverLetter({ htmlPath, pdfPath } = {}) {
  const html = await readOptional(htmlPath, "utf8");
  const pdf = await readOptional(pdfPath);
  if (!html && !pdf) return null;

  const htmlStats = html ? analyzeHtml(html) : { words: 0, pageWords: [], sections: [] };
  const pdfPages = pdf ? countPdfPages(pdf) : 0;
  const pageCount = pdfPages || htmlStats.pageWords.length || 0;
  const issues = [];

  if (pageCount !== 1) {
    issues.push(issue(
      "cover_letter_page_count",
      `Cover letter renders to ${pageCount || "unknown"} pages; target one polished page.`,
      pageCount > 1 ? "fail" : "review",
    ));
  }
  /* A registry letter is judged on its body against its family's band; a
     legacy letter keeps the whole-page 325–475 rule. */
  const htmlText = typeof html === "string" ? html : "";
  const band = htmlText ? letterWordBandFromHtml(htmlText) : null;
  const [minWords, maxWords] = band || [COVER_MIN_WORDS, COVER_MAX_WORDS];
  const counted = band ? letterBodyWords(htmlText) : htmlStats.words;
  const scope = band ? "body words" : "words";
  if (counted < minWords) {
    issues.push(issue(
      "cover_letter_too_short",
      `Cover letter has ${counted} ${scope} (target ${minWords}–${maxWords}); add specific role evidence.`,
    ));
  }
  if (counted > maxWords) {
    issues.push(issue(
      "cover_letter_too_long",
      `Cover letter has ${counted} ${scope} (target ${minWords}–${maxWords}); tighten to fit one page.`,
    ));
  }

  return {
    status: statusFor(issues),
    pageCount,
    words: htmlStats.words,
    pageWords: htmlStats.pageWords,
    issues,
  };
}

/** @param {string} dir */
export async function auditApplicationMaterials(dir) {
  /** @type {Record<string, DocumentAudit>} */
  const documents = {};
  const resume = await auditResume({
    htmlPath: join(dir, "resume.html"),
    pdfPath: join(dir, "resume.pdf"),
  });
  if (resume) documents.resume = resume;

  const coverLetter = await auditCoverLetter({
    htmlPath: join(dir, "cover-letter.html"),
    pdfPath: join(dir, "cover-letter.pdf"),
  });
  if (coverLetter) documents.cover_letter = coverLetter;

  const allIssues = Object.values(documents).flatMap((doc) => doc.issues || []);
  return {
    version: QUALITY_VERSION,
    status: statusFor(allIssues),
    documents,
  };
}
