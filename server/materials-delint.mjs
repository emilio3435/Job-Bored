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

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_PACK_PATH = join(__dirname, "materials-voice.json");

/**
 * @typedef {object} VoiceRule
 * @property {string} pattern
 * @property {"fail" | "review"} [severity]
 * @property {string} [note]
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
    const re = new RegExp(escapeRegExp(rule.pattern), "gi");
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
 * @param {string[]} [input.bullets] Resume bullets in rendered order, for the parallel-skeleton check.
 * @param {string} [input.letterText] Concatenated letter body, for em-dash density.
 * @param {string} [input.jdText] Posting text, for verbatim echo. Withheld from the LLM half on purpose.
 * @param {string[]} [input.echoBans] Extra per-posting phrases from jd-extract.
 * @param {VoicePack} input.pack
 * @returns {DelintResult}
 */
export function delint({ fields = {}, bullets = [], letterText = "", jdText = "", echoBans = [], pack }) {
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
    const isResume = field === "statement" || field.startsWith("bullet");
    spans.push(...scanRules(field, text, bannedRules, "banned_filler"));
    if (isResume) {
      spans.push(...scanRules(field, text, pack.resumeSpeak || [], "resume_speak"));
    }
    spans.push(...scanAdjectiveStacks(field, text, cadence.adjectiveStackMin || 3));
    if (jdText) {
      spans.push(...scanJdEcho(field, text, jdText, pack.jdEcho?.windowWords || 8));
    }
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
