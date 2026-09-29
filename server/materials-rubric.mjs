/** Deterministic materials gates and advisory evidence for the independent judge. */
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { validateDraft } from "./materials-draft.mjs";
import { TOOL_LEXICON } from "./materials-ledger-build.mjs";
import { toolPattern } from "./materials-tool-match.mjs";
import { criticHardChecks } from "./materials-critic.mjs";
import { countPdfPages } from "./materials-quality.mjs";
import { hashRenderedText, splitSentences as splitJudgeSentences } from "./materials-judge.mjs";
import { describeUpgrades, scopeUpgrades } from "./materials-scope.mjs";
import { voiceTells } from "./materials-voice-tells.mjs";

/** @typedef {{ id?: string, text?: string, metrics?: Array<{ token?: string }>, employerId?: string }} Claim */
/** @typedef {{ claims?: Claim[], employers?: Array<{ id?: string, name?: string }> }} Ledger */
/** @typedef {{ contract?: string, statement?: string, bullets?: Array<{ claimId?: string, text?: string }>, earlier?: Array<{ claimId?: string, text?: string }>, letter?: Record<string, string> }} Draft */
/** @typedef {Array<{ sentence?: string, claimIds?: string[] }>} SourceRefs */
/** @typedef {{ id: string, kind: "hard" | "advisory" | "constraint", pass: boolean, reason: string, sentenceIds: string[] }} Gate */
/** @typedef {{ id: string, kind: string, sentenceIds: string[], detail: string }} Advisory */

/** The old outreach path still needs plain sentence chunks until B1 lands. */
export function splitSentences(/** @type {string} */ text) {
  return String(text || "").split(/(?<=[.!?])\s+(?=[A-Z0-9“"$])/).map((part) => part.trim()).filter(Boolean);
}

/** Letter draft slots in their stored order. */
export function letterBeats(/** @type {{ letter?: Record<string, unknown> }} */ draft) {
  return Object.entries(draft?.letter || {}).filter((entry) => typeof entry[1] === "string" && entry[1].trim());
}

/** A page-fit measurement; it is a constraint, never a factual gate. */
export function resumeFill(/** @type {{ measurement?: { lastTextBottom?: number, limit?: number } | null } | null | undefined} */ fit, /** @type {string} */ txt) {
  const measured = fit?.measurement;
  if (measured && typeof measured.lastTextBottom === "number" && typeof measured.limit === "number" && measured.limit > 0) {
    return { ratio: Math.min(1, measured.lastTextBottom / measured.limit), basis: "measured" };
  }
  const words = String(txt || "").split(/\s+/).filter(Boolean).length;
  const full = MATERIALS_BUDGETS.resume.visibleWords[0];
  return { ratio: Math.min(1, words / full), basis: `${words} words of ${full} estimated` };
}

/**
 * @param {object} input
 * @param {"letter" | "resume"} input.document
 * @param {string} input.finalText exact delivered body
 * @param {Draft} [input.draft]
 * @param {Ledger} [input.ledger]
 * @param {string | { text?: string }} [input.posting]
 * @param {SourceRefs} [input.sourceRefs]
 * @param {{ html?: string, pdf?: Buffer | Uint8Array | string, renderedText?: string, schemaValid?: boolean }} [input.artifacts]
 * @param {{ expectedEmployers?: string[], renderedEmployers?: string[], identity?: { expected?: Record<string, unknown>, actual?: Record<string, unknown> }, history?: { expected?: Array<Record<string, unknown>>, actual?: Array<Record<string, unknown>> } }} [input.protected]
 * @param {string} [input.textHash]
 * @returns {Gate[]}
 */
export function runHardGates({ document, finalText, draft = {}, ledger = {}, posting = "", sourceRefs = [], artifacts = {}, protected: protectedFacts = {}, textHash }) {
  const body = String(finalText || "");
  const claimTexts = (ledger.claims || []).map((claim) => String(claim.text || ""));
  const named = TOOL_LEXICON.filter((tool) => toolPattern(tool).test(body));
  const unsupported = named.filter((tool) => !claimTexts.some((claim) => toolPattern(tool).test(claim)));
  /** @param {string} id @param {boolean} pass @param {string} reason @returns {Gate} */
  const gate = (id, pass, reason) => ({ id, kind: "hard", pass, reason, sentenceIds: [] });
  const html = artifacts.html || "";
  const critic = criticHardChecks({ document, draft, ledger, sourceRefs, protected: protectedFacts, posting, finalText: body, html });
  const unsafeHtml = /<script\b|\bon[a-z]+\s*=|javascript:/i.test(html);
  const pdf = artifacts.pdf;
  const pdfText = pdf ? Buffer.from(pdf).toString("latin1") : "";
  const pdfValid = !pdf || (pdfText.startsWith("%PDF-") && countPdfPages(pdf) > 0);
  const parity = (artifacts.renderedText === undefined || artifacts.renderedText === body)
    && (textHash === undefined || textHash === hashRenderedText(body));
  const schemaValid = artifacts.schemaValid !== false && validateDraft(draft).ok;
  return [
    gate("schema", schemaValid, "Draft schema must validate."),
    ...critic.map((item) => gate(item.id, item.pass, item.reason)),
    gate("tool_support", unsupported.length === 0, unsupported.length ? `No ledger claim supports: ${unsupported.join(", ")}.` : "Every named tool appears in a ledger claim."),
    gate("artifact_usable", body.trim().length > 0, "The rendered body must contain usable text."),
    gate("safe_render", !unsafeHtml, "Rendered HTML must not contain scripts, event handlers or script URLs."),
    gate("usable_pdf", pdfValid, "PDF must have a valid header and at least one page."),
    gate("text_parity", parity, "The judged body and rendered body must match."),
  ];
}

/**
 * @param {object} input
 * @param {"letter" | "resume"} input.document
 * @param {string} input.finalText
 * @param {Ledger} [input.ledger]
 * @param {Draft} [input.draft]
 * @param {string | { text?: string }} [input.posting]
 * @param {string[]} [input.postingNouns] nouns from the posting extractor
 * @param {string[]} [input.selectedClaims] selected claim ids, when the draft has no claim ids
 * @param {{ ratio: number } | null} [input.fill]
 * @returns {Advisory[]}
 */
export function advisoryEvidence({ document, finalText, ledger = {}, draft = {}, posting = "", postingNouns = [], selectedClaims = [], fill = null }) {
  const body = String(finalText || "");
  const postingText = typeof posting === "string" ? posting : String(posting?.text || "");
  const sentences = splitJudgeSentences(body, document);
  const claimTexts = (ledger.claims || []).map((claim) => String(claim.text || ""));
  /** @type {Advisory[]} */
  const out = [];
  for (const sentence of sentences) {
    const upgrades = scopeUpgrades(sentence.text, claimTexts);
    if (upgrades.length) out.push({ id: `scope:${sentence.id}`, kind: "scope", sentenceIds: [sentence.id], detail: describeUpgrades(upgrades) });
  }
  const words = (/** @type {string} */ value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  const postingWords = new Set(words(postingText));
  const bodyWords = new Set(words(body));
  if (postingWords.size) {
    const hits = [...postingWords].filter((word) => bodyWords.has(word)).length;
    out.push({ id: "posting_overlap", kind: "posting_overlap", sentenceIds: [], detail: `${hits}/${postingWords.size} posting terms appear in the document` });
  }
  const nouns = [...new Set(postingNouns.map((term) => String(term || "").toLowerCase()).filter(Boolean))];
  if (nouns.length) {
    const hits = nouns.filter((noun) => body.toLowerCase().includes(noun)).length;
    out.push({ id: "noun_count", kind: "noun_count", sentenceIds: [], detail: `${hits}/${nouns.length} posting nouns appear in the document` });
  }
  const ids = new Set([...selectedClaims, ...(draft.bullets || []).map((slot) => slot.claimId), ...(draft.earlier || []).map((slot) => slot.claimId)].filter(Boolean));
  const selected = (ledger.claims || []).filter((claim) => claim.id && ids.has(claim.id));
  const expectedMetrics = new Set(selected.flatMap((claim) => (claim.metrics || []).map((metric) => metric.token).filter((token) => typeof token === "string" && token.length > 0)));
  for (const token of expectedMetrics) {
    if (typeof token !== "string") continue;
    if (!body.includes(token)) out.push({ id: `metric:${out.length + 1}`, kind: "omitted_metric", sentenceIds: [], detail: `Selected metric ${token} is absent from the rendered text.` });
  }
  const employerNames = new Map((ledger.employers || []).map((employer) => [employer.id, employer.name]));
  const expectedEmployers = new Set(selected.map((claim) => employerNames.get(claim.employerId)).filter((name) => typeof name === "string" && name.length > 0));
  for (const name of expectedEmployers) {
    if (typeof name !== "string") continue;
    if (!body.toLowerCase().includes(name.toLowerCase())) out.push({ id: `employer:${out.length + 1}`, kind: "omitted_employer", sentenceIds: [], detail: `Selected employer ${name} is absent from the rendered text.` });
  }
  const fourgrams = body.toLowerCase().split(/\s+/).filter(Boolean);
  const repeated = new Map();
  for (let index = 0; index <= fourgrams.length - 4; index += 1) {
    const phrase = fourgrams.slice(index, index + 4).join(" ");
    repeated.set(phrase, (repeated.get(phrase) || 0) + 1);
  }
  for (const [phrase, count] of repeated) if (count > 1) out.push({ id: `repeat:${out.length + 1}`, kind: "repeated_phrase", sentenceIds: [], detail: `${phrase} (${count} times)` });
  if (document === "letter") {
    for (const tell of voiceTells(body.split(/\n\s*\n/).filter(Boolean), { postingText }).tells) {
      out.push({ id: `voice:${out.length + 1}`, kind: "voice_tell", sentenceIds: [], detail: tell.note });
    }
  }
  if (fill && fill.ratio < 0.6) out.push({ id: "underfill", kind: "underfill", sentenceIds: [], detail: `Page fill ${Math.round(fill.ratio * 100)}%.` });
  return out;
}
