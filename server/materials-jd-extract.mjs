/**
 * Materials v3 — jd.extract (plan slice 4, mechanism §6.2).
 *
 * Deterministic pass first: role, stack terms lifted from the
 * requirements block, weighted nouns, and a stub outcome list. The narrow
 * LLM fill adds only what needs inference — outcomes, differentiators,
 * bars, constraints, echo bans, and noun weights. Output validates
 * against materials.jd-extract.v1; a malformed extract retries once and
 * then degrades to the deterministic half.
 */

import { findTool } from "./materials-tool-match.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { runJsonStage, schemaInvalidCall } from "./materials-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-jd-extract.v1.schema.json");

export const JD_EXTRACT_CONTRACT = "materials.jd-extract.v1";
export const EXTRACT_MAX_OUTPUT_TOKENS = 4096;
const MAX_JD_CHARS = 12_000;

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let cachedValidator = null;

function loadValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** @param {unknown} candidate */
export function validateJdExtract(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, extract: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

/** @param {string} text */
export function hashJd(text) {
  return `sha256:${createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16)}`;
}

const STOP_WORDS = new Set(
  "the,a,an,and,or,but,for,with,from,that,this,these,those,your,you,our,we,are,was,were,has,have,had,will,would,should,could,can,must,may,not,no,yes,if,then,than,into,over,under,about,across,through,during,before,after,above,below,both,each,other,such,only,also,just,very,more,most,many,much,some,any,all,per,via,including,include,includes,using,use,used,based,within,without,plus,etc,role,team,years,year".split(","),
);

/* Stack terms lifted verbatim from the requirements block. */
const STACK_TERMS = [
  "airflow", "kafka", "postgres", "postgresql", "mysql", "bigquery", "snowflake",
  "redshift", "dbt", "spark", "flink", "python", "sql", "go", "rust", "java",
  "typescript", "javascript", "r", "scala", "kotlin", "ruby", "terraform", "kubernetes",
  "docker", "gcp", "aws", "azure", "vertex ai", "gemini", "claude", "openai",
  "looker studio", "looker", "tableau", "power bi", "ga4", "google analytics", "google tag manager", "amplitude", "mixpanel", "segment",
  "elasticsearch", "redis", "pinecone", "langchain", "rag", "google ads", "meta",
  "dv360", "salesforce", "hubspot", "jira", "figma", "excel", "sheets",
];

/* ------------------------------------------------------------------ *
 * Sections (C-2 / P-11): postings are About-us, the role, requirements,
 * then pay, benefits and EEO. Only the role and requirements blocks say
 * what the hire must do; the rest is boilerplate.
 * ------------------------------------------------------------------ */

/** @typedef {"duties" | "summary" | "requirements" | "boilerplate" | "unknown"} SectionKind */

const SECTION_PATTERNS = /** @type {Array<[SectionKind, RegExp]>} */ ([
  ["duties", /^(what you['’]ll do|what you will do|responsibilities|key responsibilities|your responsibilities|duties|essential (duties|functions)|in this role|the role|about the role|role overview|what you['’]ll be doing|your impact|day[- ]to[- ]day|you will)\b/i],
  ["summary", /^(what we need|the opportunity|position summary|job summary|overview|summary|about the (job|position))\b/i],
  ["requirements", /^(what you['’]ll need|what you will need|what you['’]ll bring|what you bring|requirements|qualifications|basic qualifications|preferred qualifications|minimum qualifications|must[- ]haves?|nice to haves?|you have|who you are|skills|experience)\b/i],
  ["boilerplate", /^(about (us|the company|[a-z0-9&.' -]{2,40})$|who we are|our (company|mission|values|story)|benefits|perks|compensation|salary|pay (range|type)|location|position type|time type|equal opportunity|eeo|diversity|why join|how to apply|application process|non-compete|e-verify)\b/i],
]);

/* Lines that are boilerplate wherever they appear. */
const BOILERPLATE_LINE =
  /click here|apply (now|today|anyway)|to apply|job posting title|equal opportunity|e-verify|non-compete|accepting applications|reasonable accommodation|protected (veteran|classification)|without regard to|we encourage you to apply|salary to be determined|benefits offering/i;

/**
 * A heading is a short line ending in ":" or a short title-ish line that
 * matches a known section name.
 * @param {string} line
 * @returns {SectionKind | null}
 */
function headingKind(line) {
  const trimmed = line.trim().replace(/^#+\s*/, "").replace(/\*\*/g, "");
  if (!trimmed || trimmed.length > 60) return null;
  const bare = trimmed.replace(/[:：]\s*$/, "").trim();
  const endsColon = /[:：]\s*$/.test(trimmed);
  const words = bare.split(/\s+/).length;
  for (const [kind, re] of SECTION_PATTERNS) {
    if (re.test(bare) && (endsColon || words <= 6)) return kind;
  }
  if (endsColon && words <= 6) return "unknown";
  return null;
}

/**
 * Split a posting into sections by heading. Text before the first heading
 * is "boilerplate" when the posting has a duties or summary heading later
 * (it is the About-us pitch), otherwise "unknown".
 * @param {string} text
 * @returns {Array<{ kind: SectionKind, heading: string, lines: string[] }>}
 */
export function splitSections(text) {
  /** @type {Array<{ kind: SectionKind, heading: string, lines: string[] }>} */
  const sections = [{ kind: "unknown", heading: "", lines: [] }];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const kind = headingKind(line);
    if (kind) {
      sections.push({ kind, heading: line.replace(/[:：]\s*$/, ""), lines: [] });
      continue;
    }
    sections[sections.length - 1].lines.push(line);
  }
  const hasRole = sections.some((s) => s.kind === "duties" || s.kind === "summary");
  if (hasRole && sections[0].kind === "unknown") sections[0].kind = "boilerplate";
  return sections.filter((s) => s.lines.length);
}

/** @param {string} line */
function cleanLine(line) {
  return line.replace(/^\s*(?:[-•*·▪◦]|\d+[.)])\s*/, "").trim();
}

/**
 * Role-relevant text only: duties, summary and requirements, minus
 * boilerplate lines. Falls back to the whole posting minus boilerplate
 * lines when no section is recognised.
 * @param {string} text
 */
function roleText(text) {
  const sections = splitSections(text);
  const keep = sections.filter((s) => s.kind === "duties" || s.kind === "summary" || s.kind === "requirements");
  const pool = keep.length ? keep : sections.filter((s) => s.kind !== "boilerplate");
  return pool
    .flatMap((s) => s.lines)
    .map(cleanLine)
    .filter((l) => l && !BOILERPLATE_LINE.test(l))
    .join("\n");
}

/* The role summary and duties say what the job is; requirements say
 * who fits. Summary nouns weigh most. */
const SECTION_WEIGHT = /** @type {Record<SectionKind, number>} */ ({
  summary: 2,
  duties: 1.5,
  requirements: 1,
  unknown: 1,
  boilerplate: 0,
});

/**
 * @param {string} text
 * @returns {Array<{ line: string, weight: number }>}
 */
function weightedRoleLines(text) {
  const sections = splitSections(text);
  const hasRole = sections.some((s) => s.kind === "duties" || s.kind === "summary" || s.kind === "requirements");
  return sections
    .filter((s) => (hasRole ? s.kind !== "boilerplate" && s.kind !== "unknown" : s.kind !== "boilerplate"))
    .flatMap((s) =>
      s.lines
        .map(cleanLine)
        .filter((l) => l && !BOILERPLATE_LINE.test(l))
        .map((line) => ({ line, weight: SECTION_WEIGHT[s.kind] })),
    );
}

/* The capitalised spelling an ambiguous stack term must appear in. */
const STACK_CANONICAL = /** @type {Record<string, string>} */ ({
  go: "Go", r: "R", meta: "Meta", segment: "Segment", sheets: "Sheets", excel: "Excel", spark: "Spark", rust: "Rust", looker: "Looker", flink: "Flink",
});

/** @param {string} text */
function requirementsBlock(text) {
  const sections = splitSections(text);
  const req = sections.filter((s) => s.kind === "requirements");
  if (req.length) return req.flatMap((s) => s.lines).join("\n");
  const m = /(requirements|qualifications|what you bring|must-have|you have)[:\s]*([\s\S]*)/i.exec(text);
  return m ? m[2] : text;
}

/**
 * Stack terms lifted verbatim (surface spelling from the posting).
 * @param {string} text
 * @returns {string[]}
 */
function liftStack(text) {
  const block = requirementsBlock(text);
  const found = [];
  const seen = new Set();
  for (const term of STACK_TERMS) {
    /* Ambiguous names ("go", "r", "segment") match only as the capitalised
     * tool name, never inside "go-to" or "customer segment". */
    const m = findTool(term, block, STACK_CANONICAL[term] || term);
    if (m && !seen.has(term)) {
      seen.add(term);
      found.push(m[0]);
    }
  }
  return found;
}

/* Words that carry no job meaning on their own: HR verbiage and
 * adjectives that every posting uses. */
const GENERIC_WORDS = new Set(
  ("ability,abilities,able,excellent,strong,skills,skill,experience,experienced,knowledge,understanding,including," +
    "ensure,work,working,works,other,others,multiple,various,level,levels,new,ongoing,specific,general,related," +
    "preferred,required,requirement,requirements,plus,proven,track,record,success,successful,candidate,candidates," +
    "position,company,organization,opportunity,opportunities,environment,ideal,great,good,best,high,highly," +
    "their,them,they,what,which,while,where,when,whom,whose,need,needs,like,make,making,help,helps,well,able," +
    "minimal,guidance,desire,continued,complex,information,sources,confidence,comfort,respect,belief,return," +
    "impact,full,proficiency,function,degree,college,certification,years,year,equal,employer,benefits,salary," +
    "build,building,business,efforts,leads,bring,life,innovative,closely,partnering,constant,expert,features," +
    "strategic,resource,actions,properly,additional,prioritize,organize,decision,decisions,making,identify,mitigate," +
    "recognize,influence,influencing,consensus,trusted,advisor,colleagues,growth,mindset,learning,sharing,drivers," +
    "improvement,independently,productive,long-term,self-starter,entrepreneurial,adept,communication,solutions,solution," +
    "between,among,drive,drives,driving,project,projects,multi,ongoing,specific,general,liaison,assets,standards,promotion,collection")
    .split(","),
);

/**
 * Company-name cores to keep out of the nouns: "NorthwindMedia, Inc." gives
 * "northwindmedia", which also rules out "northwind" and "northwindradio" by a
 * shared 5+ letter prefix.
 * @param {string} company
 */
function companyCores(company) {
  return String(company || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|plc|gmbh)\b\.?/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

/**
 * @param {string} term
 * @param {string[]} cores
 */
function isCompanyTerm(term, cores) {
  return term.split(" ").some((word) =>
    cores.some((core) => {
      if (word === core) return true;
      let i = 0;
      while (i < word.length && i < core.length && word[i] === core[i]) i += 1;
      return i >= 5 || (i >= 4 && (word.length <= 6 || core.length <= 6));
    }),
  );
}

/**
 * Weighted role nouns from the role sections only: single words of 5+
 * letters and two-word terms ("streaming audio", "east region") that
 * appear as a pair, never the company's own name.
 * @param {string} text role text
 * @param {string} company
 * @param {string} title
 * @returns {Array<{ term: string, weight: number }>}
 */
function liftNouns(text, company = "", title = "") {
  return liftNounsWeighted(
    String(text || "").split("\n").map((line) => ({ line, weight: 1 })),
    company,
    title,
  );
}

/**
 * @param {Array<{ line: string, weight: number }>} weightedLines
 * @param {string} company
 * @param {string} title
 * @returns {Array<{ term: string, weight: number }>}
 */
function liftNounsWeighted(weightedLines, company = "", title = "") {
  const cores = companyCores(company);
  /** @type {Map<string, number>} */
  const counts = new Map();
  const bump = (/** @type {string} */ term, /** @type {number} */ by) =>
    counts.set(term, (counts.get(term) || 0) + by);
  const titleWords = new Set(
    String(title || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !SENIORITY_WORDS.test(w)),
  );
  for (const { line, weight: lineWeight } of weightedLines) {
    const words = line
      .split(/[^A-Za-z0-9+#/’'-]+/)
      .map((w) => w.toLowerCase().replace(/[’']s$/, "").replace(/^[-/]+|[-/]+$/g, ""))
      .filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      const usable = (/** @type {string} */ x) =>
        x && !STOP_WORDS.has(x) && !GENERIC_WORDS.has(x) && !/^\d/.test(x) && !/[’']/.test(x);
      if (usable(w) && (w.length >= 5 || /^[a-z]{2,4}$/.test(w) && /^(ctv|ott|sem|seo|dsp|crm|b2b|saas|iab|ga4|sql|api|kpi|roas|cpa)$/.test(w))) {
        bump(w, lineWeight * (DOMAIN_SINGLES.test(w) ? 2 : 1));
      }
      const next = words[i + 1];
      if (next && usable(w) && usable(next) && w.length >= 3 && next.length >= 3) {
        const pair = `${w} ${next}`;
        bump(pair, lineWeight * (DOMAIN_PAIRS.test(pair) ? 2 : 1.25));
      }
    }
  }
  /* Two-word terms count only when they recur or name a known domain
   * pair; a one-off pair is usually a sentence fragment. */
  const ranked = [...counts.entries()]
    .filter(([term, count]) => (!term.includes(" ") || count >= 3.5 || DOMAIN_PAIRS.test(term)))
    .filter(([term]) => !isCompanyTerm(term, cores))
    /* Design 7: nouns are skills and requirements vocabulary; a region, a
     * team or a group of people is context, not something a resume shows. */
    .filter(([term]) => !PEOPLE_OR_PLACE.test(term))
    .map(([term, count]) => {
      const inTitle = term.split(" ").some((w) => titleWords.has(w));
      return /** @type {[string, number]} */ ([term, count + (inTitle ? 1 : 0)]);
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  /* A single word already inside a kept pair adds little; keep both only
   * when the word also stands alone often. */
  const countOf = new Map(ranked);
  /** @type {Array<[string, number]>} */
  const kept = [];
  for (const entry of ranked) {
    if (kept.length >= 24) break;
    const [term, count] = entry;
    /* A word that mostly appears inside a stronger pair ("audio" in
     * "streaming audio") gives its slot to the next distinct term. */
    if (!term.includes(" ")) {
      const inPair = ranked.some(
        ([pair, pairCount]) => pair.includes(" ") && pair.split(" ").includes(term) && pairCount * 1.5 >= count && countOf.has(pair),
      );
      if (inPair) continue;
    }
    kept.push(entry);
  }
  const top = kept.length ? kept[0][1] : 1;
  return kept.map(([term, count]) => ({
    term,
    weight: Math.round((0.4 + (0.6 * count) / top) * 100) / 100,
  }));
}

const PEOPLE_OR_PLACE =
  /\b(?:regions?|regional|territor(?:y|ies)|markets?|teams?|managers?|clients?|customers?|partners?|vendors?|people|colleagues|staff|employees?|candidates?|director|executives?|aes?|stakeholders?|communities|country|america|americans|nationwide|office|headquarters|east|west|north|south|midwest|northeast|southeast|southwest|northwest|central)\b/;

const SENIORITY_WORDS = /^(director|senior|manager|head|lead|principal|staff|junior|associate|chief|vice|president)$/;

/* Channel, product and craft words that outrank generic nouns. */
const DOMAIN_SINGLES =
  /^(podcasts?|podcasting|ctv|ott|programmatic|streaming|audio|video|display|sem|seo|dsp|social|influencers?|attribution|viewability|targeting|revenue|quota|pipeline|enablement|training|analytics|dashboards?|experimentation|forecasting|kubernetes|python|sql|iab|b2b|saas|enterprise|agency|agencies|advertisers?|broadcast)$/;

/* Pairs worth keeping even once: media channels, regions, sales motions. */
const DOMAIN_PAIRS =
  /^(streaming audio|digital audio|social influencers?|paid (social|search|media)|audience targeting|ad (tagging|tech|sales|operations)|rich media|data sharing|viewability studies|integrated campaigns?|digital (sales|revenue|marketing|media|platform|product)|(east|west|north|south|central|midwest|northeast|southeast|southwest|northwest) region|sales (managers?|leadership|teams?|enablement|strategy)|account (executives?|management)|revenue (strategy|growth)|customer success|project managers?|client relationships?|media (sales|industry)|machine learning|data (pipelines?|platform|warehouse|engineering|analysis|science)|product (analytics|management|strategy)|marketing (analytics|mix|attribution)|a\/b testing|stakeholder management)$/;

/* ------------------------------------------------------------------ *
 * Outcomes: what the hire must deliver, from the summary and duties.
 * ------------------------------------------------------------------ */

/**
 * @param {string} line
 */
function sentencesOf(line) {
  return line.split(/(?<=[.!?;])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} text
 * @param {string} company
 * @param {string} title
 */
function stubOutcomes(text, company = "", title = "") {
  const sections = splitSections(text);
  const nouns = liftNounsWeighted(weightedRoleLines(text), company, title);
  const weightOf = new Map(nouns.map((n) => [n.term, n.weight]));
  /** @type {Array<{ text: string, score: number, order: number, from: SectionKind }>} */
  const candidates = [];
  let order = 0;
  for (const section of sections) {
    if (section.kind !== "summary" && section.kind !== "duties") continue;
    for (const raw of section.lines) {
      const line = cleanLine(raw);
      if (!line || BOILERPLATE_LINE.test(line)) continue;
      for (const sentence of section.kind === "summary" ? sentencesOf(line) : [line]) {
        if (sentence.length < 24) continue;
        const lower = sentence.toLowerCase();
        let score = 0;
        for (const [term, weight] of weightOf) {
          if (lower.includes(term)) score += term.includes(" ") ? weight * 1.5 : weight;
        }
        /* Concrete scope beats a generic duty: a region, a named channel
         * list, a team to train. */
        if (/\bregion\b|\bterritor/i.test(sentence)) score += 1;
        if (/,.*,/.test(sentence)) score += 0.5;
        if (/\btrain|\bcoach|\bdevelop(ment)? (of|for)?\s*(the )?team|\benablement/i.test(sentence)) score += 2;
        if (section.kind === "summary") score += 0.5;
        candidates.push({ text: sentence, score, order: order++, from: section.kind });
      }
    }
  }
  /* No recognised role section: the old line heuristic over the
   * boilerplate-free text. */
  if (!candidates.length) {
    const lines = roleText(text)
      .split("\n")
      .map(cleanLine)
      .filter((l) => l.length > 24 && !BOILERPLATE_LINE.test(l));
    lines.slice(0, 3).forEach((l, i) => candidates.push({ text: l, score: 3 - i, order: i, from: "unknown" }));
  }
  if (!candidates.length) {
    const first = String(text || "").split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 24 && !BOILERPLATE_LINE.test(s));
    if (first) candidates.push({ text: first.trim().slice(0, 200), score: 0, order: 0, from: "unknown" });
  }
  if (!candidates.length) {
    candidates.push({ text: "Deliver the outcomes described in the posting.", score: 0, order: 0, from: "unknown" });
  }
  /* Greedy pick with a diversity penalty: a second "East Region" line
   * loses to a line that names a different duty. */
  /** @type {typeof candidates} */
  const picked = [];
  const pool = [...candidates];
  /** @type {Set<string>} */
  const covered = new Set();
  while (picked.length < 4 && pool.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    pool.forEach((c, i) => {
      const terms = keyTermsOf(c.text, weightOf);
      const repeats = terms.filter((t) => covered.has(t)).length;
      const adjusted = c.score - repeats * 0.9;
      if (adjusted > bestScore || (adjusted === bestScore && c.order < pool[bestIdx].order)) {
        bestScore = adjusted;
        bestIdx = i;
      }
    });
    const [choice] = pool.splice(bestIdx, 1);
    for (const t of keyTermsOf(choice.text, weightOf)) covered.add(t);
    picked.push(choice);
  }
  const top = Math.max(...picked.map((c) => c.score), 1);
  return picked
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({
      id: `o${i + 1}`,
      text: c.text.slice(0, 300),
      weight: Math.round(Math.min(1, Math.max(0.3, c.score / top)) * 100) / 100,
    }));
}

/**
 * The distinctive terms a sentence carries (region, channels, team words),
 * for the outcome diversity penalty.
 * @param {string} text
 * @param {Map<string, number>} weightOf
 */
function keyTermsOf(text, weightOf) {
  const lower = text.toLowerCase();
  const terms = [...weightOf.keys()].filter((t) => !t.includes(" ") && lower.includes(t) && t !== "sales" && t !== "digital");
  if (/\bregion\b/.test(lower)) terms.push("#region");
  if (/\btrain|\bcoach|\benablement/.test(lower)) terms.push("#training");
  return terms;
}

/**
 * Company facts from the posting's own About block (the pitch before the
 * role, or an "About us" section): concrete sentences first — a number,
 * a rank, a superlative. The letter's company insight draws on these.
 * @param {string} text
 * @returns {string[]}
 */
export function companyFactsFrom(text) {
  const sections = splitSections(text);
  const roleTerms = [
    ...new Set(
      liftNounsWeighted(weightedRoleLines(text))
        .map((n) => n.term)
        .filter((t) => DOMAIN_SINGLES.test(t) || DOMAIN_PAIRS.test(t))
        .flatMap((t) => [t, ...t.split(" ").filter((w) => DOMAIN_SINGLES.test(w))]),
    ),
  ];
  const about = sections.filter(
    (s, i) => s.kind === "boilerplate" && (i === 0 || /^about|who we are|our (company|mission|story)/i.test(s.heading)),
  );
  /** @type {Array<{ text: string, score: number, order: number }>} */
  const facts = [];
  let order = 0;
  for (const section of about) {
    for (const raw of section.lines) {
      const line = cleanLine(raw);
      if (!line || BOILERPLATE_LINE.test(line) || /\b(we encourage|excited about this role|diverse, inclusive)\b/i.test(line)) continue;
      for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
        let t = sentence.replace(/[;:,]\s*$/, "").trim();
        if (t.length > 200) t = t.split(/\s[-–—]\s/)[0].trim();
        if (t.length < 30 || t.length > 260) continue;
        let score = 0;
        if (/\d|#1|number one/i.test(t)) score += 2;
        if (/\b(largest|leading|first|only|fastest|most|top|number one)\b/i.test(t)) score += 1;
        if (t.length > 180) score -= 0.5;
        if (/\b(we|our)\b/i.test(t)) score += 0.5;
        if (roleTerms.some((term) => t.toLowerCase().includes(term))) score += 1;
        facts.push({ text: /[.!?]$/.test(t) ? t : `${t}.`, score, order: order++ });
      }
    }
  }
  return facts
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 4)
    .map((f) => f.text);
}

/* ------------------------------------------------------------------ *
 * Role family and seniority (K4): which proofs a letter should lead with.
 * ------------------------------------------------------------------ */

export const ROLE_FAMILIES = /** @type {const} */ ([
  "sales", "marketing", "analytics", "engineering", "product", "design", "operations", "customer-success", "general",
]);
export const SENIORITIES = /** @type {const} */ (["entry", "mid", "senior", "lead", "manager", "director", "vp", "executive"]);

const FAMILY_TITLE_PATTERNS = /** @type {Array<[string, RegExp]>} */ ([
  ["sales", /\b(sales|account (executive|manager|director)|business development|revenue|partnerships?|ae\b|bdr|sdr|seller|media sales|ad sales)/i],
  ["customer-success", /\b(customer success|client success|account management|customer experience|support)\b/i],
  ["engineering", /\b(engineer|developer|sre|devops|architect|programmer|software)\b/i],
  ["analytics", /\b(analytics|analyst|data scien|insights|measurement|business intelligence|bi\b|data)\b/i],
  ["product", /\b(product manager|product owner|product lead|head of product|product)\b/i],
  ["design", /\b(designer|design|ux|ui\b|creative director)\b/i],
  ["marketing", /\b(marketing|growth|brand|content|seo|sem|demand gen|communications|social media|campaign)\b/i],
  ["operations", /\b(operations|ops\b|program manager|project manager|chief of staff|strategy)\b/i],
]);

const FAMILY_BODY_HINTS = /** @type {Record<string, RegExp>} */ ({
  sales: /\b(quota|revenue|pipeline|close|closing|book of business|prospect|sell|selling|sales)\b/gi,
  analytics: /\b(sql|dashboards?|analysis|analytics|insights|experiments?|a\/b|statistics|modeling)\b/gi,
  engineering: /\b(code|deploy|services?|apis?|systems?|infrastructure|kubernetes|backend|frontend)\b/gi,
  marketing: /\b(campaigns?|brand|audience|funnel|content|acquisition|demand)\b/gi,
});

/**
 * @param {string} title
 * @param {string} text role text
 * @returns {string}
 */
export function detectRoleFamily(title, text = "") {
  for (const [family, re] of FAMILY_TITLE_PATTERNS) {
    if (re.test(String(title || ""))) return family;
  }
  let best = "general";
  let bestCount = 2;
  for (const [family, re] of Object.entries(FAMILY_BODY_HINTS)) {
    const count = (String(text || "").match(re) || []).length;
    if (count > bestCount) {
      best = family;
      bestCount = count;
    }
  }
  return best;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function detectSeniority(title) {
  const t = String(title || "").toLowerCase();
  if (/\b(chief|cro|cmo|cto|ceo|coo|president|evp|svp)\b/.test(t)) return "executive";
  if (/\b(vp|vice president|head of)\b/.test(t)) return "vp";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\b(manager|mgr)\b/.test(t)) return "manager";
  if (/\b(lead|principal|staff)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|associate|intern|entry|coordinator|assistant)\b/.test(t)) return "entry";
  return "mid";
}

/**
 * Role-section nouns; the whole posting when no section is recognised;
 * the title words as a last resort (the schema needs one noun).
 * @param {string} text
 * @param {string} company
 * @param {string} title
 */
function nounsWithFallback(text, company, title) {
  const role = liftNounsWeighted(weightedRoleLines(text), company, title);
  if (role.length) return role;
  const whole = liftNouns(text, company, title);
  if (whole.length) return whole;
  const words = String(title || "role").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return (words.length ? words : ["role"]).slice(0, 4).map((term) => ({ term, weight: 0.5 }));
}

/**
 * @param {string} text
 */
function detectWorkMode(text) {
  if (/\bremote\b/i.test(text)) return "remote";
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\bonsite\b|\bon-site\b/i.test(text)) return "onsite";
  return "";
}

/**
 * @param {Record<string, unknown>} signals
 * @returns {Record<string, number | boolean>}
 */
function numericSignals(signals) {
  /** @type {Record<string, number | boolean>} */
  const out = {};
  for (const [key, value] of Object.entries(signals || {})) {
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value;
  }
  return out;
}

/**
 * Deterministic half: schema-valid on its own, so it doubles as the
 * degrade path.
 * @param {object} input
 * @param {string} input.jdText
 * @param {string} input.company
 * @param {string} input.title
 * @param {{ verdict: string, confidence: number, signals?: Record<string, unknown> }} input.gate
 * @param {string} [input.source]
 */
export function deterministicExtract({ jdText, company, title, gate, source = "paste" }) {
  const text = String(jdText || "").slice(0, MAX_JD_CHARS);
  return {
    contract: JD_EXTRACT_CONTRACT,
    jdHash: hashJd(text),
    source,
    gate: {
      verdict: gate.verdict,
      confidence: gate.confidence,
      /* The schema keeps numeric and boolean signals only. The drafter's
       * gate also carries `source: "cache"`, a string, which made every
       * model fill fail validation and degrade (the proof run's
       * "reply did not match the stage schema"). */
      ...(gate.signals ? { signals: numericSignals(gate.signals) } : {}),
    },
    role: {
      title: String(title || "").trim() || "Unknown role",
      company: String(company || "").trim() || "Unknown company",
      ...(detectWorkMode(text) ? { workMode: detectWorkMode(text) } : {}),
      family: detectRoleFamily(title, roleText(text)),
      seniority: detectSeniority(title),
    },
    outcomes: stubOutcomes(text, company, title),
    nouns: nounsWithFallback(text, company, title),
    companyFacts: companyFactsFrom(text),
    stack: { required: liftStack(text), preferred: [] },
    differentiators: [],
    bars: [],
    constraints: [],
    echoBans: [],
  };
}

const EXTRACT_SYSTEM_PROMPT = [
  "You read a job posting and return JSON only with this shape:",
  '{"outcomes":[{"id","text","weight"}],"differentiators":[{"id","text"}],"bars":[{"id","text"}],"constraints":[{"type","text"}],"echoBans":[],"nounWeights":{},"roleFamily":"","seniority":"","companyFacts":[]}.',
  "Read only the role sections (what the hire will do, what they need). Ignore the About-us pitch, benefits, pay, EEO text and apply instructions for outcomes and nouns.",
  "outcomes: the 3-5 concrete things the hire must deliver, in the posting's own nouns (channels, region, team, products), weight 0..1. Never an instruction to the applicant.",
  "differentiators: what would make a candidate stand out.",
  "bars: explicit disqualifiers stated in the posting (empty when none).",
  "constraints: location, clearance, travel, scheduling (empty when none).",
  "echoBans: the posting's own marketing phrases the cover letter must not echo (max 6).",
  "nounWeights: 0..1 importance for the role nouns that matter most. Never the company's own name.",
  `roleFamily: one of ${ROLE_FAMILIES.join(", ")}. seniority: one of ${SENIORITIES.join(", ")}.`,
  "companyFacts: up to 3 specific, checkable facts about the company stated in the posting (a rank, a size, a product), copied closely.",
  "IDs are kebab-case. No prose outside the JSON.",
].join(" ");

/**
 * @param {object} input
 * @param {string} input.jdText
 * @param {string} input.company
 * @param {string} input.title
 * @param {{ verdict: string, confidence: number, signals?: Record<string, unknown> }} input.gate
 * @param {string} [input.source]
 * @param {import("./materials-writer.mjs").WriterPin | null} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 */
export async function extractJd({ jdText, company, title, gate, source, pin, fetchImpl }) {
  const base = deterministicExtract({ jdText, company, title, gate, source });
  /* Degraded path: no pin, no model call — the deterministic half. */
  if (!pin) return { extract: base, degraded: true };
  const nounList = base.nouns.map((n) => n.term).join(", ");
  const { value: fill, call } = await runJsonStage({
      stage: "jd.extract",
      pin,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userText: [
        `Role: ${base.role.title} at ${base.role.company}`,
        `Role nouns: ${nounList}`,
        `Stack: ${base.stack.required.join(", ") || "none detected"}`,
        "",
        String(jdText || "").slice(0, MAX_JD_CHARS),
      ].join("\n"),
      maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
      fetchImpl,
    });
  if (!fill) return { extract: base, degraded: true, call };
  const merged = mergeFill(base, fill);
  const validation = validateJdExtract(merged);
  if (!validation.ok) {
    return {
      extract: base,
      degraded: true,
      call: schemaInvalidCall(call),
      rawReply: { stage: "jd.extract", errors: validation.errors, reply: fill },
    };
  }
  return { extract: merged, degraded: false, call };
}

/**
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} fill
 */
function mergeFill(base, fill) {
  const pick = (/** @type {unknown} */ value, /** @type {unknown} */ fallback) =>
    (value !== undefined ? value : fallback);
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  if (Array.isArray(fill.outcomes) && fill.outcomes.length) {
    const merged = fill.outcomes
      .filter((o) => o && typeof o === "object" && typeof o.text === "string" && o.text.trim())
      .map((o, i) => ({
        id: typeof o.id === "string" && o.id ? o.id : `o${i + 1}`,
        text: String(o.text).slice(0, 300),
        weight: typeof o.weight === "number" ? Math.min(1, Math.max(0, o.weight)) : 0.5,
      }));
    out.outcomes = merged.length ? merged : base.outcomes;
  }
  if (Array.isArray(fill.differentiators)) {
    out.differentiators = fill.differentiators
      .filter((d) => d && typeof d === "object" && typeof d.text === "string" && d.text.trim())
      .map((d, i) => ({
        id: typeof d.id === "string" && d.id ? d.id : `d${i + 1}`,
        text: String(d.text).slice(0, 300),
      }));
  }
  if (Array.isArray(fill.bars)) {
    out.bars = fill.bars
      .filter((b) => b && typeof b === "object" && typeof b.text === "string" && b.text.trim())
      .map((b, i) => ({
        id: typeof b.id === "string" && b.id ? b.id : `bar${i + 1}`,
        text: String(b.text).slice(0, 300),
      }));
  }
  if (Array.isArray(fill.constraints)) {
    out.constraints = fill.constraints
      .filter((c) => c && typeof c === "object" && typeof c.text === "string" && c.text.trim())
      .map((c) => ({
        type: typeof c.type === "string" && c.type ? c.type : "other",
        text: String(c.text).slice(0, 300),
      }));
  }
  if (Array.isArray(fill.echoBans)) {
    out.echoBans = fill.echoBans.filter((b) => typeof b === "string" && b.trim()).slice(0, 6);
  }
  const role = /** @type {Record<string, unknown>} */ ({ ...(/** @type {object} */ (base.role) || {}) });
  if (typeof fill.roleFamily === "string" && ROLE_FAMILIES.includes(/** @type {never} */ (fill.roleFamily))) {
    role.family = fill.roleFamily;
  }
  if (typeof fill.seniority === "string" && SENIORITIES.includes(/** @type {never} */ (fill.seniority))) {
    role.seniority = fill.seniority;
  }
  out.role = role;
  if (Array.isArray(fill.companyFacts)) {
    const facts = fill.companyFacts
      .filter((f) => typeof f === "string" && f.trim())
      .map((f) => String(f).trim().slice(0, 260))
      .slice(0, 3);
    const baseFacts = Array.isArray(base.companyFacts) ? base.companyFacts : [];
    if (facts.length) out.companyFacts = [...facts, ...baseFacts.filter((f) => !facts.includes(f))].slice(0, 6);
  }
  if (fill.nounWeights && typeof fill.nounWeights === "object") {
    const weights = /** @type {Record<string, unknown>} */ (fill.nounWeights);
    const baseNouns = /** @type {Array<{ term?: unknown }>} */ (
      Array.isArray(base.nouns) ? base.nouns : []
    );
    out.nouns = baseNouns.map((n) => {
      const w = typeof n.term === "string" ? weights[n.term] : undefined;
      return typeof w === "number" ? { ...n, weight: Math.min(1, Math.max(0, w)) } : n;
    });
  }
  return pick(out, base);
}

/* ------------------------------------------------------------------ *
 * RESJ Q3: evidence, not word count
 * ------------------------------------------------------------------ */

/**
 * What a posting offers before any model call: role sections found, duty
 * lines, a requirements block, company facts in its About text. The gate
 * confidence comes from these, never from length alone (a long page of
 * benefits and EEO text is not a strong posting).
 * @param {string} text
 * @returns {{ words: number, roleSections: number, requirementSections: number, dutyLines: number, companyFacts: number, confidence: number }}
 */
export function jdEvidence(text) {
  const body = String(text || "");
  const sections = splitSections(body);
  const role = sections.filter((s) => s.kind === "duties" || s.kind === "summary");
  const req = sections.filter((s) => s.kind === "requirements");
  const dutyLines = role.flatMap((s) => s.lines).filter((l) => l.replace(/^\s*(?:[-•*·▪◦]|\d+[.)])\s*/, "").trim().length > 24).length;
  const companyFacts = companyFactsFrom(body).length;
  const words = body.split(/\s+/).filter(Boolean).length;
  let confidence = 0.3;
  if (role.length) confidence += 0.25;
  if (req.length) confidence += 0.15;
  confidence += Math.min(0.2, 0.04 * dutyLines);
  confidence += Math.min(0.1, 0.05 * companyFacts);
  /* A posting with no recognisable sections still counts for something
   * when it has real sentences; a stub does not. */
  if (!role.length && !req.length && words < 80) confidence = Math.min(confidence, 0.35);
  return {
    words,
    roleSections: role.length,
    requirementSections: req.length,
    dutyLines,
    companyFacts,
    confidence: Math.round(Math.min(0.95, confidence) * 100) / 100,
  };
}

/**
 * How much role evidence the extract carries, whatever produced it: the
 * outcomes, company facts, differentiators or bars, stack and nouns the
 * later stages can use. Recorded beside the extract and in run.json.
 * @param {Record<string, unknown>} extract
 * @param {boolean} degraded the model fill did not land
 * @returns {{ score: number, outcomes: number, companyFacts: number, differentiators: number, bars: number, stack: number, nouns: number }}
 */
export function extractQuality(extract, degraded) {
  const count = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.length : 0);
  const stack = /** @type {{ required?: unknown, preferred?: unknown }} */ (extract.stack && typeof extract.stack === "object" ? extract.stack : {});
  const q = {
    outcomes: count(extract.outcomes),
    companyFacts: count(extract.companyFacts),
    differentiators: count(extract.differentiators),
    bars: count(extract.bars),
    stack: count(stack.required) + count(stack.preferred),
    nouns: count(extract.nouns),
  };
  let score = q.outcomes >= 3 ? 0.4 : q.outcomes === 2 ? 0.25 : q.outcomes ? 0.1 : 0;
  if (q.companyFacts) score += 0.2;
  if (q.differentiators || q.bars) score += 0.1;
  if (q.stack) score += 0.1;
  if (q.nouns >= 10) score += 0.1;
  if (!degraded) score += 0.1;
  return { score: Math.round(Math.min(0.95, score) * 100) / 100, ...q };
}
