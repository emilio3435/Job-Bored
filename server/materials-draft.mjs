/**
 * Materials v3 — draft (plan slice 4, mechanism §6.4).
 *
 * The third and final model call: outline + claim texts become plain
 * strings — a statement, one string per featured bullet keyed by claim
 * id, earlier lines, and five role-typed letter beats (hook,
 * companyInsight, proof1, proof2, ask; draft v2). The prompt carries the
 * company, the title, the job's outcomes and nouns, full claim text with
 * its employer, the template's word band and the role's enrichment
 * (C-1 / P-1 / C-4). Post-call rules repair
 * coverage deterministically (missing bullets fall back to claim text,
 * unknown ids are dropped, markup is stripped); a model failure yields
 * a degraded verbatim draft and the run continues to QA.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { claimById } from "./materials-ledger.mjs";
import { intelPromptLines } from "./materials-intel.mjs";
import { isAiClaim, isAiRole, namedClientProofs, positioningFor, wantsNamedClient } from "./materials-positioning.mjs";
import { runJsonStage, schemaInvalidCall } from "./materials-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-draft.v2.schema.json");
const SCHEMA_V1_PATH = resolvePath(__dirname, "..", "schemas", "materials-draft.v1.schema.json");
const VOICE_PATH = resolvePath(__dirname, "materials-voice.json");

export const DRAFT_CONTRACT = "materials.draft.v2";
export const DRAFT_CONTRACT_V1 = "materials.draft.v1";
/** The v2 letter beats, in reading order. */
export const LETTER_BEATS = /** @type {const} */ (["hook", "companyInsight", "proof1", "proof2", "ask"]);
export const DRAFT_MAX_OUTPUT_TOKENS = 4096;

/** @type {Map<string, import("ajv").ValidateFunction<unknown>>} */
const cachedValidators = new Map();

/** @param {string} [path] */
function loadValidator(path = SCHEMA_PATH) {
  const cachedValidator = cachedValidators.get(path);
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(path, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  const compiled = ajv.compile(schema);
  cachedValidators.set(path, compiled);
  return compiled;
}

/**
 * Validates a v2 draft, or a v1 draft stored by an older run (old
 * packages stay readable).
 * @param {unknown} candidate
 */
export function validateDraft(candidate) {
  const isV1 =
    candidate && typeof candidate === "object" && /** @type {{ contract?: unknown }} */ (candidate).contract === DRAFT_CONTRACT_V1;
  const validate = loadValidator(isV1 ? SCHEMA_V1_PATH : SCHEMA_PATH);
  const ok = validate(candidate);
  if (ok) return { ok: true, draft: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

/* Writing rules 1-9 from the materials overhaul spec (rule 10 is QA's),
 * rewritten for voice v4: one curious inventor with an analyst's eye,
 * writing by hand. The voice guide itself lives in materials-voice.json
 * and is appended by draftSystemPrompt. */
const DRAFT_SYSTEM_PROMPT = [
  "You write resume slots and a cover letter for one job from the candidate's verified claims. Return JSON only:",
  '{"statement":"","bullets":[{"claimId","text"}],"earlier":[{"claimId","text"}],"letter":{"hook","companyInsight","proof1","proof2","ask"}}.',
  "Facts: use only the listed claims. Keep every metric token verbatim. No new facts, tools, employers, titles or metrics. No markup in any field.",
  "Resume: one bullet per listed claim id, in the candidate's voice, compressed to resume density, no I-statements.",
  "Rule 3: bullets show scope, then result, then rank (book or team size, the result, the ranking), in that order, when the claim has them.",
  "Rule 6: the statement is one sentence in the candidate's own terms and positioning (see the summary line in the voice guide, and the user's voice guide when given); never restate the posting's job title as their identity.",
  "Letter shape: THREE short paragraphs. Paragraph 1 is hook + companyInsight (2-3 sentences in total); paragraph 2 is proof1 + proof2 (3-4 sentences in total, one or two concrete proofs); paragraph 3 is ask (1-2 sentences). companyInsight may be empty. Fewer words over more.",
  "Rule 1: the hook opens with the most relevant fact about the candidate for this role, in the lead positioning the candidate's voice guide names (use that positioning's exact words), with one specific number or named client; never with admiration of the company, never with what the company requires, needs or seeks, and never with a paraphrase of the posting. Name the company within the first two sentences, in a sentence about what the candidate wants to do there or a listed company fact; never characterize the company beyond the posting.",
  "Never copy 8 or more words in a row from the posting. Never add a fact that is not listed.",
  "No purpose-clause openers anywhere: never start a sentence with 'To <verb> …, I' or 'In order to'; say what the candidate did.",
  "Grounding: every sentence that states a fact about the candidate restates one listed claim or approved voice fact (its numbers, its employer, its words); every sentence about the company restates a listed company fact or the posting. Nothing else: no invented results, clients, scopes, causes, commitments, comparisons or outcomes, and no connective claim that links two facts in a way no source does. A sentence with no fact in it may be the candidate's own words.",
  "Rule 2: proof1 opens with the candidate's single biggest relevant number (the claim marked proof1) and names the employer or project. Say how it was measured when the claim says so.",
  "Rule 4: proof1 and proof2 each answer the one named job responsibility assigned to them, and each carries at least one metric token from its claim. Proof sentences stay close to the claim's own wording (its nouns, verbs and numbers), in first person and active voice: 'I supported 12 AE desks…', not a retelling.",
  "Rule 5: mirror the job's exact nouns only where a claim supports them.",
  "Rule 7: the word band below is a hard requirement. ask says what the candidate wants to do next and makes a direct ask, and names the company again. Never 'I would welcome the chance', 'I look forward to', or 'thank you for your consideration'.",
  "Name the company within the first 40 words of the letter: keep the first sentence short, or name the company in it.",
  "Open the letter with a first-person sentence that has a verb ('I spent eight years…'), never a headline-style noun phrase ('Digital marketing consultant with eight years…').",
  "Never upgrade scope, scale, seniority, team size or technical depth past the claim you restate: no 'enterprise', 'global', 'production', 'engineering', 'models', 'executive' or 'team of N' unless that claim says it for the same thing.",
  "Personality: at most one small line of it, in the hook or the close, taken from the candidate's own phrasing (signature lines when given, quoted exactly, never dropped in the middle of the evidence), never a made-up aside like 'The lift proved the model.' Clarity first.",
  "Rule 8: no abstract filler (operational integrity, strategic initiatives, ongoing success, synergy, adoption depth, governance frameworks, durable impact) unless a number follows it in the same sentence.",
  "Rule 9: match the company's register as the posting shows it. Proofs follow the role family's proof order; side projects outside that family appear only as supporting proof.",
  "Never echo the banned posting phrases.",
].join(" ");

/** @type {{ oneLine?: string, persona?: string, do?: string[], dont?: string[], summary?: string } | null} */
let cachedGuide = null;

/**
 * The one voice guide every role family inherits (voice v4), from
 * materials-voice.json.
 * @returns {{ oneLine?: string, persona?: string, do?: string[], dont?: string[], summary?: string }}
 */
export function voiceGuide() {
  if (!cachedGuide) {
    try {
      const pack = JSON.parse(readFileSync(VOICE_PATH, "utf8"));
      cachedGuide = pack && pack.guide && typeof pack.guide === "object" ? pack.guide : {};
    } catch {
      cachedGuide = {};
    }
  }
  return cachedGuide || {};
}

/**
 * The voice guide as prompt text: one paragraph the model reads before
 * any claim.
 * @returns {string}
 */
export function voiceGuideText() {
  const g = voiceGuide();
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return [
    "Voice guide (every letter and the summary line):",
    g.oneLine ? `Who: ${g.oneLine}` : "",
    g.persona ? `Register: ${g.persona}` : "",
    list(g.do).length ? `Do: ${list(g.do).join(" ")}` : "",
    list(g.dont).length ? `Never: ${list(g.dont).join(" ")}` : "",
    g.summary ? `Summary line: ${g.summary}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The system prompt with the voice guide and the template's letter band
 * stated in it.
 * @param {number[] | undefined} letterWords
 */
export function draftSystemPrompt(letterWords) {
  const [lo, hi] = Array.isArray(letterWords) && letterWords.length === 2 ? letterWords : [120, 200];
  return `${DRAFT_SYSTEM_PROMPT} ${voiceGuideText()} Letter band: ${lo}-${hi} words total across the three paragraphs.`;
}

/**
 * @typedef {object} DraftEnrichment
 * @property {string} [fitAngle]
 * @property {string[]} [talkingPoints]
 * @property {string[]} [mustHaves]
 * @property {string} [contact]
 * @property {number} [fitScore]
 */

/** @type {Record<string, { lead?: string, proofs?: string, ask?: string }> | null} */
let cachedFamilies = null;

/**
 * @param {string} family
 * @returns {{ lead?: string, proofs?: string, ask?: string }}
 */
export function familyVoice(family) {
  if (!cachedFamilies) {
    try {
      const pack = JSON.parse(readFileSync(VOICE_PATH, "utf8"));
      cachedFamilies = pack && typeof pack.families === "object" ? pack.families : {};
    } catch {
      cachedFamilies = {};
    }
  }
  const families = cachedFamilies || {};
  return families[family] || families.general || {};
}

/**
 * The name a letter uses: "NorthwindMedia, Inc." reads as "NorthwindMedia".
 * @param {string} company
 */
export function displayCompany(company) {
  return String(company || "")
    .replace(/,?\s+(inc|llc|l\.l\.c|ltd|corp|corporation|co|plc|gmbh|s\.a|lp|llp)\.?$/i, "")
    .trim();
}

/**
 * The user-text half of the draft prompt: every fact the writer may use,
 * the plan for each letter beat, and the word band. Exported so tests can
 * snapshot what the model sees.
 * @param {object} input
 * @param {{ featured?: Array<{ employerId?: unknown, claimIds?: unknown[] }>, earlier?: unknown[], letterBeats?: Record<string, unknown> | null }} input.outline
 * @param {Record<string, unknown>} input.extract
 * @param {{ employers?: Array<{ id?: unknown, name?: unknown, title?: unknown, start?: unknown, end?: unknown }>, claims?: Array<{ id?: unknown, text?: unknown, employerId?: unknown, metrics?: Array<{ token?: unknown }> }> }} input.ledger
 * @param {string} input.feature
 * @param {string[]} input.featuredIds
 * @param {string[]} input.earlierIds
 * @param {number[]} [input.letterWords]
 * @param {DraftEnrichment | null} [input.enrichment]
 * @returns {string[]}
 */
export function draftPromptLines({ outline, extract, ledger, feature, featuredIds, earlierIds, letterWords, enrichment }) {
  const role = /** @type {Record<string, unknown>} */ (extract.role && typeof extract.role === "object" ? extract.role : {});
  const company = displayCompany(typeof role.company === "string" ? role.company : "");
  const title = typeof role.title === "string" ? role.title : "";
  const family = typeof role.family === "string" ? role.family : "general";
  const seniority = typeof role.seniority === "string" ? role.seniority : "";
  const employers = new Map((ledger.employers || []).map((e) => [e && e.id, e]));
  const outcomes = /** @type {Array<{ id?: unknown, text?: unknown, weight?: unknown }>} */ (
    Array.isArray(extract.outcomes) ? extract.outcomes : []
  );
  const outcomeText = new Map(outcomes.map((o) => [o.id, typeof o.text === "string" ? o.text : ""]));
  const nouns = /** @type {Array<{ term?: unknown }>} */ (Array.isArray(extract.nouns) ? extract.nouns : []);
  const facts = /** @type {unknown[]} */ (Array.isArray(extract.companyFacts) ? extract.companyFacts : []);

  /**
   * @param {unknown} v
   * @returns {v is string}
   */
  const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;

  /** @param {string} id */
  const claimLine = (id) => {
    const claim = claimById(ledger, id);
    if (!claim) return `- ${id}: (missing claim)`;
    const employer = typeof claim.employerId === "string" ? employers.get(claim.employerId) : null;
    const where = employer
      ? [employer.name, employer.title, [employer.start, employer.end ?? "present"].filter((v) => v !== undefined && v !== "").join("–")]
          .filter((v) => typeof v === "string" && v)
          .join(" · ")
      : "no employer on record";
    const rawMetrics = /** @type {{ metrics?: unknown }} */ (claim).metrics;
    const metrics = Array.isArray(rawMetrics)
      ? rawMetrics
          .map((/** @type {unknown} */ m) => {
            const token = m && typeof m === "object" ? /** @type {{ token?: unknown }} */ (m).token : undefined;
            return typeof token === "string" ? token : "";
          })
          .filter(Boolean)
      : [];
    const text = typeof claim.text === "string" ? claim.text : "";
    /* "- id: text" stays the first line so repair tooling can read it;
     * the employer and metric tokens ride on an indented line. */
    return `- ${id}: ${text.slice(0, 1200)}\n  from: ${where}${metrics.length ? ` · metrics: ${metrics.join(", ")}` : ""}`;
  };

  const lines = [
    `Company: ${company || "unknown"}`,
    `Job title: ${title || "unknown"}`,
    `Role family: ${family}${seniority ? ` · seniority: ${seniority}` : ""}`,
    "",
    "Job responsibilities (outcomes the hire must deliver):",
    ...outcomes.map((o) => `- [${String(o.id)}] ${String(o.text || "").slice(0, 300)}`),
    "",
    `Job nouns (mirror only where a claim supports them): ${nouns.slice(0, 20).map((n) => String(n.term)).join(", ")}`,
  ];
  if (facts.length) {
    lines.push("", "Company facts from the posting (the hook may cite one):", ...facts.slice(0, 4).map((f) => `- ${String(f).slice(0, 260)}`));
  }
  const e = enrichment || {};
  const enrichmentLines = [
    e.fitAngle ? `Fit angle (the thesis to argue): ${e.fitAngle}` : "",
    Array.isArray(e.talkingPoints) && e.talkingPoints.length ? `Talking points: ${e.talkingPoints.slice(0, 6).join(" | ")}` : "",
    Array.isArray(e.mustHaves) && e.mustHaves.length ? `Must-haves to show: ${e.mustHaves.slice(0, 6).join(" | ")}` : "",
    e.contact ? `Hiring contact: ${e.contact} (address the letter's ask to them by name)` : "",
    typeof e.fitScore === "number" ? `Fit score: ${e.fitScore}/10` : "",
  ].filter(Boolean);
  if (enrichmentLines.length) lines.push("", "What JobBored already knows about this role:", ...enrichmentLines);

  if (feature !== "cover_letter") {
    lines.push(
      "",
      `Role context: ${(outline.featured || []).length} featured employer(s).`,
      "Featured claims (one bullet each, same ids):",
      ...featuredIds.map(claimLine),
      "",
      "Earlier lines:",
      ...earlierIds.map(claimLine),
    );
  }

  const beats = outline.letterBeats && typeof outline.letterBeats === "object" ? outline.letterBeats : null;
  if (feature !== "resume" && beats) {
    const str = (/** @type {unknown} */ v) => (typeof v === "string" ? v : "");
    const proof1 = str(beats.proof1) || str(beats.analyticsProof);
    const proof2 = str(beats.proof2) || str(beats.aiOpsProof);
    const pain = (/** @type {string} */ id) => (id && outcomeText.get(id) ? `${id} — ${outcomeText.get(id)}` : "the job's heaviest responsibility");
    const voice = familyVoice(family);
    const [lo, hi] = Array.isArray(letterWords) && letterWords.length === 2 ? letterWords : [120, 200];
    lines.push(
      "",
      `Letter word band: ${lo}-${hi} words across the three paragraphs.`,
      `Letter plan (${family} voice):`,
      `- paragraph 1 (hook + companyInsight, 2-3 sentences): the most relevant fact about you for this role, bearing on ${pain(str(beats.hook))}; name ${company || "the company"} within the first 40 words (keep the first sentence under 30 words); no flattery.`,
      `- paragraph 2 (proof1 + proof2, 3-4 sentences): proof1 answers ${pain(str(beats.proof1Pain))} with claim ${proof1 || "none"}.`,
      `- proof2 answers ${pain(str(beats.proof2Pain))} with claim ${proof2 || "none"}.`,
      `- paragraph 3 (ask, 2 sentences): what you want to do next for ${company || "the company"}, then a short direct ask of nine words or fewer (e.g. "Worth a quick call this week?").`,
      `- Length: ${Math.max(lo, Math.round((lo + hi) / 2) - 15)}-${hi - 10} words in total (never under ${lo + 15}; count them); the evidence paragraph is exactly 3 or 4 sentences. Never open a proof with a purpose clause that ties it to the posting ("To scale that strategy, I…"); state what you did.`,
      "Letter proof claims:",
      ...[...new Set([proof1, proof2].filter(isNonEmptyString))].map(claimLine),
    );
    /* Voice v4.1: the band is a hard floor, filled with more grounded
     * proof, never padding. For an AI role the AI-builder claims lead. */
    const aiRole = isAiRole(/** @type {{ role?: { title?: unknown }, outcomes?: Array<{ text?: unknown }> }} */ (extract));
    const supporting = [...new Set([...featuredIds, ...earlierIds])]
      .filter((id) => id !== proof1 && id !== proof2)
      .map((id, i) => ({ id, i, ai: aiRole && isAiClaim(String(claimById(ledger, id)?.text || "")) }))
      .sort((a, b) => Number(b.ai) - Number(a.ai) || a.i - b.i)
      .slice(0, 4)
      .map((c) => c.id);
    if (supporting.length) {
      lines.push(
        `Supporting claims (if the letter would land under ${lo} words, add a proof sentence from one of these, restated closely in first person; never pad):`,
        ...supporting.map(claimLine),
      );
    }
    if (aiRole) {
      lines.push("This is an AI role: tell the AI systems the candidate built (from the claims) before sales-floor stories, mapped to the job's outcomes. Never invent.");
    }
    if (voice.lead || voice.proofs || voice.ask) {
      lines.push(
        "Proof order for this role family (the voice guide above still applies):",
        ...[voice.lead && `- Lead: ${voice.lead}`, voice.proofs && `- Proofs: ${voice.proofs}`, voice.ask && `- Ask: ${voice.ask}`].filter(isNonEmptyString),
      );
    }
  }
  return lines;
}

/**
 * @param {object} input
 * @param {{ featured?: Array<{ employerId?: unknown, claimIds?: unknown[] }>, earlier?: unknown[], letterBeats?: Record<string, unknown> | null }} input.outline
 * @param {{ jdHash?: unknown, role?: unknown, outcomes?: unknown, nouns?: unknown, companyFacts?: unknown }} input.extract
 * @param {{ ledgerHash?: unknown, employers?: Array<{ id?: unknown, name?: unknown, title?: unknown, start?: unknown, end?: unknown }>, claims?: Array<{ id?: unknown, text?: unknown, employerId?: unknown, metrics?: Array<{ token?: unknown }> }> }} input.ledger
 * @param {string} input.feature
 * @param {string[]} [input.voice]
 * @param {string[]} [input.echoBans]
 * @param {number[]} [input.letterWords] the template's letter word band
 * @param {DraftEnrichment | null} [input.enrichment] what JobBored knows about the role (C-4)
 * @param {string} [input.jdText] the posting: the hook's company fact must trace to it (design 5)
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 * @param {{ statement?: unknown }} [input.current] repair mode: the prior draft to edit
 * @param {string} [input.repairInstructions] repair mode: editor instructions
 * @param {import("./materials-voice-profile.mjs").VoiceProfile | null} [input.voiceProfile] the user's voice.md (source of truth for voice)
 * @param {import("./materials-intel.mjs").IntelFact[]} [input.intelFacts] the company intel pack's citeable facts (Wave 3)
 */
export async function draftSlots({
  outline,
  extract,
  ledger,
  feature,
  voice = [],
  echoBans = [],
  letterWords,
  enrichment = null,
  jdText = "",
  pin,
  fetchImpl,
  current,
  repairInstructions = "",
  voiceProfile = null,
  intelFacts = [],
}) {
  const featuredIds = (outline.featured || []).flatMap((f) =>
    Array.isArray(f.claimIds) ? f.claimIds.filter((id) => typeof id === "string") : [],
  );
  const earlierIds = Array.isArray(outline.earlier)
    ? outline.earlier.filter((id) => typeof id === "string")
    : [];
  /* Degraded path: no pin, no model call — verbatim claim text. */
  if (!pin) {
    return { draft: degradedDraft({ extract, ledger, featuredIds, earlierIds }), degraded: true };
  }
  const lines = draftPromptLines({
    outline,
    extract: /** @type {Record<string, unknown>} */ (extract),
    ledger,
    feature,
    featuredIds,
    earlierIds,
    letterWords,
    enrichment,
  });
  if (echoBans.length) lines.push("", `Never echo these posting phrases: ${echoBans.join(" | ")}`);
  const positioning = positioningFor(/** @type {{ role?: { title?: unknown, family?: unknown }, outcomes?: Array<{ text?: unknown }> }} */ (extract), jdText, voiceProfile);
  lines.push(...positioningLines(positioning));
  if (feature !== "resume") lines.push(...intelPromptLines(intelFacts));
  lines.push(...voiceProfileLines(voiceProfile, { positioning }));
  if (voice.length && !voiceProfile) {
    lines.push("", "Voice (match it, never quote it):", ...voice.slice(0, 4).map((v) => `- ${v.slice(0, 400)}`));
  }
  /* F8: repair is editing, not regeneration — the current draft plus the
   * notes as editor instructions. */
  if (current && repairInstructions) {
    lines.push(
      "",
      "REPAIR: rewrite the WHOLE letter (all five beats) as one piece, in one voice, fixing every issue below; do not patch or splice sentences. Keep the letter plan's shape and length (three paragraphs, evidence 3-4 sentences, a short direct ask, inside the word band). Keep every supported sentence's facts and wording unless an issue names it. If the letter is short, add a sentence only by restating one approved fact closely; never add an outcome, frequency, adjective, scope or cause the facts do not state. Keep the resume slots unless an issue names them.",
      `Instructions: ${repairInstructions.slice(0, 2000)}`,
      `Current draft: ${JSON.stringify(current).slice(0, 8000)}`,
    );
  }

  const { value: raw, call } = await runJsonStage({
      stage: "draft",
      pin,
      systemPrompt: draftSystemPrompt(letterWords),
      userText: lines.join("\n"),
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
      fetchImpl,
    });
  if (!raw) {
    return { draft: degradedDraft({ extract, ledger, featuredIds, earlierIds }), degraded: true, call };
  }
  const draft = repairDraft({ raw, extract, ledger, featuredIds, earlierIds, feature });
  const validation = validateDraft(draft);
  if (!validation.ok) {
    return {
      draft: degradedDraft({ extract, ledger, featuredIds, earlierIds }),
      degraded: true,
      call: schemaInvalidCall(call),
      rawReply: { stage: "draft", errors: validation.errors, reply: raw },
    };
  }
  return { draft, degraded: false, call };
}

/**
 * The user's voice guide as prompt lines (voice v5). It is the source of
 * truth: where it conflicts with the shipped guide in the system prompt,
 * it wins. Its approved facts may be stated as facts; its signature lines
 * may be quoted exactly (never paraphrased); its projects are named as
 * written so they render as links. Exported for prompt snapshot tests.
 * @param {import("./materials-voice-profile.mjs").VoiceProfile | null | undefined} profile
 * @param {{ positioning?: { kind: string, why: string, phrase: string } | null }} [options]
 * @returns {string[]}
 */
export function voiceProfileLines(profile, { positioning = null } = {}) {
  if (!profile) return [];
  /* Voice v6: the candidate's own cover-letter rewrites come first, as
   * the pattern to imitate; the rest of the guide follows. */
  /* A guide with no example titled for cover letters (the onboarding
   * template's "two short pairs") uses all of its examples as the pattern. */
  const titled = profile.examples.filter((ex) => /cover letter/i.test(ex.title));
  const letterExamples = titled.length ? titled : profile.examples;
  const otherExamples = titled.length ? profile.examples.filter((ex) => !/cover letter/i.test(ex.title)) : [];
  /** @type {string[]} */
  const lead = [];
  if (letterExamples.length) {
    lead.push(
      "",
      "THE PATTERN TO IMITATE: the candidate's own cover-letter rewrites, verbatim. Match their rhythm: short clauses, specific nouns (platforms, clients, numbers), one landing line. Their facts are approved; their placeholders are not.",
      ...letterExamples.flatMap((ex) => [`### ${ex.title}`, `Generic (never write like this): ${ex.generic}`, `His version (write like this): ${ex.better}`, ...(ex.why.length ? [`Why: ${ex.why.join(" ")}`] : [])]),
    );
  }
  if (profile.hookPatterns.length) {
    lead.push(
      "",
      "Hook pattern: when it fits the role, build one hook sentence on one of these lines of his, quoted EXACTLY (never paraphrased), then tie it to a specific fact about him:",
      ...profile.hookPatterns.slice(0, 12).map((l) => `- ${l}`),
    );
  }
  const lines = [
    ...lead,
    "",
    "THE CANDIDATE'S OWN VOICE GUIDE (source of truth for voice, positioning and letter shape; where it conflicts with the shipped voice guide, follow this one):",
    profile.guideText,
  ];
  if (profile.facts.length) {
    lines.push(
      "",
      "Approved voice facts (the candidate approved these; state them as facts, closely, with their numbers and client names; nothing beyond them):",
      ...profile.facts.map((f, i) => `- voice-${i + 1}: ${f.slice(0, 400)}`),
    );
  }
  if (profile.signatureLines.length) {
    lines.push(
      "",
      "Signature lines (at most one per letter, quoted EXACTLY as written, or not at all; never paraphrase them):",
      ...profile.signatureLines.slice(0, 40).map((l) => `- ${l}`),
    );
  }
  if (profile.links.length) {
    lines.push("", `Projects: write these names exactly as shown; they render as links: ${profile.links.map((l) => l.text).join(", ")}.`);
  }
  if (positioning && wantsNamedClient(/** @type {import("./materials-positioning.mjs").PositioningKind} */ (positioning.kind))) {
    const proofs = namedClientProofs(profile);
    if (proofs.length) {
      lines.push(
        "",
        "Named-client proof: this role rewards scale and client work, so the evidence paragraph uses ONE of these approved named-client proofs, stated closely:",
        ...proofs.map((f) => `- ${f.slice(0, 300)}`),
      );
    }
  }
  if (otherExamples.length) {
    lines.push("", "More examples of the candidate's voice (generic → better):");
    for (const ex of otherExamples) {
      lines.push(`### ${ex.title}`, `Generic: ${ex.generic}`, `Better: ${ex.better}`, ...(ex.why.length ? [`Why: ${ex.why.join(" ")}`] : []));
    }
  }
  return lines;
}

/**
 * The positioning line for the draft prompt (any user, voice guide or
 * not): which identity leads the hook and the summary for this role.
 * @param {{ kind: string, why: string, phrase: string }} positioning
 * @returns {string[]}
 */
export function positioningLines(positioning) {
  const lead = positioning.phrase
    ? `"${positioning.phrase}"`
    : positioning.kind === "ai"
      ? "the AI and product work the candidate built"
      : positioning.kind === "performance"
        ? "the candidate's in-house growth and performance results"
        : "the candidate's client, agency or consulting work";
  return [
    "",
    `Positioning for this role (${positioning.why}): the hook's first sentence and the resume statement lead with ${lead}.${positioning.kind === "ai" ? " AI-builder proof leads the evidence; do not force a client story." : ""} Other identities are supporting evidence.`,
  ];
}

/**
 * @param {string} text
 */
function stripMarkup(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Post-call rules: unknown ids out, missing bullets backfilled with
 * claim text, markup stripped, letter beats defaulted to empty strings.
 * @param {object} input
 * @param {Record<string, unknown>} input.raw
 * @param {{ jdHash?: unknown }} input.extract
 * @param {{ ledgerHash?: unknown, claims?: Array<{ id?: unknown, text?: unknown }> }} input.ledger
 * @param {string[]} input.featuredIds
 * @param {string[]} input.earlierIds
 * @param {string} input.feature
 */
function repairDraft({ raw, extract, ledger, featuredIds, earlierIds, feature }) {
  const pick = (/** @type {unknown} */ value) =>
    /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});
  const bullets = [];
  /** @type {Map<string, string>} */
  const offered = new Map();
  if (Array.isArray(raw.bullets)) {
    for (const entry of raw.bullets) {
      if (!entry || typeof entry !== "object") continue;
      const { claimId, text } = /** @type {{ claimId?: unknown, text?: unknown }} */ (entry);
      if (typeof claimId !== "string" || !featuredIds.includes(claimId)) continue;
      if (typeof text !== "string" || !text.trim() || offered.has(claimId)) continue;
      offered.set(claimId, stripMarkup(text).slice(0, 1200));
    }
  }
  for (const id of featuredIds) {
    const claim = claimById(ledger, id);
    const fallback = claim && typeof claim.text === "string" ? claim.text : "";
    bullets.push({ claimId: id, text: offered.get(id) || fallback });
  }
  /** @type {Array<{ claimId: string | null, text: string }>} */
  const earlier = [];
  /** @type {Map<string, string>} */
  const offeredEarlier = new Map();
  if (Array.isArray(raw.earlier)) {
    for (const entry of raw.earlier) {
      if (!entry || typeof entry !== "object") continue;
      const { claimId, text } = /** @type {{ claimId?: unknown, text?: unknown }} */ (entry);
      if (typeof text !== "string" || !text.trim()) continue;
      if (typeof claimId === "string" && earlierIds.includes(claimId) && !offeredEarlier.has(claimId)) {
        offeredEarlier.set(claimId, stripMarkup(text).slice(0, 600));
      }
    }
  }
  for (const id of earlierIds) {
    const claim = claimById(ledger, id);
    const fallback = claim && typeof claim.text === "string" ? claim.text : "";
    earlier.push({ claimId: id, text: offeredEarlier.get(id) || fallback });
  }
  const letter = pick(raw.letter);
  const str = (/** @type {unknown} */ value) =>
    typeof value === "string" ? stripMarkup(value).slice(0, 2000) : "";
  /* A model that answers in the v1 beat names still lands in v2 slots. */
  const beat = (/** @type {string} */ v2, /** @type {string} */ v1) => str(letter[v2] !== undefined ? letter[v2] : letter[v1]);
  return {
    contract: DRAFT_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    statement: feature === "cover_letter" ? "" : str(raw.statement),
    bullets: feature === "cover_letter" ? [] : bullets,
    earlier: feature === "cover_letter" ? [] : earlier,
    letter:
      feature === "resume"
        ? emptyLetter()
        : {
            hook: beat("hook", "thesis"),
            companyInsight: beat("companyInsight", "companyInsight"),
            proof1: beat("proof1", "analyticsProof"),
            proof2: beat("proof2", "aiOpsProof"),
            ask: beat("ask", "nextStep"),
          },
  };
}

/**
 * Deterministic fallback: claim text verbatim, letter empty (QA will
 * REVIEW the letter band honestly rather than ship invented prose).
 * @param {object} input
 * @param {{ jdHash?: unknown }} input.extract
 * @param {{ ledgerHash?: unknown, claims?: Array<{ id?: unknown, text?: unknown }> }} input.ledger
 * @param {string[]} input.featuredIds
 * @param {string[]} input.earlierIds
 */
function degradedDraft({ extract, ledger, featuredIds, earlierIds }) {
  const textOf = (/** @type {string} */ id) => {
    const claim = claimById(ledger, id);
    return claim && typeof claim.text === "string" ? claim.text : "";
  };
  return {
    contract: DRAFT_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    statement: "",
    bullets: featuredIds.map((claimId) => ({ claimId, text: textOf(claimId) })),
    earlier: earlierIds.map((claimId) => ({ claimId, text: textOf(claimId) })),
    letter: emptyLetter(),
  };
}

/** @returns {{ hook: string, companyInsight: string, proof1: string, proof2: string, ask: string }} */
function emptyLetter() {
  return { hook: "", companyInsight: "", proof1: "", proof2: "", ask: "" };
}

