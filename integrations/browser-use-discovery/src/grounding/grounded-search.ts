import { URL } from "node:url";

import type { BrowserUseSessionManager } from "../browser/session.ts";
import type { WorkerRuntimeConfig } from "../config.ts";
import type { CompanyTarget, DiscoveryRun, RawListing } from "../contracts.ts";

const SEARCH_SYSTEM_PROMPT = [
  "You source current live job postings from the public web.",
  "Use Google Search grounding to find candidate links.",
  "Return strict JSON only.",
  'Use this shape: {"results":[{"url":"https://...","title":"...","pageType":"job|listings|careers|other","reason":"..."}]}.',
  "Prefer direct employer job pages and active careers/listings pages that can be expanded into direct jobs.",
  "Use absolute HTTPS URLs.",
].join(" ");

const PAGE_EXTRACTION_PROMPT = [
  "Extract active job postings from this page.",
  "Return strict JSON only.",
  'Use this shape: {"pageType":"job|listings|careers|other","jobs":[{"title":"...","company":"...","location":"...","url":"https://...","descriptionText":"...","compensationText":"...","tags":["..."],"contact":"..."}],"warnings":["..."]}.',
  "If this page is a single job posting, return one job.",
  "If this page is a careers or listings page, return up to 8 relevant direct job links from the page.",
  "Only include active jobs that plausibly match the requested company and filters.",
  "Use absolute HTTPS URLs for each job.",
].join(" ");

const SEED_HOST_DENYLIST = new Set([
  "google.com",
  "www.google.com",
  "support.google.com",
  "linkedin.com",
  "www.linkedin.com",
  "indeed.com",
  "www.indeed.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "monster.com",
  "www.monster.com",
  "ziprecruiter.com",
  "www.ziprecruiter.com",
  "simplyhired.com",
  "www.simplyhired.com",
  "talent.com",
  "www.talent.com",
  "jooble.org",
  "www.jooble.org",
]);

export type GroundedSearchCandidate = {
  url: string;
  title: string;
  pageType: "job" | "listings" | "careers" | "other";
  reason: string;
  sourceDomain: string;
};

export type GroundedSearchResult = {
  searchQueries: string[];
  candidates: GroundedSearchCandidate[];
  warnings: string[];
};

export type GroundedSearchClient = {
  search(company: CompanyTarget, run: DiscoveryRun): Promise<GroundedSearchResult>;
};

export type GroundedWebCollectionResult = {
  rawListings: RawListing[];
  searchQueries: string[];
  seedUrls: string[];
  warnings: string[];
  pagesVisited: number;
};

type FetchImpl = typeof fetch;
type AnyRecord = Record<string, unknown>;

export function createGroundedSearchClient(
  runtimeConfig: WorkerRuntimeConfig,
  dependencies: { fetchImpl?: FetchImpl } = {},
): GroundedSearchClient {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  return {
    async search(company, run) {
      const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
      if (!apiKey) {
        throw new Error("Gemini API key is not configured for grounded search.");
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel || "gemini-2.5-flash")}:generateContent`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SEARCH_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: buildSearchPrompt(
                    company,
                    run,
                    runtimeConfig.groundedSearchMaxResultsPerCompany,
                  ),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
          tools: [{ google_search: {} }],
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          objectString(payload, "error", "message") ||
            `Gemini grounded search HTTP ${response.status}`,
        );
      }

      const responseText = extractModelText(payload);
      const groundingMetadata = firstCandidateGroundingMetadata(payload);
      const searchQueries = uniqueStrings(
        readStringArray(groundingMetadata?.webSearchQueries),
      );
      const explicit = extractGroundedCandidatesFromText(responseText, company);
      const cited = extractGroundedCandidatesFromMetadata(
        groundingMetadata,
        company,
      );
      const candidates = mergeGroundedCandidates(
        explicit,
        cited,
        company,
        runtimeConfig.groundedSearchMaxResultsPerCompany,
      );

      return {
        searchQueries,
        candidates,
        warnings:
          candidates.length > 0
            ? []
            : ["Grounded search returned no usable candidate links."],
      };
    },
  };
}

export async function collectGroundedWebListings(input: {
  company: CompanyTarget;
  run: DiscoveryRun;
  runtimeConfig: WorkerRuntimeConfig;
  groundedSearchClient: GroundedSearchClient;
  sessionManager: BrowserUseSessionManager;
}): Promise<GroundedWebCollectionResult> {
  const searchResult = await input.groundedSearchClient.search(
    input.company,
    input.run,
  );
  const warnings = [...searchResult.warnings];
  const seedCandidates = searchResult.candidates.slice(
    0,
    Math.max(1, input.runtimeConfig.groundedSearchMaxPagesPerCompany || 1),
  );
  const rawListings: RawListing[] = [];
  let pagesVisited = 0;

  for (const candidate of seedCandidates) {
    try {
      const sessionResult = await input.sessionManager.run({
        url: candidate.url,
        instruction: buildPagePrompt(input.company, input.run, candidate),
        timeoutMs: 25_000,
      });
      pagesVisited += 1;
      const listings = extractListingsFromSessionResult({
        text: sessionResult.text,
        candidate,
        company: input.company,
        searchQueries: searchResult.searchQueries,
      });
      rawListings.push(...listings);
    } catch (error) {
      warnings.push(
        `Grounded page extraction failed for ${candidate.url}: ${formatError(error)}`,
      );
    }
  }

  return {
    rawListings: dedupeRawListings(rawListings),
    searchQueries: searchResult.searchQueries,
    seedUrls: seedCandidates.map((entry) => entry.url),
    warnings,
    pagesVisited,
  };
}

function buildSearchPrompt(
  company: CompanyTarget,
  run: DiscoveryRun,
  maxResults: number,
): string {
  const config = run.config;
  const isUnrestrictedScope = !company.name;

  // For unrestricted scope (empty company name), compose query from modifiers only
  // without placeholder company artifacts that could bias search toward irrelevant terms.
  // VAL-ROUTE-010: grounded query evidence is modifier-driven, not placeholder-company-driven.
  const lines: string[] = [];

  if (isUnrestrictedScope) {
    // Unrestricted: search is driven by modifier fields only
    // Do NOT include "Company:" with empty value - it creates misleading placeholder artifacts
    lines.push("Search focus: Modifier-driven intent search (no fixed company target)");
  } else {
    lines.push(`Company: ${company.name}`);
  }

  lines.push(
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Exclude keywords: ${joinOrAny([
      ...config.excludeKeywords,
      ...(company.excludeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
    `Return at most ${Math.max(1, maxResults)} candidate links.`,
    "Mix direct employer job pages with expandable careers/listings pages when useful.",
  );

  return lines.join("\n");
}

function buildPagePrompt(
  company: CompanyTarget,
  run: DiscoveryRun,
  candidate: GroundedSearchCandidate,
): string {
  const config = run.config;
  return [
    PAGE_EXTRACTION_PROMPT,
    `Target company: ${company.name}`,
    `Seed page type: ${candidate.pageType}`,
    `Seed link reason: ${candidate.reason || "search result"}`,
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Exclude keywords: ${joinOrAny([
      ...config.excludeKeywords,
      ...(company.excludeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
  ].join("\n");
}

function extractListingsFromSessionResult(input: {
  text: string;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const structured = extractListingsFromStructuredText(input);
  if (structured.length) return structured;

  if (looksLikeHtml(input.text)) {
    const jsonLdListings = extractListingsFromJsonLd(input);
    if (jsonLdListings.length) return jsonLdListings;
    return extractListingsFromHtmlLinks(input);
  }

  return [];
}

function extractListingsFromStructuredText(input: {
  text: string;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const parsed = parseJsonLoose(input.text);
  const items = extractStructuredListingItems(parsed);
  return items
    .map((item) =>
      toRawListing(item, {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "structured",
      }),
    )
    .filter((item): item is RawListing => !!item);
}

function extractListingsFromJsonLd(input: {
  text: string;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const listings: RawListing[] = [];
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(input.text || "")))) {
    const parsed = parseJsonLoose(htmlDecode(match[1] || ""));
    for (const entry of flattenJsonLdNodes(parsed)) {
      if (!isJobPostingNode(entry)) continue;
      const listing = toRawListing(entry, {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "json_ld",
      });
      if (listing) listings.push(listing);
    }
  }
  return dedupeRawListings(listings);
}

function extractListingsFromHtmlLinks(input: {
  text: string;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const listings: RawListing[] = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(String(input.text || "")))) {
    const url = resolveUrl(input.candidate.url, match[1] || "");
    if (!url || !isLikelyJobLink(url)) continue;
    const title = cleanText(stripHtml(match[2] || ""));
    if (!isLikelyJobTitle(title)) continue;
    const listing = toRawListing(
      {
        title,
        url,
        company: input.company.name,
      },
      {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "html_link",
      },
    );
    if (listing) listings.push(listing);
  }
  return dedupeRawListings(listings).slice(0, 8);
}

function toRawListing(
  source: unknown,
  context: {
    candidate: GroundedSearchCandidate;
    company: CompanyTarget;
    searchQueries: string[];
    extractionMode: string;
  },
): RawListing | null {
  const record = isPlainRecord(source) ? source : {};
  const title = readFirstStringValue(record, [
    "title",
    "jobTitle",
    "role",
    "position",
    "name",
    "text",
  ]);
  if (!isLikelyJobTitle(title)) return null;

  const url = resolveUrl(
    context.candidate.url,
    readFirstStringValue(record, [
      "url",
      "jobUrl",
      "applyUrl",
      "link",
      "hostedUrl",
    ]) || context.candidate.url,
  );
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const companyName =
    readFirstStringValue(record, [
      "company",
      "employer",
      "organization",
      "organizationName",
    ]) ||
    objectString(record, "company", "name") ||
    objectString(record, "hiringOrganization", "name") ||
    context.company.name;

  if (!companiesLikelyMatch(companyName, context.company.name)) {
    return null;
  }

  return {
    sourceId: "grounded_web",
    sourceLabel: "Grounded Search",
    title,
    company: companyName,
    location: cleanText(
      readFirstStringValue(record, [
        "location",
        "applicantLocationRequirements",
      ]) ||
        objectString(record, "jobLocation", "address", "addressLocality") ||
        objectString(record, "jobLocation", "name"),
    ),
    url,
    compensationText: cleanText(
      readFirstStringValue(record, [
        "compensationText",
        "compensation",
        "salary",
        "salaryRange",
      ]) ||
        objectString(record, "baseSalary", "value", "value") ||
        objectString(record, "baseSalary", "value", "minValue"),
    ),
    contact: readFirstStringValue(record, [
      "contact",
      "recruiter",
      "hiringManager",
    ]),
    descriptionText: cleanText(
      readFirstStringValue(record, [
        "descriptionText",
        "description",
        "summary",
        "excerpt",
      ]),
    ),
    tags: uniqueStrings([
      ...readStringArray(record.tags),
      ...readStringArray(record.keywords),
      ...readStringArray(record.departments),
      ...readStringArray(record.teams),
    ]),
    metadata: {
      sourceQuery: uniqueStrings([
        ...context.searchQueries,
        context.candidate.url,
      ]).join(" | "),
      extractionMode: context.extractionMode,
      seedPageType: context.candidate.pageType,
      seedReason: context.candidate.reason,
      seedTitle: context.candidate.title,
      seedDomain: context.candidate.sourceDomain,
    },
  };
}

function extractGroundedCandidatesFromText(
  text: string,
  company: CompanyTarget,
): GroundedSearchCandidate[] {
  const parsed = parseJsonLoose(text);
  const rows = isPlainRecord(parsed)
    ? Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : Array.isArray(parsed.links)
          ? parsed.links
          : []
    : Array.isArray(parsed)
      ? parsed
      : [];

  return rows
    .map((entry) => toGroundedCandidate(entry, company))
    .filter((entry): entry is GroundedSearchCandidate => !!entry);
}

function extractGroundedCandidatesFromMetadata(
  groundingMetadata: AnyRecord | null,
  company: CompanyTarget,
): GroundedSearchCandidate[] {
  const chunks = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];
  return chunks
    .map((chunk) => {
      const record = isPlainRecord(chunk) ? chunk : {};
      const web = isPlainRecord(record.web) ? record.web : {};
      return toGroundedCandidate(
        {
          url: cleanText(web.uri),
          title: cleanText(web.title),
          pageType: classifyPageType(cleanText(web.uri), cleanText(web.title)),
          reason: "Grounded Google Search citation",
        },
        company,
      );
    })
    .filter((entry): entry is GroundedSearchCandidate => !!entry);
}

function toGroundedCandidate(
  source: unknown,
  company: CompanyTarget,
): GroundedSearchCandidate | null {
  const record = isPlainRecord(source) ? source : {};
  const url = cleanAbsoluteUrl(
    readFirstStringValue(record, ["url", "uri", "link", "href"]),
  );
  if (!url || !isSupportedSeedUrl(url)) return null;

  const title = readFirstStringValue(record, ["title", "name"]) || url;
  const pageType = normalizePageType(
    readFirstStringValue(record, ["pageType", "type"]) ||
      classifyPageType(url, title),
  );
  const reason =
    readFirstStringValue(record, ["reason", "why"]) ||
    `Grounded search result for ${company.name}`;

  return {
    url,
    title,
    pageType,
    reason,
    sourceDomain: safeHostname(url),
  };
}

function mergeGroundedCandidates(
  explicit: GroundedSearchCandidate[],
  cited: GroundedSearchCandidate[],
  company: CompanyTarget,
  limit: number,
): GroundedSearchCandidate[] {
  const byUrl = new Map<string, GroundedSearchCandidate>();
  for (const candidate of [...explicit, ...cited]) {
    const key = candidate.url;
    const existing = byUrl.get(key);
    if (!existing || candidateScore(candidate, company) > candidateScore(existing, company)) {
      byUrl.set(key, candidate);
    }
  }
  return [...byUrl.values()]
    .sort((left, right) => candidateScore(right, company) - candidateScore(left, company))
    .slice(0, Math.max(1, limit));
}

function candidateScore(
  candidate: GroundedSearchCandidate,
  company: CompanyTarget,
): number {
  let score = 0;
  if (candidate.pageType === "job") score += 40;
  else if (candidate.pageType === "listings") score += 30;
  else if (candidate.pageType === "careers") score += 20;
  if (isLikelyJobLink(candidate.url)) score += 12;
  if (mentionsCompany(candidate.url, candidate.title, company.name)) score += 8;
  if (candidate.reason) score += 2;
  return score;
}

function classifyPageType(url: string, title: string): GroundedSearchCandidate["pageType"] {
  const haystack = `${url} ${title}`.toLowerCase();
  if (
    /(\/job\/|\/jobs\/|\/careers\/[^/?#]+|\/positions\/|gh_jid=|lever\.co\/[^/]+\/[^/?#]+|ashbyhq\.com\/[^/]+\/[^/?#]+)/i.test(
      haystack,
    )
  ) {
    return "job";
  }
  if (/(careers|open roles|job board|jobs search|all jobs|join us)/i.test(haystack)) {
    return "listings";
  }
  if (/(career|jobs)/i.test(haystack)) {
    return "careers";
  }
  return "other";
}

function normalizePageType(value: string): GroundedSearchCandidate["pageType"] {
  const text = String(value || "").toLowerCase();
  if (text === "job" || text === "jobs" || text === "posting") return "job";
  if (text === "listings" || text === "listing" || text === "board") return "listings";
  if (text === "careers" || text === "career") return "careers";
  return "other";
}

function isSupportedSeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return false;
    if (SEED_HOST_DENYLIST.has(parsed.hostname.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

function cleanAbsoluteUrl(input: string): string {
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  const raw = String(maybeRelative || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractStructuredListingItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isPlainRecord(value)) return [];
  for (const key of ["jobs", "listings", "results", "leads", "items"]) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  if (value.url || value.jobUrl || value.applyUrl) return [value];
  return [];
}

function flattenJsonLdNodes(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLdNodes(entry));
  }
  if (!isPlainRecord(value)) return [];
  if (Array.isArray(value["@graph"])) {
    return flattenJsonLdNodes(value["@graph"]);
  }
  return [value];
}

function isJobPostingNode(value: AnyRecord): boolean {
  const type = value["@type"];
  if (typeof type === "string") return type.toLowerCase() === "jobposting";
  if (Array.isArray(type)) {
    return type.some(
      (entry) => typeof entry === "string" && entry.toLowerCase() === "jobposting",
    );
  }
  return false;
}

function parseJsonLoose(input: string): unknown | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  for (const candidate of [body, extractJsonObject(body), extractJsonArray(body)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractJsonObject(input: string): string {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function extractJsonArray(input: string): string {
  const start = input.indexOf("[");
  const end = input.lastIndexOf("]");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function firstCandidateGroundingMetadata(payload: unknown): AnyRecord | null {
  if (!isPlainRecord(payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates.find((entry) => isPlainRecord(entry));
  if (!isPlainRecord(candidate) || !isPlainRecord(candidate.groundingMetadata)) {
    return null;
  }
  return candidate.groundingMetadata as AnyRecord;
}

function extractModelText(payload: unknown): string {
  if (!isPlainRecord(payload) || !Array.isArray(payload.candidates)) return "";
  const candidate = payload.candidates.find((entry) => isPlainRecord(entry));
  if (!isPlainRecord(candidate) || !isPlainRecord(candidate.content)) return "";
  const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  return parts
    .map((entry) => (isPlainRecord(entry) ? cleanText(entry.text) : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function companiesLikelyMatch(left: string, right: string): boolean {
  const a = normalizeCompanyKey(left);
  const b = normalizeCompanyKey(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function mentionsCompany(url: string, title: string, companyName: string): boolean {
  const haystack = `${url} ${title}`.toLowerCase();
  return companyName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((entry) => entry.length >= 3)
    .some((token) => haystack.includes(token));
}

function normalizeCompanyKey(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyJobLink(url: string): boolean {
  return /(\/job\/|\/jobs\/|\/careers\/[^/?#]+|\/positions\/|gh_jid=|lever\.co\/[^/]+\/[^/?#]+|ashbyhq\.com\/[^/]+\/[^/?#]+)/i.test(
    String(url || ""),
  );
}

/**
 * Denylist of obvious navigation/junk anchor titles that should never be
 * promoted as job opportunity titles, even if they link to a job URL.
 */
const NAVIGATION_TITLE_DENYLIST = new Set([
  // Generic navigation
  "skip to content",
  "skip to main content",
  "skip navigation",
  "read more",
  "read more →",
  "read more »",
  "learn more",
  "learn more →",
  "learn more »",
  "click here",
  "click here →",
  "click here »",
  "view all",
  "view all jobs",
  "view all →",
  "see all",
  "see all jobs",
  "see more",
  "see more →",
  "show more",
  "show more →",
  "more info",
  "more information",
  "get more info",
  // Navigation labels
  "menu",
  "home",
  "about",
  "contact",
  "blog",
  "search",
  "jobs",
  "careers",
  "open roles",
  "apply",
  "search jobs",
  "sign in",
  "log in",
  "signup",
  "register",
  // Social/actions
  "share",
  "tweet",
  "email",
  "print",
  "download",
  "apply now",
  "apply now →",
  "submit",
  "submit →",
  "next",
  "previous",
  "back",
  "continue",
  "continue →",
  "learn more about",
  "find out more",
  "explore",
  "discover",
  "get started",
  "start now",
]);

/**
 * Returns true if the title looks like a real job title (not a navigation
 * label or junk anchor text) and is long enough to be plausible.
 */
function isLikelyJobTitle(input: string): boolean {
  const text = cleanText(input).toLowerCase();
  if (!text || text.length < 4) return false;
  // Reject exact denylist matches
  if (NAVIGATION_TITLE_DENYLIST.has(text)) return false;
  // Reject titles that are prefixes of denylist entries (e.g. "read more about" -> "read more")
  for (const junk of NAVIGATION_TITLE_DENYLIST) {
    if (text.startsWith(junk + " ") || text.startsWith(junk + " –") || text.startsWith(junk + " —")) {
      return false;
    }
  }
  if (
    [
      "careers",
      "jobs",
      "open roles",
      "apply",
      "search jobs",
      "view all jobs",
    ].includes(text)
  ) {
    return false;
  }
  return /[a-z]/i.test(text);
}

/**
 * Multi-signal dedupe for raw listings: uses normalized (title + company)
 * identity in addition to URL to collapse semantic duplicates across alternate
 * URLs that point to the same job (e.g. short link vs long link, same job
 * accessed via different referral paths).
 *
 * Strategy: First group by (title, company) identity. For each identity group,
 * pick the best entry (longest description, or direct job link as tiebreaker).
 * This collapses alternate URLs for the same job into a single entry.
 */
function dedupeRawListings(listings: RawListing[]): RawListing[] {
  // Identity key -> best listing for that identity
  const byIdentity = new Map<string, RawListing>();

  for (const listing of listings) {
    const urlKey = cleanAbsoluteUrl(listing.url);
    if (!urlKey) continue;

    // Build identity key from normalized title + company
    const normalizedTitle = normalizeForDedup(listing.title || "");
    const normalizedCompany = normalizeForDedup(listing.company || "");
    if (!normalizedTitle || !normalizedCompany) continue;

    const identityKey = `${normalizedTitle}|${normalizedCompany}`;
    const existing = byIdentity.get(identityKey);

    // Choose the better listing: longer description wins; if equal, prefer
    // a URL that looks like a direct job link over a generic/redirect URL.
    const existingDescLen = String(existing?.descriptionText || "").length;
    const newDescLen = String(listing.descriptionText || "").length;
    const better = !existing ||
      newDescLen > existingDescLen ||
      (newDescLen === existingDescLen &&
        isLikelyJobLink(urlKey) && !isLikelyJobLink(existing.url || ""));

    if (better) {
      byIdentity.set(identityKey, { ...listing, url: urlKey });
    }
  }

  return [...byIdentity.values()];
}

/**
 * Normalizes a string for use as part of a dedupe identity key.
 * Strips punctuation, folds whitespace, and lowercases.
 */
function normalizeForDedup(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function joinOrAny(values: readonly string[]): string {
  const cleaned = uniqueStrings((values || []).map((entry) => cleanText(entry)));
  return cleaned.length ? cleaned.join(", ") : "any";
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) =>
        Array.isArray(entry) ? readStringArray(entry) : [cleanText(entry)],
      )
      .filter(Boolean);
  }
  if (isPlainRecord(value)) {
    const text = objectString(value, "name") || objectString(value, "title");
    return text ? [text] : [];
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

function readFirstStringValue(record: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = cleanText(value);
      if (text) return text;
    }
  }
  return "";
}

function objectString(value: unknown, ...path: string[]): string {
  let current = value;
  for (const segment of path) {
    if (!isPlainRecord(current)) return "";
    current = current[segment];
  }
  return cleanText(current);
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function cleanText(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(stripHtml(htmlDecode(value)));
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : normalizeWhitespace(String(value));
}

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(input: string): string {
  return String(input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function looksLikeHtml(input: string): boolean {
  return /<html\b|<body\b|<a\b|<script\b|<title>/i.test(String(input || ""));
}

function isPlainRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
