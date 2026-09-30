/**
 * Materials v3 — build the claim ledger from the user's resume and profile
 * (plan slice 1, mechanism §5).
 *
 * Employers come from profile experiences plus a previously interpreted
 * resume structure. `ensureLedger` requires the quote-grounded model path for
 * non-empty resumes; this pure builder never parses resume text. Claims come
 * from profile strength evidence and model-attributed resume claims, with
 * metric tokens and a tool inventory split into user-asserted (owned) and
 * resume-mentioned (adjacent).
 *
 * Fails with `ledger_empty` when neither input yields a fact.
 */

import { toolPattern } from "./materials-tool-match.mjs";
import { profileForLedger } from "./profile-identity.mjs";
import { maskNonMetrics } from "./materials-numerals.mjs";
import { createHash, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hashLedger, readLedger, resolveLedgerPath, writeLedgerAtomic, LEDGER_CONTRACT } from "./materials-ledger.mjs";
import { aliasesFor, slugify } from "./materials-resume-structure.mjs";
import { structureResume } from "./materials-resume-structure-model.mjs";
import { employerKey } from "./resume-ingest-identity.mjs";
import { validateIngestResult } from "./resume-ingest-contract.mjs";
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
 * @property {string[]} [aliases]
 * @property {string[]} [sourceRefs] profile-only employers retain their source
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
 * @property {"inferred"} [attribution]
 * @property {"check where this belongs"} [review]
 */

const MAX_CLAIM_TEXT = 2000;

/* Bump when the builder's output changes for the same inputs. A stored
 * ledger from an older builder (no field = 1, the bullet-only parser that
 * produced 0-claim ledgers from unbulleted resumes) is rebuilt on the next
 * ensureLedger even when the resume and profile hashes still match.
 * 3: split figures re-joined ("$ 10 M +" → "$10M+") and product-name
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
/* 8: model labels resolved only to parsed employers, roles, dates and claims;
 * rebuild ledgers that may contain a model-invented employer.
 * 10: the model owns document structure and quotes; no rules-structure path
 * may fill gaps or replace a failed model pass. */
/* 12: retain profile-only roles and placement review on re-homed claims. */
export const LEDGER_BUILDER_VERSION = 12;

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

function resumeTooLongError() {
  const error = /** @type {Error & {code:string}} */ (new Error("Your résumé is too long to read (over 60,000 characters). Shorten it and try again."));
  error.code = "resume_too_long";
  return error;
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
 * Employers: profile-only and user-edited experiences, then every grounded
 * resume employer, merged by name or alias
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
  const resumeAliases = new Set(structure.employers.flatMap((entry) => [...entry.aliases, ...aliasesFor(entry.name)]));
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
      if (raw.provenance !== "user" && raw.userEdited !== true && keys.some((key) => resumeAliases.has(key))) continue;
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
        sourceRefs: ["profile"],
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
    const userOwned = isRecord(profile) && Array.isArray(profile.experiences) && profile.experiences.some((raw) =>
      isRecord(raw) && (raw.provenance === "user" || raw.userEdited === true) && aliasesFor(clean(raw.company || raw.label, 120)).some((key) => keys.includes(key)));
    const firstTitle = clean(se.roles[0]?.title, 160);
    if (!employer.title && firstTitle) employer.title = firstTitle;
    if (!employer.location && se.location) employer.location = se.location;
    if (!employer.scope && se.scope) employer.scope = se.scope;
    if (!employer.site && se.site) employer.site = se.site;
    if (!("start" in employer) || !userOwned) {
      employer.start = se.start;
      employer.end = se.end;
    }
    if (se.roles.length && !userOwned) {
      const id = employer.id;
      employer.roles = se.roles.map((r, i) => ({ id: `${id}-r${i + 1}`, title: clean(r.title, 160), start: r.start, end: r.end }));
    }
    employer.aliases = [...keySet];
    delete employer.sourceRefs;
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
 * Build a claim ledger from profile JSON plus a previously interpreted
 * resume structure. Pure and synchronous: no LLM, no network, no disk.
 * Resume text alone is never parsed into employers or claims.
 * @param {object} input
 * @param {unknown} input.profile canonical UserProfile or null
 * @param {string} [input.resumeText] the user's resume, plain text
 * @param {string} [input.resumeSource] portfolio | profile | upload | …
 * @param {string} [input.nowIso]
 * @param {import("./materials-resume-structure.mjs").ResumeStructure} [input.structure]
 * @param {import("./resume-ingest-contract.mjs").IngestResult} [input.ingestResult]
 * @param {string} [input.note] how the resume was structured, kept on the ledger
 */
export function buildLedger({
  profile,
  resumeText = "",
  resumeSource: _resumeSource = "upload",
  nowIso,
  structure: givenStructure,
  ingestResult,
  note,
}) {
  const resume = String(resumeText || "");
  if (resume.length > 60_000) throw resumeTooLongError();
  const builtAt = nowIso || new Date().toISOString();
  if (resume.trim() && !givenStructure && !ingestResult?.structure) {
    const error = /** @type {Error & { code: string }} */ (
      new Error("Resume text requires a quote-grounded model structure before ledger building.")
    );
    error.code = "resume_structure_required";
    throw error;
  }
  const structure = /** @type {import("./materials-resume-structure.mjs").ResumeStructure} */ (/** @type {unknown} */ (
    ingestResult?.structure || givenStructure || { source: "model", employers: [], education: [], credentials: [], looseClaims: [] }
  ));
  const { employers, keysById, byStructure } = collectEmployers(profile, structure);

  /** @type {Array<{ id: string, kind: "resume" | "profile", hash: string, ingestedAt: string }>} */
  const sources = [];
  if (resume.trim()) {
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
   * @param {{ attribution?: "inferred", review?: "check where this belongs" }} [placement]
   */
  const addResumeClaim = (id, employerId, kind, rawText, roleId, placement = {}) => {
    /* A figure split by a PDF text layer ("$ 10 M +") is re-joined, so the
     * claim's metric token is the one a draft prints ("$10M+"). */
    const text = desplitMetricTokens(clean(rawText));
    if (!text) return;
    if (kind !== "role" && resumeClaims.some((c) => c.employerId === employerId && c.kind !== "role" && claimSimilarity(c.text, text) >= DUPLICATE_JACCARD)) return;
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
      ...placement,
    });
  };
  let bulletN = 0;
  const sections = structure.employers.filter((entry) => entry.lines?.[0])
    .sort((a, b) => /** @type {[number,number]} */ (a.lines)[0] - /** @type {[number,number]} */ (b.lines)[0]);
  for (const se of structure.employers) {
    const employer = byStructure.get(se);
    const lines = resume.split(/\r?\n/u);
    const headerAt = Array.isArray(se.lines) ? se.lines[0] : 0;
    const firstRoleAt = Math.min(...se.roles.map((role) => Array.isArray(role.lines) ? role.lines[0] : Infinity));
    const descriptor = headerAt && Number.isFinite(firstRoleAt)
      ? lines.slice(headerAt, firstRoleAt - 1).map((line) => line.trim()).filter(Boolean).join(" · ")
      : "";
    /** @param {import("./materials-resume-structure.mjs").StructureRole | null} role */
    const roleText = (role) => [role?.title || employer?.title || "", employer?.name,
      [role?.start ?? se.start, role?.end ?? se.end].filter(Boolean).join(" – "), se.location || "", descriptor].filter(Boolean).join(" · ");
    if (se.roles.length) {
      se.roles.forEach((role, index) => addResumeClaim(`resume-role-${employer?.id}-${index + 1}`, employer?.id || null, "role", roleText(role), employer?.roles?.[index]?.id));
    } else {
      addResumeClaim(`resume-role-${employer?.id}`, employer?.id || null, "role", roleText(null));
    }
    for (const claim of se.claims) {
      if (claim.quarantined) continue;
      const range = claim.lines;
      const foreignSection = range && sections.find((entry, index) => entry !== se &&
        range[0] >= /** @type {[number,number]} */ (entry.lines)[0] && range[1] < (sections[index + 1]?.lines?.[0] || Infinity));
      if (foreignSection) continue;
      const inferred = /** @type {typeof claim & { roleAttribution?: string }} */ (claim).roleAttribution === "inferred" || claim.attribution === "inferred";
      const roleTitle = claim.roleIndex === null ? "" : se.roles[claim.roleIndex]?.title || "";
      const role = roleTitle
        ? employer?.roles?.find((r) => r.title.toLowerCase() === roleTitle.toLowerCase())
        : undefined;
      bulletN += 1;
      addResumeClaim(`resume-b${bulletN}`, employer?.id || null, guessKind(claim.text), claim.text, role?.id,
        inferred ? { attribution: "inferred", review: "check where this belongs" } : {});
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
  for (const employer of employers.filter((entry) => entry.sourceRefs?.includes("profile"))) {
    const roles = employer.roles?.length ? employer.roles : [{ title: employer.title || "", start: employer.start, end: employer.end }];
    for (const [index, role] of roles.entries()) {
      const text = [role.title, employer.name, [role.start, role.end].filter(Boolean).join(" – "), employer.location].filter(Boolean).join(" · ");
      profileClaims.push({ id: `profile-role-${employer.id}-${index + 1}`, employerId: employer.id,
        ...("id" in role && typeof role.id === "string" ? { roleId: role.id } : {}), kind: "role", text, metrics: [], tools: matchTools(text), sourceRefs: ["profile"], verified: true });
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
    ...(ingestResult ? {
      ingestSchema: "ingest/1",
      structureKind: "model",
      sourceMode: ingestResult.sourceMode,
      textSha256: ingestResult.textSha256,
      originalSha256: ingestResult.originalSha256,
      resumeStructure: structure,
      ingest: {
        schema: ingestResult.schema,
        status: ingestResult.status,
        textSha256: ingestResult.textSha256,
        originalSha256: ingestResult.originalSha256,
        resultPath: join(dirname(resolveLedgerPath()), "ingest-result.json"),
        missingEmployers: ingestResult.missingEmployers || [],
      },
    } : {}),
    note: note || (resume.trim() ? `structure:${structure.source}` : "profile:only"),
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
 * A non-empty resume requires a grounded model structure. If that pass fails,
 * the last successful fact ledger is retained byte for byte and the failure is surfaced in
 * the returned `ingest` status. Resume text is never parsed as a
 * fallback.
 * @param {object} input
 * @param {unknown} input.profile
 * @param {string} [input.resumeText]
 * @param {string} [input.resumeSource]
 * @param {{ mimeType: string, filename?: string, data: string }} [input.document] original PDF, never persisted
 * @param {import("./materials-writer.mjs").WriterPin | null} [input.pin]
 * @param {Function} [input.fetchImpl]
 * @param {Function} [input.callStage] test seam for the model stage call
 */
const INGEST_RESULT_FILENAME = "ingest-result.json";

function ingestResultPath() {
  return join(dirname(resolveLedgerPath()), INGEST_RESULT_FILENAME);
}

/** @param {unknown} value */
async function writeIngestResult(value) {
  const path = ingestResultPath();
  assertLedgerPathIsolated(path);
  const validation = validateIngestResult(value);
  if (!validation.ok) throw new Error(`Invalid ingest result: ${validation.errors.join(", ")}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readIngestResult() {
  try { return JSON.parse(await readFile(ingestResultPath(), "utf8")); }
  catch { return null; }
}

/** @param {Record<string, any> | null} ledger @param {number} [rejectedClaims] */
function ledgerCoverage(ledger, rejectedClaims = 0) {
  const employers = Array.isArray(ledger?.employers) ? ledger.employers : [];
  const claims = Array.isArray(ledger?.claims) ? ledger.claims : [];
  const resumeClaims = claims.filter((claim) => typeof claim.id === "string" && claim.id.startsWith("resume-"));
  return {
    totalEmployers: employers.length,
    employersWithClaims: new Set(resumeClaims.map((claim) => claim.employerId).filter(Boolean)).size,
    rejectedClaims,
    looseClaims: resumeClaims.filter((claim) => !claim.employerId && claim.kind !== "education" && claim.kind !== "credential").length,
  };
}

/** @param {Record<string, any>} result @param {Record<string, any> | null} ledger @param {string} [code] @param {string} [reason] */
function ingestSummary(result, ledger, code = "", reason = "") {
  return {
    schema: result.schema,
    status: result.status,
    sourceHash: result.textSha256 ? `sha256:${result.textSha256}` : "",
    textSha256: result.textSha256,
    originalSha256: result.originalSha256,
    resultPath: ingestResultPath(),
    code,
    reason,
    rejected: result.rejected || [],
    notes: /** @type {Array<{kind:string,reason:string}>} */ (result.notes || []).map((item) => ({ kind: item.kind, reason: item.reason })),
    missingEmployers: result.missingEmployers || [],
    coverage: ledgerCoverage(ledger, /** @type {Array<{kind:string}>} */ (result.rejected || []).filter((item) => item.kind === "claim").length),
  };
}

/**
 * Read the canonical résumé through READ's reconciler, persist its full
 * IngestResult, and publish only a ready model structure. Profile saves
 * rebuild the overlay from the stored structure without asking a model.
 * @param {object} input
 * @param {unknown} input.profile
 * @param {string} [input.resumeText]
 * @param {string} [input.resumeSource]
 * @param {import("./materials-writer.mjs").WriterPin | null} [input.pin]
 * @param {Function} [input.fetchImpl]
 * @param {Function} [input.callStage]
 * @returns {Promise<Record<string, any>>}
 */
export async function ensureLedger({ profile, resumeText = "", resumeSource = "upload", pin = null, fetchImpl, callStage }) {
  assertLedgerPathIsolated(resolveLedgerPath());
  const resume = String(resumeText || "");
  const sourceHash = resume.trim() ? sha(resume) : "";
  const profileText = isRecord(profile) ? JSON.stringify(profileForLedger(profile)) : "";
  const canModel = Boolean(resume && pin && (typeof callStage === "function" || typeof fetchImpl === "function"));
  const stored = await readLedger();
  const previous = stored.ok ? /** @type {Record<string, any>} */ (stored.ledger) : null;
  const priorResult = await readIngestResult();
  const sources = Array.isArray(previous?.sources) ? previous.sources : [];
  const previousResume = sources.find((entry) => entry.kind === "resume");
  const previousProfile = sources.find((entry) => entry.kind === "profile");
  const resumeFresh = Boolean(previous && resume && previousResume?.hash === sourceHash);
  const profileFresh = Boolean(previous && (profileText ? previousProfile?.hash === sha(profileText) : !previousProfile));
  const current = Boolean(previous && previous.ingestSchema === "ingest/1" && previous.builderVersion === LEDGER_BUILDER_VERSION &&
    previous.structureKind === "model" && previous.resumeStructure && previous.note === "structure:model");
  const priorReady = Boolean(priorResult && priorResult.status === "ready" && `sha256:${priorResult.textSha256}` === sourceHash);
  /** @param {Record<string, any>} result @param {string} [code] @param {string} [reason] */
  const unpublishable = (result, code = "", reason = "") => ({
    ...(previous || { contract: LEDGER_CONTRACT, employers: [], claims: [] }),
    employers: [],
    claims: [],
    rebuilt: false,
    ingest: ingestSummary(result, null, code, reason),
  });

  if (resume.length > 60_000) {
    const error = resumeTooLongError();
    const result = {
      schema: "ingest-result/1", status: "failed", sourceMode: "text",
      originalSha256: sourceHash.slice(7), textSha256: sourceHash.slice(7),
      model: { provider: pin?.provider || "", id: pin?.resolvedModel || pin?.model || "" },
      chunks: 0, anchors: 0,
      employers: [], structure: { source: "model", employers: [], education: [], credentials: [], looseClaims: [] },
      unread: [], setAside: [], review: { claims: [] }, rejected: [], carried: [], missingEmployers: [],
      resolutions: [], notes: [], reads: 0, stopReasons: [error.code],
      coverage: { linesAttributed: 0, linesNonBlank: 0, anchorsAccounted: 0, anchorsTotal: 0, datedAnchorsAccounted: 0, datedAnchorsTotal: 0 },
      reconciliation: { ok: false, failures: [error.code] },
    };
    await writeIngestResult(result);
    return unpublishable(result, error.code, error.message);
  }

  if (current && resumeFresh && priorReady) {
    if (profileFresh) return { ...previous, rebuilt: false, ingest: ingestSummary(priorResult, previous) };
    const rebuilt = buildLedger({ profile, resumeText: resume, resumeSource, ingestResult: { ...priorResult, structure: previous?.resumeStructure }, nowIso: previous?.builtAt });
    // The structure snapshot is copied byte for byte; only the profile overlay moves.
    rebuilt.resumeStructure = previous?.resumeStructure;
    rebuilt.ledgerHash = hashLedger(rebuilt);
    const { ledgerHash } = await writeLedgerAtomic(rebuilt);
    return { ...rebuilt, ledgerHash, rebuilt: true, ingest: ingestSummary(priorResult, rebuilt) };
  }

  if (!resume || !canModel) {
    const result = await structureResume({ lsrc: resume, pin: null });
    await writeIngestResult(result);
    const stale = previous && (!current || !resumeFresh);
    return unpublishable(result, stale ? "stale_ledger" : "ingest_needs_model",
      stale ? "The saved résumé read is stale. Connect an AI provider to read it again." : "Connect an AI provider so JobBored can read your résumé.");
  }

  const result = await structureResume({ lsrc: resume, pin,
    ...(typeof fetchImpl === "function" ? { fetchImpl: /** @type {typeof globalThis.fetch} */ (fetchImpl) } : {}),
    ...(typeof callStage === "function" ? { callStage: /** @type {(input:Record<string,unknown>)=>Promise<unknown>|unknown} */ (callStage) } : {}),
  });
  await writeIngestResult(result);
  if (result.status !== "ready") {
    const code = result.status === "ready_with_review" ? "ingest_incomplete" : "model_error";
    return unpublishable(result, code, result.status === "ready_with_review" ? "The résumé read is incomplete." : "The model did not return a grounded résumé structure.");
  }
  const built = buildLedger({ profile, resumeText: resume, resumeSource, ingestResult: result });
  if (previous && resumeFresh) {
    /** @param {Array<{id?:string}>} claims @param {string} prefix */
    const count = (claims, prefix) => claims.filter((claim) => typeof claim.id === "string" && claim.id.startsWith(prefix)).length;
    const oldBullets = count(previous.claims, "resume-b");
    const newBullets = count(built.claims, "resume-b");
    const oldRoles = count(previous.claims, "resume-role-");
    const newRoles = count(built.claims, "resume-role-");
    const newKeys = new Set(built.employers.flatMap((entry) => entry.aliases || [employerKey(entry.name)]));
    const missing = /** @type {LedgerEmployer[]} */ (previous.employers).flatMap((entry) =>
      (entry.aliases || [employerKey(entry.name)]).filter((key) => key && !newKeys.has(key)).map((aliasKey) => ({ aliasKey, entry })));
    let loss = "";
    if (built.employers.length < previous.employers.length) loss = "The model returned fewer grounded employers than the saved ledger.";
    else if (newBullets < oldBullets || newRoles < oldRoles) loss = "The model returned fewer grounded résumé claims or roles than the saved ledger.";
    else if (missing.length) loss = "The model omitted a saved employer alias key.";
    if (loss) {
      result.status = "ready_with_review";
      for (const { aliasKey, entry } of missing) {
        const lines = /** @type {Array<{name?:string,lines?:[number,number]}>} */ (previous.resumeStructure?.employers || [])
          .find((item) => item.name === entry.name)?.lines || [1, 1];
        if (!(result.missingEmployers || []).some((item) => item.aliasKey === aliasKey)) {
          result.missingEmployers.push({ aliasKey, displayName: entry.name, lines });
          result.unread.push({ id: `previously-read-${result.unread.length + 1}`, kind: "previously_read", aliasKey, lines, excerpt: entry.name, reason: "previously_read" });
        }
      }
      await writeIngestResult(result);
      return unpublishable(result, "ingest_incomplete", loss);
    }
  }
  const { ledgerHash } = await writeLedgerAtomic(built);
  return { ...built, ledgerHash, rebuilt: true, ingest: ingestSummary(result, built) };
}
