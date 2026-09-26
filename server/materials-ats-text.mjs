/**
 * Render model → plain-text ATS twins (plan slice 3).
 *
 * The .txt twin is generated from the render model, never scraped from the
 * HTML, so it is byte-identical for every template family: switching
 * families changes the look, never what an ATS reads. Chrome-only elements
 * (readout strips, pull quotes, headlines, signatures) restate facts that
 * are already in the body, so they are left out.
 */

import { runsToText } from "./materials-render.mjs";

/**
 * @param {string} text
 * @param {number} width
 * @param {string} [firstPrefix]
 * @param {string} [restPrefix]
 * @returns {string}
 */
export function wrapText(text, width, firstPrefix = "", restPrefix = firstPrefix) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return firstPrefix.trimEnd();
  /** @type {string[]} */
  const lines = [];
  let line = firstPrefix;
  let lineHasWord = false;
  for (const word of words) {
    const candidate = lineHasWord ? `${line} ${word}` : `${line}${word}`;
    if (lineHasWord && candidate.length > width) {
      lines.push(line);
      line = `${restPrefix}${word}`;
    } else {
      line = candidate;
    }
    lineHasWord = true;
  }
  lines.push(line);
  return lines.join("\n");
}

/**
 * @param {import("./materials-render.mjs").RenderModel} model
 */
function options(model) {
  const ats = model.atsText || {};
  const wrap = typeof ats.wrap === "number" && ats.wrap >= 72 && ats.wrap <= 88 ? ats.wrap : 78;
  const marker = typeof ats.bulletMarker === "string" && ats.bulletMarker ? ats.bulletMarker : "- ";
  /** @param {string} label */
  const heading = (label) => (ats.headings === "title" ? label : label.toUpperCase());
  return { wrap, marker, heading };
}

/**
 * @param {import("./materials-render.mjs").RenderModel} model
 */
function headerLines(model) {
  const { wrap } = options(model);
  const contact = (model.identity.contact || []).map((c) => c.text).filter(Boolean);
  /** @type {string[]} */
  const contactLines = [];
  for (const item of contact) {
    const last = contactLines[contactLines.length - 1];
    if (last && `${last} | ${item}`.length <= wrap) contactLines[contactLines.length - 1] = `${last} | ${item}`;
    else contactLines.push(item);
  }
  return [model.identity.name, model.identity.target, ...contactLines].filter(Boolean);
}

/**
 * @param {import("./materials-render.mjs").Entry} entry
 * @param {{ wrap: number, marker: string }} opts
 */
function entryLines(entry, opts) {
  const seat = runsToText(entry.seat);
  const meta = (entry.meta || []).filter(Boolean).join(" ");
  /** @type {string[]} */
  const lines = [[entry.org, seat].filter(Boolean).join(", ")];
  if (meta) lines.push(meta);
  for (const bullet of entry.bullets || []) {
    lines.push(wrapText(runsToText(bullet.runs), opts.wrap, opts.marker, " ".repeat(opts.marker.length)));
  }
  if (!(entry.bullets || []).length && entry.line) {
    lines.push(wrapText(entry.line, opts.wrap, opts.marker, " ".repeat(opts.marker.length)));
  }
  return lines;
}

/**
 * @param {import("./materials-render.mjs").RenderModel} model
 * @returns {string}
 */
export function resumeText(model) {
  const resume = model.documents.resume;
  if (!resume) return "";
  const opts = options(model);
  /** @type {string[][]} */
  const blocks = [headerLines(model)];
  const statement = runsToText(resume.statement?.runs);
  if (statement) blocks.push([opts.heading("Summary"), wrapText(statement, opts.wrap)]);
  if (resume.intro && Array.isArray(resume.intro.runs)) {
    blocks.push([opts.heading("Profile"), wrapText(runsToText(resume.intro.runs), opts.wrap)]);
  }
  for (const section of resume.sections || []) {
    if (section.kind === "readouts") continue;
    /** @type {string[]} */
    const lines = [opts.heading(section.label)];
    if (section.entries?.length) {
      section.entries.forEach((entry, index) => {
        if (index > 0) lines.push("");
        lines.push(...entryLines(entry, opts));
      });
    }
    if (section.groups?.length) {
      for (const group of section.groups) lines.push(wrapText(`${group.label}: ${group.items.join(", ")}`, opts.wrap));
    }
    if (section.tokens?.length) lines.push(wrapText(section.tokens.join(", "), opts.wrap));
    if (section.lines?.length) {
      for (const line of section.lines) lines.push(wrapText(runsToText(line.runs), opts.wrap));
    }
    if (lines.length > 1) blocks.push(lines);
  }
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

/**
 * @param {import("./materials-render.mjs").RenderModel} model
 * @returns {string}
 */
export function coverLetterText(model) {
  const letter = model.documents.coverLetter;
  if (!letter) return "";
  const opts = options(model);
  /** @type {string[][]} */
  const blocks = [headerLines(model)];
  const rail = (letter.rail || [])
    .map((group) => `${group.label}: ${group.lines.join(", ")}`)
    .filter(Boolean);
  if (rail.length) blocks.push(rail);
  blocks.push([letter.salutation]);
  for (const paragraph of letter.paragraphs || []) blocks.push([wrapText(paragraph.text, opts.wrap)]);
  blocks.push([letter.signoff || "Best,", model.identity.name]);
  return `${blocks.map((b) => b.join("\n")).join("\n\n")}\n`;
}

/**
 * Visible words of the resume as the ATS twin counts them; the fit stage
 * compares this against the family's soft word budget.
 * @param {import("./materials-render.mjs").RenderModel} model
 */
export function resumeWordCount(model) {
  const text = resumeText(model).trim();
  return text ? text.split(/\s+/).length : 0;
}
