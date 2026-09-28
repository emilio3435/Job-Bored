/**
 * Materials v3 — deterministic half of the `delint` stage.
 *
 * Finds banned phrases, canned taglines, resume-speak, AI cadence tells, and
 * verbatim job-description echo, and returns them as spans. Two reasons this
 * half is deterministic and runs first:
 *
 *   1. It is the gate. If it finds nothing, the anti-AI LLM call is skipped
 *      entirely — which is what happened on the 3E fixture run.
 *   2. When it does find something, the model is handed the spans and the
 *      voice pack with the posting deliberately withheld, so it cannot fix an
 *      echo by echoing (mechanism spec §6.4).
 *
 * This replaces `materials-critic.mjs`'s five-phrase regex and its
 * "3 tokens of length >= 5" relevance gate.
 *
 * Spec: docs/superpowers/specs/2026-09-17-materials-v3-mechanism-design.md
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callJsonStage } from "./materials-writer.mjs";
import {
  abstractionDensity,
  detectAiWords,
  detectContrastFrames,
  detectCannedAsides,
  detectGush,
  detectOffVoice,
  detectPurposeOpeners,
  letterParagraphs,
  maskSignatures,
  voiceTells,
} from "./materials-voice-tells.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_PACK_PATH = join(__dirname, "materials-voice.json");

/**
 * @typedef {object} VoiceRule
 * @property {string} pattern
 * @property {"fail" | "review"} [severity]
 * @property {string} [note]
 * @property {boolean} [regex] the pattern is a regular expression
 *   (inflections, variants), not a literal phrase
 */

/**
 * @typedef {object} VoiceCadence
 * @property {number} [adjectiveStackMin]
 * @property {number} [parallelBulletRun]
 * @property {number} [letterEmDashMax]
 * @property {number} [letterSentenceWordsMax]
 * @property {string} [titleStackPattern]
 */

/**
 * @typedef {object} VoicePack
 * @property {string} [version]
 * @property {VoiceRule[]} [banned]
 * @property {VoiceRule[]} [taglines]
 * @property {VoiceRule[]} [resumeSpeak]
 * @property {VoiceCadence} [cadence]
 * @property {{ windowWords?: number }} [jdEcho]
 * @property {Array<{ pattern: string, note?: string }>} [aiTells] additive AI-word rules (regex)
 * @property {{ paragraphEmDashMax?: number, abstractionMax?: number, rhythmCvMin?: number, shortSentenceMax?: number }} [humanVoice]
 * @property {Record<string, unknown>} [guide]
 * @property {string[]} [signatureLines] the user's own lines (voice.md), exempt when quoted exactly
 * @property {string[]} [signatureTellLines] signature/philosophy lines the mid-evidence tell watches
 */

/**
 * @typedef {object} DelintSpan
 * @property {string} code
 * @property {"fail" | "review"} severity
 * @property {string} field
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {string} [note]
 */

/**
 * @typedef {object} DelintResult
 * @property {boolean} clean
 * @property {DelintSpan[]} spans
 * @property {boolean} llmRewriteNeeded
 * @property {Record<string, number>} counts
 */

/** @type {VoicePack | null} */
let cachedPack = null;

/**
 * @param {string} [path]
 * @returns {Promise<VoicePack>}
 */
export async function loadVoicePack(path) {
  if (!path && cachedPack) return cachedPack;
  const raw = await readFile(path || VOICE_PACK_PATH, "utf8");
  const parsed = /** @type {VoicePack} */ (JSON.parse(raw));
  if (!path) cachedPack = parsed;
  return parsed;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {VoiceRule} rule
 * @returns {"fail" | "review"}
 */
function severityOf(rule) {
  return rule.severity === "review" ? "review" : "fail";
}

/**
 * @param {string} field
 * @param {string} text
 * @param {VoiceRule[]} rules
 * @param {string} code
 * @returns {DelintSpan[]}
 */
function scanRules(field, text, rules, code) {
  /** @type {DelintSpan[]} */
  const spans = [];
  for (const rule of rules) {
    /* A rule marked `regex` carries a pattern (inflections, variants);
     * every other rule is a literal phrase. */
    let re;
    try {
      re = rule.regex ? new RegExp(rule.pattern, "gi") : new RegExp(escapeRegExp(rule.pattern), "gi");
    } catch {
      continue;
    }
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      spans.push({
        code,
        severity: severityOf(rule),
        field,
        start,
        end: start + match[0].length,
        text: match[0],
        ...(rule.note ? { note: rule.note } : {}),
      });
    }
  }
  return spans;
}

/**
 * Three or more comma-separated adjectives in a row ("proactive,
 * collaborative, adaptable") is the most reliable LLM tell in this corpus.
 *
 * @param {string} field
 * @param {string} text
 * @param {number} minRun
 * @returns {DelintSpan[]}
 */
function scanAdjectiveStacks(field, text, minRun) {
  /** @type {DelintSpan[]} */
  const spans = [];
  const re = /\b([a-z]+(?:ive|ful|ous|able|ible|ic|al|ent|ant|ing))\b(,\s+\b[a-z]+(?:ive|ful|ous|able|ible|ic|al|ent|ant|ing)\b){1,}(,?\s+and\s+\b[a-z]+(?:ive|ful|ous|able|ible|ic|al|ent|ant|ing)\b)?/gi;
  for (const match of text.matchAll(re)) {
    const parts = match[0].split(/,|\band\b/).filter((part) => part.trim().length > 0);
    if (parts.length < minRun) continue;
    const start = match.index ?? 0;
    spans.push({
      code: "adjective_stack",
      severity: "review",
      field,
      start,
      end: start + match[0].length,
      text: match[0],
      note: `${parts.length} stacked adjectives`,
    });
  }
  return spans;
}

/**
 * @param {string[]} bullets
 * @param {number} run
 * @returns {DelintSpan[]}
 */
function scanParallelBullets(bullets, run) {
  /** @type {DelintSpan[]} */
  const spans = [];
  /**
   * @param {string} text
   * @returns {string}
   */
  const skeleton = (text) => {
    const words = text.trim().split(/\s+/);
    const first = (words[0] || "").toLowerCase().replace(/[^a-z]/g, "");
    const ending = first.endsWith("ed") ? "ed" : first.endsWith("ing") ? "ing" : "other";
    return `${ending}:${Math.min(words.length, 40) > 18 ? "long" : "short"}`;
  };

  let streak = 1;
  for (let i = 1; i < bullets.length; i += 1) {
    if (skeleton(bullets[i]) === skeleton(bullets[i - 1])) {
      streak += 1;
    } else {
      streak = 1;
    }
    if (streak >= run) {
      spans.push({
        code: "parallel_bullets",
        severity: "review",
        field: `bullets[${i - run + 1}..${i}]`,
        start: 0,
        end: 0,
        text: bullets[i],
        note: `${streak} consecutive bullets share a grammar skeleton`,
      });
      streak = 1;
    }
  }
  return spans;
}

/**
 * @param {string} field
 * @param {string} text
 * @param {string} jdText
 * @param {number} windowWords
 * @returns {DelintSpan[]}
 */
function scanJdEcho(field, text, jdText, windowWords) {
  const jdWords = jdText.trim().split(/\s+/).filter(Boolean);
  if (jdWords.length < windowWords) return [];
  const haystack = text.toLowerCase();
  for (let i = 0; i <= jdWords.length - windowWords; i += 1) {
    const window = jdWords.slice(i, i + windowWords).join(" ").toLowerCase();
    const at = haystack.indexOf(window);
    if (at >= 0) {
      return [
        {
          code: "jd_echo",
          severity: "fail",
          field,
          start: at,
          end: at + window.length,
          text: window,
          note: `${windowWords}-word verbatim window from the posting`,
        },
      ];
    }
  }
  return [];
}

/**
 * @param {object} input
 * @param {Record<string, string>} [input.fields] Named prose fields (statement, p1..p4, bullets as bullet:<claimId>).
 * @param {Record<string, string>} [input.voiceFields] Additional prose fields used only for verbatim voice-copy advisories.
 * @param {string[]} [input.bullets] Resume bullets in rendered order, for the parallel-skeleton check.
 * @param {string} [input.letterText] Concatenated letter body, for em-dash density.
 * @param {string} [input.jdText] Posting text, for verbatim echo. Withheld from the LLM half on purpose.
 * @param {string[]} [input.echoBans] Extra per-posting phrases from jd-extract.
 * @param {string[]} [input.voiceReferences] Voice.md sample and example lines, used only for copy advisories.
 * @param {Record<string, unknown> | null} [input.letter] The draft's letter beats, for the whole-letter "sounds human" tells.
 * @param {string} [input.company] The hiring company (its name never anchors an abstraction).
 * @param {VoicePack} input.pack
 * @returns {DelintResult}
 */
export function delint({ fields = {}, voiceFields = {}, bullets = [], letterText = "", jdText = "", echoBans = [], voiceReferences = [], letter = null, company = "", pack }) {
  const cadence = pack.cadence || {};
  /** @type {DelintSpan[]} */
  const spans = [];

  const bannedRules = [
    ...(pack.banned || []),
    ...(pack.taglines || []),
    ...echoBans.map((pattern) => ({ pattern, severity: /** @type {"fail"} */ ("fail"), note: "posting echo ban" })),
  ];

  for (const [field, text] of Object.entries(fields)) {
    if (typeof text !== "string" || !text) continue;
    spans.push(...scanVerbatimVoice(field, text, voiceReferences));
    const isResume = field === "statement" || field.startsWith("bullet");
    /* A literal phrase and its regex variant can hit the same span. */
    const seenSpans = new Set();
    spans.push(
      ...scanRules(field, text, bannedRules, "banned_filler").filter((span) => {
        const key = `${span.start}:${span.end}`;
        if (seenSpans.has(key)) return false;
        seenSpans.add(key);
        return true;
      }),
    );
    if (isResume) {
      spans.push(...scanRules(field, text, pack.resumeSpeak || [], "resume_speak"));
    }
    spans.push(...scanAdjectiveStacks(field, text, cadence.adjectiveStackMin || 3));
    if (field.startsWith("letter.") || field === "statement") {
      spans.push(...scanMachineWords(field, maskSignatures(text, pack.signatureLines || []), pack.aiTells || []));
    }
    if (jdText) {
      spans.push(...scanJdEcho(field, text, jdText, pack.jdEcho?.windowWords || 8));
    }
  }

  for (const [field, text] of Object.entries(voiceFields)) {
    if (typeof text !== "string" || !text || fields[field] === text) continue;
    spans.push(...scanVerbatimVoice(field, text, voiceReferences));
  }

  if (cadence.titleStackPattern && typeof fields.statement === "string") {
    const re = new RegExp(cadence.titleStackPattern, "i");
    const match = re.exec(fields.statement);
    if (match) {
      spans.push({
        code: "title_stack",
        severity: "fail",
        field: "statement",
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        note: "title stacking plus a years-of-experience count",
      });
    }
  }

  if (bullets.length) {
    spans.push(...scanParallelBullets(bullets, cadence.parallelBulletRun || 3));
  }

  const emDashMax = cadence.letterEmDashMax;
  if (typeof emDashMax === "number" && letterText) {
    const count = (letterText.match(/—/g) || []).length;
    if (count > emDashMax) {
      spans.push({
        code: "em_dash_density",
        severity: "review",
        field: "letter",
        start: 0,
        end: 0,
        text: `${count} em-dashes`,
        note: `max ${emDashMax} in a letter`,
      });
    }
  }

  if (typeof fields.statement === "string" && fields.statement) {
    spans.push(...scanStatementChain(fields.statement, company));
  }
  if (letter && typeof letter === "object") {
    spans.push(...scanLetterVoice(letter, { company, jdText, pack }));
  }

  /** @type {Record<string, number>} */
  const counts = {};
  for (const span of spans) {
    counts[span.code] = (counts[span.code] || 0) + 1;
  }

  return {
    clean: spans.length === 0,
    spans,
    llmRewriteNeeded: spans.length > 0,
    counts,
  };
}

/**
 * Find copied runs of six or more words from voice.md in a prose field.
 * Punctuation and case do not break a match. These are review spans for
 * the independent judge; they never act as hard gates.
 * @param {string} field
 * @param {string} text
 * @param {string[]} references
 * @returns {DelintSpan[]}
 */
function scanVerbatimVoice(field, text, references) {
  /** @param {string} value */
  const tokens = (value) => [...String(value || "").matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    word: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const referenceTokens = [...new Map((Array.isArray(references) ? references : [])
    .filter((reference) => typeof reference === "string")
    .map((reference) => {
      const words = tokens(reference).map((token) => token.word);
      return [words.join(" "), words];
    }))
    .values()]
    .filter((words) => words.length >= 6);
  const referenceWindows = new Map();
  for (const words of referenceTokens) {
    for (let offset = 0; offset + 6 <= words.length; offset += 1) {
      const key = words.slice(offset, offset + 6).join("\u001f");
      const candidates = referenceWindows.get(key) || [];
      candidates.push({ words, offset });
      referenceWindows.set(key, candidates);
    }
  }
  const bodyTokens = tokens(text);
  /** @type {DelintSpan[]} */
  const spans = [];
  for (let i = 0; i + 6 <= bodyTokens.length;) {
    let best = 0;
    const key = bodyTokens.slice(i, i + 6).map((token) => token.word).join("\u001f");
    for (const { words, offset } of referenceWindows.get(key) || []) {
      let length = 6;
      while (i + length < bodyTokens.length && offset + length < words.length && words[offset + length] === bodyTokens[i + length].word) length += 1;
      if (length > best) best = length;
    }
    if (!best) {
      i += 1;
      continue;
    }
    const start = bodyTokens[i].start;
    const end = bodyTokens[i + best - 1].end;
    spans.push({
      code: "verbatim_voice",
      severity: "review",
      field,
      start,
      end,
      text: text.slice(start, end),
      note: "6+ word run copied from voice.md; advisory only",
    });
    i += best;
  }
  return spans;
}

/**
 * Word-level machine tells in one letter or summary field: AI words,
 * gush, and "not X, but Y" framing. Each fails.
 * @param {string} field
 * @param {string} text
 * @param {Array<{ pattern: string, note?: string }>} extra
 * @returns {DelintSpan[]}
 */
function scanMachineWords(field, text, extra) {
  /** @type {DelintSpan[]} */
  const spans = [];
  const push = (/** @type {string} */ code, /** @type {{ start: number, end: number, text: string, note: string }} */ hit) =>
    spans.push({ code, severity: "fail", field, start: hit.start, end: hit.end, text: hit.text, note: hit.note });
  for (const hit of detectAiWords(text, extra)) push("ai_word", hit);
  for (const hit of detectGush(text)) push("gush", hit);
  for (const hit of detectContrastFrames(text)) push("contrast_frame", hit);
  for (const hit of detectOffVoice(text)) push(hit.code, hit);
  for (const hit of detectPurposeOpeners(text)) {
    const start = text.indexOf(hit.text);
    push("purpose_opener", { start, end: start + hit.text.length, text: hit.text, note: hit.note });
  }
  for (const hit of detectCannedAsides(text)) {
    const start = text.indexOf(hit.text);
    push("canned_aside", { start, end: start + hit.text.length, text: hit.text, note: hit.note });
  }
  return spans;
}

/**
 * The summary line is one sentence, not a buzzword chain: three or more
 * abstract nouns with nothing concrete nearby is a chain.
 * @param {string} statement
 * @param {string} company
 * @returns {DelintSpan[]}
 */
function scanStatementChain(statement, company) {
  const { unanchored } = abstractionDensity(statement, { company });
  if (unanchored.length < 3) return [];
  return [{
    code: "buzzword_chain",
    severity: "review",
    field: "statement",
    start: 0,
    end: 0,
    text: unanchored.join(", "),
    note: `${unanchored.length} abstract nouns with no number or concrete thing nearby; name the thing instead`,
  }];
}

/**
 * Whole-letter "sounds human" tells mapped back onto the beat fields the
 * rewrite can edit: the opener onto the hook, the closer onto the ask,
 * paragraph-local tells onto that paragraph's beats.
 * @param {Record<string, unknown>} letter
 * @param {{ company: string, jdText: string, pack: VoicePack }} context
 * @returns {DelintSpan[]}
 */
function scanLetterVoice(letter, { company, jdText, pack }) {
  const paragraphs = letterParagraphs(letter);
  if (!paragraphs.length) return [];
  const beatsByParagraph = paragraphBeats(letter);
  const human = pack.humanVoice || {};
  const { tells } = voiceTells(paragraphs, { company, postingText: jdText, ...human, signatureLines: pack.signatureLines || [], signatureTellLines: pack.signatureTellLines || [] });
  /** @type {DelintSpan[]} */
  const spans = [];
  for (const tell of tells) {
    /* Word-level tells are already spans from the per-field scan. */
    /* Word-level tells are already spans from the per-field scan; company
     * praise needs the company name, so it is mapped here. */
    if (["ai_word", "gush", "contrast_frame", "canned_aside", "purpose_opener", "false_humility", "compensation", "departure_framing"].includes(tell.code)) continue;
    if (tell.code === "flattery" && !/praises the company/.test(tell.note)) continue;
    let fieldsFor = typeof tell.paragraph === "number" ? beatsByParagraph[tell.paragraph] || [] : [];
    if (tell.code === "tricolon_stack" || tell.code === "abstraction_density" || tell.code === "uniform_rhythm") {
      /* Whole-letter measures: the paragraphs that carry the evidence. */
      const needles = tell.text.split(/\s*\|\s*|,\s*/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 4);
      fieldsFor = beatsByParagraph.flatMap((beats, i) =>
        needles.some((n) => paragraphs[i].toLowerCase().includes(n)) ? beats : [],
      );
      if (!fieldsFor.length) fieldsFor = beatsByParagraph.flat().filter((f) => /proof|analytics|aiOps/i.test(f));
    }
    for (const beat of fieldsFor.length ? fieldsFor : ["hook"]) {
      spans.push({
        code: tell.code,
        severity: tell.weight === "hard" ? "fail" : "review",
        field: `letter.${beat}`,
        start: 0,
        end: 0,
        text: tell.text,
        note: tell.note,
      });
    }
  }
  return spans;
}

/**
 * Which beats make up each rendered paragraph (mirrors letterParagraphs).
 * @param {Record<string, unknown>} letter
 * @returns {string[][]}
 */
function paragraphBeats(letter) {
  const has = (/** @type {string} */ k) => typeof letter[k] === "string" && String(letter[k]).trim().length > 0;
  if ("hook" in letter || "companyInsight" in letter || "proof1" in letter) {
    return [
      ["hook", "companyInsight"].filter(has),
      ["proof1", "proof2"].filter(has),
      ["ask"].filter(has),
    ].filter((beats) => beats.length);
  }
  return Object.keys(letter).filter(has).map((k) => [k]);
}

export const DELINT_REWRITE_MAX_OUTPUT_TOKENS = 1500;

const DELINT_REWRITE_SYSTEM_PROMPT = [
  "You rewrite resume and cover-letter fields to remove AI tells. Return JSON only:",
  "an object mapping each listed field name to its rewritten text.",
  "Keep every fact, number, name, date, tool, channel and product noun exactly. Match the voice samples when given.",
  "Change only what the fix note names; keep every other sentence as written. Keep each field about as long as it was (never more than a fifth shorter).",
  "Concrete nouns, no new claims: never add a scene, count, opinion or detail about the company or its users. Rewrite only the listed fields.",
  "Voice: one curious builder writing by hand. First person, active verbs, contractions welcome, one short sentence among longer ones.",
  "Never use: delve, tapestry, testament, leverage, robust, seamless, synergy, holistic, cutting-edge, passionate, thrilled, excited to, 'not X, but Y', 'rather than', three-item lists back to back, more than one em-dash per paragraph.",
  "Sentences that state what the writer did stay close to their original wording; whimsy belongs only in the opener, one aside and the closing offer.",
  "A hook opens on something specific about the company tied to something the writer did, never on what the company requires or needs.",
  "An ask ends on a concrete, slightly playful next step, never 'I would welcome the chance' or 'I look forward to'.",
].join(" ");

/**
 * Conditional LLM half of delint: rewrite only the flagged fields. The
 * posting is withheld on purpose — the prepass already checked echo, and
 * the rewrite must not pull new phrasing from it.
 * @param {object} input
 * @param {VoicePack} input.pack
 * @param {Record<string, string>} input.fields
 * @param {DelintSpan[]} input.spans
 * @param {string[]} [input.voice]
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @returns {Promise<{ fields: Record<string, string> }>}
 */
export async function rewriteFlagged({ fields, spans, voice = [], pin, fetchImpl }) {
  /* No pin, no rewrite — the prepass spans stand (the pipeline only calls
   * this half when a model is available). */
  if (!pin) return { fields: { ...fields } };
  const flagged = [...new Set(spans.map((s) => s.field).filter((f) => typeof fields[f] === "string"))];
  const lines = [];
  for (const field of flagged) {
    const notes = [...new Set(spans.filter((s) => s.field === field).map((s) => s.note || s.code))];
    lines.push(`## ${field} (fix: ${notes.join("; ")})`, fields[field].slice(0, 2000), "");
  }
  if (voice.length) {
    lines.push("Voice (match it, never quote it):", ...voice.slice(0, 3).map((v) => `- ${v.slice(0, 400)}`));
  }
  const rewritten = await callJsonStage({
    pin,
    systemPrompt: DELINT_REWRITE_SYSTEM_PROMPT,
    userText: lines.join("\n"),
    maxOutputTokens: DELINT_REWRITE_MAX_OUTPUT_TOKENS,
    fetchImpl,
  });
  const out = { ...fields };
  for (const field of flagged) {
    const text = rewritten[field];
    if (typeof text === "string" && text.trim()) out[field] = text.trim().slice(0, 2000);
  }
  return { fields: out };
}
