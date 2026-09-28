/**
 * Materials — outreach note to the hiring manager (Wave 3, C-8).
 *
 * One cheap model call, generated beside the letter when the request asks
 * for the optional "outreach" extra: a LinkedIn note (≤ 300 characters)
 * and a short email (≤ 120 words), in the user's voice.md LinkedIn rules:
 * start with a concrete reason to continue reading, add one relevant detail, and make a
 * low-friction ask, no clichés, no compensation.
 *
 * It names the contact when the sheet or enrichment gives one; otherwise
 * it opens "Hi there,". Its facts come from the fact-checked letter, the
 * ledger claims, the approved voice facts, the posting and the company
 * intel pack; the letter's support check judges its sentences in the
 * same call (beats "outreach.linkedin" and "outreach.email").
 *
 * QA (deterministic): length, greeting, no tells or LinkedIn clichés, no
 * compensation, an ask, and every factual sentence supported. The note
 * is stored as outreach.json + outreach.txt in the package.
 */

import { readFileSync } from "node:fs";
import { splitSentences } from "./materials-rubric.mjs";
import { detectAiWords, detectCompanyPraise, detectContrastFrames, detectGush, detectOffVoice, maskSignatures } from "./materials-voice-tells.mjs";
import { runJsonStage } from "./materials-writer.mjs";

export const OUTREACH_CONTRACT = "materials.outreach.v1";
export const LINKEDIN_MAX_CHARS = 300;
export const EMAIL_MAX_WORDS = 120;
export const OUTREACH_MAX_OUTPUT_TOKENS = 1024;

/* The shipped LinkedIn rules, used when the user's voice.md has none. */
const DEFAULT_RULES = [
  "Start with a concrete reason to keep reading.",
  "Offer one relevant detail: a project, a result, or why this position appeals.",
  "End with a simple ask: a 15-minute meeting, or a yes/no question.",
  "Avoid stock networking openings (\"I hope you are doing well\", \"Your profile caught my attention\").",
  "No compensation discussion.",
];

/* LinkedIn and email clichés: a hard tell in an outreach note. */
const CLICHE_RES = [
  /\bhope (?:this|you're|you are|all is)\b[^.!?]{0,30}\bwell\b/i,
  /\bcame across your (?:profile|post|page)\b/i,
  /\b(?:was|am|i'm) (?:so |really |very )?impressed\b/i,
  /\bi(?:'d| would) love to connect\b/i,
  /\bi am reaching out\b|\bi'm reaching out\b|\breaching out to\b/i,
  /\bi (?:wanted to|want to) (?:introduce myself|reach out)\b/i,
  /\bpick your brain\b/i,
  /\bthank you for your (?:time|consideration)\b/i,
  /\bi look forward to hearing from you\b/i,
  /\bperfect fit\b|\bideal candidate\b/i,
];
const COMP_RE = /\b(?:salary|salaries|compensation|comp (?:range|expectations?)|OTE|base pay|pay range|rate of pay|equity)\b|\$\s?\d{2,3}\s?[kK]\b/;
const ASK_RE = /\?\s*$|\b(?:15|fifteen)[- ]minute\b|\bquick call\b|\bworth a\b|\bopen to\b[^.?!]*\?|\bwould you\b[^.?!]*\?/i;

/**
 * The user's LinkedIn / recruiter-message rules from voice.md, plus its
 * LinkedIn example rewrite when it has one. Falls back to the shipped
 * rules.
 * @param {import("./materials-voice-profile.mjs").VoiceProfile | null | undefined} profile
 * @param {(path: string) => string} [readText]
 * @returns {{ rules: string[], example: string, source: "voice.md" | "default" }}
 */
export function outreachRules(profile, readText = (path) => readFileSync(path, "utf8")) {
  let markdown = "";
  if (profile && profile.path) {
    try {
      markdown = readText(profile.path);
    } catch {
      markdown = "";
    }
  }
  /** @type {string[]} */
  let rules = [];
  for (const part of String(markdown).split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).toLowerCase();
    if (!/linkedin|recruiter message|outreach/.test(heading) || /sample|example/.test(heading)) continue;
    rules = part.slice(nl + 1).split("\n")
      .map((line) => /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line)?.[1] || "")
      .map((line) => line.replace(/\*\*|__/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim())
      .filter(Boolean);
    if (rules.length) break;
  }
  const ex = (profile?.examples || []).find((e) => /linkedin|recruiter|outreach/i.test(e.title));
  const example = ex ? ex.better : "";
  return rules.length ? { rules, example, source: "voice.md" } : { rules: DEFAULT_RULES, example, source: "default" };
}

/**
 * The first name to greet, from the contact the sheet or enrichment
 * gives ("Jane Doe, VP Sales" → "Jane"). Empty when it does not look like
 * a person's name.
 * @param {unknown} contact
 */
export function greetingName(contact) {
  const raw = typeof contact === "string" ? contact : "";
  const head = raw.split(/[,(|<\-–—@\n]/)[0].trim();
  if (!head || /\d|https?:|www\./i.test(head)) return "";
  const parts = head.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 4) return "";
  const first = parts[0].replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’.-]/g, "");
  if (!/^[A-ZÀ-Ö][A-Za-zÀ-ÖØ-öø-ÿ'’.-]{1,30}$/.test(first)) return "";
  if (/^(?:hiring|recruiter|recruiting|talent|team|hr|the|dear|mr|mrs|ms|dr)\.?$/i.test(first)) return "";
  return first;
}

/** @param {string} name */
export function greetingFor(name) {
  return name ? `Hi ${name},` : "Hi there,";
}

/** @param {string} text */
export function wordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

export const OUTREACH_SYSTEM_PROMPT = [
  "You write a short outreach note from a job candidate to the hiring manager, in the candidate's own voice. Return JSON only:",
  '{"linkedin":"","email":{"subject":"","body":""}}.',
  `linkedin: one LinkedIn note of at most ${LINKEDIN_MAX_CHARS - 30} characters INCLUDING the greeting (hard limit ${LINKEDIN_MAX_CHARS}); count them.`,
  `email.body: at most ${EMAIL_MAX_WORDS - 15} words (hard limit ${EMAIL_MAX_WORDS}), 2 short paragraphs at most, no sign-off block beyond the candidate's first name. email.subject: at most 8 words, specific, no clickbait.`,
  "Both start with the greeting given below, exactly.",
  "Facts: only what the listed letter, claims, approved voice facts, posting or company intel state. Keep every number verbatim. No new facts, clients, tools or results. The letter is already fact-checked: restating its facts closely is the safest path.",
  "Follow the candidate's outreach rules below. Use a single relevant detail. Close with an easy reply path, such as a brief call or a simple yes/no question.",
  "Never: compensation or salary, flattery of the company, 'hope this finds you well', 'I came across your profile', 'I'd love to connect', 'reaching out', 'perfect fit', 'thank you for your consideration'. No markup, no emojis, no hashtags.",
].join(" ");

/**
 * The user text for the outreach call. Exported for prompt snapshots.
 * @param {object} input
 * @param {string} input.company
 * @param {string} input.title
 * @param {string} input.greeting
 * @param {Record<string, unknown>} input.letter the drafted letter beats
 * @param {Array<{ id?: unknown, text?: unknown }>} input.claims the letter's proof claims
 * @param {string[]} [input.voiceFacts]
 * @param {import("./materials-intel.mjs").IntelFact[]} [input.intel]
 * @param {{ rules: string[], example: string }} input.rules
 * @param {string} [input.positioning] the lead positioning phrase for this role
 * @param {string} [input.firstName] the candidate's first name for the sign-off
 */
export function outreachPrompt({ company, title, greeting, letter, claims, voiceFacts = [], intel = [], rules, positioning = "", firstName = "" }) {
  const beats = Object.entries(letter || {}).filter(([, t]) => typeof t === "string" && t.trim()).map(([b, t]) => `- ${b}: ${String(t).slice(0, 700)}`);
  return [
    `Company: ${company}`,
    `Role: ${title}`,
    `Greeting (use exactly): ${greeting}`,
    ...(firstName ? [`Sign the email with: ${firstName}`] : []),
    ...(positioning ? [`Lead positioning for this role (his own words): ${positioning}`] : []),
    "",
    "The candidate's outreach rules (source of truth):",
    ...rules.rules.map((r) => `- ${r}`),
    ...(rules.example ? ["", "His own example of a good LinkedIn note (match the rhythm, never copy its placeholders):", rules.example] : []),
    "",
    "The fact-checked cover letter (restate its facts; never add):",
    ...beats,
    "",
    "Proof claims:",
    ...claims.filter((c) => c && typeof c.id === "string" && typeof c.text === "string").slice(0, 6).map((c) => `- ${String(c.id)}: ${String(c.text).slice(0, 400)}`),
    ...(voiceFacts.length ? ["", "Approved voice facts:", ...voiceFacts.slice(0, 12).map((f) => `- ${f.slice(0, 300)}`)] : []),
    ...(intel.length ? ["", "Company intel (dated, sourced; at most one, closely):", ...intel.map((f) => `- ${f.id} (${f.date}): ${f.text}`)] : []),
  ].join("\n");
}

/**
 * One model call: the LinkedIn note and the email. A failed call or an
 * unreadable reply returns null (the letter still publishes).
 * @param {object} input
 * @param {string} input.company
 * @param {string} input.title
 * @param {string} [input.contact]
 * @param {Record<string, unknown>} input.letter
 * @param {Array<{ id?: unknown, text?: unknown }>} input.claims
 * @param {import("./materials-voice-profile.mjs").VoiceProfile | null} [input.voiceProfile]
 * @param {import("./materials-intel.mjs").IntelFact[]} [input.intel]
 * @param {string} [input.positioning]
 * @param {string} [input.firstName]
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @returns {Promise<{ outreach: { greeting: string, contactName: string, linkedin: string, email: { subject: string, body: string } } | null, call?: import("./materials-writer.mjs").StageCallRecord }>}
 */
export async function generateOutreach({ company, title, contact = "", letter, claims, voiceProfile = null, intel = [], positioning = "", firstName = "", pin, fetchImpl }) {
  if (!pin) return { outreach: null };
  const contactName = greetingName(contact);
  const greeting = greetingFor(contactName);
  const rules = outreachRules(voiceProfile);
  const { value, call } = await runJsonStage({
    stage: "outreach",
    pin,
    systemPrompt: OUTREACH_SYSTEM_PROMPT,
    userText: outreachPrompt({ company, title, greeting, letter, claims, voiceFacts: voiceProfile?.facts || [], intel, rules, positioning, firstName }),
    maxOutputTokens: OUTREACH_MAX_OUTPUT_TOKENS,
    fetchImpl,
  });
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : null;
  const clean = (/** @type {unknown} */ t, max = 2000) => (typeof t === "string" ? t.replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
  const email = v?.email && typeof v.email === "object" ? /** @type {Record<string, unknown>} */ (v.email) : {};
  /* The greeting sits on its own line in both: "Hi there, Eight years…"
   * reads wrong, and lowercasing would break names. */
  const linkedin = withGreeting(clean(v?.linkedin, 1000), greeting, "\n\n");
  const body = withGreeting(clean(email.body), greeting, "\n\n");
  if (!linkedin && !body) return { outreach: null, call };
  return { outreach: { greeting, contactName, linkedin, email: { subject: clean(email.subject, 160), body } }, call };
}

/**
 * A clean first line: the exact greeting, then the note's first sentence
 * starting with a capital. Whatever greeting the model wrote ("Hi there,",
 * "Hello Jane —") and any stray punctuation after it ("Hi there, — eight
 * years…") are replaced.
 * @param {string} text
 * @param {string} greeting e.g. "Hi there,"
 * @param {string} joiner what follows the greeting (the pipeline uses a blank line)
 */
export function withGreeting(text, greeting, joiner) {
  let rest = String(text || "").trim();
  if (!rest) return "";
  rest = rest.replace(/^(?:hi|hello|hey|dear)\b[^,\n—–:!-]{0,40}[,:!]?/i, "");
  rest = rest.replace(/^[\s,;:.!—–-]+/, "");
  if (!rest) return "";
  rest = rest.charAt(0).toUpperCase() + rest.slice(1);
  return `${greeting}${joiner}${rest}`;
}

/**
 * The outreach note's sentences for the support check (the greeting and
 * the sign-off are not facts).
 * @param {{ greeting: string, linkedin: string, email: { body: string } }} outreach
 * @returns {Array<{ beat: string, text: string }>}
 */
export function outreachSupportText(outreach) {
  const strip = (/** @type {string} */ t) => String(t || "").replace(/^\s*Hi\b[^,\n]{0,40},\s*/i, "").replace(/\n+\s*[A-Z][a-z]+\.?\s*$/, "").replace(/\s+/g, " ").trim();
  return [
    { beat: "outreach.linkedin", text: strip(outreach.linkedin) },
    { beat: "outreach.email", text: strip(outreach.email.body) },
  ].filter((e) => e.text);
}

/**
 * Deterministic QA for the note: length, greeting, tells, compensation,
 * the ask, and the support verdicts for its sentences.
 * @param {object} input
 * @param {{ greeting: string, linkedin: string, email: { subject: string, body: string } }} input.outreach
 * @param {string} [input.company]
 * @param {Array<{ beat: string, sentence: string, factual: boolean, supported: boolean | null, reason: string }> | null} [input.verdicts]
 * @param {Array<{ pattern: string, note?: string }>} [input.avoid] tell rules (the voice pack's aiTells, voice.md's avoid list included)
 * @param {string[]} [input.signatureLines]
 * @returns {{ status: "pass" | "review" | "fail", checks: Array<{ code: string, severity: "pass" | "review" | "fail", message: string, part?: string }> }}
 */
export function outreachQa({ outreach, company = "", verdicts = null, avoid = [], signatureLines = [] }) {
  /** @type {Array<{ code: string, severity: "pass" | "review" | "fail", message: string, part?: string }>} */
  const checks = [];
  const add = (/** @type {string} */ code, /** @type {"pass" | "review" | "fail"} */ severity, /** @type {string} */ message, /** @type {string} */ part = "") =>
    checks.push({ code, severity, message, ...(part ? { part } : {}) });
  const chars = outreach.linkedin.length;
  add("linkedin_length", chars && chars <= LINKEDIN_MAX_CHARS ? "pass" : "fail", `LinkedIn note is ${chars}/${LINKEDIN_MAX_CHARS} characters`, "linkedin");
  const words = wordCount(outreach.email.body);
  add("email_length", words && words <= EMAIL_MAX_WORDS ? "pass" : "fail", `email is ${words}/${EMAIL_MAX_WORDS} words`, "email");
  for (const [part, text] of /** @type {Array<[string, string]>} */ ([["linkedin", outreach.linkedin], ["email", outreach.email.body]])) {
    if (!text) continue;
    if (!text.trimStart().startsWith(outreach.greeting)) add("greeting", "review", `${part} does not open with "${outreach.greeting}"`, part);
    const masked = maskSignatures(text, signatureLines);
    const tells = [
      ...detectAiWords(masked, avoid),
      ...detectGush(masked),
      ...detectContrastFrames(masked),
      ...detectOffVoice(masked),
      ...detectCompanyPraise(masked, company),
    ];
    const cliches = CLICHE_RES.map((re) => re.exec(masked)).filter(Boolean).map((m) => /** @type {RegExpExecArray} */ (m)[0]);
    if (tells.length || cliches.length) {
      add("tells", "fail", `${part}: ${[...cliches.map((c) => `cliché "${c}"`), ...tells.map((t) => `"${t.text}" (${t.note})`)].join("; ").slice(0, 300)}`, part);
    }
    if (COMP_RE.test(text)) add("compensation", "fail", `${part} mentions compensation`, part);
    const tail = splitSentences(text.replace(/\n+\s*[A-Z][a-z]+\.?\s*$/, "")).slice(-2).join(" ");
    if (!ASK_RE.test(tail)) add("ask", "review", `${part} does not end on a low-friction ask`, part);
  }
  if (!checks.some((c) => c.code === "tells")) add("tells", "pass", "no clichés or machine tells");
  if (!checks.some((c) => c.code === "compensation")) add("compensation", "pass", "no compensation");
  const mine = (verdicts || []).filter((v) => v.beat.startsWith("outreach."));
  const unsupported = mine.filter((v) => v.factual && v.supported === false);
  if (!verdicts) add("support", "review", "no support verdicts (the fact check did not run)");
  else if (unsupported.length) add("support", "fail", `${unsupported.length} unsupported sentence(s): ${unsupported.map((v) => `"${v.sentence.slice(0, 100)}" (${v.reason.slice(0, 80)})`).join(" | ")}`);
  else add("support", "pass", `${mine.filter((v) => v.factual).length} factual sentence(s), all supported`);
  const status = checks.some((c) => c.severity === "fail") ? "fail" : checks.some((c) => c.severity === "review") ? "review" : "pass";
  return { status, checks };
}

/**
 * outreach.json: the note, its QA and its per-sentence sources.
 * @param {object} input
 * @param {string} input.runId
 * @param {string} input.company
 * @param {string} input.title
 * @param {string} [input.contact]
 * @param {{ greeting: string, contactName: string, linkedin: string, email: { subject: string, body: string } }} input.outreach
 * @param {ReturnType<typeof outreachQa>} input.qa
 * @param {Array<{ beat: string, sentence: string, factual: boolean, supported: boolean | null, reason: string, source?: string, intel?: { id: string, url: string, date: string } }> | null} [input.verdicts]
 * @param {string} input.generatedAt
 */
export function outreachRecord({ runId, company, title, contact = "", outreach, qa, verdicts = null, generatedAt }) {
  return {
    contract: OUTREACH_CONTRACT,
    runId,
    generatedAt,
    company,
    title,
    contact: outreach.contactName ? { name: outreach.contactName, source: contact ? "sheet" : "none", raw: String(contact).slice(0, 160) } : { name: "", source: "none" },
    greeting: outreach.greeting,
    linkedin: { text: outreach.linkedin, chars: outreach.linkedin.length, max: LINKEDIN_MAX_CHARS },
    email: { subject: outreach.email.subject, body: outreach.email.body, words: wordCount(outreach.email.body), max: EMAIL_MAX_WORDS },
    qa,
    sources: (verdicts || [])
      .filter((v) => v.beat.startsWith("outreach."))
      .map((v) => ({ part: v.beat.replace(/^outreach\./, ""), sentence: v.sentence, factual: v.factual, supported: v.supported, source: v.source || "", ...(v.intel ? { intel: v.intel } : {}), ...(v.reason ? { reason: v.reason } : {}) })),
  };
}

/**
 * outreach.txt: both notes, ready to paste.
 * @param {ReturnType<typeof outreachRecord>} record
 */
export function outreachText(record) {
  return [
    `LinkedIn note (${record.linkedin.chars}/${record.linkedin.max} characters)`,
    "",
    record.linkedin.text,
    "",
    `Email to the hiring manager (${record.email.words}/${record.email.max} words)`,
    "",
    `Subject: ${record.email.subject}`,
    "",
    record.email.body,
    "",
  ].join("\n");
}
