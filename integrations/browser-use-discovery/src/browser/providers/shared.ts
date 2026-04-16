import type {
  AtsSourceId,
  CareerSurfaceType,
  CompanyTarget,
  RawListing,
} from "../../contracts.ts";
import { normalizeLeadUrl } from "../../normalize/lead-normalizer.ts";
import {
  compactCompanyTokens,
  extractTokenFromBoardHint,
  sanitizeCompensationText,
  slugifyCompanyName,
  stripHtml,
  toPlainText,
} from "../selectors/index.ts";
import type { BrowserUseSessionManager } from "../session.ts";
import type {
  AtsProvider,
  ProviderDetectionHints,
  ProviderMemorySnapshot,
  ProviderSurface,
} from "./types.ts";

export const DEFAULT_PROVIDER_BROWSER_INSTRUCTION =
  "Inspect the careers surface and return active direct job links with title, location, company, and URL.";
const PROVIDER_HTTP_TIMEOUT_MS = 8_000;

export type CanonicalizedSurface = {
  canonicalUrl: string;
  surfaceType: ProviderSurface["surfaceType"];
  boardToken?: string;
  finalUrl?: string;
  metadata?: Record<string, unknown>;
};

export function buildDetectionHints(
  company: CompanyTarget,
  sourceId: AtsSourceId,
): ProviderDetectionHints {
  const rawHints = splitHintValues(company.boardHints?.[sourceId]);
  const explicitUrls = uniqueStrings(
    rawHints
      .map((entry) => toAbsoluteUrl(entry))
      .filter((entry): entry is string => !!entry),
  );
  const explicitTokens = uniqueStrings(
    rawHints
      .filter((entry) => !toAbsoluteUrl(entry))
      .map((entry) => extractTokenFromBoardHint(entry))
      .filter(Boolean),
  );
  const domains = uniqueStrings(
    [
      ...(company.domains || []),
      ...rawHints.filter((entry) => looksLikeDomain(entry)),
    ]
      .map(normalizeDomain)
      .filter(Boolean),
  );
  const aliases = uniqueStrings(
    [company.normalizedName || "", ...(company.aliases || [])].filter(Boolean),
  );
  const companyTokens = uniqueStrings(
    [
      ...compactCompanyTokens(company.name),
      ...aliases.flatMap((alias) => compactCompanyTokens(alias)),
      ...domains.flatMap(domainTokensFromHostname),
      company.companyKey || "",
      slugifyCompanyName(company.companyKey || ""),
    ].filter(Boolean),
  );
  return {
    sourceId,
    rawHints,
    explicitUrls,
    explicitTokens,
    companyTokens,
    aliases,
    domains,
  };
}

export function splitHintValues(raw: string | undefined): string[] {
  return String(raw || "")
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function normalizeDomain(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(toAbsoluteUrl(value) || value).hostname
      .toLowerCase()
      .replace(/^www\./i, "");
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
  }
}

export function domainTokensFromHostname(hostname: string): string[] {
  const normalized = normalizeDomain(hostname);
  if (!normalized) return [];
  const labels = normalized.split(".").filter(Boolean);
  const candidate = labels[0] || "";
  if (!candidate || candidate === "www") return [];
  return compactCompanyTokens(candidate);
}

export function toAbsoluteUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (looksLikeDomain(value)) {
    return `https://${value.replace(/^\/+/, "")}`;
  }
  return null;
}

export function looksLikeDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(String(value || "").trim());
}

export function buildProviderSurface(
  providerId: AtsSourceId,
  label: string,
  company: CompanyTarget,
  input: CanonicalizedSurface & {
    confidence: number;
    warnings?: string[];
    metadata?: Record<string, unknown>;
  },
): ProviderSurface {
  const canonicalUrl = normalizeLeadUrl(input.canonicalUrl);
  return {
    matched: true,
    sourceId: providerId,
    sourceLabel: label,
    providerType: providerId,
    boardUrl: canonicalUrl,
    confidence: clampConfidence(input.confidence),
    warnings: [...(input.warnings || [])],
    surfaceType: input.surfaceType,
    canonicalUrl,
    finalUrl: normalizeLeadUrl(input.finalUrl || canonicalUrl),
    boardToken: String(input.boardToken || "").trim(),
    sourceLane: "ats_provider",
    metadata: {
      companyName: company.name,
      companyKey: company.companyKey || "",
      normalizedCompanyName:
        company.normalizedName || slugifyCompanyName(company.name),
      aliases: company.aliases || [],
      domains: company.domains || [],
      ...(input.metadata || {}),
    },
  };
}

export function surfaceCompanyName(surface: ProviderSurface): string {
  return String(surface.metadata.companyName || "").trim() || "Unknown company";
}

export function dedupeSurfaces(
  surfaces: ProviderSurface[],
  scoreSurface: (surface: ProviderSurface) => number,
): ProviderSurface[] {
  const ranked = [...surfaces].sort((left, right) => {
    return scoreSurface(right) - scoreSurface(left);
  });
  const seen = new Set<string>();
  const out: ProviderSurface[] = [];
  for (const surface of ranked) {
    const key = [
      surface.sourceId,
      surface.canonicalUrl,
      surface.boardToken || "",
      surface.surfaceType,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(surface);
  }
  return out;
}

export function collectMemoryUrls(
  providerId: AtsSourceId,
  memory?: ProviderMemorySnapshot,
): string[] {
  const urls = new Set<string>();
  for (const value of memory?.urls || []) {
    if (value) urls.add(value);
  }
  for (const surface of memory?.surfaces || []) {
    if (surface.providerType && surface.providerType !== providerId) continue;
    for (const value of [surface.canonicalUrl, surface.finalUrl]) {
      if (value) urls.add(value);
    }
  }
  return [...urls];
}

type CreateAtsProviderConfig = {
  id: AtsSourceId;
  sourceLabel: string;
  boardUrlPatterns: RegExp[];
  jobUrlPatterns: RegExp[];
  htmlMarkers: Array<string | RegExp>;
  scriptMarkers: Array<string | RegExp>;
  normalizeBoardUrl(raw: string): string;
  normalizeJobUrl(raw: string): string;
  extractBoardToken(raw: string): string;
  extractJobId(raw: string, payload?: unknown): string;
  buildPublicApiProbeUrls(boardHint: string): string[];
  buildPublicFeedProbeUrls(boardHint: string): string[];
  extractListingsFromPayload(payload: unknown, input: {
    boardUrl: string;
    companyName: string;
  }): RawListing[];
};

export function createAtsProvider(
  config: CreateAtsProviderConfig,
): AtsProvider {
  const provider: AtsProvider = {
    id: config.id,
    label: config.sourceLabel,
    async detectSurfaces(company, hints, memory) {
      const surfaces: ProviderSurface[] = [];
      const pushSurface = (
        rawUrl: string,
        origin: string,
        confidence: number,
        warnings: string[] = [],
      ) => {
        const canonicalized = canonicalizeProviderSurface(config, rawUrl);
        if (!canonicalized) return;
        surfaces.push(
          buildProviderSurface(config.id, config.sourceLabel, company, {
            ...canonicalized,
            confidence,
            warnings,
            metadata: { origin, ...(canonicalized.metadata || {}) },
          }),
        );
      };

      for (const url of collectMemoryUrls(config.id, memory)) {
        pushSurface(url, "memory", 0.98);
      }
      for (const url of hints.explicitUrls) {
        pushSurface(url, "hint_url", 0.92);
      }
      for (const domain of hints.domains) {
        const asUrl = toAbsoluteUrl(domain);
        if (asUrl) pushSurface(asUrl, "company_domain", 0.84);
      }

      // Build probe hints only from explicit tokens and non-URL raw hints.
      // Do NOT include companyTokens - they are derived from the company name
      // and can create spurious surfaces when the API probe succeeds for a
      // different company with a similar but not identical name (e.g., "Acme"
      // probe succeeds for "Acme" company instead of "Acme AI").
      const probeHints = uniqueStrings([
        ...hints.explicitTokens,
        ...hints.rawHints
          .filter((value) => !toAbsoluteUrl(value))
          .flatMap((value) => extractBoardHintCandidates(value)),
      ]);
      for (const hint of probeHints) {
        const isExplicit = hints.explicitTokens.includes(hint);
        let matched = false;
        for (const url of config.buildPublicApiProbeUrls(hint)) {
          const response = await fetchJson(url);
          if (!response.ok) continue;
          pushSurface(
            config.normalizeBoardUrl(hint),
            isExplicit ? "hint_token" : "company_token",
            isExplicit ? 0.97 : 0.86,
            isExplicit ? [] : ["Surface derived from company token heuristic."],
          );
          matched = true;
          break;
        }
        if (matched) continue;

        for (const url of uniqueStrings([
          config.normalizeBoardUrl(hint),
          ...config.buildPublicFeedProbeUrls(hint),
        ])) {
          const response = await fetchText(url);
          if (
            !response.ok ||
            !looksLikeProviderMarkup(response.text, [
              ...config.htmlMarkers,
              ...config.scriptMarkers,
            ])
          ) {
            continue;
          }
          pushSurface(
            config.normalizeBoardUrl(hint),
            isExplicit ? "hint_token" : "company_token",
            isExplicit ? 0.74 : 0.58,
            [
              "Detected from HTML/script probe instead of a public feed.",
              ...(isExplicit ? [] : ["Surface derived from company token heuristic."]),
            ],
          );
          break;
        }
      }

      return dedupeSurfaces(surfaces, provider.scoreSurface);
    },
    async enumerateListings(surface, sessionManager) {
      const probeTargets = uniqueStrings([
        ...config.buildPublicApiProbeUrls(surface.boardToken || surface.boardUrl),
        ...config.buildPublicFeedProbeUrls(surface.boardToken || surface.boardUrl),
        surface.finalUrl || "",
        surface.canonicalUrl || "",
      ]);

      for (const target of probeTargets) {
        const response = await fetchJson(target);
        if (!response.ok || response.data == null) continue;
        const listings = config.extractListingsFromPayload(response.data, {
          boardUrl: surface.canonicalUrl || surface.boardUrl,
          companyName: surfaceCompanyName(surface),
        });
        if (listings.length > 0) return dedupeRawListings(listings);
      }

      const sessionResult = await sessionManager.run({
        url: surface.finalUrl || surface.canonicalUrl || surface.boardUrl,
        instruction: DEFAULT_PROVIDER_BROWSER_INSTRUCTION,
        timeoutMs: 20_000,
      });
      const payload = tryParseJson(sessionResult.text);
      const structured = config.extractListingsFromPayload(
        payload ?? sessionResult.text,
        {
          boardUrl: surface.canonicalUrl || surface.boardUrl,
          companyName: surfaceCompanyName(surface),
        },
      );
      if (structured.length > 0) return dedupeRawListings(structured);
      return extractLinksFromHtml(
        sessionResult.text,
        surface,
        mergePatterns(config.boardUrlPatterns, config.jobUrlPatterns),
      );
    },
    canonicalizeUrl(url) {
      return canonicalizeProviderSurface(config, url)?.canonicalUrl || null;
    },
    extractExternalJobId(url, payload) {
      return config.extractJobId(url, payload);
    },
    scoreSurface(surface) {
      let score = Math.round(surface.confidence * 100);
      const origin = String(surface.metadata.origin || "");
      if (origin === "memory") score += 8;
      if (origin === "hint_url") score += 6;
      if (origin === "company_domain") score += 4;
      if (origin === "probe") score -= 2;
      if (surface.surfaceType === "provider_board") score += 2;
      return score;
    },
  };
  return provider;
}

function canonicalizeProviderSurface(
  config: CreateAtsProviderConfig,
  rawUrl: string,
): CanonicalizedSurface | null {
  const raw = String(rawUrl || "").trim();
  if (!raw) return null;
  const boardUrl = normalizeLeadUrl(config.normalizeBoardUrl(raw));
  const jobUrl = normalizeLeadUrl(config.normalizeJobUrl(raw));
  const surfaceType = matchesAnyPattern(raw, config.jobUrlPatterns)
    ? "job_posting"
    : matchesAnyPattern(raw, config.boardUrlPatterns)
      ? "provider_board"
      : jobUrl && jobUrl !== boardUrl
        ? "job_posting"
        : "provider_board";
  const canonicalUrl = surfaceType === "job_posting" ? jobUrl : boardUrl;
  if (!canonicalUrl) return null;
  return {
    canonicalUrl,
    finalUrl: canonicalUrl,
    surfaceType,
    boardToken: config.extractBoardToken(raw),
  };
}

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) =>
    new RegExp(pattern.source, pattern.flags.replace(/g/g, "")).test(value),
  );
}

function mergePatterns(boardPatterns: RegExp[], jobPatterns: RegExp[]): RegExp {
  const sources = [...boardPatterns, ...jobPatterns].map((pattern) => pattern.source);
  return new RegExp(sources.join("|"), "i");
}

export function safeUrl(raw: string): URL | null {
  try {
    return new URL(String(raw || "").trim());
  } catch {
    return null;
  }
}

export function getPathSegments(raw: string): string[] {
  const url = safeUrl(raw);
  if (!url) return [];
  return url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
}

export function getQueryParam(raw: string, key: string): string {
  const url = safeUrl(raw);
  return url?.searchParams.get(key)?.trim() || "";
}

export function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return "";
}

export function ensureAbsoluteUrl(baseUrl: string, candidate: string): string {
  const absolute = resolveRelativeUrl(baseUrl, candidate);
  return /^https?:\/\//i.test(absolute) ? absolute : "";
}

export function extractBoardHintCandidates(raw: string): string[] {
  // If raw is already an absolute URL, return it directly without extracting
  // tokens. Tokens extracted from URLs (e.g., "Acme" from
  // "https://jobs.smartrecruiters.com/AcmeAI") would create spurious probe
  // surfaces when the API succeeds for a different company token.
  if (toAbsoluteUrl(raw)) {
    return [raw];
  }
  return uniqueStrings([
    ...splitHintValues(raw),
    ...compactCompanyTokens(raw),
    extractTokenFromBoardHint(raw),
  ].filter(Boolean));
}

export function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringValue(entry)).filter(Boolean);
}

export function buildLocationText(...values: unknown[]): string {
  return sanitizeTags(values.map((value) => stringValue(value)).filter(Boolean)).join(", ");
}

export function createListing(input: {
  providerId: AtsSourceId;
  sourceLabel: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  jobId?: string;
  compensationText?: string;
  contact?: string;
  descriptionText?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): RawListing {
  const canonicalUrl = normalizeLeadUrl(input.url);
  return {
    sourceId: input.providerId,
    sourceLabel: input.sourceLabel,
    providerType: input.providerId,
    sourceLane: "ats_provider",
    title: normalizeWhitespace(input.title),
    company: normalizeWhitespace(input.company),
    location: normalizeWhitespace(input.location || ""),
    url: canonicalUrl,
    canonicalUrl,
    externalJobId: stringValue(input.jobId),
    compensationText: sanitizeCompensationValue(input.compensationText || ""),
    contact: normalizeWhitespace(input.contact || ""),
    descriptionText: sanitizeDescriptionText(input.descriptionText || ""),
    tags: sanitizeTags(input.tags || []),
    metadata: { ...(input.metadata || {}) },
  };
}

export async function fetchJson(
  url: string,
): Promise<{ ok: boolean; data?: unknown; status: number }> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const text = await response.text();
    const data = tryParseJson(text);
    return { ok: response.ok, data: data ?? text, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function fetchText(
  url: string,
): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    return {
      ok: response.ok,
      text: await response.text(),
      status: response.status,
    };
  } catch {
    return {
      ok: false,
      text: "",
      status: 0,
    };
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function looksLikeProviderMarkup(
  text: string,
  markers: Array<string | RegExp>,
): boolean {
  const haystack = String(text || "");
  if (!haystack) return false;
  const lowered = haystack.toLowerCase();
  return markers.some((marker) => {
    if (typeof marker === "string") {
      return lowered.includes(marker.toLowerCase());
    }
    return new RegExp(marker.source, marker.flags.replace(/g/g, "")).test(
      haystack,
    );
  });
}

export function extractLinksFromHtml(
  html: string,
  surface: ProviderSurface,
  pattern: RegExp,
): RawListing[] {
  const listings: RawListing[] = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(String(html || "")))) {
    const href = match[1] || "";
    if (!pattern.test(href)) continue;
    const resolved = resolveRelativeUrl(surface.canonicalUrl || surface.boardUrl, href);
    if (!/^https?:\/\//i.test(resolved)) continue;
    const title = stripHtml(match[2]);
    if (!title) continue;
    listings.push({
      sourceId: surface.sourceId,
      sourceLabel: surface.sourceLabel,
      providerType: surface.providerType,
      sourceLane: "ats_provider",
      surfaceId: String(surface.metadata.surfaceId || ""),
      title,
      company: surfaceCompanyName(surface),
      location: "",
      url: normalizeLeadUrl(resolved),
      canonicalUrl: normalizeLeadUrl(resolved),
      externalJobId: "",
      compensationText: "",
      contact: "",
      descriptionText: "",
      tags: [],
      metadata: {
        sourceQuery: surface.canonicalUrl || surface.boardUrl,
        extractionMode: "html",
      },
    });
  }
  return dedupeRawListings(listings);
}

export function extractStructuredListings(
  payload: unknown,
  surface: ProviderSurface,
  externalJobId: (url: string, payload?: unknown) => string,
): RawListing[] {
  const records = structuredJobRecords(payload);
  return dedupeRawListings(
    records
      .map((record) => {
        const title =
          readFirstStringValue(record, [
            "title",
            "name",
            "text",
            "jobTitle",
            "positionTitle",
          ]) || "";
        const url = resolveRelativeUrl(
          surface.canonicalUrl || surface.boardUrl,
          readFirstStringValue(record, [
            "url",
            "jobUrl",
            "applyUrl",
            "absolute_url",
            "absoluteUrl",
            "hostedUrl",
            "canonicalUrl",
          ]) || "",
        );
        if (!title || !/^https?:\/\//i.test(url)) return null;
        const location =
          readFirstStringValue(record, [
            "location",
            "locationName",
            "city",
          ]) || objectString(record.location, "name");
        const tags = sanitizeTags([
          readFirstStringValue(record, ["department", "team", "group"]),
          readFirstStringValue(record, ["employmentType", "commitment"]),
          objectString(record.categories, "team"),
          objectString(record.categories, "department"),
          objectString(record.categories, "location"),
        ]);
        return {
          sourceId: surface.sourceId,
          sourceLabel: surface.sourceLabel,
          providerType: surface.providerType,
          sourceLane: "ats_provider",
          surfaceId: String(surface.metadata.surfaceId || ""),
          title,
          company: surfaceCompanyName(surface),
          location,
          url: normalizeLeadUrl(url),
          canonicalUrl: normalizeLeadUrl(url),
          externalJobId: externalJobId(url, record),
          compensationText: sanitizeCompensationValue(
            readFirstStringValue(record, [
              "compensation",
              "compensationText",
              "salary",
              "salaryRange",
            ]),
          ),
          contact: readFirstStringValue(record, ["leadName", "contact"]),
          descriptionText: sanitizeDescriptionText(
            readFirstStringValue(record, [
              "description",
              "descriptionHtml",
              "content",
            ]),
          ),
          tags,
          metadata: {
            sourceQuery: surface.canonicalUrl || surface.boardUrl,
            extractionMode: "structured",
          },
        } satisfies RawListing;
      })
      .filter((entry): entry is RawListing => !!entry),
  );
}

export function resolveRelativeUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export function dedupeRawListings(listings: RawListing[]): RawListing[] {
  const seen = new Set<string>();
  const out: RawListing[] = [];
  for (const item of listings) {
    const key = normalizeLeadUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeDescriptionText(value: unknown): string {
  return toPlainText(stringValue(value));
}

export function sanitizeCompensationValue(value: unknown): string {
  return sanitizeCompensationText(stringValue(value));
}

export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = normalizeWhitespace(tag);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

export function stringValue(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function objectValue(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

export function objectString(value: unknown, key: string): string {
  return stringValue(objectValue(value)[key]);
}

export function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject);
}

export function stringArrayFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      isPlainObject(entry) ? stringValue(entry.name) : stringValue(entry),
    )
    .filter(Boolean);
}

export function readFirstStringValue(
  value: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const found = stringValue(value[key]);
    if (found) return found;
  }
  return "";
}

function structuredJobRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isPlainObject);
  if (!isPlainObject(payload)) return [];
  for (const key of [
    "jobs",
    "postings",
    "results",
    "positions",
    "openings",
    "data",
  ]) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter(isPlainObject);
    }
  }
  return [];
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
