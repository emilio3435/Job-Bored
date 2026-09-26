/**
 * Materials v3 — build the claim ledger from the user's resume and profile
 * (plan slice 1, mechanism §5).
 *
 * Deterministic extraction only: employers from profile experiences plus
 * resume header lines, claims from strength evidence plus resume bullets,
 * metric tokens from numerals, and a tool inventory split into
 * user-asserted (owned) and resume-mentioned (adjacent). Every string is
 * verbatim user text with a recorded source — nothing is inferred, so
 * every claim ships verified:true and selection can feature any of them.
 *
 * Fails with `ledger_empty` when neither input yields a fact.
 */

import { createHash } from "node:crypto";
import { hashLedger, readLedger, writeLedgerAtomic, LEDGER_CONTRACT } from "./materials-ledger.mjs";

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
 */

/**
 * @typedef {object} LedgerClaim
 * @property {string} id
 * @property {string | null} employerId
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
const MAX_INVENTORY = 40;

/* Numerals that may appear as emphasized metric runs. Years and year
 * ranges are dates, not metrics. */
const METRIC_RE = /((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g;
const YEAR_RE = /^(?:19|20)\d\d$/;
const YEAR_RANGE_RE = /^(?:19|20)\d\d[–-](?:19|20)\d\d$/;

/* "Employer — Title, dates" / "Employer | Title" header lines. */
const EMPLOYER_HEADER_RE = /^(.{2,60}?)\s+[—–|]\s+(.{2,80})$/;
const BULLET_RE = /^\s*(?:[-•*·]|\d+[.)])\s+/;
const DATE_SPAN_RE = /(\d{4})\s*[–-]\s*(\d{4}|present)/i;
const SECTION_RE = /^[A-Z][A-Z\s&/]{2,40}$/;

/* Resume-mentioned tools ship as adjacent; profile keywords are owned. */
const TOOL_LEXICON = [
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

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function clean(value, max = MAX_CLAIM_TEXT) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

/** @param {string} name */
function slugify(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "employer";
}

/**
 * @param {string} text
 * @returns {Array<{ token: string, unit: string }>}
 */
function extractMetrics(text) {
  /** @type {Array<{ token: string, unit: string }>} */
  const out = [];
  const seen = new Set();
  for (const match of text.matchAll(METRIC_RE)) {
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
    const re = new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) found.push(tool);
  }
  return found;
}

/**
 * @param {string} text
 * @param {string} section
 * @returns {LedgerClaim["kind"]}
 */
function guessKind(text, section) {
  if (/EDUCATION|DEGREE|UNIVERSITY|COLLEGE/.test(section)) return "education";
  if (/CERTIF|LICENSE/.test(section)) return "credential";
  if (SYSTEM_RE.test(text)) return "system";
  if (OPERATIONS_RE.test(text)) return "operations";
  return "achievement";
}

/**
 * @param {string} rest title/dates remainder of a header line
 * @returns {{ title: string, start: string | null, end: string | null }}
 */
function splitTitleDates(rest) {
  const m = DATE_SPAN_RE.exec(rest);
  if (!m) return { title: rest.trim(), start: null, end: null };
  return {
    title: rest.slice(0, m.index).replace(/[,;:\s]+$/, "").trim(),
    start: m[1],
    end: /present/i.test(m[2]) ? null : m[2],
  };
}

/**
 * @param {unknown} profile
 * @param {string} resumeText
 */
function collectEmployers(profile, resumeText) {
  /** @type {LedgerEmployer[]} */
  const employers = [];
  /** @type {Map<string, LedgerEmployer>} */
  const byName = new Map();
  const add = (/** @type {LedgerEmployer} */ employer) => {
    const key = employer.name.toLowerCase();
    if (byName.has(key)) {
      const prior = byName.get(key);
      if (prior && !prior.title && employer.title) prior.title = employer.title;
      return byName.get(key);
    }
    employers.push(employer);
    byName.set(key, employer);
    return employer;
  };
  if (isRecord(profile) && Array.isArray(profile.experiences)) {
    for (const raw of profile.experiences) {
      if (!isRecord(raw)) continue;
      const name = clean(raw.company || raw.label, 120);
      if (!name) continue;
      add({
        id: typeof raw.slug === "string" && raw.slug ? raw.slug : slugify(name),
        name,
        ...(clean(raw.title, 160) ? { title: clean(raw.title, 160) } : {}),
      });
    }
  }
  for (const line of resumeText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || BULLET_RE.test(trimmed)) continue;
    const m = EMPLOYER_HEADER_RE.exec(trimmed);
    if (!m) continue;
    const name = m[1].trim();
    if (/^(experience|education|skills|summary|projects?)$/i.test(name)) continue;
    const { title, start, end } = splitTitleDates(m[2].trim());
    add({
      id: slugify(name),
      name,
      ...(title ? { title: clean(title, 160) } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    });
  }
  return { employers, byName };
}

/**
 * Build a claim ledger from profile JSON plus resume text. Pure and
 * synchronous: no LLM, no network, no disk.
 * @param {object} input
 * @param {unknown} input.profile canonical UserProfile or null
 * @param {string} [input.resumeText] the user's resume, plain text
 * @param {string} [input.resumeSource] portfolio | profile | upload | …
 * @param {string} [input.nowIso]
 */
export function buildLedger({ profile, resumeText = "", resumeSource = "upload", nowIso }) {
  const resume = String(resumeText || "").trim().slice(0, 60_000);
  const builtAt = nowIso || new Date().toISOString();
  const { employers, byName } = collectEmployers(profile, resume);

  /** @type {LedgerClaim[]} */
  const claims = [];
  /** @type {Array<{ id: string, kind: string, hash: string, ingestedAt: string }>} */
  const sources = [];
  if (resume) {
    sources.push({
      id: `resume-${sha(resume).slice(7, 15)}`,
      kind: "resume",
      hash: sha(resume),
      ingestedAt: builtAt,
    });
  }
  const profileText = isRecord(profile) ? JSON.stringify(profile) : "";
  if (profileText) {
    sources.push({ id: "profile", kind: "profile", hash: sha(profileText), ingestedAt: builtAt });
  }
  const sourceIds = sources.map((s) => s.id);

  if (isRecord(profile) && Array.isArray(profile.strengths)) {
    for (const raw of profile.strengths) {
      if (!isRecord(raw)) continue;
      const evidence = clean(raw.evidence, 1200);
      if (!evidence) continue;
      const rank = typeof raw.rank === "number" ? raw.rank : claims.length + 1;
      claims.push({
        id: `profile-strength-${rank}`,
        employerId: null,
        kind: "achievement",
        text: evidence,
        metrics: extractMetrics(evidence),
        tools: matchTools(`${raw.name || ""} ${evidence}`),
        sourceRefs: ["profile"],
        verified: true,
      });
    }
  }

  let bulletN = 0;
  let section = "";
  let currentEmployerId = null;
  for (const line of resume.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (SECTION_RE.test(trimmed) && trimmed.length < 40) {
      section = trimmed;
      continue;
    }
    const header = EMPLOYER_HEADER_RE.exec(trimmed);
    if (header && !BULLET_RE.test(trimmed)) {
      currentEmployerId = byName.get(header[1].trim().toLowerCase())?.id || null;
      continue;
    }
    if (!BULLET_RE.test(trimmed)) continue;
    const text = clean(trimmed.replace(BULLET_RE, ""));
    if (!text) continue;
    bulletN += 1;
    claims.push({
      id: `resume-b${bulletN}`,
      employerId: currentEmployerId,
      kind: guessKind(text, section),
      text,
      metrics: extractMetrics(text),
      tools: matchTools(text),
      sourceRefs: sourceIds.filter((id) => id !== "profile"),
      verified: true,
    });
  }

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
    sources,
    employers,
    claims,
    toolInventory: [...inventory.values()].slice(0, MAX_INVENTORY),
  };
  ledger.ledgerHash = hashLedger(ledger);
  return ledger;
}

/**
 * Load the stored ledger, rebuilding it when the inputs moved. Returns
 * the ledger plus whether it was rebuilt.
 * @param {object} input
 * @param {unknown} input.profile
 * @param {string} [input.resumeText]
 * @param {string} [input.resumeSource]
 */
export async function ensureLedger({ profile, resumeText = "", resumeSource = "upload" }) {
  const resume = String(resumeText || "").trim().slice(0, 60_000);
  const profileText = isRecord(profile) ? JSON.stringify(profile) : "";
  const stored = await readLedger();
  if (stored.ok) {
    const sources = Array.isArray(stored.ledger.sources) ? stored.ledger.sources : [];
    const resumeSourceEntry = sources.find((s) => s && s.kind === "resume");
    const profileSourceEntry = sources.find((s) => s && s.kind === "profile");
    const resumeFresh =
      (resume ? resumeSourceEntry?.hash === sha(resume) : !resumeSourceEntry) &&
      (!resumeSourceEntry || resume);
    const profileFresh =
      (profileText ? profileSourceEntry?.hash === sha(profileText) : !profileSourceEntry) &&
      (!profileSourceEntry || profileText);
    if (resumeFresh && profileFresh) {
      return { ...stored.ledger, rebuilt: false };
    }
  }
  const built = buildLedger({ profile, resumeText: resume, resumeSource });
  const { ledgerHash } = await writeLedgerAtomic(built);
  return { ...built, ledgerHash, rebuilt: true };
}
