/** A proposed edit batch is validated here; it never publishes a partial model. */
import { applyOps, deriveNodes, MaterialsEditError } from "./materials-nodes.mjs";
import { claimById } from "./materials-ledger.mjs";
import { callJsonStage, EDIT_SYSTEM_PROMPT, WriterJsonError } from "./materials-writer.mjs";

/** @param {unknown} text */
const words = (text) => String(text || "").trim().split(/\s+/).filter(Boolean);
/** @param {Array<{text:string}>} nodes */
const count = (nodes) => nodes.reduce((sum, node) => sum + words(node.text).length, 0);
/** @param {unknown} text */
const factTokens = (text) => String(text || "").match(/(?:[$#]|top-)?\d[\d,.]*(?:[–-]\d[\d,.]*)?(?:%|x\b|[kKmMbB]\+?|\+)?|[\p{L}][\p{L}\p{M}\d]*(?:[-'][\p{L}\p{M}\d]+)*/gu) || [];
const ordinaryWords = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "i", "in", "into", "is", "it", "my", "of", "on", "or", "our", "the", "their", "this", "to", "was", "we", "were", "who", "with", "you", "your"]);
/** @param {string} text */
const normalizedPhrase = (text) => (text.toLocaleLowerCase().match(/[\p{L}\p{M}\d]+/gu) || []).join(" ");
/** @param {string} text */
const titlePhrases = (text) => text.match(/\b[A-Z][\p{L}\p{M}\d]*(?:\s+[A-Z][\p{L}\p{M}\d]*)+\b/gu) || [];
/** @param {string} name @param {unknown} value */
const dataBlock = (name, value) => `<untrusted-data name="${name}">\n${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</untrusted-data>`;

/** @param {any} ledger @param {import('./materials-render.mjs').RenderModel} model @param {Array<{text:string}>} nodes */
function trustedFacts(ledger, model, nodes) {
  const claims = Array.isArray(ledger?.claims) ? ledger.claims : [];
  const employers = Array.isArray(ledger?.employers) ? ledger.employers : [];
  const tools = Array.isArray(ledger?.toolInventory) ? ledger.toolInventory : [];
  const entries = (model.documents?.resume?.sections || []).flatMap((section) => section.entries || []);
  const sourceParts = [
    JSON.stringify(model.identity),
    ...nodes.map((node) => node.text),
    ...entries.flatMap((entry) => [entry.org, ...(entry.meta || [])]),
    ...claims.flatMap((/** @type {any} */ claim) => [claim.text, ...(claim.metrics || []).map((/** @type {any} */ metric) => metric.token), ...(claim.tools || [])]),
    ...employers.flatMap((/** @type {any} */ employer) => [employer.name, employer.title, employer.start, employer.end, employer.location]),
    ...tools.map((/** @type {any} */ tool) => tool.tool),
  ].filter(Boolean).map(String);
  return {
    tokens: new Set(factTokens(sourceParts.join(" ")).map((token) => token.toLocaleLowerCase())),
    phrases: sourceParts.map(normalizedPhrase),
  };
}

/** Newly introduced fact-like tokens absent from the candidate source facts.
 * @param {any} op @param {string} beforeText @param {ReturnType<typeof trustedFacts>} trusted @param {any} ledger @param {string} writtenText
 */
function unverifiedFacts(op, beforeText, trusted, ledger, writtenText) {
  if (op.op === "remove") return [];
  const prior = new Set(factTokens(beforeText).map((token) => token.toLocaleLowerCase()));
  const candidates = factTokens(writtenText).filter((token) => !prior.has(token.toLocaleLowerCase()) && !ordinaryWords.has(token.toLocaleLowerCase()));
  const missing = candidates.filter((token) => !trusted.tokens.has(token.toLocaleLowerCase()));
  for (const phrase of titlePhrases(writtenText)) {
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
