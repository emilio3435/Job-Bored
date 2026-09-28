/**
 * Render model + template family → HTML (visual spec §8, plan slice 3).
 *
 * The render model (schemas/materials-render-model.v1.schema.json) is the
 * only input. A family's resume.html and cover-letter.html are logic-less
 * templates over a *view* this module derives from the model: they carry no
 * candidate facts and never receive markup from a model. Every string is
 * escaped; the only raw HTML a template can print is HTML this module built
 * from typed runs (`n` → <span class="n">, `hl` → <span class="hl">).
 *
 * Template syntax (deliberately tiny):
 *   {{path.to.value}}           escaped text (or renderer-built HTML)
 *   {{#if path}} … {{else}} … {{/if}}
 *   {{#unless path}} … {{/unless}}
 *   {{#each path}} … {{/each}}  with {{this}}, {{@index}}, {{@first}}, {{@last}}
 *   {{! comment }}
 *
 * The rendered document is self-contained: the family stylesheet and the
 * family's vendored font faces (vendor/fonts/fonts.css, as data: URIs) are
 * inlined, so the file renders identically on disk, in the dashboard and in
 * the PDF renderer, with no network (rule 5).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { letterWordBand, readFamilyFile, resolveFamily, templateIdsFor } from "./materials-templates.mjs";
import { targetCompanyOf } from "./materials-monogram.mjs";
import { deriveNodes } from "./materials-nodes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolvePath(__dirname, "..", "vendor", "fonts");
const RENDER_MODEL_SCHEMA = resolvePath(__dirname, "..", "schemas", "materials-render-model.v1.schema.json");

/* ------------------------------------------------------------------ *
 * Render model types (a JSDoc mirror of materials.render-model.v1)
 * ------------------------------------------------------------------ */

/** @typedef {{ t?: string, n?: string, hl?: string }} Run */
/** @typedef {{ src: string, alt: string, shape?: "mark" | "wordmark" | "lockup", source?: string }} Logo */
/** @typedef {{ n: string, caption: string, claimId: string, employerId?: string }} Readout */
/** @typedef {{ claimId: string, runs: Run[] }} Bullet */

/**
 * @typedef {object} Entry
 * @property {string} employerId
 * @property {string} [claimId]
 * @property {Logo} [logo]
 * @property {string[]} meta
 * @property {string} org
 * @property {string | Run[]} [seat]
 * @property {string} [line]
 * @property {Bullet[]} [bullets]
 * @property {{ seat: string | Run[], meta: string[], claimIds: string[] }[]} [roles]
 *   P-4: several dated roles at one company; each names its bullets by
 *   claim id (the bullets themselves stay on the entry)
 */

/**
 * @typedef {object} Section
 * @property {string} kind
 * @property {string} label
 * @property {Entry[]} [entries]
 * @property {string[]} [tokens]
 * @property {string[]} [excluded]
 * @property {string} [excludedReason]
 * @property {Readout[]} [readouts]
 * @property {{ label: string, items: string[] }[]} [groups]
 * @property {{ claimId?: string, logo?: Logo, runs: Run[] }[]} [lines]
 */

/**
 * @typedef {object} ResumeDoc
 * @property {string} templateId
 * @property {{ runs: Run[], words?: number }} statement
 * @property {{ runs: Run[], claimIds: string[] }} [intro]
 * @property {Section[]} sections
 * @property {Record<string, string>} [foot]
 */

/**
 * @typedef {object} LetterParagraph
 * @property {string} id
 * @property {string} beat
 * @property {string} [claimId]
 * @property {string[]} [supportClaimIds]
 * @property {string} [transferId]
 * @property {number} [words]
 * @property {string} text
 * @property {Array<{ text: string, href: string }>} [links] project names that render as links
 */

/**
 * @typedef {object} LetterDoc
 * @property {string} templateId
 * @property {string[]} [index]
 * @property {string} [headline]
 * @property {{ text: string, fromParagraph: string }} [pullQuote]
 * @property {Readout[]} [readouts]
 * @property {{ label: string, lines: string[] }[]} [rail]
 * @property {string} [railRule]
 * @property {string} salutation
 * @property {LetterParagraph[]} paragraphs
 * @property {number} [bodyWords]
 * @property {string} [signoff]
 * @property {Record<string, string>} [foot]
 */

/**
 * @typedef {object} RenderModel
 * @property {"materials.render-model.v1"} contract
 * @property {string} [note]
 * @property {{ family: string, version: string, pageBudget: number, accent?: string, density?: string }} template
 * @property {Record<string, string>} [provenance]
 * @property {{ name: string, target: string, targetSource?: string, contact: { kind: string, text: string, href?: string }[] }} identity
 * @property {{ resume?: ResumeDoc, coverLetter?: LetterDoc }} documents
 * @property {{ wrap?: number, bulletMarker?: string, headings?: string }} [atsText]
 */

/** @typedef {"resume" | "coverLetter"} DocKind */

/**
 * @typedef {object} RenderOptions
 * @property {string[]} [fitTokens] tokens for the sheet's data-fit attribute
 * @property {boolean} [fitVerified] the layout was measured and fits, so the
 *   sheet may take its fixed height and clip; otherwise the sheet grows and
 *   nothing can be hidden (rule 4: never clip silently)
 * @property {boolean} [overflow] a measured overflow the ladder could not fix
 * @property {{ company?: string, logo?: Logo | null }} [target] the company
 *   the package is addressed to and its resolved mark. The company defaults
 *   to the one the letter's own "To" rail names; the mark is render-time
 *   input (the brand-logo resolver), never part of the render model.
 * @property {string} [header] a header variant the family lists in
 *   family.json `headers`; unknown ids fall back to `defaultHeader`
 */

/* ------------------------------------------------------------------ *
 * Escaping and runs
 * ------------------------------------------------------------------ */

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Renderer-built HTML. Templates print it as-is; everything else is escaped. */
class SafeHtml {
  /** @param {string} html */
  constructor(html) {
    this.html = html;
  }
}

/** @param {string} html */
function safe(html) {
  return new SafeHtml(html);
}

/**
 * @param {Run} run
 * @returns {string}
 */
function runText(run) {
  return String(run.t ?? run.n ?? run.hl ?? "");
}

/**
 * @param {Run[] | string | undefined} runs
 * @returns {string}
 */
export function runsToText(runs) {
  if (typeof runs === "string") return runs;
  return Array.isArray(runs) ? runs.map(runText).join("") : "";
}

/**
 * @param {Run[] | string | undefined} runs
 * @returns {string}
 */
function runsToHtml(runs) {
  if (typeof runs === "string") return escapeHtml(runs);
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run) => {
      if (typeof run.n === "string") return `<span class="n">${escapeHtml(run.n)}</span>`;
      if (typeof run.hl === "string") return `<span class="hl">${escapeHtml(run.hl)}</span>`;
      return escapeHtml(run.t ?? "");
    })
    .join("");
}

/**
 * Wrap known metric tokens inside plain text (letter paragraphs carry no
 * runs). Only tokens the model already set as `n` runs or readouts are
 * tagged, so a number the ledger never verified is never typeset as data.
 *
 * @param {string} text
 * @param {string[]} tokens longest first
 * @returns {string}
 */
function tagTokensInText(text, tokens) {
  if (!tokens.length) return escapeHtml(text);
  const pattern = new RegExp(
    `(^|[^\\w$#])(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w%])`,
    "g",
  );
  let out = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = /** @type {number} */ (match.index) + match[1].length;
    out += escapeHtml(text.slice(last, start));
    out += `<span class="n">${escapeHtml(match[2])}</span>`;
    last = start + match[2].length;
  }
  return out + escapeHtml(text.slice(last));
}

/* ------------------------------------------------------------------ *
 * Template engine
 * ------------------------------------------------------------------ */

/**
 * @typedef {{ type: "text", value: string }
 *   | { type: "var", path: string }
 *   | { type: "block", kind: "if" | "unless" | "each", path: string, body: TemplateNode[], inverse: TemplateNode[] }} TemplateNode
 */

/** @type {Map<string, TemplateNode[]>} */
const parsedCache = new Map();

/**
 * @param {string} source
 * @returns {TemplateNode[]}
 */
export function parseTemplate(source) {
  const cached = parsedCache.get(source);
  if (cached) return cached;
  /** @type {{ node: TemplateNode | null, body: TemplateNode[], inElse: boolean }[]} */
  const stack = [{ node: null, body: [], inElse: false }];
  const tagRe = /\{\{\s*([#/!]?)\s*([^}]*?)\s*\}\}/g;
  let last = 0;
  /** @param {TemplateNode} node */
  const push = (node) => {
    const top = stack[stack.length - 1];
    if (top.inElse && top.node && top.node.type === "block") top.node.inverse.push(node);
    else top.body.push(node);
  };
  for (const match of source.matchAll(tagRe)) {
    const index = /** @type {number} */ (match.index);
    if (index > last) push({ type: "text", value: source.slice(last, index) });
    last = index + match[0].length;
    const [, sigil, body] = match;
    if (sigil === "!") continue;
    if (sigil === "#") {
      const [kind, path = ""] = body.split(/\s+/, 2);
      if (kind !== "if" && kind !== "unless" && kind !== "each") {
        throw new Error(`unknown template block {{#${kind}}}`);
      }
      /** @type {TemplateNode} */
      const node = { type: "block", kind, path, body: [], inverse: [] };
      push(node);
      stack.push({ node, body: node.body, inElse: false });
      continue;
    }
    if (sigil === "/") {
      const top = stack.pop();
      if (!top || !top.node || top.node.type !== "block" || top.node.kind !== body) {
        throw new Error(`unbalanced template close {{/${body}}}`);
      }
      continue;
    }
    if (body === "else") {
      const top = stack[stack.length - 1];
      if (!top.node) throw new Error("{{else}} outside a block");
      top.inElse = true;
      continue;
    }
    push({ type: "var", path: body });
  }
  if (last < source.length) push({ type: "text", value: source.slice(last) });
  if (stack.length !== 1) throw new Error("unclosed template block");
  parsedCache.set(source, stack[0].body);
  return stack[0].body;
}

/**
 * @param {unknown[]} scopes innermost last
 * @param {string} path
 * @returns {unknown}
 */
function lookup(scopes, path) {
  if (path === "this" || path === ".") return scopes[scopes.length - 1];
  const [head, ...rest] = path.split(".");
  let value;
  let found = false;
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i];
    if (scope && typeof scope === "object" && head in /** @type {object} */ (scope)) {
      value = /** @type {Record<string, unknown>} */ (scope)[head];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  for (const key of rest) {
    if (!value || typeof value !== "object") return undefined;
    value = /** @type {Record<string, unknown>} */ (value)[key];
  }
  return value;
}

/** @param {unknown} value */
function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * @param {TemplateNode[]} nodes
 * @param {unknown[]} scopes
 * @returns {string}
 */
function renderNodes(nodes, scopes) {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
    } else if (node.type === "var") {
      const value = lookup(scopes, node.path);
      if (value instanceof SafeHtml) out += value.html;
      else if (typeof value === "string" || typeof value === "number") out += escapeHtml(value);
    } else if (node.kind === "each") {
      const list = lookup(scopes, node.path);
      if (Array.isArray(list) && list.length) {
        list.forEach((item, index) => {
          const frame = { "@index": index, "@first": index === 0, "@last": index === list.length - 1 };
          out += renderNodes(node.body, [...scopes, frame, item]);
        });
      } else {
        out += renderNodes(node.inverse, scopes);
      }
    } else {
      const test = truthy(lookup(scopes, node.path));
      const pass = node.kind === "if" ? test : !test;
      out += renderNodes(pass ? node.body : node.inverse, scopes);
    }
  }
  return out;
}

/**
 * @param {string} source
 * @param {unknown} view
 */
export function renderTemplate(source, view) {
  return renderNodes(parseTemplate(source), [view]);
}

/* ------------------------------------------------------------------ *
 * Fonts: inline the family's vendored faces
 * ------------------------------------------------------------------ */

/** @type {Map<string, string>} */
const fontsCssByFile = new Map();
/** @type {Map<string, string>} */
const fontFaceCache = new Map();

/**
 * The static instances the materials documents inline (generated by
 * scripts/build-materials-fonts.py). The app's fonts.css ships variable
 * faces, and Chromium prints a variable font as a Type3 font whose glyph
 * advances drift from the text positioning, so extractors split words
 * ("Directo r", "S ales"). Static instances embed as CID fonts with a
 * ToUnicode map and extract whole.
 */
const MATERIALS_FONTS_CSS = "materials/materials-fonts.css";

/**
 * @typedef {object} FontFace
 * @property {string} family
 * @property {string} style
 * @property {string} weight
 * @property {string} [stretch]
 * @property {string} src relative path under vendor/fonts
 * @property {string} range unicode-range
 * @property {string} subset
 */

/**
 * @param {string} file a stylesheet under vendor/fonts
 * @returns {FontFace[]}
 */
function parseFontFaces(file) {
  let css = fontsCssByFile.get(file);
  if (css === undefined) {
    css = readFileSync(join(FONTS_DIR, file), "utf8");
    fontsCssByFile.set(file, css);
  }
  /** @type {FontFace[]} */
  const faces = [];
  for (const match of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = match;
    /** @param {string} prop */
    const read = (prop) => (new RegExp(`${prop}:\\s*([^;]+);`).exec(body) || [])[1]?.trim() || "";
    const src = (/url\(([^)]+)\)/.exec(body) || [])[1] || "";
    faces.push({
      family: read("font-family").replace(/^['"]|['"]$/g, ""),
      style: read("font-style") || "normal",
      weight: read("font-weight") || "400",
      stretch: read("font-stretch") || undefined,
      src,
      range: read("unicode-range"),
      subset,
    });
  }
  return faces;
}

/** The app's vendored faces (vendor/fonts/fonts.css; variable fonts). */
export function vendoredFontFaces() {
  return parseFontFaces("fonts.css");
}

/** Variable source faces only the materials templates use (vendor/fonts/materials/sources.css). */
export function materialsSourceFaces() {
  return parseFontFaces("materials/sources.css");
}

/** The static faces the materials renderer inlines (vendor/fonts/materials/). */
export function materialsFontFaces() {
  return parseFontFaces(MATERIALS_FONTS_CSS);
}

/**
 * The @font-face rules for a family's `fonts` list, as data: URIs, from the
 * static materials set. A name with an " Italic" suffix adds that face's
 * italics; latin and latin-ext only.
 *
 * @param {string[]} fontNames
 * @returns {string}
 */
export function inlineFontCss(fontNames) {
  const key = fontNames.join("|");
  const cached = fontFaceCache.get(key);
  if (cached) return cached;
  const wanted = new Set(fontNames);
  const faces = materialsFontFaces().filter(
    (face) =>
      (face.subset === "latin" || face.subset === "latin-ext" || face.subset === "all") &&
      wanted.has(face.style === "italic" ? `${face.family} Italic` : face.family),
  );
  const rules = faces.map((face) => {
    const data = readFileSync(join(FONTS_DIR, face.src)).toString("base64");
    /* woff2 instances, or a full static font copied as-is (build-materials-fonts.py). */
    const [mime, format] = face.src.endsWith(".ttf") ? ["font/ttf", "truetype"] : ["font/woff2", "woff2"];
    return [
      "@font-face {",
      `  font-family: '${face.family}';`,
      `  font-style: ${face.style};`,
      `  font-weight: ${face.weight};`,
      face.stretch ? `  font-stretch: ${face.stretch};` : "",
      "  font-display: block;",
      `  src: url(data:${mime};base64,${data}) format('${format}');`,
      `  unicode-range: ${face.range};`,
      "}",
    ].filter(Boolean).join("\n");
  });
  const css = rules.join("\n");
  fontFaceCache.set(key, css);
  return css;
}

/* ------------------------------------------------------------------ *
 * View building
 * ------------------------------------------------------------------ */

/**
 * The shared print contract every family inherits. A sheet takes its fixed
 * 8.5 × 11in box and clips only once the renderer measured that it fits;
 * until then it grows, so an unmeasured or overflowing render can never hide
 * text (rule 4).
 */
const BASE_CSS = `
@page { size: letter; margin: 0; }
/* ATS text layer: on Linux, Chrome's default text rendering hints glyphs to
   whole pixels, so each glyph lands off its font advance and Skia writes a
   positioning jump into the PDF text run; pdf.js then reads the jumps as word
   breaks ("Manag er", "Int ellig ence"). geometricPrecision lays glyphs out at
   their unhinted font advances on every platform. It does not help with
   variable fonts, which Chrome prints as Type3 fonts that split words in
   pypdf and pdftotext ("Directo r"): the faces inlined above are static
   instances for that reason (inlineFontCss). */
article.page, article.page * { text-rendering: geometricPrecision; }
article.page:not([data-fit-verified]) { height: auto !important; min-height: 11in; overflow: visible !important; }
article.page[data-fit-verified] { height: 11in; overflow: hidden; }
/* A wordmark already spells the employer's name, so the h2.company-name
   beside it is hidden visually but kept in the text layer for ATS. It stays
   in flow, in its own 1px-type box beside the logo, so its glyphs never share
   page coordinates with anything else (an absolutely positioned copy stacked
   on the logo interleaved letter by letter in extraction), and it is painted
   in DOM order. Clipping it (1px box + overflow hidden) drops it from the PDF. */
.visually-dup { position: relative !important; flex: none; margin: 0 !important; padding: 0 !important; font-size: 1px !important; line-height: 1 !important; letter-spacing: 0 !important; white-space: pre; color: transparent !important; pointer-events: none; user-select: none; }
`;

/** @type {Map<string, { ascent: number, descent: number, advances: Record<string, number>, tittles: Record<string, { cx: number, cy: number }> } | null>} */
const displayMetricsCache = new Map();

/** @param {string} id e.g. "marcellus-400-normal" (vendor/fonts/materials/<id>.metrics.json) */
function displayMetrics(id) {
  if (!displayMetricsCache.has(id)) {
    let metrics = null;
    if (/^[a-z0-9-]+$/.test(id)) {
      try {
        metrics = JSON.parse(readFileSync(join(FONTS_DIR, "materials", `${id}.metrics.json`), "utf8"));
      } catch {
        metrics = null;
      }
    }
    displayMetricsCache.set(id, metrics);
  }
  return displayMetricsCache.get(id) || null;
}

/**
 * Where to draw the colored tittle dots over a name (the wordmark motif),
 * in em of the name's font size from the top-left of its first line, or
 * null for no dots.
 *
 * The name itself stays one plain text run (HTML text extractors and the
 * PDF text layer both read it exactly); the dots are empty positioned
 * boxes laid over the glyphs' own tittles. Their positions come from the
 * display face's advance widths (build-materials-fonts.py writes them), so
 * the name must set with kerning and ligatures off, and on one line, which
 * fitName guarantees. A name with any character the face lacks gets no
 * tittles (the template's closing dot still prints); a name with no
 * lowercase i or j gets none either. Colors cycle through four slots.
 * Positions are in em, so they hold at whatever size fitName picks.
 *
 * @param {string} name
 * @param {import("./materials-templates.mjs").TemplateFamily["nameDots"]} spec family.json `nameDots`
 * @returns {{ x: string, y: string, n: number }[] | null}
 */
export function nameDots(name, spec) {
  if (!spec) return null;
  const m = displayMetrics(spec.metrics);
  if (!m) return null;
  const chars = [...String(name || "")];
  let x = 0;
  /** @type {{ x: string, y: string, n: number }[]} */
  const dots = [];
  const halfLeading = (spec.lineHeight - (m.ascent + m.descent)) / 2;
  const baseline = halfLeading + m.ascent;
  for (const ch of chars) {
    const advance = m.advances[ch];
    if (typeof advance !== "number") return null;
    const tittle = m.tittles[ch];
    if (tittle) {
      dots.push({ x: (x + tittle.cx).toFixed(4), y: (baseline - tittle.cy).toFixed(4), n: (dots.length % 4) + 1 });
    }
    x += advance + spec.letterSpacingEm;
  }
  return dots.length ? dots : null;
}

/**
 * @typedef {object} NameFitSpec family.json `nameFit.resume` / `nameFit.coverLetter`
 * @property {string} metrics the display face's metrics file id
 * @property {number} maxPt the design size
 * @property {number} minPt the smallest size the name shares its row at
 * @property {number} boxPt the name's row width, in pt, before `reserve`
 * @property {number} fullRowPt the width when the name takes a row of its own
 * @property {number} letterSpacingEm
 * @property {"one" | "firstLast"} [lines] "firstLast": first and last names on
 *   two lines by design; each must fit on its own line
 * @property {{ from: "contact" | "target", fontPt: number, advanceEm: number, extraPt: number }} [reserve]
 *   what shares the name's row, estimated from its text at its size
 */

/** Advance, in em, assumed for a character the metrics file does not know. */
const UNKNOWN_ADVANCE_EM = 0.6;
/** Never smaller than this, even on its own row. */
const NAME_FLOOR_PT = 10;

/**
 * The font size that keeps a name on one line, never wrapping at a hyphen
 * or anywhere else: the design size when it fits, else the largest size
 * that fits beside what shares its row (the contact column, the target
 * line), down to `minPt`; below that the name takes a full-width row of its
 * own, at the largest size that fits there. Widths come from the display
 * face's metrics, so no layout engine is needed; the template must set the
 * name with `white-space: nowrap`, kerning and ligatures off.
 *
 * @param {{ name: string, nameFirst: string, nameLast: string, target: string, contact: string[] }} identity
 * @param {NameFitSpec | undefined} spec
 * @returns {{ pt: string, full: boolean } | null}
 */
export function fitName(identity, spec) {
  if (!spec) return null;
  const m = displayMetrics(spec.metrics);
  if (!m) return { pt: String(spec.maxPt), full: false };
  /** @param {string} text */
  const widthEm = (text) => [...text].reduce((sum, ch) => sum + (m.advances[ch] ?? UNKNOWN_ADVANCE_EM) + spec.letterSpacingEm, 0);
  const lines = spec.lines === "firstLast" && identity.nameLast ? [identity.nameFirst, identity.nameLast] : [identity.name];
  const width = Math.max(...lines.map(widthEm), 0.01);
  let reservePt = 0;
  if (spec.reserve) {
    const texts = spec.reserve.from === "contact" ? identity.contact : [identity.target];
    const chars = Math.max(0, ...texts.map((t) => [...String(t || "")].length));
    reservePt = chars * spec.reserve.advanceEm * spec.reserve.fontPt + spec.reserve.extraPt;
  }
  const inRow = Math.min(spec.maxPt, (spec.boxPt - reservePt) / width);
  const floor = (/** @type {number} */ pt) => (Math.floor(pt * 10) / 10).toFixed(1);
  if (inRow >= spec.minPt) return { pt: floor(inRow), full: false };
  return { pt: floor(Math.max(NAME_FLOOR_PT, Math.min(spec.maxPt, spec.fullRowPt / width))), full: true };
}

/** @param {string} value */
function isDateLike(value) {
  return /\d{4}|present|now|current/i.test(value);
}

/* Contact icons: 24-unit line glyphs drawn with currentColor. Inline SVG
   paths print as vectors with no text, so the PDF text layer still reads
   only the contact text itself. */
const CONTACT_ICONS = {
  email: '<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M6.5 3h3l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 4.5 5a2 2 0 0 1 2-2z"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10.5V17M8 7.2v.1M12 17v-6.5M12 13.2c0-1.8 1.2-2.9 2.6-2.9s2.4 1 2.4 2.9V17"/>',
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.3 5.8 2.6 5.8 2.6a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  location: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
};

/**
 * A clickable URI for a contact, derived from its text when the model gave
 * none: mailto: for email, tel: for phone, https: for a profile or site.
 * Location gets none. Only mailto:, tel: and http(s): ever leave here.
 *
 * @param {{ kind: string, text: string, href?: string }} c
 * @returns {string}
 */
export function contactLink(c) {
  if (typeof c.href === "string" && /^(https?:|mailto:|tel:)/i.test(c.href)) return c.href;
  const text = String(c.text || "").trim();
  if (!text) return "";
  if (c.kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : "";
  if (c.kind === "phone") {
    const digits = text.replace(/[^\d+]/g, "");
    return digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : "";
  }
  if (c.kind === "location") return "";
  const bare = text.replace(/^https?:\/\//i, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(bare) ? `https://${bare}` : "";
}

/**
 * @param {{ kind: string, text: string, href?: string }[]} contact
 */
function contactView(contact) {
  const items = contact.map((c) => {
    const icon = CONTACT_ICONS[/** @type {keyof typeof CONTACT_ICONS} */ (c.kind)] || CONTACT_ICONS.site;
    return {
      kind: c.kind,
      text: c.text,
      href: typeof c.href === "string" && /^(https?:|mailto:|tel:)/i.test(c.href) ? c.href : "",
      link: contactLink(c),
      icon: safe(`<svg class="ct-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`),
      isSite: c.kind === "site",
      isMono: c.kind === "phone",
    };
  });
  /** @param {string} kind */
  const first = (kind) => items.find((c) => c.kind === kind) || null;
  const signature = items.filter((c) => c.kind === "phone" || c.kind === "email" || c.kind === "site");
  return {
    items,
    location: first("location"),
    phone: first("phone"),
    email: first("email"),
    site: first("site"),
    linkedin: first("linkedin"),
    links: items.filter((c) => c.kind !== "location" && c.kind !== "phone"),
    signature,
    signatureText: signature.map((c) => c.text).join(" · "),
    lineText: items.map((c) => c.text).join(" · "),
  };
}

/**
 * @param {Logo | undefined} logo
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 */
function logoView(logo, family) {
  if (!logo || typeof logo.src !== "string" || !logo.src) return null;
  const shape = logo.shape || "mark";
  const heightIn = family.logos.opticalSizesIn[shape] || family.logos.opticalSizesIn.mark;
  return {
    src: logo.src,
    alt: logo.alt,
    shape,
    isWordmark: shape === "wordmark",
    isMonogram: logo.source === "monogram",
    style: `height:${heightIn}in;width:auto`,
  };
}

/**
 * Pair the ids from the canonical address book with their source objects.
 * Its per-kind order follows the model, so equal text in two blocks stays
 * distinct without reconstructing any id from employer or claim fields.
 * @param {RenderModel} model
 */
function renderNodeIds(model) {
  /** @type {Map<string, string[]>} */
  const byKind = new Map();
  for (const { kind, id } of deriveNodes(model)) {
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)?.push(id);
  }
  /** @param {string} kind */
  const take = (kind) => {
    const id = byKind.get(kind)?.shift();
    if (!id) throw new Error(`missing ${kind} render node`);
    return id;
  };
  /** @type {Map<object, string>} */
  const seats = new Map();
  /** @type {Map<object, string>} */
  const bullets = new Map();
  /** @type {Map<object, string>} */
  const lines = new Map();
  /** @type {Map<object, string>} */
  const credentials = new Map();
  /** @type {Map<object, string>} */
  const groups = new Map();
  /** @type {Map<object, string>} */
  const paragraphs = new Map();
  const resume = model.documents.resume;
  const statement = resume ? take("statement") : "";
  const intro = resume?.intro ? take("intro") : "";
  for (const section of resume?.sections || []) {
    for (const entry of section.entries || []) {
      if (entry.seat !== undefined) seats.set(entry, take("seat"));
      for (const bullet of entry.bullets || []) bullets.set(bullet, take("bullet"));
      if (entry.line !== undefined) lines.set(entry, take("line"));
    }
    for (const line of section.lines || []) credentials.set(line, take("credential"));
    for (const group of section.groups || []) groups.set(group, take("toolkit"));
  }
  const letter = model.documents.coverLetter;
  const salutation = letter ? take("salutation") : "";
  for (const paragraph of letter?.paragraphs || []) paragraphs.set(paragraph, take("paragraph"));
  if ([...byKind.values()].some((ids) => ids.length)) throw new Error("unmapped render node");
  return { statement, intro, seats, bullets, lines, credentials, groups, salutation, paragraphs };
}

/**
 * @param {Entry} entry
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {ReturnType<typeof renderNodeIds>} nodeIds
 * @param {{ side?: boolean }} [options]
 */
function entryView(entry, family, nodeIds, options = {}) {
  const logo = logoView(entry.logo, family);
  const meta = Array.isArray(entry.meta) ? entry.meta.filter((m) => typeof m === "string" && m.trim()) : [];
  const dates = meta.filter(isDateLike).join(" ");
  const place = meta.filter((m) => !isDateLike(m)).join(", ");
  const bullets = (entry.bullets || []).map((bullet) => {
    const runs = Array.isArray(bullet.runs) ? bullet.runs : [];
    const lead = runs.length > 1 && typeof runs[0].n === "string" ? runs[0].n : "";
    return {
      claimId: bullet.claimId,
      nodeId: nodeIds.bullets.get(bullet) || "",
      html: safe(runsToHtml(runs)),
      text: runsToText(runs),
      lead,
      hasLead: Boolean(lead),
      restHtml: safe(runsToHtml(lead ? runs.slice(1) : runs)),
    };
  });
  const roleViews = (Array.isArray(entry.roles) ? entry.roles : []).map((role) => {
    const ids = new Set(Array.isArray(role.claimIds) ? role.claimIds : []);
    const roleBullets = bullets.filter((b) => ids.has(b.claimId));
    const roleMeta = Array.isArray(role.meta) ? role.meta.filter((m) => typeof m === "string" && m.trim()) : [];
    return {
      seatHtml: safe(runsToHtml(role.seat)),
      seatText: runsToText(role.seat),
      dates: roleMeta.join(" "),
      bullets: roleBullets,
      hasBullets: roleBullets.length > 0,
    };
  });
  return {
    employerId: entry.employerId,
    claimId: entry.claimId || "",
    seatNodeId: nodeIds.seats.get(entry) || "",
    lineNodeId: nodeIds.lines.get(entry) || "",
    org: entry.org,
    orgIsDuplicate: Boolean(logo && logo.isWordmark && family.logos.hideNameBesideWordmark),
    logo,
    seatHtml: safe(runsToHtml(entry.seat)),
    seatText: runsToText(entry.seat),
    hasSeat: Boolean(runsToText(entry.seat)),
    meta,
    metaText: meta.join(" "),
    dates,
    place,
    line: entry.line || "",
    bullets,
    hasBullets: bullets.length > 0,
    roles: roleViews,
    hasRoles: roleViews.length > 0,
    side: Boolean(options.side),
  };
}

/* A word that may start the next clause or phrase: stopping a caption just
   before one ends it cleanly. */
const CLAUSE_START = /^(and|or|but|while|with|without|to|for|of|in|on|at|by|from|into|across|through|via|over|under|per|as|than|when|where|which|that|who|so|after|before|during)$/i;
/* Words a caption must never end on. */
const DANGLING = /\s+(a|an|the|and|or|but|to|for|of|in|on|at|by|from|into|across|through|via|with|without|as|than|per|while|who|which|that|its|their|his|her|our|my|your)$/i;

/** @param {string} value */
function wordsOf(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whether a summary only restates the headline (the same words, ignoring
 * case and punctuation such as the "•" between roles), or is empty.
 *
 * @param {string} statement
 * @param {string} headline
 */
export function repeatsHeadline(statement, headline) {
  const s = wordsOf(statement);
  if (!s) return true;
  const h = wordsOf(headline);
  return Boolean(h) && (s === h || h.includes(s));
}

/**
 * A readout caption that ends at a clean word or clause boundary, or "" to
 * drop the readout. Captions are fragments of a bullet; when the bullet goes
 * on mid-phrase after the fragment ("AE desks through a digital-first" +
 * " motion: …"), the caption is cut back to before its last clause or
 * phrase ("AE desks"). Trailing function words are trimmed either way.
 *
 * @param {string} caption
 * @param {string} source the bullet or line the figure comes from, "" if unknown
 * @returns {string}
 */
export function cleanCaption(caption, source) {
  let text = String(caption || "").replace(/\s+/g, " ").trim().replace(/[\s,;:\u2014\u2013-]+$/, "");
  if (!text) return "";
  const src = String(source || "").replace(/\s+/g, " ");
  const at = src.toLowerCase().indexOf(text.toLowerCase());
  if (at >= 0) {
    const after = src.slice(at + text.length);
    const next = (after.trim().split(/\s+/)[0] || "").replace(/[^\p{L}]/gu, "");
    const complete = !after.trim() || /^\s*[.,;:!?)\u2014\u2013]/.test(after) || /^\s+[-\u2013\u2014]\s/.test(after) || CLAUSE_START.test(next);
    if (!complete) {
      const words = text.split(" ");
      let cut = 0;
      for (let i = words.length - 1; i >= 1; i -= 1) {
        if (CLAUSE_START.test(words[i]) || /^(a|an|the)$/i.test(words[i])) {
          cut = i;
          break;
        }
      }
      text = words.slice(0, cut).join(" ");
    }
  }
  while (DANGLING.test(text)) text = text.replace(DANGLING, "");
  /* Nothing left but function words: drop the readout. */
  return text && !/^(a|an|the|and|or|of|to|in|for)$/i.test(text) ? text : "";
}

/**
 * Bullet and line text by claim id, the sources readout captions are cut from.
 * @param {RenderModel} model
 * @returns {Map<string, string>}
 */
function claimTexts(model) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const section of model.documents.resume?.sections || []) {
    for (const entry of section.entries || []) {
      if (entry.claimId && entry.line) out.set(entry.claimId, entry.line);
      for (const bullet of entry.bullets || []) out.set(bullet.claimId, runsToText(bullet.runs));
    }
  }
  return out;
}

/**
 * Group readouts by employer and attach that employer's name, seat and logo
 * from the resume's entries, so a readout strip can label its channels. Each
 * caption is cleaned against its source (cleanCaption); a readout whose
 * caption cannot end cleanly is left off (its figure stays in its bullet).
 *
 * @param {Readout[]} rawReadouts
 * @param {Map<string, ReturnType<typeof entryView>>} entriesById
 * @param {Map<string, string>} [sources] claim id -> bullet text
 */
function readoutGroups(rawReadouts, entriesById, sources = new Map()) {
  const readouts = rawReadouts
    .map((r) => ({ ...r, caption: cleanCaption(r.caption, sources.get(r.claimId) || "") }))
    .filter((r) => r.caption);
  /** @type {{ employerId: string, org: string, seatText: string, dates: string, logo: ReturnType<typeof logoView>, items: { n: string, caption: string, claimId: string, col: number, first: boolean, split: boolean }[], span: number, start: number, last: boolean }[]} */
  const groups = [];
  let col = 1;
  for (const readout of readouts) {
    const employerId = readout.employerId || "";
    let group = groups.find((g) => g.employerId === employerId);
    if (!group) {
      const entry = entriesById.get(employerId);
      group = {
        employerId,
        org: entry ? entry.org : "",
        seatText: entry ? entry.seatText : "",
        dates: entry ? entry.dates : "",
        logo: entry ? entry.logo : null,
        items: [],
        span: 0,
        start: 0,
        last: false,
      };
      groups.push(group);
    }
    group.items.push({ n: readout.n, caption: readout.caption, claimId: readout.claimId, col: 0, first: false, split: false });
  }
  groups.forEach((group, gi) => {
    group.start = col;
    group.span = group.items.length;
    group.last = gi === groups.length - 1;
    group.items.forEach((item, ii) => {
      item.col = col;
      item.first = ii === 0;
      item.split = ii === 0 && gi > 0;
      col += 1;
    });
  });
  const items = groups.flatMap((g) => g.items);
  return { groups, items, columns: items.length };
}

/** A ticker line holds this many figures; the rest stay in their bullets. */
const TICKER_MAX = 4;
/** Figure + caption characters one ticker line holds at the family's size. */
const TICKER_LINE_CHARS = 116;

/**
 * One lean row of verified figures for a header ticker: the first
 * TICKER_MAX readouts, in order, with no employer grouping (the experience
 * timeline already carries employers and dates). Every figure also appears
 * in its bullet or paragraph, so a figure left off the ticker hides nothing.
 *
 * @param {ReturnType<typeof readoutGroups> | null} readouts
 * @returns {{ n: string, caption: string, claimId: string, first: boolean }[] | null}
 */
function tickerItems(readouts) {
  if (!readouts || !readouts.items.length) return null;
  /** @type {{ n: string, caption: string, claimId: string, first: boolean }[]} */
  const out = [];
  let chars = 0;
  for (const item of readouts.items.slice(0, TICKER_MAX)) {
    /* The caption's first clause ("of live pipeline, for a seller pitch" →
       "of live pipeline"), and only as many figures as fit one line. */
    const caption = item.caption.split(/[,;:]\s/)[0].trim();
    chars += item.n.length + caption.length + 1;
    if (out.length && chars > TICKER_LINE_CHARS) break;
    out.push({ n: item.n, caption, claimId: item.claimId, first: out.length === 0 });
  }
  return out;
}

/**
 * @param {RenderModel} model
 * @returns {string[]} metric tokens, longest first
 */
function metricTokens(model) {
  const tokens = new Set();
  const resume = model.documents.resume;
  for (const section of resume?.sections || []) {
    for (const entry of section.entries || []) {
      for (const run of Array.isArray(entry.seat) ? entry.seat : []) if (run.n) tokens.add(run.n);
      for (const bullet of entry.bullets || []) for (const run of bullet.runs || []) if (run.n) tokens.add(run.n);
    }
    for (const readout of section.readouts || []) tokens.add(readout.n);
  }
  for (const run of resume?.statement?.runs || []) if (run.n) tokens.add(run.n);
  for (const readout of model.documents.coverLetter?.readouts || []) tokens.add(readout.n);
  return [...tokens].filter((t) => typeof t === "string" && t.trim()).sort((a, b) => b.length - a.length);
}

/**
 * @param {RenderModel} model
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {ReturnType<typeof renderNodeIds>} nodeIds
 */
function resumeView(model, family, nodeIds) {
  const resume = /** @type {ResumeDoc} */ (model.documents.resume);
  const sections = Array.isArray(resume.sections) ? resume.sections : [];
  /** @param {string} kind */
  const firstOf = (kind) => sections.find((s) => s.kind === kind) || null;

  const experience = firstOf("experience");
  const experienceEntries = (experience?.entries || []).map((e) => entryView(e, family, nodeIds));
  const earlierSection = firstOf("earlier");
  const earlierEntries = (earlierSection?.entries || []).map((e) => entryView(e, family, nodeIds));
  const venturesSection = firstOf("ventures");
  const ventureEntries = (venturesSection?.entries || []).map((e) => entryView(e, family, nodeIds, { side: true }));

  /** @type {Map<string, ReturnType<typeof entryView>>} */
  const entriesById = new Map();
  for (const e of [...experienceEntries, ...earlierEntries, ...ventureEntries]) {
    if (!entriesById.has(e.employerId)) entriesById.set(e.employerId, e);
  }

  const readoutsSection = firstOf("readouts");
  const readouts = readoutsSection && readoutsSection.readouts?.length
    ? { label: readoutsSection.label, ...readoutGroups(readoutsSection.readouts, entriesById, claimTexts(model)) }
    : null;

  const toolkitSection = firstOf("toolkit");
  const toolkit = toolkitSection && toolkitSection.groups?.length
    ? {
      label: toolkitSection.label,
      groups: toolkitSection.groups.map((g) => ({ label: g.label, items: g.items, itemsText: g.items.join(", "), nodeId: nodeIds.groups.get(g) || "" })),
    }
    : null;

  const tokenSections = sections.filter((s) => s.kind === "tokens" && s.tokens?.length);
  const educationTokenSections = tokenSections.filter((s) => /educat|school|degree/i.test(s.label));
  const skillTokenSections = tokenSections.filter((s) => !educationTokenSections.includes(s));
  const skills = skillTokenSections.map((s) => ({ label: s.label, items: s.tokens || [], itemsText: (s.tokens || []).join(", ") }));

  const credentialsSection = firstOf("credentials");
  /** @type {{ html: SafeHtml, text: string, claimId: string, nodeId: string, logo: ReturnType<typeof logoView> }[]} */
  const educationLines = [];
  for (const line of credentialsSection?.lines || []) {
    educationLines.push({
      html: safe(runsToHtml(line.runs)),
      text: runsToText(line.runs),
      claimId: line.claimId || "",
      nodeId: nodeIds.credentials.get(line) || "",
      logo: logoView(line.logo, family),
    });
  }
  for (const s of educationTokenSections) {
    for (const token of s.tokens || []) {
      educationLines.push({ html: safe(escapeHtml(token)), text: token, claimId: "", nodeId: "", logo: null });
    }
  }
  const education = educationLines.length
    ? {
      label: credentialsSection?.label || educationTokenSections[0]?.label || "Education",
      lines: educationLines,
      logo: educationLines.find((l) => l.logo)?.logo || null,
    }
    : null;

  const statementText = runsToText(resume.statement?.runs);
  return {
    statement: {
      nodeId: nodeIds.statement,
      html: safe(runsToHtml(resume.statement?.runs)),
      text: statementText,
      /* A degraded draft falls back to the headline for its summary; the
         header already says it, so the sheet prints no summary at all. */
      show: !repeatsHeadline(statementText, model.identity.target),
    },
    intro: resume.intro && Array.isArray(resume.intro.runs)
      ? { html: safe(runsToHtml(resume.intro.runs)), claimIds: resume.intro.claimIds.join(" "), nodeId: nodeIds.intro }
      : null,
    experience: experienceEntries.length ? { label: experience?.label || "Experience", entries: experienceEntries } : null,
    earlier: earlierEntries.length
      ? {
        label: earlierSection?.label || "Earlier",
        /* An entry whose org merely repeats the section label (a thin model
           with no employer name) prints its line alone, not "Earlier Earlier". */
        entries: earlierEntries.map((e) => {
          const showOrg = e.org.trim().toLowerCase() !== String(earlierSection?.label || "Earlier").trim().toLowerCase();
          return { ...e, showOrg, hasHead: showOrg || e.hasSeat || Boolean(e.dates) };
        }),
      }
      : null,
    ventures: ventureEntries.length ? { label: venturesSection?.label || "Ventures", entries: ventureEntries } : null,
    readouts,
    ticker: tickerItems(readouts),
    toolkit,
    skills: skills.length ? skills : null,
    hasSkills: Boolean(toolkit || skills.length),
    skillsLabel: toolkit ? toolkit.label : skills[0]?.label || "Skills",
    showSkillLabels: Boolean(toolkit) || skills.length > 1,
    education,
    foot: resume.foot && typeof resume.foot === "object" ? { left: resume.foot.left || "", right: resume.foot.right || "" } : null,
  };
}

/**
 * Wrap the first plain-text occurrence of each project name in a link
 * (the user's hyperlink convention). The html is already escaped; only
 * http(s) targets are allowed.
 * @param {string} html
 * @param {Array<{ text: string, href: string }>} links
 */
export function linkify(html, links) {
  let out = html;
  for (const link of links) {
    if (!link || !/^https?:\/\//i.test(link.href) || !link.text) continue;
    const needle = escapeHtml(link.text);
    const at = out.indexOf(needle);
    if (at < 0) continue;
    out = `${out.slice(0, at)}<a class="proj" href="${escapeHtml(link.href)}">${needle}</a>${out.slice(at + needle.length)}`;
  }
  return out;
}

/**
 * @param {RenderModel} model
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {Map<string, ReturnType<typeof entryView>>} entriesById
 * @param {ReturnType<typeof renderNodeIds>} nodeIds
 */
function letterView(model, family, entriesById, nodeIds) {
  const letter = /** @type {LetterDoc} */ (model.documents.coverLetter);
  const tokens = metricTokens(model);
  const paragraphs = (letter.paragraphs || []).map((p, index) => {
    const firstToken = tokens
      .map((t) => ({ t, at: p.text.indexOf(t) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    const isProof = p.beat === "analytics-proof" || p.beat === "ai-ops-proof";
    return {
      id: p.id,
      nodeId: nodeIds.paragraphs.get(p) || "",
      beat: p.beat,
      claimId: p.claimId || "",
      html: safe(linkify(tagTokensInText(p.text, tokens), p.links || [])),
      text: p.text,
      k: isProof && firstToken ? firstToken.t : "",
      first: index === 0,
    };
  });
  const rail = (letter.rail || []).map((r) => ({
    label: r.label,
    lines: r.lines,
    linesText: r.lines.join(", "),
  }));
  /** @param {string} label */
  const railGroup = (label) => rail.find((r) => r.label.toLowerCase() === label.toLowerCase()) || null;
  const grouped = letter.readouts && letter.readouts.length ? readoutGroups(letter.readouts, entriesById, claimTexts(model)) : null;
  const readouts = grouped && grouped.items.length ? grouped : null;
  const pullQuote = letter.pullQuote && letter.pullQuote.text
    ? { html: safe(tagTokensInText(letter.pullQuote.text, tokens)), text: letter.pullQuote.text, fromParagraph: letter.pullQuote.fromParagraph }
    : null;
  return {
    salutation: letter.salutation,
    salutationNodeId: nodeIds.salutation,
    lede: paragraphs[0] || null,
    body: paragraphs.slice(1),
    paragraphs,
    rail,
    to: railGroup("to"),
    re: railGroup("re"),
    date: railGroup("date"),
    headline: letter.headline || "",
    pullQuote,
    readouts,
    ticker: tickerItems(readouts),
    signoff: letter.signoff || "Best,",
    foot: letter.foot && typeof letter.foot === "object" ? { left: letter.foot.left || "", right: letter.foot.right || "" } : null,
  };
}

/**
 * The template view for one document.
 *
 * @param {RenderModel} model
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {DocKind} doc
 * @param {RenderOptions} [options]
 */
export function buildView(model, family, doc, options = {}) {
  const identity = model.identity;
  const nameParts = identity.name.trim().split(/\s+/);
  const nameLast = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const nameFirst = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : identity.name.trim();
  const accent = model.template.accent && family.accents.includes(model.template.accent)
    ? model.template.accent
    : "volt";
  const nodeIds = renderNodeIds(model);
  const resume = model.documents.resume ? resumeView(model, family, nodeIds) : null;
  /** @type {Map<string, ReturnType<typeof entryView>>} */
  const entriesById = new Map();
  for (const group of [resume?.experience, resume?.earlier, resume?.ventures]) {
    for (const entry of group?.entries || []) if (!entriesById.has(entry.employerId)) entriesById.set(entry.employerId, entry);
  }
  const letter = doc === "coverLetter" && model.documents.coverLetter ? letterView(model, family, entriesById, nodeIds) : null;
  const fitTokens = (options.fitTokens || []).filter((t) => /^[a-z][a-z0-9-]*$/.test(t));
  /* Header variant: one the family lists, else its default, else none. */
  const headers = Array.isArray(family.headers) ? family.headers : [];
  const header = options.header && headers.includes(options.header)
    ? options.header
    : headers.includes(String(family.defaultHeader)) ? String(family.defaultHeader) : "";
  const sheetAttrs = [
    `data-doc="${doc === "resume" ? "resume" : "cover-letter"}"`,
    `data-family="${escapeHtml(family.id)}"`,
    `data-accent="${escapeHtml(accent)}"`,
    fitTokens.length ? `data-fit="${escapeHtml(fitTokens.join(" "))}"` : "",
    options.fitVerified && !options.overflow ? "data-fit-verified" : "",
    options.overflow ? "data-overflow" : "",
    header ? `data-header="${escapeHtml(header)}"` : "",
  ].filter(Boolean).join(" ");
  const docLabel = doc === "resume" ? "Resume" : "Cover letter";
  const targetCompany = String(options.target?.company || targetCompanyOf(model) || "").trim();
  const targetMark = options.target?.logo && typeof options.target.logo.src === "string" && options.target.logo.src
    ? {
      src: options.target.logo.src,
      alt: options.target.logo.alt || `${targetCompany} logo`,
      shape: options.target.logo.shape || "mark",
      isWordmark: options.target.logo.shape === "wordmark",
      isMonogram: options.target.logo.source === "monogram",
    }
    : null;
  return {
    title: `${identity.name}: ${docLabel}`,
    family: { id: family.id, label: family.label, version: family.version },
    sheetAttrs: safe(sheetAttrs),
    target: targetCompany ? { company: targetCompany, logo: targetMark } : null,
    identity: {
      name: identity.name,
      nameDots: nameDots(identity.name, family.nameDots),
      nameFit: fitName(
        {
          name: identity.name,
          nameFirst: `${nameFirst} `,
          nameLast,
          target: identity.target,
          contact: (identity.contact || []).map((c) => String(c.text || "")),
        },
        family.nameFit ? family.nameFit[doc] : undefined,
      ),
      nameFirst,
      nameLast,
      hasNameLast: Boolean(nameLast),
      target: identity.target,
      contact: contactView(identity.contact || []),
    },
    resume,
    letter,
  };
}

/**
 * @param {RenderModel} model
 * @param {DocKind} doc
 * @param {RenderOptions} [options]
 * @returns {string} a complete, self-contained HTML document
 */
export function renderDocument(model, doc, options = {}) {
  if (!model || !model.template || !model.identity || !model.documents) {
    throw new Error("renderDocument needs a materials.render-model.v1");
  }
  if (!model.documents[doc]) throw new Error(`the render model has no ${doc}`);
  const family = resolveFamily(model.template.family);
  const view = buildView(model, family, doc, options);
  const template = readFamilyFile(family, doc === "resume" ? family.documents.resume : family.documents.coverLetter);
  const body = renderTemplate(template, view);
  const css = [inlineFontCss(family.fonts), BASE_CSS, readFamilyFile(family, family.stylesheet)].join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(view.title)}</title>`,
    `<meta name="materials-template" content="${escapeHtml(`${family.id}@${family.version}`)}" />`,
    /* materials-quality counts a template letter's body (its data-paragraph
       elements) against this band instead of the legacy whole-page 325–475. */
    doc === "coverLetter" ? `<meta name="materials-letter-words" content="${letterWordBand(family).join("-")}" />` : "",
    `<style>\n${css}\n</style>`,
    "</head>",
    "<body>",
    body.trim(),
    "</body>",
    "</html>",
    "",
  ].filter((line, i, all) => line !== "" || i === all.length - 1).join("\n");
}

/* ------------------------------------------------------------------ *
 * Model helpers
 * ------------------------------------------------------------------ */

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let modelValidator = null;

/**
 * Validate against schemas/materials-render-model.v1.schema.json.
 * @param {unknown} model
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRenderModel(model) {
  if (!modelValidator) {
    const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
      /** @type {unknown} */ (Ajv2020)
    );
    const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
    modelValidator = ajv.compile(JSON.parse(readFileSync(RENDER_MODEL_SCHEMA, "utf8")));
  }
  const ok = Boolean(modelValidator(model));
  return {
    ok,
    errors: ok ? [] : (modelValidator.errors || []).map((e) => `${e.instancePath || "/"} ${e.message || "invalid"}`),
  };
}

/**
 * The same model, re-pointed at another family: the template block and the
 * documents' templateIds change, nothing else (the render model does not
 * depend on the family, visual spec §9.4). Accent and density carry over
 * only when the new family lists them.
 *
 * @param {RenderModel} model
 * @param {{ id: string, version: string, accents: string[], densities: string[] }} family
 * @returns {RenderModel}
 */
export function retargetModel(model, family) {
  /** @type {RenderModel} */
  const out = JSON.parse(JSON.stringify(model));
  const ids = templateIdsFor(family);
  /** @type {RenderModel["template"]} */
  const template = { family: family.id, version: family.version, pageBudget: out.template?.pageBudget || 1 };
  if (out.template?.accent && family.accents.includes(out.template.accent)) template.accent = out.template.accent;
  if (out.template?.density && family.densities.includes(out.template.density)) template.density = out.template.density;
  out.template = template;
  if (out.documents.resume) out.documents.resume.templateId = ids.resume;
  if (out.documents.coverLetter) out.documents.coverLetter.templateId = ids.coverLetter;
  return out;
}
