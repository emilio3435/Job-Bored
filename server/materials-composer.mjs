import * as cheerio from "cheerio";

/** @typedef {import("cheerio").CheerioAPI} CheerioApi */

/**
 * @typedef {object} LetterJson
 * @property {string} [date]
 * @property {string} [company]
 * @property {string} [companyAddr]
 * @property {string} [role]
 * @property {string} [hiringManager]
 * @property {string} [hook]
 * @property {string} [whyThem]
 * @property {string} [whyMe]
 * @property {string} [whyNow]
 * @property {string} [closing]
 * @property {string} [flourish]
 */

/**
 * @typedef {object} ResumeSummary
 * @property {string} [opener]
 * @property {string} [body]
 */

/**
 * @typedef {object} ResumeRole
 * @property {string} id
 * @property {string[]} bullets
 */

/**
 * @typedef {object} ResumeJson
 * @property {ResumeSummary} [summary]
 * @property {ResumeRole[]} [roles]
 */

/** @type {Readonly<Record<keyof LetterJson, readonly string[]>>} */
const LETTER_SLOTS = {
  date: ["date"],
  company: ["company"],
  companyAddr: ["company-addr"],
  role: ["role"],
  hiringManager: ["hiring-manager", "salutation-name"],
  hook: ["hook"],
  whyThem: ["why-them"],
  whyMe: ["why-me"],
  whyNow: ["why-now"],
  closing: ["closing"],
  flourish: ["flourish"],
};

/**
 * @param {unknown} html
 * @returns {CheerioApi}
 */
function loadDocument(html) {
  return cheerio.load(typeof html === "string" ? html : "");
}

/**
 * @param {CheerioApi} $
 * @returns {string}
 */
function serializeHtml($) {
  return $.html();
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {CheerioApi} $
 * @param {unknown} summary
 */
function fillSummary($, summary) {
  if (!isPlainObject(summary)) return;
  const $section = $('[data-section="summary"]').first();
  if (!$section.length) return;

  const $opener = $section.find(".opener");
  const $body = $section.find(".body");
  if ($opener.length || $body.length) {
    if (typeof summary.opener === "string") $opener.text(summary.opener);
    if (typeof summary.body === "string") $body.text(summary.body);
    return;
  }

  const parts = [];
  if (typeof summary.opener === "string") parts.push(summary.opener);
  if (typeof summary.body === "string") parts.push(summary.body);
  $section.text(parts.join(" "));
}

/**
 * @param {CheerioApi} $
 * @param {unknown} role
 */
function fillRole($, role) {
  if (!isPlainObject(role)) return;
  const id = typeof role.id === "string" ? role.id : "";
  if (!id || !Array.isArray(role.bullets)) return;

  const $article = $("article[data-role]").filter(
    (_, el) => $(el).attr("data-role") === id,
  );
  if (!$article.length) return;

  const $ul = $article.find("ul").first();
  if (!$ul.length) return;

  const bullets = role.bullets.map((bullet) =>
    typeof bullet === "string" ? bullet : "",
  );

  let $items = $ul.children("li");
  if (!$items.length && bullets.length > 0) {
    $ul.append("<li></li>");
    $items = $ul.children("li");
  }
  while ($items.length < bullets.length) {
    $items.last().clone().appendTo($ul);
    $items = $ul.children("li");
  }
  while ($items.length > bullets.length) {
    $items.last().remove();
    $items = $ul.children("li");
  }

  $ul.children("li").each((index, el) => {
    $(el).text(bullets[index] ?? "");
  });
}

/**
 * Fill branded cover-letter `data-slot` nodes from writer JSON.
 * Present string fields are written with `.text()`; `<style>` is untouched.
 *
 * @param {unknown} html
 * @param {unknown} letter
 * @returns {string}
 */
export function composeCoverLetter(html, letter) {
  const $ = loadDocument(html);
  if (!isPlainObject(letter)) return serializeHtml($);

  for (const [field, slots] of Object.entries(LETTER_SLOTS)) {
    if (!Object.hasOwn(letter, field)) continue;
    const value = letter[field];
    if (typeof value !== "string") continue;
    for (const slot of slots) {
      $(`[data-slot="${slot}"]`).text(value);
    }
  }

  return serializeHtml($);
}

/**
 * Fill resume summary + existing `article[data-role]` bullets from writer JSON.
 * Unknown role ids are ignored; no nodes are invented.
 *
 * @param {unknown} html
 * @param {unknown} resume
 * @returns {string}
 */
export function composeResume(html, resume) {
  const $ = loadDocument(html);
  if (!isPlainObject(resume)) return serializeHtml($);

  fillSummary($, resume.summary);
  if (Array.isArray(resume.roles)) {
    for (const role of resume.roles) fillRole($, role);
  }

  return serializeHtml($);
}
