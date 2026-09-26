/* server/shared/text-normalize.mjs
   Server twin of jb-text.js (spec §4.2) — Canonical Job Text producer.
   Keep the entity map and Markdown/glyph rules in sync with jb-text.js. */

/** @type {Record<string, string>} */
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", bull: "•", middot: "·", sect: "§",
  copy: "©", reg: "®", trade: "™", deg: "°",
  laquo: "«", raquo: "»", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
  frac12: "½", frac14: "¼", plusmn: "±",
  eacute: "é", egrave: "è", agrave: "à",
  auml: "ä", ouml: "ö", uuml: "ü",
  ccedil: "ç", ntilde: "ñ",
};

const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]{2,10}));/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060]/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FRAGMENT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
  "of", "on", "or", "the", "to", "with", "using", "your", "our", "their", "you",
  "we", "will", "have", "has", "had", "this", "that", "these", "those", "years",
  "year", "plus", "strong", "ability", "abilities", "experience", "experienced",
  "knowledge", "understanding", "background", "preferred", "required", "requirement",
  "requirements",
]);
const KNOWN_TOOL_ALIASES = new Set([
  "javascript", "js", "typescript", "ts", "nodejs", "node js", "node.js", "react",
  "reactjs", "react.js", "ci cd", "ci/cd", "continuous integration",
  "continuous delivery", "machine learning", "ml", "artificial intelligence", "ai",
  "kubernetes", "k8s", "postgresql", "postgres", "amazon web services", "aws",
  "google cloud platform", "gcp", "google cloud", "microsoft azure", "azure",
]);

/** @param {unknown} s */
export function decodeHtmlEntities(s) {
  if (s == null) return "";
  return String(s).replace(ENTITY_RE, (m, dec, hex, name) => {
    if (name) {
      const hit = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : NAMED_ENTITIES[name.toLowerCase()];
      return hit != null ? hit : m;
    }
    const n = dec ? Number(dec) : Number.parseInt(hex, 16);
    if (!Number.isFinite(n) || (n < 32 && n !== 9 && n !== 10) || n > 0x10ffff) return m;
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}

/** @param {unknown} s */
export function stripMarkdownInline(s) {
  let t = String(s == null ? "" : s);
  t = t.replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)");
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2");
  t = t.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,;:!?])/g, "$1$2");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  return t;
}

/** @param {unknown} s */
export function stripListGlyph(s) {
  return String(s == null ? "" : s).replace(/^\s*(?:[-*•·‣▪–—]|\d{1,4}[.)])\s+/, "");
}

/** Remove model control tokens and partial token delimiters. @param {unknown} s */
export function stripControlTokens(s) {
  return String(s == null ? "" : s)
    .replace(/(?:\[)?<\|[\s\S]*?\|>/g, "")
    .replace(/\[<\|/g, "")
    .replace(/\|>/g, "")
    .replace(/\[</g, "")
    .replace(/>\]/g, "")
    .trim();
}

/** @param {string} s */
function normalizeFragmentText(s) {
  return s
    .toLowerCase()
    .replace(/\bci\/cd\b/g, "ci cd")
    .replace(/\bnode\.js\b/g, "nodejs")
    .replace(/\breact\.js\b/g, "react")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+#.%/\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} s */
function hasUnbalancedParens(s) {
  let depth = 0;
  for (const char of s) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

/** @param {string} s */
function hasUnbalancedQuotes(s) {
  const straightDouble = (s.match(/"/g) || []).length;
  const curlyOpen = (s.match(/“/g) || []).length;
  const curlyClose = (s.match(/”/g) || []).length;
  return straightDouble % 2 !== 0 || curlyOpen !== curlyClose;
}

/** Detect incomplete prose that cannot stand as a requirement or claim. @param {unknown} s */
export function isFragment(s) {
  const text = stripControlTokens(s);
  if (hasUnbalancedParens(text) || hasUnbalancedQuotes(text)) return true;

  const normalized = normalizeFragmentText(text);
  const significantTokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .filter((token) => !FRAGMENT_STOP_WORDS.has(token));
  const knownTool = KNOWN_TOOL_ALIASES.has(normalized);

  if (/^[a-z]/.test(text) && significantTokens.length < 3) return true;
  if (/(?:[,;]|\b(?:and|or))$/i.test(text)) return true;
  return significantTokens.length < 2 && !knownTool;
}

/** Split a sentence from a trailing short Title Case section heading. @param {unknown} s */
export function splitHeadingTail(s) {
  const text = String(s == null ? "" : s).trim();
  const match = /^([\s\S]*[.!?])\s+([^.!?\n]+)$/.exec(text);
  if (!match) return { body: text, heading: "" };

  const body = match[1].trim();
  const heading = match[2].trim();
  const words = heading.match(/[A-Za-z0-9][A-Za-z0-9+/#'’\-]*/g) || [];
  const titleWords = words.filter((word) => /^[A-Z0-9]/.test(word));
  if (
    !body.replace(/[.!?]/g, "").trim() ||
    words.length === 0 ||
    words.length > 6 ||
    titleWords.length / words.length < 0.6
  ) {
    return { body: text, heading: "" };
  }
  return { body, heading };
}

/** Plain text → Canonical Job Text (spec §3). @param {unknown} s */
export function normalizeJobText(s) {
  let t = String(s == null ? "" : s);
  t = t.replace(/\r\n?/g, "\n").replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
  t = t.replace(/\u00A0/g, " ");
  t = t
    .split("\n")
    .map((l) => stripMarkdownInline(l).replace(/[ \t]+/g, " ").trim().replace(/\s*·$/, ""))
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Single-line field → clean one-liner. @param {unknown} s */
export function normalizeInlineField(s) {
  let t = decodeHtmlEntities(s);
  t = t.replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
  t = t.replace(/[\r\n\t\u00A0]+/g, " ");
  t = stripMarkdownInline(t);
  return t.replace(/ {2,}/g, " ").trim();
}

/** Block-aware HTML → Canonical Job Text. Decode FIRST (Greenhouse
    entity-encodes whole documents), then strip with structure. @param {unknown} html */
export function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  let t = decodeHtmlEntities(html);
  if (!/[<>]/.test(t)) return normalizeJobText(t);
  t = t
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|table|section|article|blockquote)>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " · ")
    .replace(/<[^>]+>/g, " ");
  return normalizeJobText(t);
}
