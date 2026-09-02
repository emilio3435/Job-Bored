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
