/** Stable, template-independent address book for materials.render-model.v1. */
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { runsToText, validateRenderModel } from "./materials-render.mjs";

const NUMBER = /(?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?/g;

/** @typedef {import('./materials-render.mjs').RenderModel} RenderModel */
/** @typedef {{id:string,kind:string,text:string,locked:{whole:boolean,spans:number[][]},ref:any}} Address */
/** @type {import('ajv').ValidateFunction<unknown> | null} */
let editOpValidator = null;

/** @param {unknown} op */
function validEditOp(op) {
  if (!editOpValidator) {
    const Ajv2020Constructor = /** @type {typeof import('ajv/dist/2020.js').default} */ (/** @type {unknown} */ (Ajv2020));
    const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
    editOpValidator = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/materials-edit-op.v1.schema.json", import.meta.url), "utf8")));
  }
  return Boolean(editOpValidator(op));
}

export class MaterialsEditError extends Error {
  /** @param {string} reason @param {string} detail */
  constructor(reason, detail) {
    super(detail);
    this.name = "MaterialsEditError";
    this.reason = reason;
    this.detail = detail;
  }
}

/** @param {string} text */
const wordCount = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;
/** @param {string} text */
const plain = (text) => String(text)
  .replace(/<[^>]*>/g, "")
  .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
  .replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, "")
  .replace(/(?:\*\*|__|~~|`|\*|_)/g, "")
  .trim();

/** @param {Array<{t?:string,n?:string,hl?:string}>} runs */
function metricSpans(runs) {
  let offset = 0;
  const spans = [];
  for (const run of runs) {
    const value = run.t ?? run.n ?? run.hl ?? "";
    if (run.n) spans.push([offset, offset + value.length]);
    offset += value.length;
  }
  return spans;
}

/** @param {string} text */
function numberSpans(text) {
  return [...text.matchAll(NUMBER)].map((match) => [match.index, match.index + match[0].length]);
}

/**
 * @param {RenderModel} model
 * @returns {Address[]}
 */
function addressBook(model) {
  /** @type {Address[]} */
  const out = [];
  /** @param {string} id @param {string} kind @param {string} text @param {any} ref @param {number[][]} [spans] @param {boolean} [whole] */
  const add = (id, kind, text, ref, spans = [], whole = false) => {
    if (out.some((node) => node.id === id)) throw new MaterialsEditError("invalid_model", `duplicate node id: ${id}`);
    out.push({ id, kind, text, locked: { whole, spans }, ref });
  };
  const resume = model.documents?.resume;
  if (resume) {
    add("stmt", "statement", runsToText(resume.statement.runs), { kind: "statement", target: resume.statement }, metricSpans(resume.statement.runs));
    if (resume.intro) add("intro", "intro", runsToText(resume.intro.runs), { kind: "intro", target: resume.intro, owner: resume }, metricSpans(resume.intro.runs));
    for (const section of resume.sections) {
      for (const entry of section.entries || []) {
        const employerId = entry.employerId;
        if (entry.seat !== undefined) add(`seat:${employerId}`, "seat", runsToText(entry.seat), { kind: "seat", entry }, [], true);
        for (const bullet of entry.bullets || []) {
          add(`b:${employerId}:${bullet.claimId}`, "bullet", runsToText(bullet.runs), { kind: "bullet", target: bullet, owner: entry.bullets }, metricSpans(bullet.runs));
        }
        if (entry.line !== undefined) add(`line:${employerId}`, "line", entry.line, { kind: "line", entry });
      }
      (section.lines || []).forEach((line, index) => add(`cred:${line.claimId || index}`, "credential", runsToText(line.runs), { kind: "credential", target: line, owner: section.lines }, [], true));
      for (const group of section.groups || []) add(`tool:${group.label}`, "toolkit", group.items.join(", "), { kind: "toolkit", target: group, owner: section.groups });
    }
  }
  const letter = model.documents?.coverLetter;
  if (letter) {
    add("sal", "salutation", letter.salutation, { kind: "salutation", target: letter });
    for (const paragraph of letter.paragraphs) add(`p:${paragraph.id}`, "paragraph", paragraph.text, { kind: "paragraph", target: paragraph, owner: letter.paragraphs }, numberSpans(paragraph.text));
  }
  return out;
}

/** Public nodes for GET /versions/:runId/model; no mutable model references. */
/** @param {RenderModel} model */
export function deriveNodes(model) {
  return addressBook(model).map(({ id, kind, text, locked }) => ({ id, kind, text, locked }));
}

/** Locked offsets are UTF-16 string offsets, matching String.slice in the browser. */
/** @param {RenderModel} model */
export function lockedSpans(model) {
  return Object.fromEntries(deriveNodes(model).map(({ id, locked }) => [id, locked]));
}

/** @param {Address} node @param {string|null} nextText */
function assertUnlocked(node, nextText) {
  if (node.locked.whole) throw new MaterialsEditError("locked", node.text);
  if (!node.locked.spans.length) return;
  if (nextText === null) throw new MaterialsEditError("locked", node.text.slice(...node.locked.spans[0]));
  let from = 0;
  for (const [start, end] of node.locked.spans) {
    const token = node.text.slice(start, end);
    let at = nextText.indexOf(token, from);
    while (at >= 0) {
      const before = Array.from(nextText.slice(0, at)).at(-1) || "";
      const rest = nextText.slice(at + token.length);
      const after = Array.from(rest)[0] || "";
      // A sentence-ending period is punctuation; a period joined to a
      // following digit extends the figure just as a decimal prefix does.
      if (!/[\p{L}\p{N}]/u.test(before + after) && before !== "." && !/^\.\p{N}/u.test(rest)) break;
      at = nextText.indexOf(token, at + 1);
    }
    if (at < 0) throw new MaterialsEditError("locked", token);
    from = at + token.length;
  }
}

/** @param {RenderModel} model */
function metricTokens(model) {
  return [...new Set(addressBook(model).flatMap((node) => node.locked.spans.map(([a, b]) => node.text.slice(a, b))))].sort((a, b) => b.length - a.length);
}

/** @param {string} text @param {string[]} tokens */
function toRuns(text, tokens) {
  /** @type {Array<{t?:string,n?:string}>} */
  const runs = [];
  let rest = text;
  while (rest) {
    const matches = tokens.map((token) => ({ token, at: rest.indexOf(token) })).filter(({ at }) => at >= 0).sort((a, b) => a.at - b.at || b.token.length - a.token.length);
    if (!matches.length) break;
    const { token, at } = matches[0];
    if (at) runs.push({ t: rest.slice(0, at) });
    runs.push({ n: token });
    rest = rest.slice(at + token.length);
  }
  if (rest) runs.push({ t: rest });
  return runs.length ? runs : [{ t: text }];
}

/** @param {RenderModel} model */
function checkShape(model) {
  const resume = model.documents?.resume;
  if (resume) {
    const count = wordCount(runsToText(resume.statement.runs));
    if (count < 20 || count > 55) throw new MaterialsEditError("shape", `statement has ${count} words; expected 20–55`);
    for (const section of resume.sections) for (const entry of section.entries || []) {
      const [min, max] = MATERIALS_BUDGETS.resume.bulletsPerFeatured;
      if (entry.bullets && (entry.bullets.length < min || entry.bullets.length > max)) throw new MaterialsEditError("shape", `${entry.employerId} has ${entry.bullets.length} bullets; expected ${min}–${max}`);
    }
  }
  const letter = model.documents?.coverLetter;
  if (letter && (letter.paragraphs.length < 3 || letter.paragraphs.length > 4)) throw new MaterialsEditError("shape", `letter has ${letter.paragraphs.length} paragraphs; expected 3–4`);
}

/**
 * Apply a complete batch atomically. Throws MaterialsEditError with reason
 * locked | out_of_scope | shape | invalid_model. The input is never changed.
 * @param {RenderModel} model
 * @param {Array<any>} ops
 * @param {{scope?:'all'|string[]}} [options]
 */
export function applyOps(model, ops, { scope = "all" } = {}) {
  if (!Array.isArray(ops) || !Array.isArray(scope) && scope !== "all") throw new MaterialsEditError("invalid_model", "invalid edit batch or scope");
  const base = validateRenderModel(model);
  if (!base.ok) throw new MaterialsEditError("invalid_model", base.errors.join("; "));
  const out = structuredClone(model);
  const tokens = metricTokens(model);
  const seen = new Set();
  for (const op of ops) {
    if (!validEditOp(op) || seen.has(op.opId)) throw new MaterialsEditError("invalid_model", "invalid or duplicate edit op");
    seen.add(op.opId);
    const id = op.op === "insert" ? op.after : op.node;
    if (typeof id !== "string" || !id) throw new MaterialsEditError("invalid_model", "edit op needs a node id");
    if (scope !== "all" && !scope.includes(id)) throw new MaterialsEditError("out_of_scope", id);
    const node = addressBook(out).find((item) => item.id === id);
    if (!node) throw new MaterialsEditError("invalid_model", `unknown node: ${id}`);
    const { ref } = node;
    if (op.op === "insert") {
      if (typeof op.claimId !== "string" || !op.claimId || typeof op.text !== "string" || !plain(op.text)) throw new MaterialsEditError("invalid_model", "insert needs claimId and text");
      const text = plain(op.text);
      if (ref.kind === "bullet") {
        if (ref.owner.some((/** @type {{claimId:string}} */ b) => b.claimId === op.claimId)) throw new MaterialsEditError("invalid_model", `duplicate claimId: ${op.claimId}`);
        ref.owner.splice(ref.owner.indexOf(ref.target) + 1, 0, { claimId: op.claimId, runs: toRuns(text, tokens) });
      } else if (ref.kind === "paragraph") {
        const paragraphId = op.paragraphId || op.opId;
        if (typeof paragraphId !== "string" || ref.owner.some((/** @type {{id:string}} */ p) => p.id === paragraphId)) throw new MaterialsEditError("invalid_model", `duplicate paragraph id: ${paragraphId}`);
        const beat = op.beat || ref.target.beat;
        ref.owner.splice(ref.owner.indexOf(ref.target) + 1, 0, { id: paragraphId, beat, claimId: op.claimId, text, words: wordCount(text) });
      } else throw new MaterialsEditError("invalid_model", `cannot insert after ${id}`);
    } else if (op.op === "replace") {
      if (typeof op.text !== "string" || !plain(op.text)) throw new MaterialsEditError("invalid_model", "replace needs text");
      const text = plain(op.text);
      assertUnlocked(node, text);
      if (["statement", "intro", "bullet", "credential"].includes(ref.kind)) ref.target.runs = toRuns(text, tokens);
      else if (ref.kind === "paragraph") { ref.target.text = text; if ("words" in ref.target) ref.target.words = wordCount(text); }
      else if (ref.kind === "line") ref.entry.line = text;
      else if (ref.kind === "toolkit") ref.target.items = text.split(",").map((item) => item.trim()).filter(Boolean);
      else if (ref.kind === "salutation") ref.target.salutation = text;
      if (ref.kind === "statement" && "words" in ref.target) ref.target.words = wordCount(text);
    } else {
      assertUnlocked(node, null);
      if (["bullet", "credential", "toolkit", "paragraph"].includes(ref.kind)) ref.owner.splice(ref.owner.indexOf(ref.target), 1);
      else if (ref.kind === "intro") delete ref.owner.intro;
      else if (ref.kind === "line") delete ref.entry.line;
      else throw new MaterialsEditError("invalid_model", `cannot remove ${id}`);
    }
  }
  if (out.documents?.coverLetter && "bodyWords" in out.documents.coverLetter) out.documents.coverLetter.bodyWords = out.documents.coverLetter.paragraphs.reduce((n, p) => n + wordCount(p.text), 0);
  checkShape(out);
  const validation = validateRenderModel(out);
  if (!validation.ok) throw new MaterialsEditError("invalid_model", validation.errors.join("; "));
  addressBook(out); // Reject duplicate ids even if the render-model schema permits them.
  return out;
}
