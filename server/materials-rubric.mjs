/**
 * Materials v3 — the per-document rubric (plan slice 5, mechanism §7.2;
 * Wave 1 L4 adds P-10 / C-7 / P-15 rows).
 *
 * Deterministic scoring over extract + selection + draft + delint spans,
 * one document at a time. Each row scores 0–2.
 *
 *   resume: outcome_coverage, noun_fidelity, proof_density,
 *           transfer_honesty, omission_record, delint_clean,
 *           metric_dropped, underfill
 *   letter: outcome_coverage, noun_fidelity, transfer_honesty,
 *           delint_clean, company_specificity, metric_in_letter,
 *           letter_ungrounded, sounds_human
 *
 * READY needs a total at or above readyThreshold(max) (10 of every 12)
 * with zero fails. The note on each row says exactly what moved it, so a
 * REVIEW or FAIL package explains itself.
 */

import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { stem, termIndex, termMatches } from "./materials-claim-score.mjs";
import { numerals } from "./materials-metric-tag.mjs";
import { describeUpgrades, scopeUpgrades } from "./materials-scope.mjs";
import { letterParagraphs, soundsHumanRow } from "./materials-voice-tells.mjs";

/**
 * @typedef {object} RubricRow
 * @property {string} id
 * @property {number} score
 * @property {number} max
 * @property {string} note
 */

/** @param {string} text */
function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 4);
}

/**
 * @param {{ statement?: unknown, bullets?: Array<{ text?: unknown }>, earlier?: Array<{ text?: unknown }> }} draft
 */
function resumeText(draft) {
  const parts = [];
  if (typeof draft.statement === "string") parts.push(draft.statement);
  for (const b of draft.bullets || []) {
    if (b && typeof b.text === "string") parts.push(b.text);
  }
  for (const line of draft.earlier || []) {
    if (line && typeof line.text === "string") parts.push(line.text);
  }
  return parts.join("\n");
}

/**
 * Letter paragraphs in beat order, whatever the draft schema names them.
 * @param {{ letter?: Record<string, unknown> }} draft
 * @returns {Array<[string, string]>}
 */
export function letterBeats(draft) {
  const letter = draft.letter && typeof draft.letter === "object" ? draft.letter : {};
  /** @type {Array<[string, string]>} */
  const out = [];
  for (const [beat, text] of Object.entries(letter)) {
    if (typeof text === "string" && text.trim()) out.push([beat, text]);
  }
  return out;
}

/** 10 of every 12 points, rounded up. */
export function readyThreshold(/** @type {number} */ max) {
  return Math.ceil((max * 10) / 12);
}

const LEGAL_SUFFIX_RE = /[,\s]+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|s\.a|group|holdings)\.?$/i;

/**
 * The ways a letter may name the company: the name without its legal
 * suffix ("NorthwindMedia, Inc." → "northwindmedia").
 * @param {string} company
 * @returns {string[]}
 */
export function companyAliases(company) {
  let name = String(company || "").trim();
  for (let i = 0; i < 3 && LEGAL_SUFFIX_RE.test(name); i += 1) name = name.replace(LEGAL_SUFFIX_RE, "").trim();
  name = name.toLowerCase();
  return name.length >= 2 ? [name] : [];
}

/**
 * @param {string} haystack lowercased
 * @param {string} needle lowercased
 */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  const re = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
  return (haystack.match(re) || []).length;
}

const GROUNDING_STOPWORDS = new Set([
  "about", "across", "after", "again", "their", "there", "these", "those", "which", "while", "where",
  "would", "could", "should", "other", "through", "including", "within", "without", "every", "being",
  "company", "business", "experience", "years", "people", "teams", "work", "worked", "working",
]);

/**
 * @param {object} input
 * @param {"resume" | "letter"} [input.document] which document to score
 * @param {{ outcomes?: Array<{ id?: unknown }>, nouns?: Array<{ term?: unknown }> }} input.extract
 * @param {{ kept?: Array<{ claimId?: unknown, mapsTo?: unknown[] }>, omittedEmployers?: Array<{ employerId?: unknown, justified?: unknown }> }} input.selection
 * @param {{ employers?: Array<{ id?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown, metrics?: Array<{ token?: unknown }> }>, toolInventory?: Array<{ tool?: unknown }> }} input.ledger
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ text?: unknown }>, letter?: Record<string, unknown> }} input.draft
 * @param {Array<{ severity?: unknown, field?: unknown }>} [input.delintSpans]
 * @param {string} [input.company] letter: the hiring company's name
 * @param {{ ratio: number, basis: string } | null} [input.fill] resume: how full the page is
 * @param {Array<{ claimId?: unknown }>} [input.droppedClaims] resume: claims the page budget dropped (P-15)
 * @param {string[]} [input.skills] resume: the rendered skills line (it is resume text too)
 * @param {string} [input.postingText] letter: the posting, the other legal source of facts
 * @param {{ aiTells?: Array<{ pattern: string, note?: string }>, humanVoice?: Record<string, number>, signatureLines?: string[], signatureTellLines?: string[] }} [input.voice] letter: the pack's extra AI-word rules, thresholds and the user's exempt signature lines
 * @param {Array<{ sentence: string, factual: boolean, supported: boolean | null, reason: string, source?: string }> | null} [input.support] letter: the model's meaning-level verdicts (null: overlap check only)
 * @param {string} [input.intelText] letter: the company intel pack's dated, sourced facts (Wave 3), a legal source for company facts beside the posting
 */
export function scoreRubric({
  document = "resume",
  extract,
  selection,
  ledger,
  draft,
  delintSpans = [],
  company = "",
  fill = null,
  droppedClaims = [],
  skills = [],
  postingText = "",
  voice = {},
  support = null,
  intelText = "",
}) {
  const isLetter = document === "letter";
  /* Wave 3: grounding and numeral tracing accept the intel pack's facts
   * as they accept the posting's; the voice checks read the posting alone. */
  const factSources = intelText ? [postingText, intelText].filter(Boolean).join("\n") : postingText;
  /** @type {RubricRow[]} */
  const rows = [];
  const kept = selection.kept || [];
  const mapped = new Set(kept.flatMap((k) => (Array.isArray(k.mapsTo) ? k.mapsTo : [])));
  const beats = letterBeats(draft);
  const text = isLetter ? beats.map(([, t]) => t).join("\n") : resumeText(draft);
  const words = new Set(tokens(text));
  const claimsById = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const ledgerTokens = new Set(
    (ledger.claims || []).flatMap((c) =>
      Array.isArray(c.metrics) ? c.metrics.map((m) => String(m.token || "")) : [],
    ),
  );

  /* Outcome coverage: kept claims map to the extract's outcomes. */
  const outcomes = extract.outcomes || [];
  const covered = outcomes.filter((o) => mapped.has(o.id)).length;
  const outcomeRatio = outcomes.length ? covered / outcomes.length : 1;
  rows.push({
    id: "outcome_coverage",
    score: outcomeRatio >= 0.8 ? 2 : outcomeRatio >= 0.5 ? 1 : 0,
    max: 2,
    note: `${covered}/${outcomes.length} outcomes mapped by kept claims`,
  });

  /* Noun fidelity: the document speaks the posting's nouns — matched
   * with the same light stemming and synonyms the claim scorer uses
   * ("podcasts" meets "podcast", "OTT/CTV" meets "CTV"). */
  const nouns = (extract.nouns || []).map((n) => String(n.term || "").toLowerCase()).filter(Boolean);
  const nounIndex = termIndex([text, ...(isLetter ? [] : skills.filter((t) => typeof t === "string"))].join("\n"));
  const hitNouns = nouns.filter((term) => words.has(term) || termMatches(term, nounIndex)).length;
  const nounRatio = nouns.length ? hitNouns / Math.min(nouns.length, 10) : 1;
  /* Voice v6: a 130-200 word letter carries fewer posting nouns than a
   * resume; four earns full marks, two earns one. */
  const nounScore = isLetter
    ? !nouns.length || hitNouns >= Math.min(4, nouns.length) ? 2 : hitNouns >= 2 ? 1 : 0
    : nounRatio >= 0.7 ? 2 : nounRatio >= 0.4 ? 1 : 0;
  rows.push({
    id: "noun_fidelity",
    score: nounScore,
    max: 2,
    note: `${hitNouns}/${nouns.length} role nouns appear in the ${isLetter ? "letter" : "resume"}`,
  });

  /* Proof density: kept claims carry metrics. */
  if (!isLetter) {
    const withProof = kept.filter((k) => {
      const claim = claimsById.get(k.claimId);
      return claim && Array.isArray(claim.metrics) && claim.metrics.length > 0;
    }).length;
    const proofRatio = kept.length ? withProof / kept.length : 0;
    rows.push({
      id: "proof_density",
      score: proofRatio >= 0.6 ? 2 : proofRatio >= 0.3 ? 1 : 0,
      max: 2,
      note: `${withProof}/${kept.length} kept claims carry metrics`,
    });
  }

  /* Transfer honesty: every tool named is ledger-evidenced. */
  const inventoried = new Set(
    (ledger.toolInventory || []).map((t) => String(t.tool || "").toLowerCase()),
  );
  /* Scan the text for tool-shaped tokens against a small lexicon; any
   * hit outside the inventory is an invention. */
  const lexicon = [
    "kafka", "postgres", "airflow", "python", "sql", "bigquery", "snowflake",
    "dbt", "spark", "flink", "gemini", "claude", "openai", "gcp", "aws",
    "kubernetes", "docker", "terraform", "redis", "ga4", "tableau",
  ];
  const invented = lexicon.filter((tool) => words.has(tool) && ![...inventoried].some((inv) => inv.includes(tool)));
  const toolHits = lexicon.filter((tool) => words.has(tool));
  rows.push({
    id: "transfer_honesty",
    /* A letter that names no tool invents none: no point lost (voice v6). */
    score: invented.length ? 0 : toolHits.length || isLetter ? 2 : 1,
    max: 2,
    note: invented.length
      ? `invented tools: ${invented.join(", ")}`
      : toolHits.length
        ? `${toolHits.length} named tools all ledger-evidenced`
        : "no tools named",
  });

  /* Omission record: non-featured employers are justified. Only
   * employers that own ledger claims can be omitted from the selection. */
  if (!isLetter) {
    const featuredEmployers = new Set(
      kept.map((k) => claimsById.get(k.claimId)?.employerId).filter(Boolean),
    );
    const claimedEmployers = new Set(
      (ledger.claims || []).map((c) => c && c.employerId).filter(Boolean),
    );
    const omitted = selection.omittedEmployers || [];
    const unjustified = (ledger.employers || []).filter(
      (e) => e && e.id && claimedEmployers.has(e.id) && !featuredEmployers.has(e.id) && !omitted.some((o) => o.employerId === e.id && o.justified),
    );
    rows.push({
      id: "omission_record",
      score: unjustified.length ? 0 : 2,
      max: 2,
      note: unjustified.length
        ? `unjustified omissions: ${unjustified.map((e) => e.id).join(", ")}`
        : "every omission recorded with a reason",
    });
  }

  /* Delint clean: this document's spans after the rewrite pass. */
  const ownSpans = delintSpans.filter((span) => {
    const field = typeof span.field === "string" ? span.field : "";
    return isLetter ? field.startsWith("letter.") : !field.startsWith("letter.");
  });
  const fails = ownSpans.filter((s) => s.severity === "fail").length;
  rows.push({
    id: "delint_clean",
    score: fails ? 0 : ownSpans.length ? 1 : 2,
    max: 2,
    note: fails ? `${fails} failing spans remain` : ownSpans.length ? `${ownSpans.length} review spans remain` : "no spans",
  });

  if (!isLetter) {
    /* Metric dropped: a bullet whose claim carries a number, written
     * without any of that claim's numbers. */
    const dropped = (draft.bullets || []).filter((b) => {
      const claim = b && claimsById.get(b.claimId);
      const own = claim && Array.isArray(claim.metrics) ? claim.metrics.map((m) => String(m.token || "")).filter(Boolean) : [];
      if (!own.length) return false;
      const used = numerals(typeof b.text === "string" ? b.text : "");
      return !own.some((token) => used.includes(token));
    });
    rows.push({
      id: "metric_dropped",
      score: dropped.length === 0 ? 2 : dropped.length === 1 ? 1 : 0,
      max: 2,
      note: dropped.length
        ? `${dropped.length} bullet(s) dropped their claim's metric: ${dropped.map((b) => String(b.claimId)).join(", ")}`
        : "every metric-bearing claim kept its number",
    });

    /* Underfill (P-15): the page is under 60% full. */
    const ratio = fill && Number.isFinite(fill.ratio) ? fill.ratio : 0;
    const basis = fill && fill.basis ? fill.basis : "no fill measurement";
    const droppedNote = droppedClaims.length ? `; page budget dropped ${droppedClaims.length} claim(s)` : "";
    rows.push({
      id: "underfill",
      score: ratio >= 0.85 ? 2 : ratio >= 0.6 ? 1 : 0,
      max: 2,
      note: `page ${Math.round(ratio * 100)}% full (${basis})${droppedNote}`,
    });
  } else {
    /* Company specificity (rule 1): named ≥ 2 times, once in the first
     * 40 words. */
    const lower = text.toLowerCase();
    const opening = text.split(/\s+/).slice(0, 40).join(" ").toLowerCase();
    const aliases = companyAliases(company);
    const mentions = aliases.reduce((n, alias) => n + countOccurrences(lower, alias), 0);
    const early = aliases.some((alias) => countOccurrences(opening, alias) > 0);
    rows.push({
      id: "company_specificity",
      score: mentions >= 2 && early ? 2 : mentions >= 1 ? 1 : 0,
      max: 2,
      note: !aliases.length
        ? "no company name to check"
        : mentions
          ? `${company} named ${mentions}×${early ? ", in the first 40 words" : ", not in the first 40 words"}`
          : `${company} is never named in the letter`,
    });

    /* Metric in letter (rule 2): ≥ 2 traced ledger metrics. */
    const letterNumerals = numerals(text);
    const traced = letterNumerals.filter((token) => ledgerTokens.has(token));
    /* A posting fact may carry its own number ("reaches 90% of
     * Americans"); only numbers from neither source are untraced. */
    const postingNumerals = new Set(numerals(factSources));
    const untraced = letterNumerals.filter((token) => !ledgerTokens.has(token) && !postingNumerals.has(token));
    rows.push({
      id: "metric_in_letter",
      score: traced.length >= 2 ? 2 : traced.length === 1 ? 1 : 0,
      max: 2,
      note: traced.length ? `${traced.length} traced ledger metric(s): ${traced.join(", ")}` : "the letter carries no ledger metric",
    });

    /* Letter ungrounded (proof-run design 4): every sentence that states
     * a fact maps to a ledger claim or to a posting fact. */
    const judged = applySupport(letterSentenceGrounding({ draft, ledger, postingText: factSources, company }), support);
    const factual = judged.filter((j) => j.factual);
    const ungrounded = factual.filter((j) => !j.grounded);
    /* Each proof paragraph must also rest on a claim: at least one
     * grounded factual sentence. */
    const proofBeats = beats.filter(([beat]) => /proof/i.test(beat)).map(([beat]) => beat);
    const bareProofs = proofBeats.filter((beat) => !factual.some((j) => j.beat === beat && j.grounded));
    rows.push({
      id: "letter_ungrounded",
      score: untraced.length || !beats.length || ungrounded.length || bareProofs.length ? 0 : 2,
      max: 2,
      note: untraced.length
        ? `untraced numeral(s) in the letter: ${untraced.join(", ")}`
        : !beats.length
          ? "the letter has no paragraphs"
          : bareProofs.length && !ungrounded.length
            ? `${bareProofs.length}/${proofBeats.length} proof paragraph(s) rest on no ledger claim: ${bareProofs.join(", ")}`
            : ungrounded.length
            ? `${ungrounded.length} sentence(s) rest on no ledger claim, voice fact or posting fact; rewrite each from one named claim's own words in first person (keep the letter inside its word band): ${ungrounded
              .map((j) => `"${j.sentence.slice(0, 160)}"${j.reason && !/^(?:rests on|posting overlap|no factual)/.test(j.reason) ? ` (${j.reason.slice(0, 160)})` : ""}`)
              .join(" | ")}`
            : `${factual.length}/${factual.length} factual sentence(s) rest on a ledger claim or posting fact`,
    });

    /* Sounds human (voice v4): no AI words, gush, contrast framing,
     * stock opener or closer; soft tells (em-dashes, stacked tricolons,
     * abstraction density, flat rhythm) cost a point each. */
    const human = soundsHumanRow(letterParagraphs(draft.letter), {
      company,
      postingText,
      aiTells: voice.aiTells || [],
      ...(voice.humanVoice || {}),
      signatureLines: voice.signatureLines || [],
      signatureTellLines: voice.signatureTellLines || [],
    });
    rows.push({ id: human.id, score: human.score, max: human.max, note: human.note });
  }

  const max = rows.reduce((n, row) => n + row.max, 0);
  return { rows, total: rows.reduce((n, row) => n + row.score, 0), max, threshold: readyThreshold(max) };
}

/**
 * How full the resume page is: the measured last text line when a
 * browser laid it out, else visible words against the budget's lower
 * band (a page at the band floor counts as full).
 * @param {{ measurement?: { lastTextBottom?: unknown, limit?: unknown } | null } | null | undefined} fit
 * @param {string} txt the rendered resume.txt
 * @returns {{ ratio: number, basis: string }}
 */
export function resumeFill(fit, txt) {
  const m = fit && fit.measurement;
  if (m && typeof m.lastTextBottom === "number" && typeof m.limit === "number" && m.limit > 0) {
    return { ratio: Math.min(1, m.lastTextBottom / m.limit), basis: "measured" };
  }
  const words = String(txt || "").split(/\s+/).filter(Boolean).length;
  const full = MATERIALS_BUDGETS.resume.visibleWords[0];
  return { ratio: Math.min(1, words / full), basis: `${words} words of ${full} estimated` };
}

/* ------------------------------------------------------------------ *
 * Sentence grounding (proof-run design 4)
 * ------------------------------------------------------------------ */

/* Words any letter may use without a source: framing, asks, connectives. */
const FRAME_WORDS = new Set(
  ("would,could,should,will,have,has,been,being,that,this,these,those,with,from,into,onto,over,under,across,through," +
    "about,after,before,while,where,when,which,what,your,yours,their,them,they,then,than,also,each,every,both,more,most," +
    "such,same,just,very,well,here,there,like,want,walk,show,share,talk,discuss,conversation,call,meet,next,step,plan," +
    "role,position,posting,team,teams,work,help,bring,make,made,take,know,look,ready,glad,happy,today,week,month," +
    "kind,sort,part,exact,exactly,directly,already,since,because,that's,it's,i'd,i've,i'm,we've,let,lets,company," +
    "hiring,candidate,letter,dear,best,thank,thanks,which,whose,around,toward,towards,within,without,every,other,another,one,two,three," +
    "turn,turned,turning,use,used,using,put,get,got,give,gave,move,moved,start,started,also,still,again,together,able").split(","),
);

/* A sentence claims a fact when it carries a number, a first-person
 * accomplishment, or a claim about the company's rank or reach. */
const FIRST_PERSON_FACT = /\b(?:i|we|my team|our team)\s+(?:\w+\s+){0,2}?(?:led|built|drove|grew|ran|won|managed|coached|shipped|delivered|secured|supported|earned|launched|created|designed|deployed|owned|increased|reduced|doubled|tripled|trained|hired|closed|generated|kept|turned|helped|partnered|guided|steered|elevated|outpaced|achieved|exceeded|expanded|retained|built|stood|spent|have\s+\w+ed|had\s+\w+ed)\b/i;
const COMPANY_FACT = /\b(?:largest|leading|leads|leader in|number one|#\s?1|no\.\s?1|only|biggest|fastest|top|most|reaches|reach of|ranked|award|recognized)\b/i;

/** @param {string} text */
function contentStems(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-z0-9$%+'-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 4 && !FRAME_WORDS.has(w) && !GROUNDING_STOPWORDS.has(w))
    .map((w) => stem(w.replace(/-/g, "")));
}

/** @param {string} text */
export function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"$])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Judge every letter sentence: is it factual, and does it rest on a
 * ledger claim or a posting fact? A factual sentence is grounded when
 *   - it shares a ledger metric token, or
 *   - no more than a quarter of its content words come from outside the
 *     ledger and the posting, and a first-person claim shares 2+ content
 *     words with one ledger claim, and
 *   - a claim about the company (rank, reach, "only", a number) overlaps
 *     one posting sentence by 0.6 of its content words.
 * @param {object} input
 * @param {{ letter?: Record<string, unknown> }} input.draft
 * @param {{ claims?: Array<{ text?: unknown, metrics?: Array<{ token?: unknown }> }> }} input.ledger
 * @param {string} [input.postingText]
 * @param {string} [input.company]
 * @returns {Array<{ beat: string, sentence: string, factual: boolean, grounded: boolean, reason: string }>}
 */
export function letterSentenceGrounding({ draft, ledger, postingText = "", company = "" }) {
  const claimSets = (ledger.claims || []).map((c) => ({
    stems: new Set(contentStems(typeof c.text === "string" ? c.text : "")),
    metrics: Array.isArray(c.metrics) ? c.metrics.map((m) => String(m.token || "")).filter(Boolean) : [],
  }));
  /* Employer names and titles are ledger facts too ("Digital Sales Manager"). */
  const employerStems = (/** @type {{ employers?: Array<{ name?: unknown, title?: unknown, roles?: unknown }> }} */ (ledger).employers || [])
    .flatMap((e) => contentStems([e && e.name, e && e.title].filter((v) => typeof v === "string").join(" ")));
  const ledgerVocab = new Set([...claimSets.flatMap((c) => [...c.stems]), ...employerStems]);
  const postingSentences = splitSentences(String(postingText || "").replace(/\s*\n\s*/g, ". "))
    .map((t) => new Set(contentStems(t)))
    .filter((set) => set.size);
  const postingVocab = new Set(postingSentences.flatMap((set) => [...set]));
  const companyStems = new Set(contentStems(companyAliases(company).join(" ")));
  const postingNumerals = new Set(numerals(postingText));
  /* Review defect 5: the sources a candidate sentence may not upgrade. */
  const scopeSources = [
    ...(ledger.claims || []).map((c) => (typeof c.text === "string" ? c.text : "")),
    ...(/** @type {{ employers?: Array<{ name?: unknown, title?: unknown }> }} */ (ledger).employers || []).map((e) =>
      [e && e.name, e && e.title].filter((v) => typeof v === "string").join(" · "),
    ),
  ];
  /** @type {Array<{ beat: string, sentence: string, factual: boolean, grounded: boolean, reason: string }>} */
  const out = [];
  for (const [beat, para] of letterBeats(draft)) {
    for (const sentence of splitSentences(para)) {
      const nums = numerals(sentence);
      const firstPerson = FIRST_PERSON_FACT.test(sentence);
      const companyClaim = !firstPerson && (COMPANY_FACT.test(sentence) || (nums.length > 0 && nums.every((n) => postingNumerals.has(n))));
      /* A sentence about the candidate that upgrades scope, scale,
       * seniority, team size or tech depth past its source is ungrounded,
       * even when it states no other fact ("hands-on seller development"). */
      const upgrades = companyClaim ? [] : scopeUpgrades(sentence, scopeSources);
      if (upgrades.length) {
        out.push({ beat, sentence, factual: true, grounded: false, reason: `scope upgrade: ${describeUpgrades(upgrades)} is not in the claim it restates` });
        continue;
      }
      const factual = nums.length > 0 || firstPerson || companyClaim;
      if (!factual) {
        out.push({ beat, sentence, factual, grounded: true, reason: "no factual claim" });
        continue;
      }
      const stems = contentStems(sentence).filter((w) => !companyStems.has(w));
      if (companyClaim) {
        /* Judged clause by clause: the clause that carries the claim (a
         * number, a rank) must restate one posting sentence (0.6 of its
         * words); the other clauses may only use posting or ledger words. */
        const clauses = sentence.split(/,\s+(?:and|but|while|so|which)\s+|;\s+|\s+[—–]\s+/).filter((c) => c.trim());
        let worst = 1;
        let ok = true;
        for (const clause of clauses) {
          const cs = contentStems(clause).filter((w) => !companyStems.has(w));
          if (!cs.length) continue;
          const claimy = COMPANY_FACT.test(clause) || numerals(clause).length > 0;
          if (claimy) {
            const best = postingSentences.reduce((m, set) => Math.max(m, cs.filter((w) => set.has(w)).length / cs.length), 0);
            worst = Math.min(worst, best);
            if (best < 0.6) ok = false;
          } else if (cs.filter((w) => !postingVocab.has(w) && !ledgerVocab.has(w)).length / cs.length > 0.25) {
            ok = false;
          }
        }
        out.push({ beat, sentence, factual, grounded: ok, reason: `posting overlap ${worst.toFixed(2)}` });
        continue;
      }
      const metricHit = claimSets.some((c) => c.metrics.some((m) => nums.includes(m)));
      const foreign = stems.filter((w) => !ledgerVocab.has(w) && !postingVocab.has(w));
      const foreignRatio = stems.length ? foreign.length / stems.length : 0;
      const anchor = claimSets.reduce((m, c) => Math.max(m, stems.filter((w) => c.stems.has(w)).length), 0);
      const grounded = foreignRatio <= 0.25 && (metricHit || anchor >= 2);
      out.push({
        beat,
        sentence,
        factual,
        grounded,
        reason: grounded ? "rests on a ledger claim" : `unsupported words: ${foreign.slice(0, 6).join(", ")}${anchor < 2 && !metricHit ? "; no claim anchor" : ""}`,
      });
    }
  }
  return out;
}

/**
 * Meaning-level grounding (voice v5): the overlap judgement AND the
 * model's verdict. A sentence the model finds factual but unsupported is
 * ungrounded even when its words overlap a claim ("building tools that
 * tie directly to revenue pipeline"). Sentences without a verdict (added
 * after the check, or no model) keep the overlap judgement alone.
 * @param {Array<{ beat: string, sentence: string, factual: boolean, grounded: boolean, reason: string }>} judged
 * @param {Array<{ sentence: string, factual: boolean, supported: boolean | null, reason: string, source?: string }> | null | undefined} support
 */
export function applySupport(judged, support) {
  if (!Array.isArray(support) || !support.length) return judged;
  const bySentence = new Map(support.map((v) => [v.sentence.trim(), v]));
  return judged.map((j) => {
    const v = bySentence.get(j.sentence.trim());
    if (!v || !v.factual || v.supported !== false) return j;
    return { ...j, factual: true, grounded: false, reason: `unsupported in meaning: ${v.reason || "no claim states it"}${v.source ? `; rewrite from ${v.source}` : ""}` };
  });
}
