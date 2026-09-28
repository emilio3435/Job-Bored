/**
 * Materials — the user's own voice guide (~/.jobbored/profile/voice.md).
 *
 * When present it is the source of truth for voice: it overrides the
 * shipped guide in materials-voice.json where they conflict. This module
 * parses the markdown into the parts the pipeline uses:
 *
 *   - guideText: the rule sections, quoted to the draft model verbatim;
 *   - facts: the factual statements from "Core narrative", "Preferred
 *     phrasing patterns" and "Voice samples" (plus any approved client
 *     list), ingested as approved claims with provenance source "voice",
 *     so grounding and metric tracing accept them;
 *   - signatureLines: the user's own quoted lines, exempt from the tell
 *     lint when a letter quotes them exactly (paraphrases are not);
 *   - avoid: "Phrases to avoid", merged into the tell list;
 *   - links: project name → URL from the hyperlink convention.
 *
 * Parsing is by section heading, so any user's voice.md with the same
 * headings works; unknown sections are ignored.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { numerals } from "./materials-metric-tag.mjs";

/**
 * @typedef {object} VoiceProfile
 * @property {string} path
 * @property {string} guideText
 * @property {string[]} facts
 * @property {string[]} signatureLines
 * @property {string[]} signatureTellLines the lines the signature-mid-
 *   evidence tell watches: the explicit "Signature lines" section, else the
 *   guide's quoted signature/philosophy lines; digit-free, 6+ words, never
 *   an approved fact (review defect 1)
 * @property {Array<{ pattern: string, note: string }>} avoid
 * @property {Array<{ text: string, href: string }>} links
 * @property {string[]} samples
 * @property {string[]} hookPatterns the user's lines marked as openers,
 *   signature or philosophy lines (not resume-voice or LinkedIn-only
 *   ones), plus first-person "because I" lines: a hook may quote one
 * @property {Array<{ title: string, generic: string, better: string, why: string[] }>} examples
 *   the guide's "Example rewrites" (generic → better), few-shot for the draft
 */

/** The voice.md path: $JOBBORED_HOME/profile/voice.md, else ~/.jobbored/profile/voice.md. */
export function voiceProfilePath() {
  const root = process.env.JOBBORED_HOME || join(homedir(), ".jobbored");
  return join(root, "profile", "voice.md");
}

/**
 * A heading as a key: lowercase, punctuation and dashes to single
 * spaces ("What it should NEVER sound like:" → "what it should never
 * sound like").
 * @param {string} heading
 */
export function headingKey(heading) {
  return String(heading || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* Section names, matched on headingKey: Jordan's hand-written guide and
 * the onboarding template (server/profile-voice-shared.js) both map to
 * one role each. */
const SECTION = /** @type {const} */ ({
  summary: /^voice summary/,
  soundLike: /^what (?:the voice|my writing|my voice|it|i) should sound like/,
  neverSoundLike: /^what (?:the voice|my writing|my voice|it|i) should (?:not|never) sound like/,
  narrative: /^core narrative/,
  approvedFacts: /^approved facts/,
  coverLetterRules: /^cover letter (?:voice )?rules/,
  resumeRules: /^resume (?:voice |line )?rules/,
  signatureLines: /^signature lines/,
  phrasing: /^preferred phrasing/,
  samples: /^voice samples/,
  avoid: /^phrases to avoid/,
  links: /^hyperlink/,
  examples: /^example rewrites/,
  calibration: /^calibration/,
});

/**
 * @param {string} markdown
 * @returns {Map<string, { heading: string, body: string }>} headingKey → the heading as written and its body
 */
function sections(markdown) {
  /** @type {Map<string, { heading: string, body: string }>} */
  const out = new Map();
  const parts = String(markdown || "").split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    out.set(headingKey(heading), { heading, body: nl < 0 ? "" : part.slice(nl + 1) });
  }
  return out;
}

/**
 * @param {Map<string, { heading: string, body: string }>} map
 * @param {RegExp} re
 */
function section(map, re) {
  for (const [key, entry] of map) if (re.test(key)) return entry.body;
  return "";
}

/**
 * Bullet items of a section, markdown stripped (quotes kept).
 * @param {string} body
 * @returns {string[]}
 */
function bulletItems(body) {
  /** @type {string[]} */
  const out = [];
  for (const line of String(body || "").split("\n")) {
    const m = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (m) out.push(plain(m[1]));
  }
  return out.filter(Boolean);
}

/** @param {string} text strip markdown emphasis and links, keep the words */
function plain(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)\*(?=\S)|(?<=\S)\*(?=\s|$|[.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quoted lines from a section: "…" or *"…"* bullets, verbatim.
 * @param {string} body
 * @returns {string[]}
 */
function quotedLines(body) {
  /** @type {string[]} */
  const out = [];
  for (const line of String(body || "").split("\n")) {
    const m = /^\s*[-*]\s+\*?"(.+?)"\*?(?:\s|$)/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** @param {string} text */
function sentencesOf(text) {
  return plain(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.replace(/^["“]|["”]$/g, "").trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

/**
 * @param {string} markdown
 * @param {string} [path]
 * @returns {VoiceProfile}
 */
export function parseVoiceProfile(markdown, path = "") {
  const map = sections(markdown);
  const narrative = section(map, SECTION.narrative);
  const phrasing = section(map, SECTION.phrasing);
  const samplesBody = section(map, SECTION.samples);
  const avoidBody = section(map, SECTION.avoid);
  const linksBody = section(map, SECTION.links);
  const resumeRules = section(map, SECTION.resumeRules);
  const approvedBody = section(map, SECTION.approvedFacts);
  const signatureBody = section(map, SECTION.signatureLines);

  /* Facts: the narrative's quoted paragraph and its numbered threads,
   * every phrasing pattern, every voice sample, the approved clients. */
  /** @type {string[]} */
  const facts = [];
  const quote = /^>\s*"?(.+?)"?\s*$/m.exec(narrative);
  if (quote) facts.push(...sentencesOf(quote[1]));
  else {
    /* The onboarding template writes the narrative as a plain paragraph. */
    const prose = narrative.split("\n").filter((line) => line.trim() && !/^\s*(?:[-*]|\d+\.)\s/.test(line) && !/^\s*(?:>|#|---)/.test(line) && !/:\s*$/.test(line.trim()));
    facts.push(...sentencesOf(prose.join(" ")));
  }
  /* "Approved facts" (onboarding template): every bullet, as written. */
  facts.push(...bulletItems(approvedBody).map((f) => f.replace(/^["“](.+)["”]$/, "$1")));
  for (const line of narrative.split("\n")) {
    const m = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (m) facts.push(plain(m[1]).replace(/\s+—\s+/, ": "));
  }
  /* "Signature lines" (onboarding template): quoted bullets, or plain
   * bullets when the user did not quote them. */
  const signatureSection = bulletItems(signatureBody).map((l) => l.replace(/^["“](.+?)["”]\.?$/, "$1").trim());
  const signatureLines = [...quotedLines(samplesBody), ...quotedLines(phrasing), ...signatureSection];
  facts.push(...signatureLines);
  const clients = /name clients freely\.?\s*(.+?)\s+—\s+all approved/i.exec(plain(resumeRules));
  if (clients) facts.push(`Clients include ${clients[1].trim()}.`);

  /* Phrases to avoid: "…" quoted items, split on " / ". */
  /** @type {Array<{ pattern: string, note: string }>} */
  const avoid = [];
  for (const line of avoidBody.split("\n")) {
    if (!/^\s*[-*]\s+/.test(line)) continue;
    /* "Leverage" (as a verb meaning "use"): the gloss is not a phrase. */
    const cleaned = line.replace(/meaning\s+"[^"]*"/gi, "");
    /* The onboarding template allows a plain list: an unquoted bullet is
     * one phrase. */
    const quoted = [...cleaned.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const items = quoted.length ? quoted : [plain(cleaned.replace(/^\s*[-*]\s+/, "")).replace(/\s*\(.*\)\s*$/, "")];
    for (const item of items) {
      const phrase = item.replace(/\.{3}|…/g, "").replace(/[,.;:]+$/, "").replace(/\s+(?:into|of)$/i, "").trim();
      if (!phrase || /^I'm a passionate/i.test(phrase)) continue;
      const words = phrase.toLowerCase().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      /* Inflect the last word lightly: long words by stem ("synergize" →
       * "synergized"), short ones only by plain endings ("fired", not
       * "first"). */
      const last = words.pop() || "";
      const tail = last.length >= 7 ? `${last.replace(/(e|y|ing|ed|s)$/, "")}(?:e|es|ed|ing|s|y|ies|ize|ized|izes|izing)?` : `${last}(?:s|d|ed|ing)?`;
      const pattern = `\\b${[...words, tail].join("\\s+")}\\b`;
      avoid.push({ pattern, note: `voice.md: avoid "${phrase}"` });
    }
  }

  /** @type {Array<{ text: string, href: string }>} */
  const links = [];
  for (const m of linksBody.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (!links.some((l) => l.text === m[1])) links.push({ text: m[1], href: m[2] });
  }

  /* The rule sections the draft model reads verbatim (no examples: the
   * facts and signature lines ride separately). */
  const keep = [SECTION.summary, SECTION.soundLike, SECTION.neverSoundLike, SECTION.coverLetterRules, SECTION.narrative, SECTION.calibration];
  const guideText = [...map]
    .filter(([key]) => keep.some((re) => re.test(key)))
    .map(([, entry]) => `## ${entry.heading.toLowerCase()}\n${entry.body.trim()}`)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 9000);

  return {
    path,
    guideText,
    examples: exampleRewrites(section(map, SECTION.examples)),
    hookPatterns: [...new Set([...hookPatterns(samplesBody, phrasing), ...signatureSection])],
    facts: [...new Set(facts.map((f) => f.trim()).filter(Boolean))],
    signatureLines: [...new Set(signatureLines)],
    signatureTellLines: signatureTellLinesOf(
      signatureSection.length ? signatureSection : hookPatterns(samplesBody, phrasing),
      [...bulletItems(approvedBody)],
    ),
    avoid,
    links,
    samples: quotedLines(samplesBody),
  };
}

/**
 * Signature/philosophy lines only: no digits (a line with a number is a
 * fact), at least six words, and not an approved fact.
 * @param {string[]} lines
 * @param {string[]} approved
 */
function signatureTellLinesOf(lines, approved) {
  const facts = new Set(approved.map((f) => f.toLowerCase().replace(/[“”"]/g, "").trim()));
  return [...new Set(lines.map((l) => String(l || "").trim()))].filter(
    (l) => l && !/\d/.test(l) && l.split(/\s+/).length >= 6 && !facts.has(l.toLowerCase().replace(/[“”"]/g, "")),
  );
}

/**
 * Lines a hook may quote exactly: phrasing patterns annotated as a
 * signature, philosophy, opener or identity line (never one marked for
 * the resume, LinkedIn or a portfolio header), first-person "because I"
 * lines, and the voice samples under a "Philosophy / identity" heading.
 * @param {string} samplesBody
 * @param {string} phrasingBody
 * @returns {string[]}
 */
function hookPatterns(samplesBody, phrasingBody) {
  /** @type {string[]} */
  const out = [];
  for (const line of String(phrasingBody || "").split("\n")) {
    const m = /^\s*[-*]\s+"(.+?)"\s*(?:\*\((.+?)\)\*)?\s*$/.exec(line);
    if (!m) continue;
    const note = m[2] || "";
    if (/resume voice|linkedin|portfolio/i.test(note)) continue;
    if (/signature|philosophy|opener|identity/i.test(note) || /\bbecause I\b/.test(m[1])) out.push(m[1].trim());
  }
  let inPhilosophy = false;
  for (const line of String(samplesBody || "").split("\n")) {
    if (/^\*\*.+\*\*\s*$/.test(line.trim())) inPhilosophy = /philosophy|identity/i.test(line);
    const m = /^\s*[-*]\s+\*?"(.+?)"\*?\s*$/.exec(line);
    if (inPhilosophy && m) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

/**
 * The "Example rewrites" section: each "### Example …" block's generic
 * version, better version (blockquotes) and "why" bullets.
 * @param {string} body
 * @returns {Array<{ title: string, generic: string, better: string, why: string[] }>}
 */
function exampleRewrites(body) {
  /** @type {Array<{ title: string, generic: string, better: string, why: string[] }>} */
  const out = [];
  /** @type {{ cur: { title: string, generic: string[], better: string[], why: string[] } | null }} */
  const state = { cur: null };
  /** @type {"" | "generic" | "better" | "why"} */
  let at = "";
  let title = "";
  let count = 0;
  const flush = () => {
    if (state.cur) {
      const generic = plain(state.cur.generic.join(" "));
      const better = plain(state.cur.better.join(" "));
      if (generic && better) out.push({ title: state.cur.title, generic, better, why: state.cur.why });
    }
    state.cur = null;
    at = "";
  };
  const start = () => {
    count += 1;
    state.cur = { title: title || `Example ${count}`, generic: [], better: [], why: [] };
    title = "";
  };
  for (const line of String(body || "").split("\n")) {
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      title = plain(heading[1]);
      continue;
    }
    /* A label line: "**Generic version**", "**Generic:** text",
     * "**In my voice:** text", "**Why it's better**", "Better: text". */
    const label = /^\s*(?:[-*]\s+)?\**\s*(why[^:*]*|generic[^:*]*|before[^:*]*|better[^:*]*|in my voice[^:*]*|my version[^:*]*|after[^:*]*)\s*:?\s*\**\s*:?\s*(.*)$/i.exec(line);
    if (label) {
      /** @type {"generic" | "better" | "why"} */
      const kind = /^why/i.test(label[1]) ? "why" : /^(?:generic|before)/i.test(label[1]) ? "generic" : "better";
      if (kind === "generic" && (!state.cur || state.cur.better.length)) {
        flush();
        start();
      }
      if (!state.cur) start();
      at = kind;
      const rest = label[2].trim();
      if (rest && state.cur) {
        if (kind === "why") state.cur.why.push(plain(rest));
        else state.cur[kind].push(rest.replace(/^>\s?/, ""));
      }
      continue;
    }
    if (!state.cur || !at) continue;
    if (at === "why") {
      const m = /^\s*[-*]\s+(.+)$/.exec(line);
      if (m) state.cur.why.push(plain(m[1]));
    } else if (/^\s*>/.test(line)) {
      state.cur[at].push(line.replace(/^\s*>\s?/, ""));
    }
  }
  flush();
  return out;
}

/**
 * Read and parse the user's voice.md, or null when it is absent.
 * @param {string} [path]
 * @returns {VoiceProfile | null}
 */
export function loadVoiceProfile(path = voiceProfilePath()) {
  try {
    if (!existsSync(path)) return null;
    return parseVoiceProfile(readFileSync(path, "utf8"), path);
  } catch {
    return null;
  }
}

/**
 * The voice facts as approved ledger claims (provenance source "voice").
 * They extend grounding and metric tracing; they never enter resume
 * selection.
 * @param {VoiceProfile | null} profile
 * @returns {Array<{ id: string, text: string, employerId: null, kind: string, verified: boolean, provenance: { source: "voice", path: string }, metrics: Array<{ token: string }> }>}
 */
export function voiceClaims(profile) {
  if (!profile) return [];
  return profile.facts.map((text, i) => ({
    id: `voice-${i + 1}`,
    text,
    employerId: null,
    kind: "voice",
    verified: true,
    provenance: { source: "voice", path: profile.path },
    metrics: numerals(text).map((token) => ({ token })),
  }));
}

/**
 * A ledger view for grounding and metric tracing: the ledger's claims
 * plus the approved voice facts.
 * @template {{ claims?: unknown[] }} L
 * @param {L} ledger
 * @param {VoiceProfile | null} profile
 * @returns {L}
 */
export function withVoiceClaims(ledger, profile) {
  const extra = voiceClaims(profile);
  if (!extra.length) return ledger;
  return { ...ledger, claims: [...(ledger.claims || []), ...extra] };
}
