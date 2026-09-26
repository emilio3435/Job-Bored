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
import { readFamilyFile, resolveFamily, templateIdsFor } from "./materials-templates.mjs";

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
 * @property {{ name: string, target: string, contact: { kind: string, text: string, href?: string }[] }} identity
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

/** @type {string | null} */
let fontsCss = null;
/** @type {Map<string, string>} */
const fontFaceCache = new Map();

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

/** @returns {FontFace[]} */
export function vendoredFontFaces() {
  if (fontsCss === null) fontsCss = readFileSync(join(FONTS_DIR, "fonts.css"), "utf8");
  /** @type {FontFace[]} */
  const faces = [];
  for (const match of fontsCss.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
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

/**
 * The @font-face rules for a family's `fonts` list, as data: URIs. A name
 * with an " Italic" suffix adds that face's italics; latin and latin-ext only.
 *
 * @param {string[]} fontNames
 * @returns {string}
 */
export function inlineFontCss(fontNames) {
  const key = fontNames.join("|");
  const cached = fontFaceCache.get(key);
  if (cached) return cached;
  const wanted = new Set(fontNames);
  /** @type {Map<string, FontFace & { weights: number[] }>} */
  const merged = new Map();
  for (const face of vendoredFontFaces()) {
    if (face.subset !== "latin" && face.subset !== "latin-ext") continue;
    const name = face.style === "italic" ? `${face.family} Italic` : face.family;
    if (!wanted.has(name)) continue;
    const id = `${face.family}|${face.style}|${face.src}`;
    const weights = face.weight.split(/\s+/).map(Number).filter(Number.isFinite);
    const prior = merged.get(id);
    if (prior) prior.weights.push(...weights);
    else merged.set(id, { ...face, weights });
  }
  const rules = [...merged.values()].map((face) => {
    const data = readFileSync(join(FONTS_DIR, face.src)).toString("base64");
    const min = Math.min(...face.weights);
    const max = Math.max(...face.weights);
    return [
      "@font-face {",
      `  font-family: '${face.family}';`,
      `  font-style: ${face.style};`,
      `  font-weight: ${min === max ? min : `${min} ${max}`};`,
      face.stretch ? `  font-stretch: ${face.stretch};` : "",
      "  font-display: block;",
      `  src: url(data:font/woff2;base64,${data}) format('woff2');`,
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
article.page:not([data-fit-verified]) { height: auto !important; min-height: 11in; overflow: visible !important; }
article.page[data-fit-verified] { height: 11in; overflow: hidden; }
/* A wordmark already spells the employer's name, so the h2.company-name
   beside it is hidden visually but kept, unclipped, in the text layer for
   ATS extraction (clipping it to 1px drops it from the PDF). */
.visually-dup { position: absolute !important; left: 0; top: 0; margin: 0 !important; white-space: pre; color: transparent !important; pointer-events: none; user-select: none; }
`;

/** @param {string} value */
function isDateLike(value) {
  return /\d{4}|present|now|current/i.test(value);
}

/**
 * @param {{ kind: string, text: string, href?: string }[]} contact
 */
function contactView(contact) {
  const items = contact.map((c) => ({
    kind: c.kind,
    text: c.text,
    href: typeof c.href === "string" && /^(https?:|mailto:|tel:)/i.test(c.href) ? c.href : "",
    isMono: c.kind === "phone",
  }));
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
    style: `height:${heightIn}in;width:auto`,
  };
}

/**
 * @param {Entry} entry
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {{ side?: boolean }} [options]
 */
function entryView(entry, family, options = {}) {
  const logo = logoView(entry.logo, family);
  const meta = Array.isArray(entry.meta) ? entry.meta.filter((m) => typeof m === "string" && m.trim()) : [];
  const dates = meta.filter(isDateLike).join(" ");
  const place = meta.filter((m) => !isDateLike(m)).join(", ");
  const bullets = (entry.bullets || []).map((bullet) => {
    const runs = Array.isArray(bullet.runs) ? bullet.runs : [];
    const lead = runs.length > 1 && typeof runs[0].n === "string" ? runs[0].n : "";
    return {
      claimId: bullet.claimId,
      html: safe(runsToHtml(runs)),
      text: runsToText(runs),
      lead,
      hasLead: Boolean(lead),
      restHtml: safe(runsToHtml(lead ? runs.slice(1) : runs)),
    };
  });
  return {
    employerId: entry.employerId,
    claimId: entry.claimId || "",
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
    side: Boolean(options.side),
  };
}

/**
 * Group readouts by employer and attach that employer's name, seat and logo
 * from the resume's entries, so a readout strip can label its channels.
 *
 * @param {Readout[]} readouts
 * @param {Map<string, ReturnType<typeof entryView>>} entriesById
 */
function readoutGroups(readouts, entriesById) {
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
 */
function resumeView(model, family) {
  const resume = /** @type {ResumeDoc} */ (model.documents.resume);
  const sections = Array.isArray(resume.sections) ? resume.sections : [];
  /** @param {string} kind */
  const firstOf = (kind) => sections.find((s) => s.kind === kind) || null;

  const experience = firstOf("experience");
  const experienceEntries = (experience?.entries || []).map((e) => entryView(e, family));
  const earlierSection = firstOf("earlier");
  const earlierEntries = (earlierSection?.entries || []).map((e) => entryView(e, family));
  const venturesSection = firstOf("ventures");
  const ventureEntries = (venturesSection?.entries || []).map((e) => entryView(e, family, { side: true }));

  /** @type {Map<string, ReturnType<typeof entryView>>} */
  const entriesById = new Map();
  for (const e of [...experienceEntries, ...earlierEntries, ...ventureEntries]) {
    if (!entriesById.has(e.employerId)) entriesById.set(e.employerId, e);
  }

  const readoutsSection = firstOf("readouts");
  const readouts = readoutsSection && readoutsSection.readouts?.length
    ? { label: readoutsSection.label, ...readoutGroups(readoutsSection.readouts, entriesById) }
    : null;

  const toolkitSection = firstOf("toolkit");
  const toolkit = toolkitSection && toolkitSection.groups?.length
    ? {
      label: toolkitSection.label,
      groups: toolkitSection.groups.map((g) => ({ label: g.label, items: g.items, itemsText: g.items.join(", ") })),
    }
    : null;

  const tokenSections = sections.filter((s) => s.kind === "tokens" && s.tokens?.length);
  const educationTokenSections = tokenSections.filter((s) => /educat|school|degree/i.test(s.label));
  const skillTokenSections = tokenSections.filter((s) => !educationTokenSections.includes(s));
  const skills = skillTokenSections.map((s) => ({ label: s.label, items: s.tokens || [], itemsText: (s.tokens || []).join(", ") }));

  const credentialsSection = firstOf("credentials");
  /** @type {{ html: SafeHtml, text: string, claimId: string, logo: ReturnType<typeof logoView> }[]} */
  const educationLines = [];
  for (const line of credentialsSection?.lines || []) {
    educationLines.push({
      html: safe(runsToHtml(line.runs)),
      text: runsToText(line.runs),
      claimId: line.claimId || "",
      logo: logoView(line.logo, family),
    });
  }
  for (const s of educationTokenSections) {
    for (const token of s.tokens || []) {
      educationLines.push({ html: safe(escapeHtml(token)), text: token, claimId: "", logo: null });
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
      html: safe(runsToHtml(resume.statement?.runs)),
      text: statementText,
    },
    intro: resume.intro && Array.isArray(resume.intro.runs)
      ? { html: safe(runsToHtml(resume.intro.runs)), claimIds: resume.intro.claimIds.join(" ") }
      : null,
    experience: experienceEntries.length ? { label: experience?.label || "Experience", entries: experienceEntries } : null,
    earlier: earlierEntries.length ? { label: earlierSection?.label || "Earlier", entries: earlierEntries } : null,
    ventures: ventureEntries.length ? { label: venturesSection?.label || "Ventures", entries: ventureEntries } : null,
    readouts,
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
 * @param {RenderModel} model
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {Map<string, ReturnType<typeof entryView>>} entriesById
 */
function letterView(model, family, entriesById) {
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
      beat: p.beat,
      claimId: p.claimId || "",
      html: safe(tagTokensInText(p.text, tokens)),
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
  const readouts = letter.readouts && letter.readouts.length ? readoutGroups(letter.readouts, entriesById) : null;
  const pullQuote = letter.pullQuote && letter.pullQuote.text
    ? { html: safe(tagTokensInText(letter.pullQuote.text, tokens)), text: letter.pullQuote.text, fromParagraph: letter.pullQuote.fromParagraph }
    : null;
  return {
    salutation: letter.salutation,
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
  const resume = model.documents.resume ? resumeView(model, family) : null;
  /** @type {Map<string, ReturnType<typeof entryView>>} */
  const entriesById = new Map();
  for (const group of [resume?.experience, resume?.earlier, resume?.ventures]) {
    for (const entry of group?.entries || []) if (!entriesById.has(entry.employerId)) entriesById.set(entry.employerId, entry);
  }
  const letter = doc === "coverLetter" && model.documents.coverLetter ? letterView(model, family, entriesById) : null;
  const fitTokens = (options.fitTokens || []).filter((t) => /^[a-z][a-z0-9-]*$/.test(t));
  const sheetAttrs = [
    `data-doc="${doc === "resume" ? "resume" : "cover-letter"}"`,
    `data-family="${escapeHtml(family.id)}"`,
    `data-accent="${escapeHtml(accent)}"`,
    fitTokens.length ? `data-fit="${escapeHtml(fitTokens.join(" "))}"` : "",
    options.fitVerified && !options.overflow ? "data-fit-verified" : "",
    options.overflow ? "data-overflow" : "",
  ].filter(Boolean).join(" ");
  const docLabel = doc === "resume" ? "Resume" : "Cover letter";
  return {
    title: `${identity.name}: ${docLabel}`,
    family: { id: family.id, label: family.label, version: family.version },
    sheetAttrs: safe(sheetAttrs),
    identity: {
      name: identity.name,
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
    `<style>\n${css}\n</style>`,
    "</head>",
    "<body>",
    body.trim(),
    "</body>",
    "</html>",
    "",
  ].join("\n");
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
