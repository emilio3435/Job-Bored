/**
 * Neutral resume and cover-letter layouts built from the writer's JSON,
 * which in turn is built from the user's own resume (UX01 C11).
 *
 * These replace the production use of
 * integrations/hermes-job-hunt/{resume,cover-letter}-template/*.html,
 * which carry the maintainer's name, contact details and employers. Those
 * files stay in the repo only as labelled samples that tests inject.
 *
 * Output keeps the hooks materials-quality.mjs and materials-critic.mjs
 * read: article.page, data-section="summary|experience|education|skills",
 * article[data-role], h2.company-name, and the letter's data-slot names.
 */

import { candidateNameFromText } from "./materials-resume-source.mjs";

/** @param {unknown} value */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {unknown} value */
function strList(value) {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

/** @param {string} value */
function esc(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Greyscale print styles; no brand colours, fonts or assets.
 */
const BASE_STYLE = `
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 Georgia, "Times New Roman", serif; color: black; background: white; }
  article.page { max-width: 7.3in; margin: 0 auto; padding: 0.2in 0; }
  header.masthead { border-bottom: 1px solid gray; padding-bottom: 8px; margin-bottom: 14px; }
  h1.name { font-size: 20pt; margin: 0 0 2px; letter-spacing: 0.01em; }
  .headline { margin: 0 0 4px; font-style: italic; }
  .contact { margin: 0; font-size: 9.5pt; color: dimgray; }
  section { margin: 0 0 12px; }
  section > h2 { font-size: 10pt; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 6px; color: dimgray; }
  article[data-role] { margin: 0 0 10px; break-inside: avoid; }
  h2.company-name { font-size: 11pt; margin: 0; }
  .role-meta { margin: 0 0 4px; font-size: 9.5pt; color: dimgray; }
  ul { margin: 0; padding-left: 1.1em; }
  li { margin: 0 0 2px; }
  .meta-block { margin: 0 0 14px; font-size: 10pt; }
  .meta-block p { margin: 0; }
  .letter-body p { margin: 0 0 10px; }
  .signature { margin-top: 16px; }
`;

/**
 * @param {string} title
 * @param {string} body
 */
function htmlDocument(title, body) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${esc(title)}</title>`,
    `<style>${BASE_STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * @typedef {object} CandidateHeader
 * @property {string} name
 * @property {string} headline
 * @property {string[]} contact
 */

/**
 * The candidate's name and contact line: the writer's header when it gave
 * one, else the first line of their resume. Never the maintainer's.
 * @param {unknown} resumeJson
 * @param {string} resumeText
 * @returns {CandidateHeader}
 */
export function candidateHeader(resumeJson, resumeText) {
  const header = isPlainObject(resumeJson) && isPlainObject(/** @type {Record<string, unknown>} */ (resumeJson).header)
    ? /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (resumeJson).header)
    : {};
  return {
    name: str(header.name) || candidateNameFromText(resumeText),
    headline: str(header.headline),
    contact: strList(header.contact),
  };
}

/** @param {CandidateHeader} header */
function mastheadHtml(header) {
  const parts = ['<header class="masthead">'];
  if (header.name) parts.push(`<h1 class="name">${esc(header.name)}</h1>`);
  if (header.headline) parts.push(`<p class="headline">${esc(header.headline)}</p>`);
  if (header.contact.length) {
    parts.push(`<p class="contact">${header.contact.map(esc).join(" · ")}</p>`);
  }
  parts.push("</header>");
  return parts.join("\n");
}

/** @param {string} value */
function slugId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * @param {unknown} resumeJson writer JSON `resume` object
 * @param {{ resumeText: string }} source the user's resume
 * @returns {string}
 */
export function renderCandidateResume(resumeJson, { resumeText }) {
  const resume = isPlainObject(resumeJson) ? /** @type {Record<string, unknown>} */ (resumeJson) : {};
  const header = candidateHeader(resume, resumeText);
  const summary = isPlainObject(resume.summary) ? /** @type {Record<string, unknown>} */ (resume.summary) : {};
  const summaryText = [str(summary.opener), str(summary.body)].filter(Boolean).join(" ");

  const roles = Array.isArray(resume.roles) ? resume.roles.filter(isPlainObject) : [];
  const roleHtml = roles.map((raw, index) => {
    const role = /** @type {Record<string, unknown>} */ (raw);
    const company = str(role.company);
    const id = str(role.id) || slugId(company) || `role-${index + 1}`;
    const meta = [str(role.title), str(role.location), str(role.dates)].filter(Boolean).join(" · ");
    const bullets = strList(role.bullets);
    return [
      `<article data-role="${esc(id)}">`,
      company ? `<h2 class="company-name">${esc(company)}</h2>` : "",
      meta ? `<p class="role-meta">${esc(meta)}</p>` : "",
      `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`,
      "</article>",
    ].filter(Boolean).join("\n");
  });

  const education = strList(resume.education);
  const skills = strList(resume.skills).length
    ? strList(resume.skills)
    : strList(resume.capabilitiesOrder);

  const body = [
    '<article class="page">',
    mastheadHtml(header),
    `<section data-section="summary"><h2>Summary</h2><p>${esc(summaryText)}</p></section>`,
    `<section data-section="experience"><h2>Experience</h2>\n${roleHtml.join("\n")}\n</section>`,
    education.length
      ? `<section data-section="education"><h2>Education</h2><ul>${education.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></section>`
      : "",
    skills.length
      ? `<section data-section="skills"><h2>Skills</h2><p>${skills.map(esc).join(" · ")}</p></section>`
      : "",
    "</article>",
  ].filter(Boolean).join("\n");

  return htmlDocument(header.name ? `${header.name} — Resume` : "Resume", body);
}

/**
 * @param {unknown} letterJson writer JSON `letter` object
 * @param {CandidateHeader} header from candidateHeader()
 * @returns {string}
 */
export function renderCandidateLetter(letterJson, header) {
  const letter = isPlainObject(letterJson) ? /** @type {Record<string, unknown>} */ (letterJson) : {};
  /** @param {string} field @param {string} slot @param {string} [tag] */
  const para = (field, slot, tag = "p") => {
    const value = str(letter[field]);
    return value ? `<${tag} data-slot="${slot}">${esc(value)}</${tag}>` : "";
  };
  const salutation = str(letter.hiringManager) || "Hiring Team";
  const recipient = [
    `<span data-slot="company">${esc(str(letter.company))}</span>`,
    str(letter.companyAddr) ? `<span data-slot="company-addr">${esc(str(letter.companyAddr))}</span>` : "",
  ].filter(Boolean).join("<br />");

  const body = [
    '<article class="page">',
    mastheadHtml(header),
    '<div class="meta-block">',
    str(letter.date) ? `<p data-slot="date">${esc(str(letter.date))}</p>` : "",
    `<p>${recipient}</p>`,
    str(letter.role) ? `<p>Re: <span data-slot="role">${esc(str(letter.role))}</span></p>` : "",
    "</div>",
    `<p class="salutation">Dear <span data-slot="salutation-name">${esc(salutation)}</span>,</p>`,
    '<div class="letter-body">',
    para("hook", "hook"),
    para("whyThem", "why-them"),
    para("whyMe", "why-me"),
    para("whyNow", "why-now"),
    para("closing", "closing"),
    para("flourish", "flourish"),
    "</div>",
    '<div class="signature">',
    "<p>Best,</p>",
    header.name ? `<p>${esc(header.name)}</p>` : "",
    "</div>",
    "</article>",
  ].filter(Boolean).join("\n");

  return htmlDocument(header.name ? `${header.name} — Cover Letter` : "Cover Letter", body);
}
