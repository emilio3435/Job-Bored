/**
 * Materials — meaning-level support check for the letter (voice v5).
 *
 * The overlap grounding in materials-rubric passes a sentence whose words
 * all appear in some claim even when it says something no claim says
 * ("built and upskilled regional activation squads"). This stage is one
 * cheap model call: every letter sentence, numbered, judged against the
 * claims, the user's approved voice facts and the posting. Each verdict
 * says whether the sentence states a fact, whether every factual element
 * is supported, which source supports it, and why not when it is not.
 *
 * No pin, a failed call or an unreadable reply returns `null`: the rubric
 * then falls back to the deterministic overlap check alone.
 */

import { enforceIntelCitations } from "./materials-intel.mjs";
import { letterBeats, splitSentences } from "./materials-rubric.mjs";
import { runJsonStage } from "./materials-writer.mjs";

export const SUPPORT_MAX_OUTPUT_TOKENS = 2048;

export const SUPPORT_SYSTEM_PROMPT = [
  "You check a cover letter's facts. Return JSON only: {\"verdicts\":[{\"i\":1,\"factual\":true,\"supported\":true,\"source\":\"claim id, voice-N or posting\",\"reason\":\"\"}]}.",
  "One verdict per numbered sentence, same numbers.",
  "factual: the sentence asserts something about the candidate's work, results, clients, tools, history or skills, or about the company. A comparative or evaluative claim about the company ('better than anyone', 'leads the market') is factual and is supported only when the posting states it. An offer, a question or a reaction with no such assertion is not factual.",
  "supported: every factual element (each action, result, number, client, tool, scope and causal link) is stated by one listed claim, voice fact or the posting. Rewording is fine; adding a scope, outcome, cause or activity the sources do not state is not.",
  "When unsupported, reason names the invented part in a few words, and source names the claim id closest to what the sentence should say.",
  "Judge strictly: 'built tools that tie directly to revenue pipeline' is unsupported unless a source ties them to pipeline.",
  "Scope is a fact: a sentence that upgrades the scope, scale, seniority, team size or technical depth of what its source says is unsupported. Examples: 'enterprise accounts' when the source says 'strategic Austin accounts'; 'engineering production forecasting models' when the source says 'shipped a forecast tool on Gemini'; 'seller development' when the source says coaching AE desks. Words like enterprise, global, production, engineering, models, executive, a team or headcount count only when the cited source uses them for the same thing.",
].join(" ");

/* Wave 3: added only when the run carries a company intel pack. */
export const SUPPORT_INTEL_RULE = "A sentence about the company may also rest on one listed company intel fact (intel-N): it is supported only when it restates that fact, and source must name that intel id exactly. Intel facts never support a claim about the candidate.";

/**
 * @typedef {object} SupportVerdict
 * @property {string} beat
 * @property {string} sentence
 * @property {boolean} factual
 * @property {boolean | null} supported
 * @property {string} reason
 * @property {string} [source]
 * @property {{ id: string, url: string, date: string }} [intel] the cited intel fact (Wave 3)
 */

/**
 * The numbered sentences and the sources, as the model sees them.
 * Exported so tests can snapshot the prompt.
 * @param {object} input
 * @param {{ letter?: Record<string, unknown> }} input.draft
 * @param {{ claims?: Array<{ id?: unknown, text?: unknown }> }} input.ledger claims plus voice facts
 * @param {string} [input.postingText]
 * @param {string} [input.company] the company the letter is addressed to
 * @param {string} [input.title] the role applied for
 * @param {import("./materials-intel.mjs").IntelFact[]} [input.intel] the company intel pack's citeable facts (Wave 3)
 * @param {Array<{ beat: string, text: string }>} [input.extra] more text to judge in the same call
 *   (Wave 3: the outreach note, beats "outreach.linkedin" / "outreach.email")
 * @returns {{ userText: string, sentences: Array<{ beat: string, sentence: string }> }}
 */
export function supportPrompt({ draft, ledger, postingText = "", company = "", title = "", intel = [], extra = [] }) {
  /** @type {Array<{ beat: string, sentence: string }>} */
  const sentences = [];
  for (const [beat, text] of letterBeats(draft)) {
    for (const sentence of splitSentences(text)) sentences.push({ beat, sentence });
  }
  for (const { beat, text } of extra) {
    for (const sentence of splitSentences(text)) sentences.push({ beat, sentence });
  }
  const claims = (ledger.claims || [])
    .filter((c) => c && typeof c.id === "string" && typeof c.text === "string")
    .map((c) => `- ${String(c.id)}: ${String(c.text).slice(0, 400)}`);
  const employers = (/** @type {{ employers?: Array<{ name?: unknown, title?: unknown, start?: unknown, end?: unknown }> }} */ (ledger).employers || [])
    .filter((e) => e && typeof e.name === "string")
    .map((e) => `- employer: ${String(e.name)}${typeof e.title === "string" ? ` · ${e.title}` : ""}${e.start ? ` · ${String(e.start)}–${e.end ? String(e.end) : "present"}` : ""}`);
  const userText = [
    ...(company ? [`The letter is addressed to ${company}${title ? ` for the ${title} role` : ""}. Naming ${company}, the role, or what the candidate wants to do there is not a claim to check.`, ""] : []),
    "Sources (employers, claims and approved voice facts):",
    ...employers,
    ...claims.slice(0, 80),
    "",
    "Posting (the only other legal source, for facts about the company):",
    String(postingText || "").slice(0, 3500),
    "",
    ...(intel.length
      ? ["Company intel (researched, dated, sourced; cite its id):", ...intel.map((f) => `- ${f.id} (${f.date}): ${f.text}`), ""]
      : []),
    "Letter sentences:",
    ...sentences.map((s, i) => `${i + 1}. ${s.sentence}`),
  ].join("\n");
  return { userText, sentences };
}

/**
 * @param {object} input
 * @param {{ letter?: Record<string, unknown> }} input.draft
 * @param {{ claims?: Array<{ id?: unknown, text?: unknown }> }} input.ledger claims plus voice facts
 * @param {string} [input.postingText]
 * @param {string} [input.company]
 * @param {string} [input.title]
 * @param {import("./materials-intel.mjs").IntelFact[]} [input.intel]
 * @param {Array<{ beat: string, text: string }>} [input.extra]
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @returns {Promise<{ verdicts: SupportVerdict[] | null, call?: import("./materials-writer.mjs").StageCallRecord }>}
 */
export async function checkLetterSupport({ draft, ledger, postingText = "", company = "", title = "", intel = [], extra = [], pin, fetchImpl }) {
  const { userText, sentences } = supportPrompt({ draft, ledger, postingText, company, title, intel, extra });
  if (!pin || !sentences.length) return { verdicts: null };
  const { value, call } = await runJsonStage({
    stage: "support",
    pin,
    systemPrompt: intel.length ? `${SUPPORT_SYSTEM_PROMPT} ${SUPPORT_INTEL_RULE}` : SUPPORT_SYSTEM_PROMPT,
    userText,
    maxOutputTokens: SUPPORT_MAX_OUTPUT_TOKENS,
    fetchImpl,
  });
  /* Wave 3: an intel citation is accepted only from this pack, in the
   * opening paragraph or the outreach note, restating the fact. */
  return { verdicts: enforceIntelCitations(parseVerdicts(value, sentences), intel, { company }), call };
}

/**
 * @param {unknown} value the model's JSON
 * @param {Array<{ beat: string, sentence: string }>} sentences
 * @returns {SupportVerdict[] | null}
 */
export function parseVerdicts(value, sentences) {
  const raw = value && typeof value === "object" ? /** @type {{ verdicts?: unknown }} */ (value).verdicts : null;
  if (!Array.isArray(raw)) return null;
  /** @type {SupportVerdict[]} */
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const v = /** @type {Record<string, unknown>} */ (entry);
    const i = typeof v.i === "number" ? v.i : Number(v.i);
    const target = Number.isInteger(i) ? sentences[i - 1] : undefined;
    if (!target) continue;
    out.push({
      beat: target.beat,
      sentence: target.sentence,
      factual: v.factual === true,
      supported: v.supported === true ? true : v.supported === false ? false : null,
      reason: typeof v.reason === "string" ? v.reason.slice(0, 240) : "",
      ...(typeof v.source === "string" && v.source ? { source: v.source.slice(0, 80) } : {}),
    });
  }
  return out.length ? out : null;
}
