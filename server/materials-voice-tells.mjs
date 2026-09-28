/**
 * Materials — the "sounds human" detectors (voice v4).
 *
 * Deterministic checks for the tells that make a cover letter read as
 * machine-written: AI-flavoured words, warm gush, "not X, but Y" framing,
 * stacked tricolons, em-dash overuse, abstraction density, uniform
 * sentence rhythm, and generic or posting-restating openers and closers.
 *
 * Each detector is exported on its own so tests can pin it with positive
 * and negative fixtures. `voiceTells` runs them all over a letter's
 * paragraphs; `soundsHumanRow` turns the result into the rubric's
 * `sounds_human` row (0-2). delint reuses the span-shaped detectors so the
 * rewrite pass sees the same tells the rubric scores.
 */

/* Same split as materials-rubric's splitSentences (kept local so the
 * rubric can import this module without a cycle). */
/** @param {string} text */
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"$])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * @typedef {object} Tell
 * @property {string} code
 * @property {"hard" | "soft"} weight hard: any one fails the row; soft: two fail it
 * @property {string} text the offending words, or a measurement
 * @property {string} note
 * @property {number} [paragraph] zero-based paragraph index, when local
 */

/**
 * @typedef {object} TellRule
 * @property {string} pattern a regular expression, case-insensitive
 * @property {string} [note]
 */

/* Words and phrases that read as model output. The pack's `aiTells`
 * list extends these; it can never remove one. */
export const DEFAULT_AI_WORDS = /** @type {const} */ ([
  { pattern: "\\bdelv(?:e|es|ed|ing)\\b", note: "delve" },
  { pattern: "\\btapestr(?:y|ies)\\b", note: "tapestry" },
  { pattern: "\\b(?:a|is a|stands as a|serves as a) testament\\b", note: "testament" },
  { pattern: "\\bleverag(?:e|es|ed|ing)\\b", note: "leverage as a verb" },
  { pattern: "\\brobust(?:ly)?\\b", note: "robust" },
  { pattern: "\\bseamless(?:ly)?\\b", note: "seamless" },
  { pattern: "\\bsynerg(?:y|ies|istic|ize|ise)\\b", note: "synergy" },
  { pattern: "\\bholistic(?:ally)?\\b", note: "holistic" },
  { pattern: "\\bcutting[- ]edge\\b", note: "cutting-edge" },
  { pattern: "\\bnavigat(?:e|es|ed|ing) (?:the |an? )?(?:\\w+ )?(?:landscape|complexities|waters)\\b", note: "navigate the landscape" },
  { pattern: "\\b(?:in )?today'?s (?:fast[- ]paced|ever[- ]changing|rapidly|dynamic|digital)\\b", note: "in today's fast-paced" },
  { pattern: "\\bever[- ](?:evolving|changing)\\b", note: "ever-evolving" },
  { pattern: "\\bgame[- ]chang(?:er|ing)\\b", note: "game-changer" },
  { pattern: "\\bunderscor(?:e|es|ed|ing)\\b", note: "underscore" },
  { pattern: "\\bpivotal\\b", note: "pivotal" },
  { pattern: "\\brealm\\b", note: "realm" },
  { pattern: "\\bmeticulous(?:ly)?\\b", note: "meticulous" },
  { pattern: "\\b(?:moreover|furthermore|additionally)\\b", note: "essay connective" },
  { pattern: "\\bunlock(?:s|ed|ing)? (?:the )?(?:full )?(?:potential|value|growth)\\b", note: "unlock potential" },
  { pattern: "\\bempower(?:s|ed|ing)?\\b", note: "empower" },
]);

/* Warmth that tips into gush. */
export const GUSH_WORDS = /** @type {const} */ ([
  { pattern: "\\bpassionate\\b", note: "passionate" },
  { pattern: "\\bthrilled\\b", note: "thrilled" },
  { pattern: "\\bexcited (?:to|about|by)\\b", note: "excited to" },
  { pattern: "\\bdream (?:role|job|company|team)\\b", note: "dream role" },
  { pattern: "\\bdelighted to\\b", note: "delighted to" },
  { pattern: "\\bhonou?red to\\b", note: "honored to" },
]);

/* "It's not just X, it's Y" / "not X, but Y" / "X rather than Y". */
const CONTRAST_RES = [
  /\bit(?:'|’)?s not (?:just |only |merely |simply )?(?:about )?[^.;!?]{1,60}?[,;—–-]\s*(?:it(?:'|’)?s|it is|but)\b/gi,
  /\bnot (?:just|only|merely|simply) [^.;!?]{1,60}?[,;—–]?\s*but(?: also)?\b/gi,
  /\bnot [a-z][^.;!?,]{0,40}, but\b/gi,
  /\brather than\b/gi,
  /* "X aren't just A — they're B" / "isn't just A, it's B". */
  /\b(?:is|are|was|were)(?:n't|n’t|\s+not)\s+(?:just|only|merely|simply)\s+[^.;!?]{1,60}?[,;—–]\s*(?:it|they|he|she|we|this|that)(?:'|’)?(?:s|re|\s+is|\s+are)\b/gi,
];

/* A list of three short items: "A, B, and C" / "A, B and C". */
const TRICOLON_RE = /\b[\w’'/&+-]+(?:\s+[\w’'/&+-]+){0,3},\s+[\w’'/&+-]+(?:\s+[\w’'/&+-]+){0,3},?\s+(?:and|or)\s+[\w’'/&+-]+/i;

/* Abstract nouns that float without a number or a concrete thing nearby. */
export const ABSTRACT_NOUNS = new Set(
  (
    "adoption,alignment,governance,framework,frameworks,impact,impacts,strategy,strategies,acceleration,excellence," +
    "innovation,innovations,transformation,transformations,solution,solutions,capability,capabilities,synergy,initiative," +
    "initiatives,outcome,outcomes,value,success,depth,efficiency,efficiencies,optimization,orchestration,ecosystem,landscape," +
    "journey,vision,mindset,deployment,deployments,implementation,implementations,productivity,experimentation,integration," +
    "integrations,visibility,collaboration,engagement,stakeholders,scalability,empowerment,paradigm,excellence,enablement," +
    "readiness,expertise,insights,leadership,objectives,priorities,functions,workflows,processes,operations,momentum"
  ).split(","),
);

/* Qualities a machine cadence lists in threes ("speed, quality, and
 * trust"); together with ABSTRACT_NOUNS they mark a rhetorical list. */
const RHETORIC_WORDS = new Set(
  "speed,quality,trust,clarity,reach,frequency,loyalty,growth,scale,precision,creativity,rigor,agility,resilience,passion,purpose,vision,discipline,focus,curiosity,accountability,transparency,consistency,reliability".split(","),
);

/* Concrete nouns that anchor an abstraction ("enablement for 12 AE desks"). */
const CONCRETE_NOUNS = new Set(
  (
    "desk,desks,pitch,pitches,forecast,forecasts,forecaster,account,accounts,client,clients,campaign,campaigns,book,tool,tools," +
    "dashboard,dashboards,spreadsheet,market,markets,playbook,playbooks,call,calls,meeting,meetings,radio,station,stations," +
    "podcast,podcasts,deck,decks,report,reports,readout,readouts,bid,bids,keyword,keywords,budget,budgets,pipeline,pipelines," +
    "seller,sellers,rep,reps,aes,manager,managers,session,sessions,café,cafe,briefing,briefings,scan,scans,model,models," +
    "prototype,prototypes,app,platform,script,scripts,sheet,sheets,landing,page,pages,ad,ads,spend,quarter,week,weeks,month,months"
  ).split(","),
);

const FIRST_PERSON_RE = /\b(?:i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll|my|me|mine)\b/i;

const GENERIC_OPENER_RES = [
  /^(?:dear [^,]+,\s*)?i am writing\b/i,
  /^(?:dear [^,]+,\s*)?i(?:'|’)m writing\b/i,
  /^please accept\b/i,
  /^my name is\b/i,
  /^allow me\b/i,
  /^as an? [\w\s-]{2,60}? with (?:over |more than )?\d/i,
  /^with (?:over |more than )?\d+\+? years\b/i,
  /^i (?:am|was) (?:excited|thrilled|pleased|delighted|eager|writing|applying)\b/i,
  /^i(?:'|’)m (?:excited|thrilled|pleased|delighted|eager|applying)\b/i,
  /^i (?:would like|wish) to (?:apply|express|submit)\b/i,
];

/* A needs-statement about the company is the posting talking, not him. */
const NEEDS_RE = /\b(?:requires?|required|needs?|seeks?|is seeking|is looking for|demands?|calls? for|is hiring|is mobilizing|is building out|must have|wants a)\b/i;

const GENERIC_CLOSER_RES = [
  /\b(?:welcome|appreciate|value|relish) (?:the|an|any|this) (?:chance|opportunity)\b/i,
  /\blook(?:ing)? forward to\b/i,
  /\bthank you for (?:your|considering)\b/i,
  /\bat your (?:earliest )?convenience\b/i,
  /\bto discuss (?:how|my|the ways|further)\b/i,
  /\bcontribute to (?:your|the) (?:team|success|mission|growth)\b/i,
  /\bwould be a (?:great|strong|perfect|valuable|natural) (?:fit|addition|asset)\b/i,
  /\bdon(?:'|’)t hesitate\b/i,
  /\bfeel free to\b/i,
  /\bhope to hear\b/i,
];

/**
 * @param {string} text
 * @param {ReadonlyArray<TellRule>} rules
 * @returns {Array<{ start: number, end: number, text: string, note: string }>}
 */
export function matchRules(text, rules) {
  /** @type {Array<{ start: number, end: number, text: string, note: string }>} */
  const out = [];
  for (const rule of rules) {
    let re;
    try {
      re = new RegExp(rule.pattern, "gi");
    } catch {
      continue;
    }
    for (const m of String(text || "").matchAll(re)) {
      const start = m.index ?? 0;
      out.push({ start, end: start + m[0].length, text: m[0], note: rule.note || rule.pattern });
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {ReadonlyArray<TellRule>} [extra] the pack's `aiTells`
 */
export function detectAiWords(text, extra = []) {
  return matchRules(text, [...DEFAULT_AI_WORDS, ...extra]);
}

/** @param {string} text */
export function detectGush(text) {
  return matchRules(text, GUSH_WORDS);
}

/** @param {string} text */
export function detectContrastFrames(text) {
  /** @type {Array<{ start: number, end: number, text: string, note: string }>} */
  const out = [];
  const seen = new Set();
  for (const re of CONTRAST_RES) {
    for (const m of String(text || "").matchAll(re)) {
      const start = m.index ?? 0;
      if ([...seen].some((s) => Math.abs(/** @type {number} */ (s) - start) < 8)) continue;
      seen.add(start);
      out.push({ start, end: start + m[0].length, text: m[0], note: "contrast framing (not X, but Y)" });
    }
  }
  return out;
}

/**
 * A three-item list is rhetorical when its items are abstractions
 * ("speed, quality, and productivity"). A list of named, concrete
 * things (platforms, clients, numbers: "Google Ads, Meta, OTT/CTV") is
 * the writer being specific, not a machine cadence, and is not counted.
 * @param {string} sentence
 */
export function hasRhetoricalTricolon(sentence) {
  const re = new RegExp(TRICOLON_RE.source, "gi");
  for (const m of sentence.matchAll(re)) {
    const items = m[0].split(/,\s+|,?\s+(?:and|or)\s+/).map((item) => item.trim()).filter(Boolean);
    /* An item is rhetorical when it is lowercase abstraction: no name,
     * number or slash, and an abstract noun in it. */
    const rhetorical = items.filter((item) => {
      const words = item.split(/\s+/);
      if (words.some((w) => /\d|\/|^[A-Z]/.test(w) && w !== "I")) return false;
      return words.some((w) => ABSTRACT_NOUNS.has(w.toLowerCase()) || RHETORIC_WORDS.has(w.toLowerCase()));
    }).length;
    if (rhetorical >= 2) return true;
  }
  return false;
}

/**
 * Stacked tricolons: two sentences in a row that each carry an
 * "A, B, and C" list, or three such sentences anywhere in the text.
 * @param {string} text
 * @returns {{ stacked: boolean, count: number, sentences: string[] }}
 */
export function detectTricolonStacks(text) {
  const sentences = splitSentences(text);
  const flags = sentences.map(hasRhetoricalTricolon);
  const count = flags.filter(Boolean).length;
  const adjacent = flags.some((f, i) => f && flags[i + 1]);
  return { stacked: adjacent || count >= 3, count, sentences: sentences.filter((_, i) => flags[i]) };
}

/**
 * @param {string[]} paragraphs
 * @param {number} [max] em-dashes allowed per paragraph
 * @returns {Array<{ paragraph: number, count: number }>}
 */
export function detectEmDashOveruse(paragraphs, max = 1) {
  return paragraphs
    .map((p, paragraph) => ({ paragraph, count: (String(p || "").match(/—|\s–\s|\s--\s/g) || []).length }))
    .filter((p) => p.count > max);
}

/** @param {string} text */
function wordTokens(text) {
  return String(text || "")
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w$#]+|[^\w%+]+$/g, ""))
    .filter(Boolean);
}

/**
 * Abstraction density: the share of words that are abstract nouns with
 * no number, proper noun or concrete noun within four words either side.
 * The hiring company's own name does not anchor anything.
 * @param {string} text
 * @param {{ company?: string }} [options]
 * @returns {{ words: number, abstract: number, unanchored: string[], ratio: number }}
 */
export function abstractionDensity(text, { company = "" } = {}) {
  const companyWords = new Set(
    String(company || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
  /** @type {string[]} */
  const unanchored = [];
  let abstract = 0;
  let words = 0;
  for (const sentence of splitSentences(text)) {
    const toks = wordTokens(sentence);
    words += toks.length;
    const concrete = toks.map((tok, i) => {
      const lower = tok.toLowerCase().replace(/'s$/, "");
      if (companyWords.has(lower)) return false;
      if (/\d/.test(tok)) return true;
      if (CONCRETE_NOUNS.has(lower)) return true;
      /* A proper noun or acronym mid-sentence (Contoso, SEM, QBRs). */
      return i > 0 && /^[A-Z]/.test(tok) && !/^(?:I|I'm|I've|I'd|I'll)$/.test(tok);
    });
    toks.forEach((tok, i) => {
      const lower = tok.toLowerCase();
      if (!ABSTRACT_NOUNS.has(lower)) return;
      abstract += 1;
      const lo = Math.max(0, i - 4);
      const hi = Math.min(toks.length - 1, i + 4);
      for (let j = lo; j <= hi; j += 1) if (j !== i && concrete[j]) return;
      unanchored.push(lower);
    });
  }
  return { words, abstract, unanchored, ratio: words ? unanchored.length / words : 0 };
}

/**
 * Sentence rhythm: a human letter mixes a short sentence in with long
 * ones. Low spread (coefficient of variation) or no short sentence at
 * all reads as generated.
 * @param {string} text
 * @returns {{ count: number, lengths: number[], mean: number, cv: number, shortest: number }}
 */
export function sentenceRhythm(text) {
  const lengths = splitSentences(text).map((s) => wordTokens(s).length).filter((n) => n > 0);
  const count = lengths.length;
  const mean = count ? lengths.reduce((a, b) => a + b, 0) / count : 0;
  const variance = count ? lengths.reduce((a, n) => a + (n - mean) ** 2, 0) / count : 0;
  const cv = mean ? Math.sqrt(variance) / mean : 0;
  return { count, lengths, mean, cv, shortest: count ? Math.min(...lengths) : 0 };
}

/** @param {string} text */
function postingStems(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.replace(/(?:ing|ed|es|s)$/, ""));
}

/**
 * The opener. Generic ("I am writing to…", "With 10+ years…"), a
 * needs-statement about the company ("Seabright requires…"), or a first
 * sentence built from the posting's own words without the writer in it.
 * @param {string} firstParagraph
 * @param {{ postingText?: string }} [options]
 * @returns {{ code: string, text: string, note: string } | null}
 */
export function detectOpener(firstParagraph, { postingText = "" } = {}) {
  const para = String(firstParagraph || "").trim();
  const first = splitSentences(para)[0] || "";
  if (!first) return null;
  for (const re of GENERIC_OPENER_RES) {
    if (re.test(first)) return { code: "generic_opener", text: first.slice(0, 120), note: "stock cover-letter opener" };
  }
  if (FIRST_PERSON_RE.test(first)) return null;
  if (NEEDS_RE.test(first)) {
    return { code: "posting_opener", text: first.slice(0, 120), note: "opens by restating what the posting says the company needs" };
  }
  if (postingText) {
    const vocab = new Set(postingStems(postingText));
    const own = postingStems(first);
    const share = own.length ? own.filter((w) => vocab.has(w)).length / own.length : 0;
    if (own.length >= 4 && share >= 0.6) {
      return { code: "posting_opener", text: first.slice(0, 120), note: `opens with the posting's words (${Math.round(share * 100)}%) and no tie to the writer` };
    }
  }
  if (!FIRST_PERSON_RE.test(para)) {
    return { code: "untied_hook", text: first.slice(0, 120), note: "the opening paragraph never ties the company to something the writer did" };
  }
  return null;
}

/**
 * @param {string} lastParagraph
 * @returns {{ code: string, text: string, note: string } | null}
 */
export function detectCloser(lastParagraph) {
  const para = String(lastParagraph || "");
  for (const re of GENERIC_CLOSER_RES) {
    const m = re.exec(para);
    if (m) return { code: "generic_closer", text: m[0], note: "stock closer; end on a concrete next step" };
  }
  return null;
}

/**
 * Replace exact quotes of the user's signature lines with neutral
 * letters, keeping length and sentence ends, so the word-level lint skips
 * them. A paraphrase is not masked.
 * @param {string} text
 * @param {string[]} lines
 */
export function maskSignatures(text, lines) {
  let out = String(text || "");
  for (const line of lines || []) {
    if (!line || line.length < 12) continue;
    let at = out.indexOf(line);
    while (at >= 0) {
      out = out.slice(0, at) + line.replace(/[^.!?\s]/g, "x") + out.slice(at + line.length);
      at = out.indexOf(line, at + line.length);
    }
  }
  return out;
}

/* Off-voice framing any letter must avoid: flattery openers, false
 * humility, compensation numbers, pejorative departure framing. */
const OFF_VOICE = /** @type {const} */ ([
  { code: "flattery", re: /\b(?:I(?:'|’)ve (?:long )?admired|I have (?:long )?admired|I(?:'|’)m (?:a (?:huge|big) fan|impressed by|inspired by)|I am (?:a (?:huge|big) fan|impressed by|inspired by)|what (?:excites|draws|attracts) me (?:most )?(?:to|about)|I love (?:what|how) [A-Z])/gi, note: "admiring the company" },
  { code: "false_humility", re: /\b(?:(?:might|may) not have (?:the |a )?(?:perfect|ideal|exact|typical|traditional)|although I (?:lack|don(?:'|’)t have)|while I (?:may|might) not|I know I(?:'|’)m not)/gi, note: "false humility" },
  { code: "compensation", re: /\b(?:salary|compensation|OTE|base pay|pay range)\b[^.]{0,40}\$?\d|\$\d[\d,.]*\s?[kK]?\s+(?:salary|base|OTE)/gi, note: "compensation in a letter" },
  { code: "departure_framing", re: /\b(?:laid off|let go|was fired|got fired|terminated)\b/gi, note: "pejorative departure framing; use the structural framing" },
]);

/* Praise of the company in the letter: the company as subject with a
 * superlative or an admiring verdict ("NorthwindMedia turns reach into
 * scale better than anyone"). */
const COMPANY_PRAISE_RE = /\b(?:better than (?:anyone|anybody|any other|most)|like no (?:one|other)|second to none|world[- ]class|best[- ]in[- ]class|the best (?:in|at)|unmatched|unrivaled|incredible|impressive|admirable|brilliant(?:ly)?|industry[- ]leading|leads the (?:industry|market|way)|a true leader|pioneer(?:ing)?|iconic|legendary)\b/i;

/**
 * @param {string} text
 * @param {string} company
 * @returns {Array<{ text: string, note: string }>}
 */
export function detectCompanyPraise(text, company) {
  const name = String(company || "").replace(/,?\s+(inc|llc|ltd|corp|corporation|co|plc)\.?$/i, "").trim().toLowerCase();
  if (!name) return [];
  return splitSentences(text)
    .filter((sentence) => sentence.toLowerCase().includes(name) && COMPANY_PRAISE_RE.test(sentence))
    .map((sentence) => ({ text: sentence.slice(0, 120), note: "praises the company; open with a fact about the writer or the role" }));
}

/* A purpose-clause opener: "To scale that strategy, I…", "In order to…". */
const PURPOSE_OPENER_RE = /^(?:To\s+[a-z]+\b[^.!?]{0,120},\s*(?:I|we)\b|In order to\b)/;

/** @param {string} text */
export function detectPurposeOpeners(text) {
  return splitSentences(text)
    .filter((sentence) => PURPOSE_OPENER_RE.test(sentence))
    .map((sentence) => ({ text: sentence.slice(0, 120), note: "purpose-clause opener; say what you did" }));
}

/** @param {string} text */
export function detectOffVoice(text) {
  /** @type {Array<{ code: string, start: number, end: number, text: string, note: string }>} */
  const out = [];
  for (const rule of OFF_VOICE) {
    for (const m of String(text || "").matchAll(rule.re)) {
      const start = m.index ?? 0;
      out.push({ code: rule.code, start, end: start + m[0].length, text: m[0], note: rule.note });
    }
  }
  return out;
}

/* A canned aside: a short, factless "The X proved/kept/was Y." line
 * dropped in for texture ("The lift proved the model.", "It took daily
 * discipline."). Personality comes from the user's own phrasing instead. */
const CANNED_ASIDE_RE = /^(?:The|It|That|This)\s+(?:\w+\s+){0,2}(?:kept|proved|was|took|made|paid|did|worked|held|showed|mattered|stuck|landed|won)\b(?:\s+[\w-]+){0,4}\.$/;

/** @param {string} text */
export function detectCannedAsides(text) {
  /** @type {Array<{ text: string, note: string }>} */
  const out = [];
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/).length;
    if (words > 7 || /\d/.test(sentence) || FIRST_PERSON_RE.test(sentence)) continue;
    if (CANNED_ASIDE_RE.test(sentence)) out.push({ text: sentence, note: "canned aside; use the writer's own phrasing for personality" });
  }
  return out;
}

/**
 * @typedef {object} VoiceTellOptions
 * @property {string} [company]
 * @property {string} [postingText]
 * @property {ReadonlyArray<TellRule>} [aiTells] extra AI-word rules from the pack
 * @property {number} [paragraphEmDashMax]
 * @property {number} [abstractionMax] unanchored abstract nouns per word
 * @property {number} [rhythmCvMin]
 * @property {number} [shortSentenceMax] words; at least one sentence this short
 * @property {string[]} [signatureLines] the user's own lines, exempt when quoted exactly
 * @property {string[]} [signatureTellLines] the user's signature/philosophy
 *   lines that must stay in the hook or close (never approved facts)
 */

/* Finite verbs a letter opener uses: a first-person subject, a modal or
 * copula, or a past/present verb form. A sentence with none of these is a
 * noun phrase ("Digital marketing consultant … with eight years at …"). */
const FINITE_VERB_RE = new RegExp(
  [
    "\\b(?:i|we|i'm|i’m|i've|i’ve|i'd|i’d|i'll|i’ll)\\b",
    "\\b(?:am|is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|may|might|must)\\b",
    "\\b[a-z]{3,}ed\\b(?!\\s+(?:by|in|at)\\b)",
    "\\b(?:led|built|ran|grew|won|sold|made|kept|drove|shipped|spent|took|gave|went|became|brought|taught|wrote|bought|found|held|leads|builds|runs|grows|sells|makes|keeps|drives|ships|spends|helps|wants|want|need|needs|know|knows|love|loves|mention|mentions)\\b",
  ].join("|"),
  "i",
);

/**
 * True when a sentence carries a finite verb (heuristic, English).
 * @param {string} sentence
 */
export function hasFiniteVerb(sentence) {
  /* The main clause only: a relative clause ("…, where I coached …")
   * does not give a headline-style noun phrase a verb. */
  const main = String(sentence || "").split(/,?\s+(?:where|who|whom|whose|which|when|while)\s+/i)[0];
  return FINITE_VERB_RE.test(main);
}

/**
 * True when a sentence has no finite verb. A fragment as the first letter
 * sentence is advisory-only whether or not it starts with a role noun.
 * @param {string} sentence
 */
export function isVerblessOpener(sentence) {
  const s = String(sentence || "").trim();
  return Boolean(s) && !hasFiniteVerb(s);
}

/**
 * Every tell in a letter, paragraph by paragraph.
 * @param {string[]} paragraphs the letter body in reading order
 * @param {VoiceTellOptions} [options]
 * @returns {{ tells: Tell[], metrics: { abstraction: ReturnType<typeof abstractionDensity>, rhythm: ReturnType<typeof sentenceRhythm>, tricolons: number } }}
 */
export function voiceTells(paragraphs, options = {}) {
  const paras = paragraphs.map((p) => String(p || "").trim()).filter(Boolean);
  const text = paras.join("\n\n");
  const {
    company = "",
    postingText = "",
    aiTells = [],
    paragraphEmDashMax = 1,
    abstractionMax = 0.025,
    rhythmCvMin = 0.25,
    shortSentenceMax = 9,
    signatureLines = [],
    signatureTellLines = [],
  } = options;
  /** @type {Tell[]} */
  const tells = [];
  /* The user's own signature lines, quoted exactly, are exempt from the
   * word-level lint (a paraphrase is not). */
  const masked = paras.map((p) => maskSignatures(p, signatureLines));
  masked.forEach((para, paragraph) => {
    for (const hit of detectAiWords(para, aiTells)) tells.push({ code: "ai_word", weight: "hard", text: hit.text, note: hit.note, paragraph });
    for (const hit of detectGush(para)) tells.push({ code: "gush", weight: "hard", text: hit.text, note: hit.note, paragraph });
    for (const hit of detectContrastFrames(para)) tells.push({ code: "contrast_frame", weight: "hard", text: hit.text, note: hit.note, paragraph });
    for (const hit of detectOffVoice(para)) tells.push({ code: hit.code, weight: "hard", text: hit.text, note: hit.note, paragraph });
    for (const hit of detectCannedAsides(para)) tells.push({ code: "canned_aside", weight: "hard", text: hit.text, note: hit.note, paragraph });
    for (const hit of detectPurposeOpeners(para)) tells.push({ code: "purpose_opener", weight: "hard", text: hit.text, note: hit.note, paragraph });
  });
  masked.forEach((para, paragraph) => {
    for (const hit of detectCompanyPraise(para, company)) tells.push({ code: "flattery", weight: "hard", text: hit.text, note: hit.note, paragraph });
  });
  if (paras.length) {
    const opener = detectOpener(paras[0], { postingText });
    if (opener) tells.push({ ...opener, weight: "hard", paragraph: 0 });
    const closer = detectCloser(paras[paras.length - 1]);
    if (closer) tells.push({ ...closer, weight: "hard", paragraph: paras.length - 1 });
  }
  /* A verbless first sentence ("Digital marketing consultant and AI
   * product builder with eight years at …") reads like a headline, not a
   * letter. Soft: a REVIEW, never a rewrite. */
  if (paras.length) {
    const first = splitSentences(paras[0])[0] || "";
    if (first && isVerblessOpener(first)) {
      tells.push({ code: "verbless_opener", weight: "soft", text: first.slice(0, 80), note: "the first sentence has no verb; open in the first person", paragraph: 0 });
    }
  }
  /* A signature line belongs in the hook or the close; quoted in the middle
   * of the evidence it reads as a slogan. Only the user's signature or
   * philosophy lines count, never an approved fact: digit-free and 6+
   * words (review defect 1). Soft: a REVIEW, never a rewrite. */
  const tellLines = signatureTellLines.filter((l) => !/\d/.test(l) && String(l).trim().split(/\s+/).length >= 6);
  if (paras.length >= 3 && tellLines.length) {
    const norm = (/** @type {string} */ t) =>
      String(t || "").toLowerCase().replace(/[“”"]/g, "").replace(/[’]/g, "'").replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
    const lines = tellLines.map(norm).filter((l) => l.length >= 12);
    paras.slice(1, -1).forEach((para, i) => {
      const hay = norm(para);
      const hit = lines.find((l) => hay.includes(l));
      if (hit) {
        tells.push({ code: "signature_mid_evidence", weight: "soft", text: hit.slice(0, 80), note: "a signature line belongs in the hook or the close, not in the evidence", paragraph: i + 1 });
      }
    });
  }
  for (const dash of detectEmDashOveruse(masked, paragraphEmDashMax)) {
    tells.push({ code: "em_dash", weight: "soft", text: `${dash.count} em-dashes`, note: `more than ${paragraphEmDashMax} em-dash in one paragraph`, paragraph: dash.paragraph });
  }
  const tri = detectTricolonStacks(masked.join("\n\n"));
  if (tri.stacked) {
    tells.push({ code: "tricolon_stack", weight: "soft", text: tri.sentences.map((s) => s.slice(0, 60)).join(" | "), note: `${tri.count} three-item lists stacked` });
  }
  const abstraction = abstractionDensity(text, { company });
  if (abstraction.ratio > abstractionMax && abstraction.unanchored.length >= 3) {
    tells.push({
      code: "abstraction_density",
      weight: "soft",
      text: abstraction.unanchored.slice(0, 8).join(", "),
      note: `${abstraction.unanchored.length} abstract nouns with no number or concrete thing nearby (${(abstraction.ratio * 100).toFixed(1)}% of words)`,
    });
  }
  const rhythm = sentenceRhythm(text);
  if (rhythm.count >= 4 && (rhythm.cv < rhythmCvMin || rhythm.shortest > shortSentenceMax)) {
    tells.push({
      code: "uniform_rhythm",
      weight: "soft",
      text: `lengths ${rhythm.lengths.join("/")}`,
      note: rhythm.cv < rhythmCvMin
        ? `sentence lengths barely vary (spread ${rhythm.cv.toFixed(2)})`
        : `no sentence of ${shortSentenceMax} words or fewer`,
    });
  }
  return { tells, metrics: { abstraction, rhythm, tricolons: tri.count } };
}

/**
 * The rubric row: 2 with no tells, 1 with soft tells only, 0 with any
 * hard tell. Confident work verbs such as "drove" and "led" are not tells
 * by themselves; the detectors score specific boilerplate and cadence.
 * @param {string[]} paragraphs
 * @param {VoiceTellOptions} [options]
 * @returns {{ id: "sounds_human", score: number, max: 2, note: string, tells: Tell[] }}
 */
export function soundsHumanRow(paragraphs, options = {}) {
  const { tells } = voiceTells(paragraphs, options);
  const hard = tells.filter((t) => t.weight === "hard");
  const soft = tells.filter((t) => t.weight === "soft");
  /* Voice v6: only a hard tell scores 0 (a FAIL that earns the one
   * repair); soft tells cost a point (REVIEW) but never trigger a rewrite. */
  const score = !paragraphs.some((p) => String(p || "").trim()) ? 0 : hard.length ? 0 : soft.length ? 1 : 2;
  const note = !tells.length
    ? "no machine tells"
    : `${tells.length} machine tell(s): ${tells.map((t) => `${t.code} "${t.text.slice(0, 80)}" (${t.note})`).join(" | ")}`;
  return { id: "sounds_human", score, max: 2, note, tells };
}

/**
 * The letter's paragraphs as rendered (voice v5, three paragraphs): hook
 * and companyInsight open, proof1 and proof2 are the evidence paragraph,
 * ask closes. v1 drafts keep one paragraph per beat.
 * @param {Record<string, unknown> | null | undefined} letter
 * @returns {string[]}
 */
export function letterParagraphs(letter) {
  const l = letter && typeof letter === "object" ? letter : {};
  const str = (/** @type {unknown} */ v) => (typeof v === "string" ? v.trim() : "");
  if ("hook" in l || "companyInsight" in l || "proof1" in l) {
    return [
      [str(l.hook), str(l.companyInsight)].filter(Boolean).join(" "),
      [str(l.proof1), str(l.proof2)].filter(Boolean).join(" "),
      str(l.ask),
    ].filter(Boolean);
  }
  return Object.values(l).map(str).filter(Boolean);
}
