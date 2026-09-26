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

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { callJsonStage } from "./materials-writer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-jd-extract.v1.schema.json");

export const JD_EXTRACT_CONTRACT = "materials.jd-extract.v1";
export const EXTRACT_MAX_OUTPUT_TOKENS = 1000;
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
  "looker", "tableau", "power bi", "ga4", "amplitude", "mixpanel", "segment",
  "elasticsearch", "redis", "pinecone", "langchain", "rag", "google ads", "meta",
  "dv360", "salesforce", "hubspot", "jira", "figma", "excel", "sheets",
];

/** @param {string} text */
function requirementsBlock(text) {
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
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = re.exec(block);
    if (m && !seen.has(term)) {
      seen.add(term);
      found.push(m[0]);
    }
  }
  return found;
}

/**
 * @param {string} text
 * @returns {Array<{ term: string, weight: number }>}
 */
function liftNouns(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of text.split(/[^a-zA-Z][^a-zA-Z0-9+#.]*/)) {
    const term = raw.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
    if (term.length < 5 || STOP_WORDS.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  const top = ranked.length ? ranked[0][1] : 1;
  return ranked.map(([term, count]) => ({
    term,
    weight: Math.round((0.4 + (0.6 * count) / top) * 100) / 100,
  }));
}

/**
 * @param {string} text
 */
function stubOutcomes(text) {
  const bullets = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 24)
    .slice(0, 3);
  if (!bullets.length) {
    const first = text.split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 24);
    if (first) bullets.push(first.trim().slice(0, 200));
  }
  if (!bullets.length) bullets.push("Deliver the outcomes described in the posting.");
  return bullets.map((body, i) => ({ id: `o${i + 1}`, text: body.slice(0, 300), weight: 0.5 }));
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
 * Deterministic half: schema-valid on its own, so it doubles as the
 * degrade path.
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
      ...(gate.signals ? { signals: gate.signals } : {}),
    },
    role: {
      title: String(title || "").trim() || "Unknown role",
      company: String(company || "").trim() || "Unknown company",
      ...(detectWorkMode(text) ? { workMode: detectWorkMode(text) } : {}),
    },
    outcomes: stubOutcomes(text),
    nouns: liftNouns(text),
    stack: { required: liftStack(text), preferred: [] },
    differentiators: [],
    bars: [],
    constraints: [],
    echoBans: [],
  };
}

const EXTRACT_SYSTEM_PROMPT = [
  "You read a job posting and return JSON only with this shape:",
  '{"outcomes":[{"id","text","weight"}],"differentiators":[{"id","text"}],"bars":[{"id","text}],"constraints":[{"type","text"}],"echoBans":[],"nounWeights":{}}.',
  "outcomes: 2-5 things the hire must deliver, weight 0..1.",
  "differentiators: what would make a candidate stand out.",
  "bars: explicit disqualifiers stated in the posting (empty when none).",
  "constraints: location, clearance, travel, scheduling (empty when none).",
  "echoBans: the posting's own marketing phrases the cover letter must not echo (max 6).",
  "nounWeights: 0..1 importance for the role nouns that matter most.",
  "IDs are kebab-case. No prose outside the JSON.",
].join(" ");

/**
 * @param {object} input
 * @param {string} input.jdText
 * @param {string} input.company
 * @param {string} input.title
 * @param {{ verdict: string, confidence: number, signals?: Record<string, unknown> }} input.gate
 * @param {string} [input.source]
 * @param {import("./materials-writer.mjs").WriterPin} input.pin
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike>} input.fetchImpl
 */
export async function extractJd({ jdText, company, title, gate, source, pin, fetchImpl }) {
  const base = deterministicExtract({ jdText, company, title, gate, source });
  const nounList = base.nouns.map((n) => n.term).join(", ");
  let fill = null;
  try {
    fill = await callJsonStage({
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
  } catch {
    return { extract: base, degraded: true };
  }
  const merged = mergeFill(base, fill);
  const validation = validateJdExtract(merged);
  if (!validation.ok) return { extract: base, degraded: true };
  return { extract: merged, degraded: false };
}

/**
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} fill
 */
function mergeFill(base, fill) {
  const pick = (/** @type {unknown} */ value, fallback) => (value !== undefined ? value : fallback);
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  if (Array.isArray(fill.outcomes) && fill.outcomes.length) {
    out.outcomes = fill.outcomes
      .filter((o) => o && typeof o === "object" && typeof o.text === "string" && o.text.trim())
      .map((o, i) => ({
        id: typeof o.id === "string" && o.id ? o.id : `o${i + 1}`,
        text: String(o.text).slice(0, 300),
        weight: typeof o.weight === "number" ? Math.min(1, Math.max(0, o.weight)) : 0.5,
      }));
    if (!out.outcomes.length) out.outcomes = base.outcomes;
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
  if (fill.nounWeights && typeof fill.nounWeights === "object") {
    const weights = /** @type {Record<string, unknown>} */ (fill.nounWeights);
    out.nouns = base.nouns.map((n) => {
      const w = weights[n.term];
      return typeof w === "number" ? { ...n, weight: Math.min(1, Math.max(0, w)) } : n;
    });
  }
  return pick(out, base);
}
