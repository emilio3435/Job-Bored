/* ============================================
   server/profile-voice-shared.js
   "Your voice": the voice guide drafts follow, stored as Markdown at
   ~/.jobbored/profile/voice.md. Single source for the parts both sides
   need, consumed by:
   - the browser (classic global window.JobBoredProfileVoiceShared,
     loaded via <script> before profile-voice.js): the chatbot prompt the
     wizard step and Settings both show, and the live preview's word count
     and heading/section detection;
   - the server (side-effect import; reads the same namespace off
     globalThis) for PUT /profile/voice's size, emptiness and binary
     checks and GET's word count.
   Lives in server/ (not root) so the Docker image carries it, like
   profile-draft-shared.js. Pure code only: no window/document/fetch at
   load, so it runs unchanged as a <script> and as a Node import.
   ============================================ */
(function (root) {
  "use strict";

  /** The most a voice guide may weigh, in UTF-8 bytes (64 KB). */
  const MAX_VOICE_BYTES = 64 * 1024;

  /**
   * The prompt a user pastes into ChatGPT, Claude or Gemini to have it
   * interview them and write the guide. Verbatim; shown by the wizard step
   * and by Settings, never edited in either place.
   */
  const VOICE_GUIDE_PROMPT = [
    "I want you to write a voice guide for me: a document an AI writing assistant can follow to write cover letters, resume lines, and recruiter messages that sound like I wrote them myself.",
    "",
    "Interview me first. Ask me these one or two at a time, wait for my answers, and ask a short follow-up whenever an answer is vague:",
    "",
    "1. Paste 2–4 things you've written that sound like you at your best: an email you're proud of, a LinkedIn post or About section, a note to your team, a message to a friend about your work. (If you paste my resume, treat it as facts, not voice.)",
    "2. In one sentence, what do you do, and what do you want to be hired for next? Which part of your background should lead, and which should only support it?",
    "3. What are 5–10 facts you want an employer to remember? Numbers, named clients or projects, rankings, scale (\"200+ locations\", \"top-4 nationally\"). Only things you'd be comfortable having checked.",
    "4. How do you sound when you're at your best: more precise or more playful? More formal or more casual? Name a writer, colleague, or brand whose tone is close.",
    "5. What words or phrases make you cringe when you see them in cover letters or LinkedIn posts?",
    "6. Do you have lines or phrases you already use about yourself, like a motto, a headline, or a way you explain what you do?",
    "7. Anything you never want said: salary expectations, how a past job ended, clients you can't name, claims you can't back up?",
    "",
    "Then write the guide in Markdown with exactly these sections:",
    "",
    "# Voice guide — [my name]",
    "## Voice summary",
    "3–5 sentences: how I sound, what I sell with (proof, stories, numbers), my register.",
    "## What my writing should sound like",
    "Bullets with a short example each: my typical sentence length and rhythm, my favorite kinds of verbs, how I use numbers, how much warmth or humor.",
    "## What it should never sound like",
    "Bullets: tones, clichés, and AI tells to avoid, in my own terms.",
    "## Core narrative",
    "One paragraph in first person: who I am, the proof, what I want next. Use only facts I gave you.",
    "## Approved facts",
    "A bulleted list of every fact, number, client, and project I'm okay using, written exactly as I stated them. Nothing you inferred or rounded.",
    "## Cover letter rules",
    "Length, paragraph shape, how to open (never with flattery or \"I'm writing to…\"), how to close, sign-off options, and how much personality to allow.",
    "## Resume line rules",
    "Verb choices, one accomplishment per line, how to present numbers.",
    "## Signature lines",
    "My own phrases, quoted verbatim, that may be reused word for word.",
    "## Phrases to avoid",
    "A plain list.",
    "## Example rewrites",
    "Two short pairs: a generic version, then a version in my voice, with one line on why it's better. Use only my facts.",
    "",
    "Rules for you while writing it: use only what I told you, never invent accomplishments or numbers, keep my wording where you can, and write the guide itself plainly — no hype. When you're done, give me the whole guide in one Markdown block so I can copy it.",
  ].join("\n");

  /**
   * The sections a guide should have for drafting to lean on it. Both are
   * a gentle warning when missing, never a refusal.
   * @type {ReadonlyArray<{ key: string, label: string, why: string }>}
   */
  const KEY_SECTIONS = Object.freeze([
    Object.freeze({
      key: "approved-facts",
      label: "Approved facts",
      why: "the facts and numbers you're happy to have quoted",
    }),
    Object.freeze({
      key: "cover-letter-rules",
      label: "Cover letter rules",
      why: "how your letters open, close and how long they run",
    }),
  ]);

  /**
   * Bring pasted or uploaded text to the shape that is stored: no byte-order
   * mark, "\n" line endings, trailing spaces trimmed, and a guide a chatbot
   * wrapped whole in a Markdown code fence unwrapped (a copy of the reply
   * often carries the fence lines along).
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeVoiceText(value) {
    let text = typeof value === "string" ? value : "";
    text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    text = text
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n")
      .trim();
    const fenced = /^(`{3,}|~{3,})[ \t]*(?:markdown|md|text)?[ \t]*\n([\s\S]*?)\n\1$/i.exec(text);
    // Only a whole-document wrapper: an inner fence of the same kind would
    // mean the first and last lines belong to different blocks.
    if (fenced && !new RegExp("^\\" + fenced[1].charAt(0) + "{3,}", "m").test(fenced[2])) {
      text = fenced[2].trim();
    }
    return text;
  }

  /**
   * UTF-8 byte length without Buffer or TextEncoder assumptions.
   * @param {string} text
   * @returns {number}
   */
  function byteLength(text) {
    let bytes = 0;
    for (const ch of String(text || "")) {
      const code = /** @type {number} */ (ch.codePointAt(0));
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
  }

  /**
   * True when the text is not something a person wrote: a NUL, a run of
   * control characters, or the replacement characters a binary file turns
   * into when it is read as text.
   * @param {string} text
   * @returns {boolean}
   */
  function looksBinary(text) {
    const value = String(text || "");
    if (!value) return false;
    if (value.indexOf("\u0000") !== -1) return true;
    const controls = (value.match(/[\u0001-\u0008\u000B\u000E-\u001F\u007F]/g) || []).length;
    const replaced = (value.match(/\uFFFD/g) || []).length;
    const sample = Math.max(value.length, 1);
    return controls / sample > 0.01 || replaced >= 8 || replaced / sample > 0.01;
  }

  /**
   * Words, in any script: runs of letters or digits (an apostrophe or
   * hyphen inside a word keeps it one word).
   * @param {string} text
   * @returns {number}
   */
  function countWords(text) {
    const matches = String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'\u2019-]*/gu);
    return matches ? matches.length : 0;
  }

  /** @param {string} value */
  function headingKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[*_`#:]+/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  /**
   * The Markdown headings of a guide, in order: ATX headings ("## Voice
   * summary") and whole-line bold labels ("**Approved facts**") that some
   * chatbots use instead, skipping anything inside a fenced code block.
   * @param {string} text
   * @returns {Array<{ level: number, text: string }>}
   */
  function findHeadings(text) {
    /** @type {Array<{ level: number, text: string }>} */
    const out = [];
    let fence = "";
    for (const raw of normalizeVoiceText(text).split("\n")) {
      const line = raw.trim();
      const fenceMark = /^(`{3,}|~{3,})/.exec(line);
      if (fenceMark) {
        if (!fence) fence = fenceMark[1].charAt(0);
        else if (fenceMark[1].charAt(0) === fence) fence = "";
        continue;
      }
      if (fence) continue;
      const atx = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (atx) {
        const label = atx[2].replace(/^[*_]+|[*_]+$/g, "").trim();
        if (label) out.push({ level: atx[1].length, text: label });
        continue;
      }
      const bold = /^(\*\*|__)([^*_].*?)\1:?$/.exec(line);
      if (bold && bold[2].trim().length <= 80) {
        out.push({ level: 0, text: bold[2].trim().replace(/:$/, "") });
      }
    }
    return out;
  }

  /**
   * What the live preview shows: the word count, the headings found, and
   * which key sections are there or missing.
   * @param {unknown} value
   * @returns {{ text: string, words: number, bytes: number, headings: Array<{ level: number, text: string }>, found: string[], missing: Array<{ key: string, label: string, why: string }>, tooLarge: boolean, binary: boolean, empty: boolean }}
   */
  function analyzeVoiceGuide(value) {
    const text = normalizeVoiceText(value);
    const headings = findHeadings(text);
    const keys = headings.map((h) => headingKey(h.text));
    /** @type {string[]} */
    const found = [];
    /** @type {Array<{ key: string, label: string, why: string }>} */
    const missing = [];
    for (const section of KEY_SECTIONS) {
      const want = headingKey(section.label);
      if (keys.some((k) => k === want || k.indexOf(want) !== -1)) found.push(section.key);
      else missing.push(section);
    }
    const bytes = byteLength(text);
    return {
      text,
      words: countWords(text),
      bytes,
      headings,
      found,
      missing,
      tooLarge: bytes > MAX_VOICE_BYTES,
      binary: looksBinary(text),
      empty: !text,
    };
  }

  /**
   * Why a guide cannot be saved, or "" when it can. Codes, not copy: each
   * surface words them for its reader.
   * @param {unknown} value
   * @returns {"" | "empty" | "too_large" | "binary"}
   */
  function voiceProblem(value) {
    if (typeof value !== "string") return "empty";
    if (looksBinary(value)) return "binary";
    const text = normalizeVoiceText(value);
    if (!text || countWords(text) === 0) return "empty";
    if (byteLength(text) > MAX_VOICE_BYTES) return "too_large";
    return "";
  }

  const api = {
    MAX_VOICE_BYTES,
    VOICE_GUIDE_PROMPT,
    KEY_SECTIONS,
    normalizeVoiceText,
    byteLength,
    looksBinary,
    countWords,
    findHeadings,
    analyzeVoiceGuide,
    voiceProblem,
  };

  root.JobBoredProfileVoiceShared = api;
  if (typeof window !== "undefined") {
    /** @type {any} */ (window).JobBoredProfileVoiceShared = api;
  }
})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
