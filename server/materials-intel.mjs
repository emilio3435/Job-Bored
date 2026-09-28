/**
 * Materials — company intel pack (Wave 3, C-6; contract materials.intel.v1).
 *
 * Research the company once, reuse it across roles. The pack is built in
 * this order, cheapest first:
 *
 *   1. the posting's own About block (free, deterministic);
 *   2. ONE Gemini google_search grounded search per company (news and
 *      what the company does, merged), the same grounding the discovery
 *      worker uses (integrations/browser-use-discovery/src/grounding/
 *      grounded-search.ts). The model decides whether to search: the
 *      generateContent API has no setting that forces google_search
 *      (toolConfig.functionCallingConfig modes apply to function calls
 *      only; checked against ai.google.dev, 2026-09-28). So a reply with
 *      no groundingMetadata is retried ONCE with a stricter search-only
 *      prompt; if that is ungrounded too, the pack is the posting alone.
 *      At most 2 search calls per company;
 *   3. the logo resolver for the brand block.
 *
 * Company facts are cached per domain at <JOBBORED_HOME>/intel/<key>.json
 * for 30 days (key = the company's domain, else its name slug). The
 * role-level half (jdPains, proofMap, tone, the hiring contact) is stored
 * in the application dir as intel.json.
 *
 * Budget: under 60 s (Jordan, 2026-09-28; a grounded search alone takes
 * 10-13 s) and at most 3 model calls (the two searches; no
 * structuring call). Any failure degrades the pack to the posting alone;
 * the pack never fails a draft.
 *
 * Grounding: every searched fact carries its source URL and a date. The
 * letter's companyInsight may cite one (as intel-N); the support check
 * accepts a sentence on an intel source only when the cited id exists in
 * this pack, the sentence restates it and it sits in the letter's opening
 * paragraph or the outreach note (enforceIntelCitations). Facts are never
 * invented: an item with no URL from the search's grounding metadata, or
 * with no date, is dropped.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { companyFactsFrom } from "./materials-jd-extract.mjs";
import { companyKey } from "./materials-monogram.mjs";

export const INTEL_CONTRACT = "materials.intel.v1";
export const INTEL_TTL_DAYS = 30;
export const INTEL_BUDGET_MS = 60_000;
export const INTEL_MAX_SEARCHES = 2;
const DAY_MS = 86_400_000;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REDIRECT_HOST = "vertexaisearch.cloud.google.com";

/**
 * @typedef {{ uri: string, title: string }} GroundingSource
 * @typedef {{ text: string, sources: number[] }} GroundingSupport
 * @typedef {{ text: string, sources: GroundingSource[], supports: GroundingSupport[], queries?: string[] }} SearchResult
 * @typedef {(request: { kind: "search" | "retry", prompt: string, signal: AbortSignal }) => Promise<SearchResult>} IntelSearch
 *   one grounded search; tests pass a stub so no test touches the network
 * @typedef {(company: string, domain: string) => Promise<{ logoPath?: string, accentHex?: string, source: string } | null>} BrandResolver
 *
 * @typedef {object} IntelFact a citeable, dated, sourced company fact
 * @property {string} id intel-N
 * @property {"news" | "product" | "mission" | "earnings"} kind
 * @property {string} text
 * @property {string} date YYYY-MM or YYYY-MM-DD (as-of date for undated kinds)
 * @property {string} url
 */

/* Job boards and ATS hosts: their domain is not the company's. */
const JOB_HOST_RE = /(?:^|\.)(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|linkedin\.com|indeed\.com|theladders\.com|ziprecruiter\.com|glassdoor\.com|smartrecruiters\.com|ashbyhq\.com|jobvite\.com|icims\.com|bamboohr\.com|workable\.com|builtin\.com|builtin[a-z]+\.com|wellfound\.com|angel\.co|google\.com|serpapi\.com|monster\.com|dice\.com|simplyhired\.com|careerbuilder\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jazzhr\.com|rippling\.com|paylocity\.com|ultipro\.com|adp\.com|dayforcehcm\.com|oraclecloud\.com|successfactors\.com|taleo\.net|applytojob\.com|jobs\.lever\.co|remote\.co|remoteok\.com|weworkremotely\.com|otta\.com|hired\.com)$/i;

/** The intel cache dir: $JOBBORED_HOME/intel, else ~/.jobbored/intel. */
export function intelRootDir(env = process.env) {
  const root = String(env.JOBBORED_HOME || "").trim() || join(homedir(), ".jobbored");
  return join(root, "intel");
}

/** @param {string} host */
function registrable(host) {
  const labels = String(host || "").toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  while (labels.length > 2 && /^(?:www\d*|careers?|jobs?|join|apply|work|team|about|corporate|investors?)$/.test(labels[0])) labels.shift();
  if (labels.length > 2) {
    const tail2 = labels.slice(-2).join(".");
    return /^(?:co|com|org|net|ac|gov)\.[a-z]{2}$/.test(tail2) ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
  }
  return labels.join(".");
}

/**
 * The company's own domain: the job URL's host when it is not a job board,
 * else a URL or email in the posting whose name matches the company.
 * Empty when neither says.
 * @param {{ company?: string, jobUrl?: string, postingText?: string }} input
 */
export function companyDomain({ company = "", jobUrl = "", postingText = "" }) {
  const key = companyKey(company).replace(/-/g, "");
  const matches = (/** @type {string} */ domain) => {
    const label = domain.split(".")[0].replace(/-/g, "");
    return Boolean(key && label && (key.includes(label) || label.includes(key.slice(0, Math.max(4, Math.min(key.length, 8))))));
  };
  try {
    const host = jobUrl ? new URL(jobUrl).hostname : "";
    const domain = registrable(host);
    if (domain && !JOB_HOST_RE.test(host) && !JOB_HOST_RE.test(domain) && matches(domain)) return domain;
  } catch {
    /* not a URL */
  }
  const text = String(postingText || "");
  const found = [
    ...[...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]),
    ...[...text.matchAll(/\bwww\.([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]),
    ...[...text.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi)].map((m) => m[1]),
  ];
  for (const host of found) {
    const domain = registrable(host);
    if (domain && !JOB_HOST_RE.test(domain) && matches(domain)) return domain;
  }
  return "";
}

/**
 * The cache key: the domain when known, else the company's name slug.
 * @param {{ company?: string, domain?: string }} input
 */
export function intelKey({ company = "", domain = "" }) {
  const key = (domain || companyKey(company)).toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return key.slice(0, 120);
}

/**
 * A cached company half, when fresh (fetchedAt + ttlDays > now).
 * @param {string} root
 * @param {string} key
 * @param {number} nowMs
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readCachedIntel(root, key, nowMs) {
  if (!root || !key) return null;
  try {
    const cached = JSON.parse(await readFile(join(root, `${key}.json`), "utf8"));
    if (!cached || cached.contract !== INTEL_CONTRACT) return null;
    const fetched = Date.parse(String(cached.fetchedAt || ""));
    const ttl = typeof cached.ttlDays === "number" ? cached.ttlDays : INTEL_TTL_DAYS;
    if (!Number.isFinite(fetched) || fetched + ttl * DAY_MS <= nowMs || fetched > nowMs + DAY_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

/* ------------------------------------------------------------------ *
 * The posting (free)
 * ------------------------------------------------------------------ */

/**
 * The posting's About block: its company facts (rank, size, product) and
 * a mission line. Deterministic.
 * @param {string} postingText
 * @returns {{ mission: string, facts: string[] }}
 */
export function mineAbout(postingText) {
  const facts = companyFactsFrom(String(postingText || ""));
  const mission =
    facts.find((f) => /\b(?:our )?mission\b|\bpurpose\b/i.test(f)) ||
    facts.find((f) => /\bwe (?:help|build|make|believe|exist)\b/i.test(f)) ||
    facts.find((f) => /\b(?:is|are) (?:a|an|the)\b/i.test(f)) ||
    "";
  return { mission, facts: facts.slice(0, 6) };
}

/**
 * The posting's register, from its own text.
 * @param {string} postingText
 * @returns {{ register: "formal" | "brisk" | "playful", evidence: string }}
 */
export function postingTone(postingText) {
  const text = String(postingText || "");
  const words = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  const bangs = (text.match(/!/g) || []).length;
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const contractions = (text.match(/\b(?:we're|you'll|you're|we've|let's|it's|don't|we'll|that's)\b/gi) || []).length;
  const youWe = (text.match(/\b(?:you|we)\b/gi) || []).length;
  const per1k = (/** @type {number} */ n) => (n * 1000) / words;
  if (emoji > 0 || per1k(bangs) >= 3) {
    return { register: "playful", evidence: `${bangs} exclamation mark(s), ${emoji} emoji in ${words} words` };
  }
  if (per1k(contractions) >= 2 || per1k(youWe) >= 25) {
    return { register: "brisk", evidence: `${contractions} contraction(s), ${youWe} you/we in ${words} words` };
  }
  return { register: "formal", evidence: `${bangs} exclamation mark(s), ${contractions} contraction(s) in ${words} words` };
}

/** @param {string} text */
function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-z0-9$%+'-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

const STOP = new Set([
  "that", "this", "with", "from", "have", "will", "your", "their", "they", "them", "into", "about", "what", "when",
  "which", "while", "also", "been", "more", "most", "than", "then", "over", "across", "each", "every", "such",
  "company", "companies", "role", "team", "work", "working", "including", "through", "where", "would", "could",
  "should", "these", "those", "there", "here", "just", "like", "make", "made", "year", "years", "month", "months",
  "recent", "recently", "latest", "announced", "launch", "launched", "launches", "new",
]);

/**
 * The job's pains (its outcomes), each with the posting line it came from.
 * @param {{ outcomes?: unknown }} extract
 * @param {string} postingText
 * @returns {Array<{ id: string, text: string, jdQuote: string }>}
 */
export function jdPainsFrom(extract, postingText) {
  const outcomes = Array.isArray(extract?.outcomes) ? extract.outcomes : [];
  const lines = String(postingText || "").split(/\n+|(?<=[.!?])\s+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 12);
  /** @type {Array<{ id: string, text: string, jdQuote: string }>} */
  const out = [];
  for (const o of outcomes) {
    if (!o || typeof o !== "object") continue;
    const id = typeof o.id === "string" ? o.id : "";
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!id || !text) continue;
    const want = new Set(words(text));
    let best = "";
    let bestScore = 0;
    for (const line of lines) {
      if (line.includes(text.slice(0, 60))) {
        best = line;
        break;
      }
      const score = words(line).filter((w) => want.has(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    }
    out.push({ id, text: text.slice(0, 300), jdQuote: best.slice(0, 300) });
  }
  return out.slice(0, 8);
}

/**
 * Which ledger claim answers which pain: the letter's proof plan, then the
 * selection's per-outcome coverage when the selection carries it.
 * @param {{ letterBeats?: Record<string, unknown> | null }} outline
 * @param {{ coverage?: unknown }} [selection]
 * @returns {Array<{ painId: string, claimId: string, why: string }>}
 */
export function proofMapFrom(outline, selection) {
  /** @type {Array<{ painId: string, claimId: string, why: string }>} */
  const out = [];
  const seen = new Set();
  const add = (/** @type {unknown} */ painId, /** @type {unknown} */ claimId, /** @type {string} */ why) => {
    if (typeof painId !== "string" || typeof claimId !== "string" || !painId || !claimId) return;
    const key = `${painId}|${claimId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ painId, claimId, why });
  };
  const beats = outline?.letterBeats && typeof outline.letterBeats === "object" ? outline.letterBeats : null;
  if (beats) {
    add(beats.proof1Pain, beats.proof1, "letter proof 1");
    add(beats.proof2Pain, beats.proof2, "letter proof 2");
  }
  const coverage = Array.isArray(selection?.coverage) ? selection.coverage : [];
  for (const row of coverage) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {{ outcomeId?: unknown, claimIds?: unknown }} */ (row);
    for (const claimId of Array.isArray(r.claimIds) ? r.claimIds.slice(0, 2) : []) add(r.outcomeId, claimId, "selected for this outcome");
  }
  return out.slice(0, 12);
}

/* ------------------------------------------------------------------ *
 * Grounded search (Gemini google_search)
 * ------------------------------------------------------------------ */

/**
 * The default search: one Gemini generateContent call with the
 * google_search tool (the discovery worker's grounding). The key travels
 * in x-goog-api-key, never in the URL.
 * @param {{ apiKey: string, model: string, fetchImpl: (input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike> }} input
 * @returns {IntelSearch}
 */
export function geminiGroundedSearch({ apiKey, model, fetchImpl }) {
  return async ({ prompt, signal }) => {
    const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetchImpl(url, {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json", "x-goog-api-key": apiKey }),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SEARCH_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        /* No responseMimeType (Gemini refuses JSON mode with tools) and no
         * small thinking budget: the live proof (2026-09-28) showed a
         * 256-token budget answering from memory with no search at all. */
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
      signal,
    });
    if (!resp || resp.ok === false) {
      const status = resp && typeof resp.status === "number" ? resp.status : 0;
      throw Object.assign(new Error(`grounded search HTTP ${status}`), { status });
    }
    const data = typeof resp.json === "function" ? await resp.json() : null;
    return parseGeminiGrounding(data);
  };
}

/* The live proof showed the model answering from memory when the prompt
 * alone asked for a search; the discovery worker also carries a system
 * instruction. An unsearched reply has no grounding sources and every
 * item in it is dropped. */
export const SEARCH_SYSTEM_PROMPT = [
  "You are a research assistant with Google Search.",
  "Use Google Search. Answer only from search results; cite each fact.",
  "Always run Google Search before you answer, and state only what the search results say.",
  "Never answer from memory. Never guess a date, a number or a URL.",
  "For every item, name the domain of the search result it came from.",
].join(" ");

/**
 * Text, sources and supports from a generateContent reply.
 * @param {unknown} data
 * @returns {SearchResult}
 */
export function parseGeminiGrounding(data) {
  const cand = data && typeof data === "object" && Array.isArray(/** @type {{ candidates?: unknown }} */ (data).candidates)
    ? /** @type {{ candidates: Array<Record<string, unknown>> }} */ (data).candidates[0]
    : null;
  const content = cand && typeof cand.content === "object" && cand.content ? /** @type {{ parts?: unknown }} */ (cand.content) : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts.map((p) => (p && typeof p.text === "string" && !p.thought ? p.text : "")).join("");
  const meta = cand && typeof cand.groundingMetadata === "object" && cand.groundingMetadata
    ? /** @type {{ groundingChunks?: unknown, groundingSupports?: unknown, webSearchQueries?: unknown }} */ (cand.groundingMetadata)
    : {};
  const chunks = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
  const sources = chunks.map((c) => {
    const web = c && typeof c === "object" && c.web && typeof c.web === "object" ? c.web : {};
    return { uri: typeof web.uri === "string" ? web.uri : "", title: typeof web.title === "string" ? web.title : "" };
  });
  const rawSupports = Array.isArray(meta.groundingSupports) ? meta.groundingSupports : [];
  const supports = rawSupports.map((s) => ({
    text: s && s.segment && typeof s.segment.text === "string" ? s.segment.text : "",
    sources: Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices.filter((/** @type {unknown} */ i) => Number.isInteger(i)) : [],
  }));
  const queries = Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries.filter((q) => typeof q === "string") : [];
  return { text, sources, supports, queries };
}

/**
 * Did the search run and return sources? (groundingMetadata with at least
 * one web chunk URL.)
 * @param {SearchResult} result
 */
export function isGrounded(result) {
  return Boolean(result && result.sources.some((s) => s.uri));
}

/**
 * The JSON object in a search reply (bare, or inside a json code fence).
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
export function parseSearchJson(text) {
  const raw = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(body.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The grounding source for one item: the support segment that restates
 * it (by its key text), else the only source there is. Null when the
 * search cannot tie the item to a page: such an item is dropped.
 * @param {string[]} keys the item's own strings (headline, summary, name)
 * @param {SearchResult} result
 * @param {string} [hint] the domain the model named for the item: it counts
 *   only when a grounding chunk from this search carries that domain
 * @returns {GroundingSource | null}
 */
export function sourceFor(keys, result, hint = "") {
  const usable = result.sources.filter((s) => s.uri);
  if (!usable.length) return null;
  const norm = (/** @type {string} */ t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const key of keys.map(norm).filter((k) => k.length >= 8)) {
    const probe = key.slice(0, 48);
    for (const support of result.supports) {
      if (!norm(support.text).includes(probe)) continue;
      const src = support.sources.map((i) => result.sources[i]).find((s) => s && s.uri);
      if (src) return src;
    }
  }
  /* Word overlap: half of the item's words in one supported segment. */
  for (const key of keys) {
    const want = new Set(words(key));
    if (want.size < 2) continue;
    for (const support of result.supports) {
      const got = words(support.text).filter((w) => want.has(w)).length;
      if (got / want.size >= 0.5) {
        const src = support.sources.map((i) => result.sources[i]).find((s) => s && s.uri);
        if (src) return src;
      }
    }
  }
  const want = String(hint || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (want && want.includes(".")) {
    /* Run 3 of the live proof tied "AudioGraph" to the Butler/Till press
     * release because both came from northwindmedia.com: a named domain
     * counts only when exactly one page from it grounded the reply. */
    const byDomain = usable.filter((s) => {
      const title = String(s.title || "").toLowerCase().replace(/^www\./, "");
      let host = "";
      try {
        host = new URL(s.uri).hostname.replace(/^www\./, "");
      } catch {
        host = "";
      }
      return title === want || title.endsWith(`.${want}`) || want.endsWith(`.${title}`) || host === want || host.endsWith(`.${want}`);
    });
    const pages = [...new Map(byDomain.map((src) => [src.uri, src])).values()];
    if (pages.length === 1) return pages[0];
  }
  return usable.length === 1 ? usable[0] : null;
}

/**
 * Grounding redirect URLs resolved to the page they point at (one HEAD
 * each, bounded); an unresolved one is kept as is (it still redirects).
 * @param {string[]} urls
 * @param {(input: string | URL, init?: RequestInit) => Promise<import("./materials-writer.mjs").HttpResponseLike & { headers?: { get?: (name: string) => string | null } }>} fetchImpl
 * @param {number} timeoutMs
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveRedirects(urls, fetchImpl, timeoutMs) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const todo = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).hostname === REDIRECT_HOST;
    } catch {
      return false;
    }
  });
  if (!todo.length || timeoutMs < 300) return out;
  await Promise.all(todo.slice(0, 8).map(async (url) => {
    try {
      const resp = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      const status = resp && typeof resp.status === "number" ? resp.status : 0;
      const location = resp && resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("location") || "" : "";
      if (status >= 300 && status < 400 && /^https?:\/\//i.test(location) && !location.includes(REDIRECT_HOST)) out.set(url, location);
    } catch {
      /* keep the redirect URL */
    }
  }));
  return out;
}

/** @param {unknown} v */
function str(v, max = 400) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * A date the pack can carry: YYYY-MM or YYYY-MM-DD, not in the future and
 * not older than two years.
 * @param {unknown} value
 * @param {number} nowMs
 */
export function cleanDate(value, nowMs) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(str(value));
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const at = Date.UTC(year, month - 1, day);
  if (at > nowMs + 2 * DAY_MS || at < nowMs - 730 * DAY_MS) return "";
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

/**
 * The search prompts. Exported so tests can snapshot them.
 * @param {{ company: string, domain: string, title: string, today: string }} input
 */
export function searchPrompts({ company, domain, title, today }) {
  const who = `${company}${domain ? ` (${domain})` : ""}`;
  const shape = `{"news":[{"headline":"","date":"YYYY-MM-DD","summary":"one factual sentence the result states","source":"domain of that result","relevance":"why it matters to a ${title || "new"} hire"}],"domain":"the official website domain","ticker":"exchange:ticker, or empty","mission":"one sentence, in the company's own words","missionSource":"domain","products":[{"name":"","oneLine":"","source":"domain"}],"earnings":{"period":"","revenueNote":"","segmentNote":"","source":"domain"}}`;
  const rules = [
    "Return JSON only, in one ```json block, no prose:",
    shape,
    "news: at most 3 items from the last 12 months (launches, partnerships, earnings, leadership or strategy moves), newest first, each with its publication date. products: at most 4. earnings: only when the company is public and a result gives its latest reported quarter; otherwise omit it.",
    "Only facts a search result states; cite each one's domain in source. Never guess a date. Leave out anything you cannot cite.",
  ];
  return {
    search: [
      `Today is ${today}. Use Google Search. Answer only from search results; cite each fact.`,
      `Search for: "${company} news ${today.slice(0, 4)}", "${company} announces", and "${company} products${domain ? ` site:${domain}` : ""}".`,
      `Company: ${who}.`,
      ...rules,
    ].join("\n"),
    retry: [
      `Today is ${today}. You MUST call Google Search before answering. Your previous answer did not use Google Search, so it cannot be used.`,
      `Run these searches now: "${company} press release", "${company} news ${today.slice(0, 4)}", "${company}${domain ? ` ${domain}` : ""} about".`,
      "Answer only from those search results; cite each fact. If a search returns nothing, leave that part empty. Do not answer from memory.",
      `Company: ${who}.`,
      ...rules,
    ].join("\n"),
  };
}

/**
 * @param {Record<string, unknown> | null} json
 * @param {SearchResult} result
 * @param {number} nowMs
 * @param {Map<string, string>} resolved
 */
function newsFrom(json, result, nowMs, resolved) {
  const items = Array.isArray(json?.news) ? json.news : [];
  /** @type {Array<{ headline: string, date: string, url: string, relevance: string, summary: string }>} */
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const headline = str(item.headline, 200);
    const summary = str(item.summary, 300);
    const date = cleanDate(item.date, nowMs);
    if (!headline || !date) continue;
    const src = sourceFor([headline, summary], result, str(item.source, 120));
    if (!src) continue;
    out.push({ headline, date, url: resolved.get(src.uri) || src.uri, relevance: str(item.relevance, 200), summary });
  }
  return out.slice(0, 3);
}

/**
 * @param {Record<string, unknown> | null} json
 * @param {SearchResult} result
 * @param {Map<string, string>} resolved
 */
function companyFrom(json, result, resolved) {
  /** @type {Array<{ name: string, oneLine: string, url: string }>} */
  const products = [];
  for (const item of Array.isArray(json?.products) ? json.products : []) {
    if (!item || typeof item !== "object") continue;
    const name = str(item.name, 80);
    const oneLine = str(item.oneLine, 200);
    if (!name) continue;
    const src = sourceFor([oneLine, name], result, str(item.source, 120));
    if (!src) continue;
    products.push({ name, oneLine, url: resolved.get(src.uri) || src.uri });
  }
  const missionText = str(json?.mission, 300);
  const missionSrc = missionText ? sourceFor([missionText], result, str(json?.missionSource, 120)) : null;
  const e = json?.earnings && typeof json.earnings === "object" ? /** @type {Record<string, unknown>} */ (json.earnings) : null;
  const period = e ? str(e.period, 40) : "";
  const revenueNote = e ? str(e.revenueNote, 240) : "";
  const earningsSrc = e && period && revenueNote ? sourceFor([revenueNote, str(e.segmentNote, 240)], result, str(e.source, 120)) : null;
  const domain = str(json?.domain, 120).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return {
    domain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : "",
    ticker: str(json?.ticker, 24),
    mission: missionSrc ? { text: missionText, url: resolved.get(missionSrc.uri) || missionSrc.uri } : null,
    products: products.slice(0, 4),
    earnings: earningsSrc
      ? { period, revenueNote, segmentNote: e ? str(e.segmentNote, 240) : "", url: resolved.get(earningsSrc.uri) || earningsSrc.uri }
      : null,
  };
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withDeadline(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("intel budget spent"), { code: "intel_timeout" })), Math.max(0, ms));
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout]).finally(() => clearTimeout(timer)));
}

/**
 * Build (or reuse) the intel pack for one role. Never throws.
 *
 * @param {object} input
 * @param {string} input.company
 * @param {string} [input.title]
 * @param {string} [input.jobUrl]
 * @param {string} input.postingText
 * @param {Record<string, unknown>} [input.extract] jd-extract (for jdPains)
 * @param {{ letterBeats?: Record<string, unknown> | null }} [input.outline]
 * @param {{ coverage?: unknown }} [input.selection]
 * @param {string} [input.contact] the hiring contact the sheet or enrichment names
 * @param {IntelSearch | null} [input.search] null: posting only
 * @param {BrandResolver | null} [input.resolveBrand]
 * @param {(input: string | URL, init?: RequestInit) => Promise<any>} [input.fetchImpl] for redirect resolution
 * @param {string} [input.cacheRoot] the per-domain cache dir ("" = no cache)
 * @param {string} [input.appDir] where intel.json (the role half) is written
 * @param {number} [input.budgetMs]
 * @param {() => number} [input.clock] ms clock (tests)
 * @param {Date | string | number} [input.now]
 * @returns {Promise<{ pack: Record<string, unknown>, facts: IntelFact[], degraded: string, modelCalls: number, cacheHit: boolean, ms: number, grounding: Array<{ call: string, grounded: boolean, sources: number, queries: number, ms: number, error?: string }> }>}
 */
export async function buildIntelPack({
  company,
  title = "",
  jobUrl = "",
  postingText,
  extract = {},
  outline = {},
  selection = {},
  contact = "",
  search = null,
  resolveBrand = null,
  fetchImpl,
  cacheRoot = "",
  appDir = "",
  budgetMs = INTEL_BUDGET_MS,
  clock = () => Date.now(),
  now,
}) {
  const started = clock();
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const nowMs = nowDate.getTime();
  const left = () => budgetMs - (clock() - started);
  const about = mineAbout(postingText);
  let domain = companyDomain({ company, jobUrl, postingText });
  const key = intelKey({ company, domain });
  /** @type {string[]} */
  const problems = [];
  let modelCalls = 0;
  let cacheHit = false;
  /** @type {Array<{ call: string, grounded: boolean, sources: number, queries: number, ms: number, error?: string }>} */
  const attempts = [];

  /** @type {Record<string, unknown> | null} */
  let companyHalf = null;
  try {
    companyHalf = await readCachedIntel(cacheRoot, key, nowMs);
    cacheHit = Boolean(companyHalf);
  } catch {
    companyHalf = null;
  }

  if (!companyHalf) {
    /** @type {Array<{ headline: string, date: string, url: string, relevance: string, summary: string }>} */
    let news = [];
    /** @type {ReturnType<typeof companyFrom> | null} */
    let searched = null;
    /** @type {{ logoPath?: string, accentHex?: string, source: string } | null} */
    let brand = null;
    const prompts = searchPrompts({ company, domain, title, today: nowDate.toISOString().slice(0, 10) });
    const controller = new AbortController();
    const brandJob = resolveBrand
      ? withDeadline(resolveBrand(company, domain), Math.max(0, left() - 200)).catch((err) => {
        problems.push(`brand: ${String(err && err.message ? err.message : err).slice(0, 80)}`);
        return null;
      })
      : Promise.resolve(null);
    if (search) {
      /** @type {SearchResult | null} */
      let grounded = null;
      for (const kind of /** @type {const} */ (["search", "retry"])) {
        if (left() < 2000) {
          problems.push(`${kind}: skipped, intel budget spent`);
          break;
        }
        modelCalls += 1;
        const t0 = clock();
        try {
          const result = await withDeadline(search({ kind, prompt: prompts[kind], signal: controller.signal }), Math.max(0, left() - 1500));
          const ok = isGrounded(result);
          attempts.push({ call: kind, grounded: ok, sources: result.sources.filter((s) => s.uri).length, queries: (result.queries || []).length, ms: Math.round(clock() - t0) });
          if (ok) {
            grounded = result;
            break;
          }
        } catch (err) {
          const message = String(err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : err).slice(0, 80);
          attempts.push({ call: kind, grounded: false, sources: 0, queries: 0, ms: Math.round(clock() - t0), error: message });
          /* An error (HTTP, timeout) is not an ungrounded answer: no retry. */
          problems.push(`${kind}: ${message}`);
          break;
        }
      }
      controller.abort();
      if (grounded) {
        const resolved = fetchImpl
          ? await resolveRedirects(grounded.sources.map((s) => s.uri), fetchImpl, Math.min(2500, left() - 500)).catch(() => new Map())
          : new Map();
        const json = parseSearchJson(grounded.text);
        if (!json) problems.push("search: unreadable reply");
        news = newsFrom(json, grounded, nowMs, resolved);
        searched = companyFrom(json, grounded, resolved);
        if (!domain && searched.domain) domain = searched.domain;
      } else if (!problems.some((p) => /^(?:search|retry):/.test(p))) {
        problems.push("search: not grounded after one retry (posting only)");
      }
    } else {
      problems.push("no grounded search available (posting only)");
    }
    brand = await brandJob;
    const searchedOk = Boolean(search) && attempts.some((a) => a.grounded) && problems.every((p) => !/^(?:search|retry)/.test(p));
    companyHalf = {
      contract: INTEL_CONTRACT,
      fetchedAt: nowDate.toISOString(),
      ttlDays: INTEL_TTL_DAYS,
      company: { name: company, domain, ...(searched?.ticker ? { ticker: searched.ticker } : {}) },
      mission: searched?.mission?.text || about.mission,
      missionSource: searched?.mission ? { url: searched.mission.url, kind: "search" } : { url: jobUrl, kind: "posting" },
      products: searched ? searched.products : [],
      news,
      ...(searched?.earnings ? { earnings: searched.earnings } : {}),
      brand: brand ? { logoPath: brand.logoPath || "", ...(brand.accentHex ? { accentHex: brand.accentHex } : {}), source: brand.source } : { logoPath: "", source: "monogram" },
      postingFacts: about.facts,
      sources: [...new Set([
        ...news.map((n) => n.url),
        ...(searched ? searched.products.map((p) => p.url) : []),
        ...(searched?.mission ? [searched.mission.url] : []),
        ...(searched?.earnings ? [searched.earnings.url] : []),
        ...(jobUrl ? [jobUrl] : []),
      ].filter(Boolean))],
    };
    /* Only a pack whose searches both answered is cached: a posting-only
     * or half-failed pack is retried on the next draft. */
    if (searchedOk && cacheRoot && key) {
      try {
        await mkdir(cacheRoot, { recursive: true });
        await writeJsonAtomic(join(cacheRoot, `${key}.json`), companyHalf);
      } catch (err) {
        problems.push(`cache write: ${String(err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : err).slice(0, 80)}`);
      }
    }
  }

  const tone = postingTone(postingText);
  const pack = {
    ...companyHalf,
    people: contact ? { hiringManager: { name: str(contact, 120), title: "", source: "sheet" } } : {},
    jdPains: jdPainsFrom(extract, postingText),
    proofMap: proofMapFrom(outline, selection),
    tone,
    cache: { key, hit: cacheHit, ...(cacheRoot ? { path: join(cacheRoot, `${key}.json`) } : {}) },
    ...(problems.length ? { degraded: { reason: problems.join("; ").slice(0, 400) } } : {}),
    budget: { ms: Math.max(0, Math.round(clock() - started)), modelCalls, limitMs: budgetMs },
    grounding: attempts,
  };
  if (appDir) {
    try {
      await writeJsonAtomic(join(appDir, "intel.json"), pack);
    } catch {
      /* the pack never fails a draft */
    }
  }
  return {
    pack,
    facts: intelFacts(pack),
    degraded: problems.join("; "),
    modelCalls,
    cacheHit,
    ms: Math.max(0, Math.round(clock() - started)),
    grounding: attempts,
  };
}

/**
 * The pack's citeable facts, numbered intel-1…: each dated and sourced.
 * Posting facts are not listed (the posting is its own legal source).
 * @param {Record<string, unknown> | null | undefined} pack
 * @returns {IntelFact[]}
 */
export function intelFacts(pack) {
  if (!pack || typeof pack !== "object") return [];
  const asOf = str(pack.fetchedAt).slice(0, 10);
  /** @type {Array<Omit<IntelFact, "id">>} */
  const out = [];
  for (const n of Array.isArray(pack.news) ? pack.news : []) {
    if (!n || !n.url || !n.date) continue;
    out.push({ kind: "news", text: [str(n.headline), str(n.summary)].filter(Boolean).join(": ").slice(0, 400), date: str(n.date), url: str(n.url, 2000) });
  }
  for (const p of Array.isArray(pack.products) ? pack.products : []) {
    if (!p || !p.url) continue;
    out.push({ kind: "product", text: `${str(p.name)}${p.oneLine ? `: ${str(p.oneLine)}` : ""}`, date: asOf, url: str(p.url, 2000) });
  }
  const e = pack.earnings && typeof pack.earnings === "object" ? /** @type {Record<string, unknown>} */ (pack.earnings) : null;
  if (e && e.url) out.push({ kind: "earnings", text: [`${str(e.period)} results`, str(e.revenueNote), str(e.segmentNote)].filter(Boolean).join(": "), date: str(e.period, 40) || asOf, url: str(e.url, 2000) });
  const ms = pack.missionSource && typeof pack.missionSource === "object" ? /** @type {Record<string, unknown>} */ (pack.missionSource) : null;
  if (ms && ms.kind === "search" && ms.url && pack.mission) out.push({ kind: "mission", text: str(pack.mission), date: asOf, url: str(ms.url, 2000) });
  return out.filter((f) => f.text && f.url).slice(0, 8).map((f, i) => ({ id: `intel-${i + 1}`, ...f }));
}

/** @param {string} url */
function hostOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === REDIRECT_HOST ? "search result" : host;
  } catch {
    return "source";
  }
}

/**
 * The intel facts as draft-prompt lines (the companyInsight may cite ONE).
 * @param {IntelFact[]} facts
 * @returns {string[]}
 */
export function intelPromptLines(facts) {
  if (!facts.length) return [];
  return [
    "",
    "Company intel (researched; dated and sourced). companyInsight may state ONE of these, closely, naming its month and year for news; it is the only company fact allowed beyond the posting. Never add to it, never combine two, never characterize the company beyond it:",
    ...facts.map((f) => `- ${f.id} (${f.kind}, ${f.date}, ${hostOf(f.url)}): ${f.text}`),
  ];
}

/**
 * The intel facts as one text block, for deterministic grounding and
 * numeral tracing (the rubric's posting-overlap check).
 * @param {IntelFact[]} facts
 */
export function intelGroundingText(facts) {
  return facts.map((f) => (/[.!?]$/.test(f.text) ? f.text : `${f.text}.`)).join("\n");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The support check's intel rule, deterministic (Wave 3): a verdict whose
 * source names an intel id is accepted only when
 *   - that id is in this pack,
 *   - the sentence sits in the letter's opening paragraph (hook or
 *     companyInsight) or the outreach note,
 *   - the sentence restates the fact (two or more of its content words),
 *   - and any year or month it names matches the fact's date.
 * Otherwise the sentence is unsupported, whatever the model said.
 * Accepted verdicts carry the fact's id, URL and date for the source map.
 * @template {{ beat: string, sentence: string, factual: boolean, supported: boolean | null, reason: string, source?: string }} V
 * @param {V[] | null} verdicts
 * @param {IntelFact[]} facts
 * @param {{ company?: string }} [options]
 * @returns {Array<V & { intel?: { id: string, url: string, date: string } }> | null}
 */
export function enforceIntelCitations(verdicts, facts, { company = "" } = {}) {
  if (!Array.isArray(verdicts)) return verdicts;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const companyWords = new Set(words(String(company || "").replace(/[,.]/g, " ")).concat(companyKey(company).split("-")));
  return verdicts.map((v) => {
    const m = /\bintel-(\d+)\b/i.exec(String(v.source || ""));
    if (!m) return v;
    const id = `intel-${m[1]}`;
    const fact = byId.get(id);
    const reject = (/** @type {string} */ reason) => ({ ...v, factual: true, supported: false, reason });
    if (!fact) return reject(`cites ${id}, which is not in the company intel pack`);
    if (!/^(?:hook|companyInsight|outreach\.)/.test(v.beat)) return reject(`${id} may only support the letter's opening paragraph or the outreach note`);
    const want = new Set(words(fact.text));
    const shared = words(v.sentence).filter((w) => !companyWords.has(w) && want.has(w));
    if (new Set(shared).size < 2) return reject(`does not restate ${id} (${fact.text.slice(0, 80)})`);
    const years = [...v.sentence.matchAll(/\b(20\d{2})\b/g)].map((y) => y[1]);
    const factYear = fact.date.slice(0, 4);
    if (years.some((y) => y !== factYear) && /^\d{4}/.test(fact.date)) return reject(`names a year that is not ${id}'s date (${fact.date})`);
    const monthNamed = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}\\b`, "i").test(v.sentence));
    const factMonth = Number(fact.date.slice(5, 7));
    if (monthNamed >= 0 && factMonth && monthNamed + 1 !== factMonth && fact.kind === "news") return reject(`names a month that is not ${id}'s date (${fact.date})`);
    return { ...v, intel: { id, url: fact.url, date: fact.date } };
  });
}
