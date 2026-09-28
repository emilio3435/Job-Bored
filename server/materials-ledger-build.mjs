/**
 * Materials v3 — build the claim ledger from the user's resume and profile
 * (plan slice 1, mechanism §5).
 *
 * Employers come from profile experiences plus the resume structure
 * (materials-resume-structure.mjs, or its model-structured twin when a pin
 * is available); claims from strength evidence plus every line written
 * under an employer, education and credential lines; metric tokens from
 * numerals; and a tool inventory split into user-asserted (owned) and
 * resume-mentioned (adjacent). Every string is verbatim user text with a
 * recorded source — nothing is inferred, so every claim ships
 * verified:true and selection can feature any of them.
 *
 * Fails with `ledger_empty` when neither input yields a fact.
 */

import { toolPattern } from "./materials-tool-match.mjs";
import { profileForLedger } from "./profile-identity.mjs";
import { maskNonMetrics } from "./materials-numerals.mjs";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { join, resolve as resolvePath, sep } from "node:path";
import { hashLedger, readLedger, resolveLedgerPath, writeLedgerAtomic, LEDGER_CONTRACT } from "./materials-ledger.mjs";
import { aliasesFor, parseResumeStructure, slugify } from "./materials-resume-structure.mjs";
import { structureResumeWithModel } from "./materials-resume-structure-model.mjs";
import { desplitMetricTokens } from "./materials-resume-source.mjs";

/**
 * @typedef {object} LedgerEmployer
 * @property {string} id
 * @property {string} name
 * @property {string} [title]
 * @property {string} [location]
 * @property {string | null} [start]
 * @property {string | null} [end]
 * @property {string} [scope]
 * @property {string} [site]
 * @property {Array<{ id: string, title: string, start: string | null, end: string | null }>} [roles]
 */

/**
 * @typedef {object} LedgerClaim
 * @property {string} id
 * @property {string | null} employerId
 * @property {string} [roleId]
 * @property {"achievement" | "system" | "operations" | "role" | "credential" | "education"} kind
 * @property {string} text
 * @property {Array<{ token: string, unit?: string }>} [metrics]
 * @property {string[]} [tools]
 * @property {string[]} [outcomes]
 * @property {string[]} [clears]
 * @property {string[]} [sourceRefs]
 * @property {boolean} verified
 */

const MAX_CLAIM_TEXT = 2000;

/* Bump when the builder's output changes for the same inputs. A stored
 * ledger from an older builder (no field = 1, the bullet-only parser that
 * produced 0-claim ledgers from unbulleted resumes) is rebuilt on the next
 * ensureLedger even when the resume and profile hashes still match.
 * 3: split figures re-joined ("$ 10 M +" → "$12M+") and product-name
 * numerals ("Chirp 3 HD") no longer metric tokens. */
/* 4: ambiguous tool names ("Go", "R", "Segment") no longer match plain
 * English ("go-to", "R&D"), so older ledgers with a false "Go" rebuild. */
/* 5: a department after the comma stays in the title ("Vice President,
 * Operations" is a role at the umbrella employer, not an employer named
 * "Operations"). */
/* 6: the department rule applies only inside an umbrella employer again;
 * a title alone on its line is a role (dated by a bare range under it); a
 * short line with a figure ("Grew revenue 40%.") is a claim; and
 * "Company, formerly Old Name" answers to both names. */
/* 7: RECOGNITION headings are credentials, not loose claims; a
 * "— formerly X —" header segment is the employer's former name. */
/* 8: model labels resolve only to parsed employers, roles, dates and claims;
 * rebuild ledgers that may contain a model-invented employer. */
export const LEDGER_BUILDER_VERSION = 9;

/* Numerals that may appear as emphasized metric runs. Years and year
 * ranges are dates, not metrics. */
const METRIC_RE = /((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g;
const YEAR_RE = /^(?:19|20)\d\d$/;
const YEAR_RANGE_RE = /^(?:19|20)\d\d[–-](?:19|20)\d\d$/;

/* P-12: a profile strength this close to a resume claim is the same fact. */
export const DUPLICATE_JACCARD = 0.6;
/* A strength that names no employer joins the employer of the resume claim
 * it paraphrases, when one is at least this close; below it, it stays
 * unbound rather than guessed. */
export const BIND_JACCARD = 0.2;
const STOPWORDS = new Set(
  "a an and the of to in on at for with by from as is was were be into across through via per its it their our my i".split(" "),
);

/* Resume-mentioned tools ship as adjacent; profile keywords are owned. */
export const TOOL_LEXICON = [
  "Looker Studio", "Vertex AI Search", "Cloud Run", "Google Ads", "Amazon DSP",
  "Trade Desk", "DV360", "BigQuery", "Snowflake", "PostgreSQL", "Power BI",
  "Tableau", "Salesforce", "HubSpot", "TypeScript", "JavaScript", "Python",
  "Gemini", "Claude", "OpenAI", "Anthropic", "Llama", "Grok", "GPT", "GCP",
  "AWS", "Azure", "Kubernetes", "Docker", "Terraform", "Kafka", "Airflow",
  "dbt", "Spark", "Flink", "Redshift", "MySQL", "Redis", "Elasticsearch",
  "GA4", "Meta", "TikTok", "LinkedIn Ads", "RAG", "LangChain", "Pinecone",
  "Weaviate", "Postgres", "Go", "Rust", "Java", "SQL", "R", "Excel",
  "Sheets", "Jira", "Figma", "Notion", "Slack", "Zoom", "Vertex AI",
  "Cloud Functions", "Pub/Sub", "Dataflow", "Looker", "Mode", "Hex",
  "Retool", "Zapier", "Segment", "Amplitude", "Mixpanel", "Optimizely",
  /* Media and adtech channels (K5). */
  "OTT/CTV", "CTV", "OTT", "SEM", "SEO", "DSP", "Paid Social", "Paid Search",
  "Programmatic Display", "Programmatic", "Streaming Audio", "Podcast",
  "Google Tag Manager", "Meta Ads Manager", "IAB",
];

const SYSTEM_RE = /system|platform|pipeline|infrastructure|tool|api|workflow|automat|architect/i;
const OPERATIONS_RE = /manag|mentor|hir|process|support|operations|coordinat/i;

/**
 * @returns {Error & { code: string }}
 */
export function ledgerEmptyError() {
  const err = /** @type {Error & { code: string }} */ (
    new Error("Add a résumé in Settings → Profile before drafting.")
  );
  err.code = "ledger_empty";
  return err;
}

/** @param {string} text */
function sha(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function clean(value, max = MAX_CLAIM_TEXT) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * @param {string} text
 * @returns {Array<{ token: string, unit?: string }>}
 */
export function extractMetrics(text) {
  /** @type {Array<{ token: string, unit: string }>} */
  /** @type {Array<{ token: string, unit?: string }>} */
  const out = [];
  const seen = new Set();
  for (const match of maskNonMetrics(text).matchAll(METRIC_RE)) {
    const token = match[1];
    if (!token || seen.has(token)) continue;
    if (YEAR_RE.test(token) || YEAR_RANGE_RE.test(token)) continue;
    seen.add(token);
    let unit = "";
    if (token.startsWith("$")) unit = "$";
    else if (token.endsWith("%")) unit = "%";
    else if (/x$/i.test(token)) unit = "x";
    else if (token.startsWith("top-")) unit = "rank";
    out.push(unit ? { token, unit } : { token });
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function matchTools(text) {
  const found = [];
  for (const tool of TOOL_LEXICON) {
    /* "Go" must not match "go-to" (ambiguous names match in their own case). */
    if (toolPattern(tool).test(text)) found.push(tool);
  }
  return found;
}

/**
 * @param {string} text
 * @returns {LedgerClaim["kind"]}
 */
function guessKind(text) {
  if (SYSTEM_RE.test(text)) return "system";
  if (OPERATIONS_RE.test(text)) return "operations";
  return "achievement";
}

/** @param {unknown} value */
function dateOrNull(value) {
  const text = clean(value, 40);
  return text && !/^(present|current|now)$/i.test(text) ? text : null;
}

/** @param {string} text */
function tokenSet(text) {
  return new Set((text.toLowerCase().match(/[a-z0-9$%+]+/g) || []).filter((t) => !STOPWORDS.has(t)));
}

/**
 * Jaccard similarity over content words.
 * @param {string} a
 * @param {string} b
 */
export function claimSimilarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Employers: profile experiences first (the user's own record, and the
 * slugs logos key on), then every resume employer, merged by name or alias
 * so "Brightwave Media" and "Brightwave Media (formerly Tidewater Radio)" stay
 * one company.
 * @param {unknown} profile
 * @param {import("./materials-resume-structure.mjs").ResumeStructure} structure
 */
function collectEmployers(profile, structure) {
  /** @type {LedgerEmployer[]} */
  const employers = [];
  /** @type {Map<string, Set<string>>} */
  const keysById = new Map();
  /** @type {Map<unknown, LedgerEmployer>} */
  const byStructure = new Map();
  /** @param {string[]} keys */
  const findByAliases = (keys) =>
    employers.find((e) => keys.some((k) => keysById.get(e.id)?.has(k))) || null;
  /** @param {string} base */
  const uniqueId = (base) => {
    let id = base;
    for (let n = 2; keysById.has(id); n += 1) id = `${base}-${n}`;
    return id;
  };

  if (isRecord(profile) && Array.isArray(profile.experiences)) {
    for (const raw of profile.experiences) {
      if (!isRecord(raw)) continue;
      const name = clean(raw.company || raw.label, 120);
      if (!name) continue;
      const keys = aliasesFor(name);
      if (findByAliases(keys)) continue;
      const id = uniqueId(typeof raw.slug === "string" && raw.slug ? raw.slug : slugify(name));
      const roles = (Array.isArray(raw.roles) ? raw.roles : [])
        .filter(isRecord)
        .map((r, i) => ({ id: `${id}-r${i + 1}`, title: clean(r.title, 160), start: dateOrNull(r.start), end: dateOrNull(r.end) }))
        .filter((r) => r.title);
      const title = clean(raw.title, 160);
      const location = clean(raw.location, 120);
      const site = clean(raw.site, 160);
      employers.push({
        id,
        name,
        ...(title ? { title } : {}),
        ...(location ? { location } : {}),
        ...(site ? { site } : {}),
        ...("start" in raw ? { start: dateOrNull(raw.start), end: dateOrNull(raw.end) } : {}),
        ...(roles.length ? { roles } : {}),
      });
      keysById.set(id, new Set(keys));
    }
  }

  for (const se of structure.employers) {
    const keys = [...new Set([...se.aliases, ...aliasesFor(se.name)])];
    let employer = findByAliases(keys);
    if (!employer) {
      const id = uniqueId(slugify(se.name));
      employer = { id, name: clean(se.name, 120) };
      employers.push(employer);
      keysById.set(id, new Set());
    }
    const keySet = /** @type {Set<string>} */ (keysById.get(employer.id));
    for (const k of keys) keySet.add(k);
    const firstTitle = clean(se.roles[0]?.title, 160);
    if (!employer.title && firstTitle) employer.title = firstTitle;
    if (!employer.location && se.location) employer.location = se.location;
    if (!employer.scope && se.scope) employer.scope = se.scope;
    if (!employer.site && se.site) employer.site = se.site;
    if (!("start" in employer)) {
      employer.start = se.start;
      employer.end = se.end;
    }
    if (!employer.roles?.length && se.roles.length) {
      const id = employer.id;
      employer.roles = se.roles.map((r, i) => ({ id: `${id}-r${i + 1}`, title: clean(r.title, 160), start: r.start, end: r.end }));
    }
    byStructure.set(se, employer);
  }
  return { employers, keysById, byStructure };
}

/**
 * The employer a profile strength names, earliest mention first.
 * @param {string} text
 * @param {LedgerEmployer[]} employers
 * @param {Map<string, Set<string>>} keysById
 */
function employerNamedIn(text, employers, keysById) {
  const hay = text.toLowerCase();
  /** @type {LedgerEmployer | null} */
  let best = null;
  let bestAt = Infinity;
  for (const employer of employers) {
    for (const key of keysById.get(employer.id) || []) {
      if (key.length < 3 || key.includes("(")) continue;
      const m = new RegExp(`\\b${escapeRe(key)}\\b`).exec(hay);
      if (m && m.index < bestAt) {
        best = employer;
        bestAt = m.index;
      }
    }
  }
  return best;
}

/**
 * The employer of the employer-bound resume claim most like `text`.
 * @param {string} text
 * @param {LedgerClaim[]} resumeClaims
 */
function closestEmployerId(text, resumeClaims) {
  let bestId = null;
  let best = BIND_JACCARD;
  for (const claim of resumeClaims) {
    if (!claim.employerId) continue;
    const score = claimSimilarity(text, claim.text);
    if (score >= best) {
      best = score;
      bestId = claim.employerId;
    }
  }
  return bestId;
}

/**
 * Build a claim ledger from profile JSON plus resume text. Pure and
 * synchronous: no LLM, no network, no disk. Pass `structure` to use a
 * model-structured resume (see ensureLedger); without it the resume text
 * goes through the deterministic parser.
 * @param {object} input
 * @param {unknown} input.profile canonical UserProfile or null
 * @param {string} [input.resumeText] the user's resume, plain text
 * @param {string} [input.resumeSource] portfolio | profile | upload | …
 * @param {string} [input.nowIso]
 * @param {import("./materials-resume-structure.mjs").ResumeStructure} [input.structure]
 * @param {string} [input.note] how the resume was structured, kept on the ledger
 */
export function buildLedger({
  profile,
  resumeText = "",
  resumeSource: _resumeSource = "upload",
  nowIso,
  structure: givenStructure,
  note,
}) {
  const resume = String(resumeText || "").trim().slice(0, 60_000);
  const builtAt = nowIso || new Date().toISOString();
  const structure = givenStructure || parseResumeStructure(resume);
  const { employers, keysById, byStructure } = collectEmployers(profile, structure);

  /** @type {Array<{ id: string, kind: "resume" | "profile", hash: string, ingestedAt: string }>} */
  const sources = [];
  if (resume) {
    sources.push({
      id: `resume-${sha(resume).slice(7, 15)}`,
      kind: "resume",
      hash: sha(resume),
      ingestedAt: builtAt,
    });
  }
  const profileText = isRecord(profile) ? JSON.stringify(profileForLedger(profile)) : "";
  if (profileText) {
    sources.push({ id: "profile", kind: "profile", hash: sha(profileText), ingestedAt: builtAt });
  }
  const resumeRefs = sources.map((s) => s.id).filter((id) => id !== "profile");

  /** @type {LedgerClaim[]} */
  const resumeClaims = [];
  /**
   * @param {string} id
   * @param {string | null} employerId
   * @param {LedgerClaim["kind"]} kind
   * @param {string} rawText
   * @param {string} [roleId]
   */
  const addResumeClaim = (id, employerId, kind, rawText, roleId) => {
    /* A figure split by a PDF text layer ("$ 10 M +") is re-joined, so the
     * claim's metric token is the one a draft prints ("$12M+"). */
    const text = desplitMetricTokens(clean(rawText));
    if (!text) return;
    if (resumeClaims.some((c) => claimSimilarity(c.text, text) >= DUPLICATE_JACCARD)) return;
    resumeClaims.push({
      id,
      employerId,
      ...(roleId ? { roleId } : {}),
      kind,
      text,
      metrics: extractMetrics(text),
      tools: matchTools(text),
      sourceRefs: resumeRefs,
      verified: true,
    });
  };
  let bulletN = 0;
  for (const se of structure.employers) {
    const employer = byStructure.get(se);
    for (const claim of se.claims) {
      const roleTitle = claim.roleIndex === null ? "" : se.roles[claim.roleIndex]?.title || "";
      const role = roleTitle
        ? employer?.roles?.find((r) => r.title.toLowerCase() === roleTitle.toLowerCase())
        : undefined;
      bulletN += 1;
      addResumeClaim(`resume-b${bulletN}`, employer?.id || null, guessKind(claim.text), claim.text, role?.id);
    }
  }
  for (const text of structure.looseClaims) {
    bulletN += 1;
    addResumeClaim(`resume-b${bulletN}`, null, guessKind(text), text);
  }
  structure.education.forEach((text, i) => addResumeClaim(`resume-edu${i + 1}`, null, "education", text));
  structure.credentials.forEach((text, i) => addResumeClaim(`resume-cred${i + 1}`, null, "credential", text));

  /* P-12: a strength binds to the employer its evidence names (else the
   * employer of the resume claim it paraphrases); one that restates a
   * resume claim is dropped so the resume's wording wins. */
  /** @type {LedgerClaim[]} */
  const profileClaims = [];
  if (isRecord(profile) && Array.isArray(profile.strengths)) {
    for (const raw of profile.strengths) {
      if (!isRecord(raw)) continue;
      const evidence = desplitMetricTokens(clean(raw.evidence, 1200));
      if (!evidence) continue;
      const kept = [...resumeClaims, ...profileClaims];
      if (kept.some((c) => claimSimilarity(c.text, evidence) >= DUPLICATE_JACCARD)) continue;
      const rank = typeof raw.rank === "number" ? raw.rank : profileClaims.length + 1;
      profileClaims.push({
        id: `profile-strength-${rank}`,
        employerId: employerNamedIn(evidence, employers, keysById)?.id || closestEmployerId(evidence, resumeClaims),
        kind: "achievement",
        text: evidence,
        metrics: extractMetrics(evidence),
        tools: matchTools(`${raw.name || ""} ${evidence}`),
        sourceRefs: ["profile"],
        verified: true,
      });
    }
  }
  const claims = [...profileClaims, ...resumeClaims];

  if (!claims.length) throw ledgerEmptyError();

  /* Tool inventory: profile keywords are user-asserted (owned), resume
   * mentions are adjacent. First mention wins the evidence ref. */
  /** @type {Map<string, { tool: string, level: string, evidence: string | null, transferFrom: string[] }>} */
  const inventory = new Map();
  if (isRecord(profile) && Array.isArray(profile.strengths)) {
    for (const raw of profile.strengths) {
      if (!isRecord(raw) || !Array.isArray(raw.keywords)) continue;
      for (const keyword of raw.keywords) {
        const tool = clean(keyword, 80);
        if (!tool || inventory.has(tool.toLowerCase())) continue;
        inventory.set(tool.toLowerCase(), {
          tool,
          level: "owned",
          evidence: clean(raw.name, 80) || null,
          transferFrom: [],
        });
      }
    }
  }
  for (const claim of claims) {
    for (const tool of matchTools(claim.text)) {
      if (inventory.has(tool.toLowerCase())) continue;
      inventory.set(tool.toLowerCase(), {
        tool,
        level: "adjacent",
        evidence: claim.id,
        transferFrom: [],
      });
    }
  }

  const ledger = {
    contract: LEDGER_CONTRACT,
    ledgerHash: "sha256:0",
    builtAt,
    builderVersion: LEDGER_BUILDER_VERSION,
    note: note || `structure:${structure.source}`,
    sources,
    employers,
    claims,
    toolInventory: [...inventory.values()],
  };
  ledger.ledgerHash = hashLedger(ledger);
  return ledger;
}

/**
 * Under `node --test`, refuse a ledger path inside the real user's
 * ~/.jobbored. A drafter test that forgot to isolate HOME rebuilt the
 * ledger from fixture text and overwrote the user's real
 * claim-ledger.json (2026-09-27 12:06). The real home comes from the
 * password database, not $HOME, so a test that does set HOME passes.
 * JOBBORED_TEST_REAL_HOME adds a second protected home for the regression
 * test; it can never lift the protection on the real one.
 * @param {string} ledgerPath
 */
export function assertLedgerPathIsolated(ledgerPath) {
  if (!process.env.NODE_TEST_CONTEXT) return;
  /** @type {string[]} */
  const homes = [];
  try {
    homes.push(userInfo().homedir);
  } catch {
    /* no passwd entry: nothing to protect */
  }
  if (process.env.JOBBORED_TEST_REAL_HOME) homes.push(process.env.JOBBORED_TEST_REAL_HOME);
  const target = resolvePath(ledgerPath);
  for (const home of homes) {
    if (!home) continue;
    if (target.startsWith(`${resolvePath(join(home, ".jobbored"))}${sep}`)) {
      const err = /** @type {Error & { code: string }} */ (
        new Error(`A test tried to use the real claim ledger at ${target}. Set HOME or JOBBORED_PROFILE_PATH to a temp dir.`)
      );
      err.code = "ledger_real_home_in_test";
      throw err;
    }
  }
}

/**
 * Load the stored ledger, rebuilding it when the inputs moved. Returns
 * the ledger plus whether it was rebuilt.
 *
 * With a writer `pin` and `fetchImpl`, the resume is structured by one
 * model call (materials-resume-structure-model.mjs) that may only return
 * the resume's own words; any failure falls back to the rule parser. A
 * stored rule-parsed ledger is upgraded once when a pin first arrives; a
 * model failure is recorded on the ledger note and not retried until the
 * resume or profile changes.
 * @param {object} input
 * @param {unknown} input.profile
 * @param {string} [input.resumeText]
 * @param {string} [input.resumeSource]
 * @param {import("./materials-writer.mjs").WriterPin | null} [input.pin]
 * @param {Function} [input.fetchImpl]
 * @param {Function} [input.callStage] test seam for the model stage call
 */
export async function ensureLedger({ profile, resumeText = "", resumeSource = "upload", pin = null, fetchImpl, callStage }) {
  assertLedgerPathIsolated(resolveLedgerPath());
  const resume = String(resumeText || "").trim().slice(0, 60_000);
  const profileText = isRecord(profile) ? JSON.stringify(profileForLedger(profile)) : "";
  const canModel = Boolean(resume && pin && typeof fetchImpl === "function");
  const stored = await readLedger();
  if (stored.ok) {
    const sources = /** @type {Array<{ kind?: unknown, hash?: unknown }>} */ (
      Array.isArray(stored.ledger.sources) ? stored.ledger.sources : []
    );
    const resumeSourceEntry = sources.find((s) => s && s.kind === "resume");
    const profileSourceEntry = sources.find((s) => s && s.kind === "profile");
    const resumeFresh =
      (resume ? resumeSourceEntry?.hash === sha(resume) : !resumeSourceEntry) &&
      (!resumeSourceEntry || resume);
    const profileFresh =
      (profileText ? profileSourceEntry?.hash === sha(profileText) : !profileSourceEntry) &&
      (!profileSourceEntry || profileText);
    const { note, builderVersion } = /** @type {{ note?: unknown, builderVersion?: unknown }} */ (stored.ledger);
    const awaitsModel = canModel && (note === undefined || note === "structure:rules");
    const currentBuilder = (typeof builderVersion === "number" ? builderVersion : 1) === LEDGER_BUILDER_VERSION;
    if (resumeFresh && profileFresh && currentBuilder && !awaitsModel) {
      return { ...stored.ledger, rebuilt: false };
    }
  }
  /** @type {{ structure?: import("./materials-resume-structure.mjs").ResumeStructure, note?: string }} */
  let structured = {};
  if (canModel && pin && typeof fetchImpl === "function") {
    const result = await structureResumeWithModel({ resumeText: resume, pin, fetchImpl, callStage });
    structured = { structure: result.structure, note: result.note };
  }
  const built = buildLedger({ profile, resumeText: resume, resumeSource, ...structured });
  const { ledgerHash } = await writeLedgerAtomic(built);
  return { ...built, ledgerHash, rebuilt: true };
}
