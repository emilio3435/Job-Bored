/**
 * The last rung of the logo chain (upload, then site logo, then favicon,
 * then monogram): a generated initials mark for a company the resolver could
 * not find, or for any render with no network at all. Pure and offline.
 *
 * The mark is an SVG data: URI. The PDF path rasterizes every SVG logo to a
 * PNG before printing (materials-package.mjs rasterizeLogos), so the
 * initials never reach the PDF text layer beside the company's real name.
 */

const SUFFIXES = new Set(["inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "corp", "corp.", "corporation", "co", "co.", "company", "plc", "gmbh", "sa", "s.a.", "the", "group", "holdings"]);

/**
 * One or two initials: the first letters of the first two significant
 * words ("Hearst Newspapers" → "HN", "NorthwindMedia, Inc." → "I").
 *
 * @param {string} name
 * @returns {string}
 */
export function monogramInitials(name) {
  const words = companyDisplayName(name)
    .replace(/[,()]/g, " ")
    .split(/[\s/&+-]+/)
    .map((w) => w.trim())
    .filter((w) => w && !SUFFIXES.has(w.toLowerCase()) && /\p{L}|\d/u.test(w));
  /* A short single-word name is its own monogram ("3E", "IBM" → "IB"). */
  if (words.length === 1 && /^[\p{Lu}\d]{2,3}$/u.test(words[0])) return words[0].slice(0, 2);
  /* One word: its first two letters ("Contoso" → "AU", "NorthwindMedia" → "IH"). */
  if (words.length === 1) {
    const two = (words[0].match(/[\p{L}\d]/gu) || []).slice(0, 2).join("");
    return two ? two.toLocaleUpperCase("en-US") : "·";
  }
  const letters = words
    .slice(0, 2)
    .map((w) => (w.match(/[\p{L}\d]/u) || [""])[0].toLocaleUpperCase("en-US"))
    .join("");
  return letters || "·";
}

/* A domain as a resume writes it: "meridian.example.org", "www.acme.io", "https://acme.io/". */
const DOMAIN_TOKEN = String.raw`(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}\/?`;
/* "Name — domain", "Name – domain", "Name - domain", "Name | domain", or a
 * bare trailing "Name domain". */
const TRAILING_DOMAIN_RE = new RegExp(String.raw`^(.*?\S)\s*(?:\s[\u2014\u2013|-]{1,2}\s|\s\|\s?|\s)\s*(${DOMAIN_TOKEN})\s*$`, "i");

/** @param {string} raw */
function bareDomain(raw) {
  const bare = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(bare) ? bare : "";
}

/**
 * Split a trailing domain off a company line: "Meridian Insights Group —
 * meridian.example.org" → { name: "Meridian Insights Group", domain: "meridian.example.org" }.
 * A name that is only a domain ("Booking.com") is left alone: the name
 * stays and no hint is taken from it.
 * @param {string} value
 * @returns {{ name: string, domain: string }}
 */
function splitTrailingDomain(value) {
  const m = TRAILING_DOMAIN_RE.exec(value);
  if (m) {
    const domain = bareDomain(m[2]);
    /* The part before must be a name, not the tail of a sentence ending in a dot. */
    if (domain && /[\p{L}\p{N})]$/u.test(m[1].trim())) return { name: m[1].trim(), domain };
  }
  return { name: value, domain: "" };
}

/**
 * A company's own name, as a resume writes it without the asides:
 * parentheticals, a trailing domain and "formerly …" clauses go
 * ("Contoso (formerly Fabrikam)" → "Contoso", "Meridian Insights Group
 * (meridian.example.org)" and "Meridian Insights Group — meridian.example.org" → "Meridian Insights Group", "Contoso, formerly Fabrikam" → "Contoso").
 *
 * @param {unknown} company
 * @returns {string}
 */
export function companyDisplayName(company) {
  const withoutAsides = String(company || "")
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return splitTrailingDomain(withoutAsides)
    .name.replace(/\s*[,;\u2014\u2013-]?\s*\b(formerly|previously|f\/k\/a|fka)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A domain the resume itself names for a company, in a parenthetical
 * ("Meridian Insights Group (meridian.example.org)"), after a dash or bar ("Meridian Insights Group — meridian.example.org", "Acme | acme.io"), or as a trailing
 * bare domain ("Acme acme.io"), or "".
 *
 * @param {unknown} company
 * @returns {string}
 */
export function companyDomainHint(company) {
  const value = String(company || "");
  for (const m of value.matchAll(/\(([^)]*)\)/g)) {
    const bare = bareDomain(m[1]);
    if (bare) return bare;
  }
  const withoutAsides = value.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return splitTrailingDomain(withoutAsides).domain;
}

/**
 * The identity key a company's cached mark is filed and checked under: its
 * name without a legal suffix, slugged ("NorthwindMedia, Inc." → "northwindmedia").
 * Two names with different keys are different companies, full stop.
 *
 * @param {unknown} company
 * @returns {string}
 */
export function companyKey(company) {
  return companyDisplayName(company)
    .replace(/,?\s+(inc|llc|ltd|corp|co|plc|gmbh)\.?$/i, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

/**
 * The mark to print for the addressee: the resolved mark only when it was
 * resolved for this very company, otherwise a monogram of the addressee. A
 * mark with no company, or another company's, is never trusted.
 *
 * @param {string} company the addressee, from the letter's own metadata
 * @param {{ src?: string, company?: string } & Record<string, unknown> | null | undefined} mark
 */
export function addresseeMark(company, mark) {
  if (!company) return null;
  const key = companyKey(company);
  if (mark && typeof mark.src === "string" && mark.src && key && companyKey(mark.company) === key) {
    const { company: _company, ...logo } = mark;
    return /** @type {import("./materials-render.mjs").Logo} */ (logo);
  }
  return monogramLogo(company);
}

/** @param {string} value */
function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @param {string} name the company or school
 * @param {{ ink?: string, paper?: string }} [colors]
 * @returns {{ src: string, alt: string, shape: "mark", source: "monogram" }}
 */
export function monogramLogo(name, colors = {}) {
  const initials = monogramInitials(name);
  const ink = /^#[0-9a-f]{3,8}$/i.test(colors.ink || "") ? colors.ink : "#15112e";
  const paper = /^#[0-9a-f]{3,8}$/i.test(colors.paper || "") ? colors.paper : "#eceaf6";
  const size = initials.length > 1 ? 40 : 50;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    `<rect x="1" y="1" width="94" height="94" rx="14" fill="${paper}" stroke="${ink}" stroke-opacity="0.18" stroke-width="2"/>`,
    `<text x="48" y="49" dominant-baseline="central" text-anchor="middle" font-family="Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" letter-spacing="-1" fill="${ink}">${escapeXml(initials)}</text>`,
    "</svg>",
  ].join("");
  return {
    src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    alt: `${String(name || "").trim() || "Company"} monogram`,
    shape: "mark",
    source: "monogram",
  };
}

/**
 * A copy of the model in which every featured experience entry without a
 * resolved mark carries a monogram, so the logo column never has holes.
 * Earlier, venture and credential lines are left alone: they show a mark
 * only when a real one exists.
 *
 * @param {import("./materials-render.mjs").RenderModel} model
 * @returns {import("./materials-render.mjs").RenderModel}
 */
export function withMonograms(model) {
  /** @type {import("./materials-render.mjs").RenderModel} */
  const out = JSON.parse(JSON.stringify(model));
  for (const section of out.documents.resume?.sections || []) {
    if (section.kind !== "experience") continue;
    for (const entry of section.entries || []) {
      if (!entry.logo && entry.org) entry.logo = monogramLogo(entry.org);
    }
  }
  return out;
}

/**
 * The company a package is addressed to, restated from the letter's own
 * metadata (the "To" rail, then the foot), or "" when the model names none.
 *
 * @param {import("./materials-render.mjs").RenderModel} model
 * @returns {string}
 */
export function targetCompanyOf(model) {
  const letter = model?.documents?.coverLetter;
  const to = (letter?.rail || []).find((r) => String(r.label).toLowerCase() === "to");
  if (to && Array.isArray(to.lines) && to.lines.length > 1) {
    const [first, second] = to.lines;
    /* The first line is the addressee (a manager or "Hiring team"); the
       company follows. */
    return String(second || first || "").trim();
  }
  const left = letter?.foot?.left || "";
  const parts = String(left).split(" · ");
  return parts.length >= 2 ? parts[1].trim() : "";
}
