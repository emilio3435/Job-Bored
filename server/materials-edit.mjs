/** A proposed edit batch is validated here; it never publishes a partial model. */
import { readFileSync } from "node:fs";
import { applyOps, deriveNodes, MaterialsEditError } from "./materials-nodes.mjs";
import { claimById } from "./materials-ledger.mjs";
import { callJsonStage, EDIT_SYSTEM_PROMPT, WriterJsonError } from "./materials-writer.mjs";

/** @param {unknown} text */
const words = (text) => String(text || "").trim().split(/\s+/).filter(Boolean);
/** @param {Array<{text:string}>} nodes */
const count = (nodes) => nodes.reduce((sum, node) => sum + words(node.text).length, 0);
const commonWords = new Set(JSON.parse(readFileSync(new URL("./data/common-english.json", import.meta.url), "utf8")).words);
const months = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
const numberWords = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion"]);
const titleFunctionWords = new Set(["a", "an", "as", "of", "for", "the", "and", "at", "in", "to"]);
const titleLinks = new Set(["of", "for", "the"]);
const roleWords = new Set(["administrator", "analyst", "architect", "associate", "assistant", "consultant", "coordinator", "designer", "developer", "director", "engineer", "head", "lead", "manager", "officer", "scientist", "specialist", "vp"]);
const lexicalToken = /(?<![\p{L}\p{N}])(?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:\s*-\s*\d[\d,]*(?:\.\d+)?)?(?:\s*%|\s*percent\b|x\b|[kmb]\+?|st\b|nd\b|rd\b|th\b)?|[\p{L}][\p{L}\p{M}\d]*(?:[-'][\p{L}\p{M}\d]+)*/giu;
/** @param {unknown} value */
const normalizedText = (value) => String(value || "").normalize("NFKC").replace(/[‘’]/g, "'").replace(/[‐‑‒–—−]/g, "-");
/** @param {string} token */
function tokenKey(token) {
  return normalizedText(token).toLocaleLowerCase().replace(/,/g, "").replace(/\s*-\s*/g, "-").replace(/\s*percent\b|\s*%/g, "%").replace(/[.,;:!?]+$/g, "");
}
/** @param {string} token */
function contractionKeys(token) {
  const key = tokenKey(token);
  const match = key.match(/^(.+)'(ve|d|ll|re|m|s)$/);
  if (!match) return [key];
  /** @type {Record<string, string>} */
  const suffix = { ve: "have", d: "would", ll: "will", re: "are", m: "am", s: "is" };
  if (match[2] === "s" && !["it", "he", "she", "that", "there", "who", "what"].includes(match[1])) return [match[1]];
  return [match[1], suffix[match[2]]];
}
/** @param {string} token */
const isNumberWords = (token) => tokenKey(token).split(/[-\s]+/).every((part) => numberWords.has(part));
/** @param {string} key */
function trustedKeys(key) {
  const keys = [key];
  const range = key.match(/^(\d[\d.]*)-(\d[\d.]*)(%|x|[kmb]\+?)?$/);
  if (range) for (const endpoint of [range[1], range[2]]) keys.push(endpoint, endpoint + (range[3] || ""));
  const metric = key.match(/^(\d[\d.]*)(%|x|[kmb]\+?)$/);
  if (metric) keys.push(metric[1]);
  return keys;
}
/** @param {string} key */
function isCommon(key) {
  if (key.length === 1 || commonWords.has(key)) return true;
  const stems = [key];
  for (let depth = 0; depth < 2; depth += 1) {
    for (const word of [...stems]) {
      for (const [suffix, replacement] of [["ies", "y"], ["ing", ""], ["ed", ""], ["es", ""], ["s", ""], ["ly", ""], ["ment", ""]]) {
        if (word.length <= suffix.length + 2 || !word.endsWith(suffix)) continue;
        const stem = word.slice(0, -suffix.length) + replacement;
        if (commonWords.has(stem) || commonWords.has(stem + "e") || stem.endsWith(stem.slice(-1).repeat(2)) && commonWords.has(stem.slice(0, -1))) return true;
        stems.push(stem);
      }
    }
  }
  return false;
}
/** @param {unknown} value */
function factTokens(value) {
  const text = normalizedText(value);
  const matches = [...text.matchAll(lexicalToken)];
  const found = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    let end = i;
    if (isNumberWords(match[0])) {
      while (end + 1 < matches.length && isNumberWords(matches[end + 1][0]) && /^[\s-]+$/.test(text.slice(matches[end].index + matches[end][0].length, matches[end + 1].index))) end += 1;
    }
    const raw = text.slice(match.index, matches[end].index + matches[end][0].length);
    const keys = isNumberWords(raw) ? [tokenKey(raw).replace(/-/g, " ")] : contractionKeys(raw);
    for (const key of keys) {
      const month = months.has(key) && (key !== "may" || raw === "May");
      found.push({ raw, key, always: /\d/.test(key) || /[\p{Ll}][\p{Lu}]/u.test(raw) || month || isNumberWords(raw) });
    }
    i = end;
  }
  return found;
}
/** @param {string} text */
const titleWords = (text) => new Set((normalizedText(text).toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu) || []).filter((word) => !titleFunctionWords.has(word)));
/** @param {Set<string>} candidate @param {Set<string>} source */
const subsetOf = (candidate, source) => [...candidate].every((word) => source.has(word));
/** @param {string} value @param {Set<string>} knownTitleWords */
function titlePhrases(value, knownTitleWords) {
  const text = normalizedText(value);
  const matches = [...text.matchAll(/[\p{L}][\p{L}\p{M}]*/gu)];
  const found = [];
  for (let i = 0; i < matches.length; i += 1) {
    if (!roleWords.has(matches[i][0].toLocaleLowerCase())) continue;
    let start = i;
    const left = matches[i - 1];
    const cue = matches[i - 2]?.[0].toLocaleLowerCase();
    if (left && !titleFunctionWords.has(left[0].toLocaleLowerCase()) && /^\s+$/.test(text.slice(left.index + left[0].length, matches[i].index)) && (knownTitleWords.has(left[0].toLocaleLowerCase()) || /^[\p{Lu}]/u.test(left[0]) || ["as", "a", "an", "role", "position"].includes(cue))) start = i - 1;
    let end = i;
    if (titleLinks.has(matches[i + 1]?.[0].toLocaleLowerCase()) && /^\s+$/.test(text.slice(matches[i].index + matches[i][0].length, matches[i + 1].index))) {
      let j = i + 1;
      while (j < matches.length && titleLinks.has(matches[j][0].toLocaleLowerCase())) j += 1;
      if (j < matches.length) {
        end = j;
        const next = matches[j + 1];
        if (next && !titleFunctionWords.has(next[0].toLocaleLowerCase()) && /^\s+$/.test(text.slice(matches[j].index + matches[j][0].length, next.index))) end = j + 1;
      }
    }
    const phrase = text.slice(matches[start].index, matches[end].index + matches[end][0].length);
    found.push({ phrase, words: titleWords(phrase) });
  }
  return found;
}
/** @param {string} name @param {unknown} value */
const dataBlock = (name, value) => `<untrusted-data name="${name}">\n${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</untrusted-data>`;

/** @param {unknown} value @returns {string[]} */
function stringLeaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}
/** @param {any} ledger @param {import('./materials-render.mjs').RenderModel} model @param {Array<{text:string}>} nodes @param {object} jdExtract @param {any} profile */
function trustedFacts(ledger, model, nodes, jdExtract, profile) {
  const claims = Array.isArray(ledger?.claims) ? ledger.claims : [];
  const employers = Array.isArray(ledger?.employers) ? ledger.employers : [];
  const tools = Array.isArray(ledger?.toolInventory) ? ledger.toolInventory : [];
  const entries = (model.documents?.resume?.sections || []).flatMap((section) => section.entries || []);
  const titles = [
    model.identity?.target,
    ...entries.map((entry) => Array.isArray(entry.seat) ? entry.seat.map((run) => run.t ?? run.n ?? run.hl ?? "").join("") : entry.seat),
    ...employers.map((/** @type {any} */ employer) => employer.title),
    ...stringLeaves(profile?.targetRoles),
    ...stringLeaves(profile?.experiences).filter((title) => roleWords.has(title.toLocaleLowerCase().split(/\s+/).at(-1) || "")),
    ...stringLeaves(profile?.employers).filter((title) => roleWords.has(title.toLocaleLowerCase().split(/\s+/).at(-1) || "")),
  ].filter(Boolean).map(String);
  const sourceParts = [
    JSON.stringify(model.identity),
    ...nodes.map((node) => node.text),
    ...entries.flatMap((entry) => [entry.org, ...(entry.meta || [])]),
    ...claims.flatMap((/** @type {any} */ claim) => [claim.text, ...(claim.metrics || []).map((/** @type {any} */ metric) => metric.token), ...(claim.tools || [])]),
    ...employers.flatMap((/** @type {any} */ employer) => [employer.name, employer.title, employer.start, employer.end, employer.location]),
    ...tools.map((/** @type {any} */ tool) => tool.tool),
    ...stringLeaves(profile?.targetRoles), ...stringLeaves(profile?.strengths), ...stringLeaves(profile?.experiences), ...stringLeaves(profile?.employers),
    ...stringLeaves(jdExtract),
  ].filter(Boolean).map(String);
  const tokens = new Set(sourceParts.flatMap((part) => factTokens(part).flatMap(({ key }) => trustedKeys(key))));
  const titleSets = titles.map(titleWords).filter((set) => set.size);
  return {
    tokens,
    titleSets,
    titleVocabulary: new Set(titleSets.flatMap((set) => [...set])),
  };
}

/** Newly introduced fact-like tokens absent from the candidate source facts.
 * @param {any} op @param {string} beforeText @param {ReturnType<typeof trustedFacts>} trusted @param {any} ledger @param {string} writtenText
 */
function unverifiedFacts(op, beforeText, trusted, ledger, writtenText) {
  if (op.op === "remove") return [];
  const prior = new Set(factTokens(beforeText).flatMap(({ key }) => trustedKeys(key)));
  const missing = factTokens(writtenText)
    .filter(({ key, always }) => !prior.has(key) && !trusted.tokens.has(key) && (always || !isCommon(key)))
    .map(({ raw }) => raw);
  const priorTitles = titlePhrases(beforeText, trusted.titleVocabulary).map(({ words }) => words);
  for (const { phrase, words: content } of titlePhrases(writtenText, trusted.titleVocabulary)) {
    if (!priorTitles.some((source) => subsetOf(content, source)) && !trusted.titleSets.some((source) => subsetOf(content, source))) missing.push(phrase);
  }
  if (op.op === "insert" && !claimById(ledger, op.claimId)) missing.push(`claimId:${op.claimId}`);
  return [...new Set(missing)];
}

/** Recheck accepted ops against the current model and fact ledger, including
 * direct manual edits that never passed through proposeEdits.
 * @param {import('./materials-render.mjs').RenderModel} model
 * @param {Array<any>} ops
 * @param {any} ledger
 */
export function flagUnverifiedOps(model, ops, ledger = {}) {
  const nodes = deriveNodes(model);
  const byId = new Map(nodes.map((node) => [node.id, node.text]));
  const trusted = trustedFacts(ledger, model, nodes);
  return ops.map((source) => {
    const op = { ...source };
    const id = op.op === "insert" ? op.after : op.node;
    const facts = unverifiedFacts(op, byId.get(id) || "", trusted, ledger);
    if (facts.length) {
      op.flags = [...new Set([...(op.flags || []), "unverified"])];
      op.facts = [...new Set([...(op.facts || []), ...facts])];
    }
    return op;
  });
}

/**
 * @param {{model:import('./materials-render.mjs').RenderModel, nodes?:Array<{id:string,text:string}>, instruction:string, scope?:'all'|string[], lockFacts?:boolean, jdExtract?:object, ledger?:any, profile?:any, pin:import('./materials-writer.mjs').WriterPin, fetchImpl:import('./materials-writer.mjs').WriterInput['fetchImpl']}} input
 */
export async function proposeEdits({ model, nodes, instruction, scope = "all", lockFacts = true, jdExtract = {}, ledger = {}, profile = {}, pin, fetchImpl }) {
  const baseNodes = deriveNodes(model);
  const suppliedNodes = Array.isArray(nodes) ? nodes : baseNodes;
  const userText = [
    `<instruction>\n${JSON.stringify(instruction)}\n</instruction>`,
    `<constraints>\n${JSON.stringify({ scope, lockFacts })}\n</constraints>`,
    dataBlock("nodes", suppliedNodes),
    dataBlock("job_posting", jdExtract),
    dataBlock("ledger_claims", ledger?.claims || []),
    dataBlock("tool_inventory", ledger?.toolInventory || []),
  ].join("\n");
  let response;
  try {
    response = await callJsonStage({ pin, systemPrompt: EDIT_SYSTEM_PROMPT, userText, maxOutputTokens: 4096, fetchImpl });
  } catch (error) {
    if (!(error instanceof WriterJsonError)) throw error;
    return { ops: [], blocked: [{ reason: "invalid_model", detail: error.message }], summary: { changes: 0, removals: 0, wordsDelta: 0, lossPct: 0, pages: model.template.pageBudget, unverified: 0 } };
  }
  if (!Array.isArray(response.ops)) {
    return { ops: [], blocked: [{ reason: "invalid_model", detail: "editor response needs an ops array" }], summary: { changes: 0, removals: 0, wordsDelta: 0, lossPct: 0, pages: model.template.pageBudget, unverified: 0 } };
  }
  const trusted = trustedFacts(ledger, model, baseNodes, jdExtract, profile);
  const ops = [];
  const blocked = [];
  const seen = new Set();
  let candidate = model;
  let removedWords = 0;
  for (const proposed of response.ops) {
    const op = proposed && typeof proposed === "object" && !Array.isArray(proposed) ? { ...proposed } : proposed;
    const id = op?.op === "insert" ? op.after : op?.node;
    const candidateNodes = deriveNodes(candidate);
    const before = candidateNodes.find((node) => node.id === id)?.text || "";
    const baseBefore = baseNodes.find((node) => node.id === id)?.text || "";
    try {
      if (seen.has(op?.opId)) throw new MaterialsEditError("invalid_model", "duplicate edit opId");
      const next = applyOps(candidate, [op], { scope });
      const nextNodes = deriveNodes(next);
      const writtenText = op.op === "insert"
        ? nextNodes.find((node) => !candidateNodes.some((prior) => prior.id === node.id))?.text || ""
        : nextNodes.find((node) => node.id === id)?.text || "";
      const facts = unverifiedFacts(op, baseBefore, trusted, ledger, writtenText);
      if (facts.length) {
        op.flags = [...new Set([...(op.flags || []), "unverified"])];
        op.facts = [...new Set([...(op.facts || []), ...facts])];
      }
      // Revalidate metadata added by the facts check against C0's schema.
      candidate = applyOps(candidate, [op], { scope });
      if (op.op === "remove") removedWords += words(before).length;
      else if (op.op === "replace") removedWords += Math.max(0, words(before).length - words(op.text).length);
      ops.push(op);
      seen.add(op.opId);
    } catch (error) {
      if (!(error instanceof MaterialsEditError)) throw error;
      blocked.push({ op: proposed, reason: error.reason, detail: error.detail });
    }
  }
  const baseWords = count(baseNodes);
  const wordsDelta = count(deriveNodes(candidate)) - baseWords;
  return { ops, blocked, summary: {
    changes: ops.length,
    removals: ops.filter((op) => op.op === "remove").length,
    wordsDelta,
    lossPct: baseWords ? Math.round(removedWords / baseWords * 100) : 0,
    pages: model.template.pageBudget,
    unverified: ops.filter((op) => op.flags?.includes("unverified")).length,
  } };
}
