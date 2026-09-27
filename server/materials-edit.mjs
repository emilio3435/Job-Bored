/** A proposed edit batch is validated here; it never publishes a partial model. */
import { applyOps, deriveNodes, MaterialsEditError } from "./materials-nodes.mjs";
import { claimById } from "./materials-ledger.mjs";
import { callJsonStage, EDIT_SYSTEM_PROMPT, WriterJsonError } from "./materials-writer.mjs";

/** @param {unknown} text */
const words = (text) => String(text || "").trim().split(/\s+/).filter(Boolean);
/** @param {Array<{text:string}>} nodes */
const count = (nodes) => nodes.reduce((sum, node) => sum + words(node.text).length, 0);
const numericToken = /(?<![\p{L}\p{N}])(?:[$#]|top[-–])?\d(?:[\d,]*\d)?(?:\.\d+)?(?:[-–]\d(?:[\d,]*\d)?(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?(?![\p{L}\p{N}])/gu;
const wordToken = /[\p{L}][\p{L}\p{M}\d]*(?:[-'’][\p{L}\p{M}\d]+)*/gu;
const months = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);
const numberWords = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion"]);
const toolNames = new Set(["aws", "azure", "docker", "github", "kafka", "kubernetes", "linux", "postgres", "python", "salesforce", "sql", "tableau", "terraform"]);
const titleFunctionWords = new Set(["of", "for", "the"]);
const titleStopWords = new Set(["a", "an", "and", "as", "at", "by", "in", "into", "of", "on", "or", "the", "to", "with"]);
const roleWords = new Set(["administrator", "analyst", "architect", "associate", "assistant", "consultant", "coordinator", "designer", "developer", "director", "engineer", "lead", "manager", "officer", "specialist"]);
/** @param {string} token */
const normalizedToken = (token) => token.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[–‐‑]/g, "-").replace(/[.,;:!?]+$/g, "");
/** @param {string} token */
const numberWord = (token) => token.toLocaleLowerCase().split(/[-–]/).every((part) => numberWords.has(part));
/** @param {unknown} value */
function factTokens(value) {
  const text = String(value || "");
  const found = [...text.matchAll(numericToken)].map((match) => ({ token: match[0], index: match.index }));
  const wordMatches = [...text.matchAll(wordToken)];
  for (let i = 0; i < wordMatches.length; i += 1) {
    const match = wordMatches[i];
    const token = match[0];
    const lower = normalizedToken(token);
    if (numberWord(token)) {
      let end = i;
      while (end + 1 < wordMatches.length && numberWord(wordMatches[end + 1][0]) && /^\s+$/.test(text.slice(wordMatches[end].index + wordMatches[end][0].length, wordMatches[end + 1].index))) end += 1;
      found.push({ token: text.slice(match.index, wordMatches[end].index + wordMatches[end][0].length), index: match.index });
      i = end;
      continue;
    }
    if (months.has(lower) && (lower !== "may" || token === "May") || toolNames.has(lower)) {
      found.push({ token, index: match.index });
      continue;
    }
    const sentenceStart = !text.slice(0, match.index).trim() || /[.!?]\s*$/.test(text.slice(0, match.index));
    if (!sentenceStart && /^[\p{Lu}]/u.test(token)) found.push({ token, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index).map(({ token }) => token);
}
/** @param {string} text */
const normalizedPhrase = (text) => (text.toLocaleLowerCase().match(/[\p{L}\p{M}\d]+/gu) || []).filter((word) => !titleFunctionWords.has(word)).join(" ");
/** @param {string} text @param {Set<string>} titleWords */
function titlePhrases(text, titleWords) {
  const found = [];
  const matches = [...text.matchAll(wordToken)];
  for (let i = 0; i < matches.length - 1; i += 1) {
    const left = matches[i];
    let j = i + 1;
    if (titleFunctionWords.has(matches[j][0].toLocaleLowerCase())) j += 1;
    if (j >= matches.length) continue;
    const right = matches[j];
    if (!/^\s+$/.test(text.slice(left.index + left[0].length, matches[i + 1].index)) || !/^\s+$/.test(text.slice(matches[j - 1].index + matches[j - 1][0].length, right.index))) continue;
    const first = normalizedToken(left[0]);
    const second = normalizedToken(right[0]);
    if (titleStopWords.has(first) || titleStopWords.has(second)) continue;
    if (!roleWords.has(first) && !roleWords.has(second)) continue;
    const prior = matches[i - 1]?.[0].toLocaleLowerCase();
    const bothKnown = titleWords.has(first) && titleWords.has(second);
    const titleCased = /^[\p{Lu}]/u.test(left[0]) && /^[\p{Lu}]/u.test(right[0]);
    if (!bothKnown && !titleCased && prior !== "as" && prior !== "role" && prior !== "position") continue;
    found.push(text.slice(left.index, right.index + right[0].length));
  }
  return found;
}
/** @param {string} name @param {unknown} value */
const dataBlock = (name, value) => `<untrusted-data name="${name}">\n${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</untrusted-data>`;

/** @param {any} ledger @param {import('./materials-render.mjs').RenderModel} model @param {Array<{text:string}>} nodes */
function trustedFacts(ledger, model, nodes) {
  const claims = Array.isArray(ledger?.claims) ? ledger.claims : [];
  const employers = Array.isArray(ledger?.employers) ? ledger.employers : [];
  const tools = Array.isArray(ledger?.toolInventory) ? ledger.toolInventory : [];
  const entries = (model.documents?.resume?.sections || []).flatMap((section) => section.entries || []);
  const titles = [model.identity?.target, ...entries.map((entry) => Array.isArray(entry.seat) ? entry.seat.map((run) => run.t ?? run.n ?? run.hl ?? "").join("") : entry.seat), ...employers.map((/** @type {any} */ employer) => employer.title)].filter(Boolean).map(String);
  const sourceParts = [
    JSON.stringify(model.identity),
    ...nodes.map((node) => node.text),
    ...entries.flatMap((entry) => [entry.org, ...(entry.meta || [])]),
    ...claims.flatMap((/** @type {any} */ claim) => [claim.text, ...(claim.metrics || []).map((/** @type {any} */ metric) => metric.token), ...(claim.tools || [])]),
    ...employers.flatMap((/** @type {any} */ employer) => [employer.name, employer.title, employer.start, employer.end, employer.location]),
    ...tools.map((/** @type {any} */ tool) => tool.tool),
  ].filter(Boolean).map(String);
  const tokens = new Set(factTokens(sourceParts.join(" ")).map(normalizedToken));
  for (const token of [...tokens]) {
    const range = token.match(/^(\d[\d,.]*)-(\d[\d,.]*)(%|x|[kmb]\+?|\+)?$/);
    if (range) { tokens.add(range[1]); tokens.add(range[2] + (range[3] || "")); }
  }
  return {
    tokens,
    phrases: sourceParts.map(normalizedPhrase),
    titleWords: new Set(titles.flatMap((title) => normalizedPhrase(title).split(" "))),
  };
}

/** Newly introduced fact-like tokens absent from the candidate source facts.
 * @param {any} op @param {string} beforeText @param {ReturnType<typeof trustedFacts>} trusted @param {any} ledger @param {string} writtenText
 */
function unverifiedFacts(op, beforeText, trusted, ledger, writtenText) {
  if (op.op === "remove") return [];
  const prior = new Set(factTokens(beforeText).map(normalizedToken));
  const candidates = factTokens(writtenText).filter((token) => !prior.has(normalizedToken(token)));
  const missing = candidates.filter((token) => !trusted.tokens.has(normalizedToken(token)));
  for (const phrase of titlePhrases(writtenText, trusted.titleWords)) {
    const normalized = normalizedPhrase(phrase);
    if (!trusted.phrases.some((source) => (` ${source} `).includes(` ${normalized} `))) missing.push(phrase);
  }
  if (op.op === "insert" && !claimById(ledger, op.claimId)) missing.push(`claimId:${op.claimId}`);
  return [...new Set(missing)];
}

/**
 * @param {{model:import('./materials-render.mjs').RenderModel, nodes?:Array<{id:string,text:string}>, instruction:string, scope?:'all'|string[], lockFacts?:boolean, jdExtract?:object, ledger?:any, pin:import('./materials-writer.mjs').WriterPin, fetchImpl:import('./materials-writer.mjs').WriterInput['fetchImpl']}} input
 */
export async function proposeEdits({ model, nodes, instruction, scope = "all", lockFacts = true, jdExtract = {}, ledger = {}, pin, fetchImpl }) {
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
  const trusted = trustedFacts(ledger, model, baseNodes);
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
