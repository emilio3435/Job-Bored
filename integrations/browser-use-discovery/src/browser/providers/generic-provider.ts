import type { CareerSurfaceType, CompanyTarget, RawListing } from "../../contracts.ts";
import type { BrowserUseSessionManager } from "../session.ts";
import {
  DEFAULT_PROVIDER_BROWSER_INSTRUCTION,
  buildProviderSurface,
  collectMemoryUrls,
  dedupeSurfaces,
  extractLinksFromHtml,
  extractStructuredListings,
  fetchText,
  looksLikeProviderMarkup,
  toAbsoluteUrl,
  tryParseJson,
} from "./shared.ts";
import type {
  AtsProvider,
  ProviderDetectionHints,
  ProviderMemorySnapshot,
  ProviderSurface,
} from "./types.ts";

type HeuristicProviderConfig = {
  id: AtsProvider["id"];
  label: string;
  browserInstruction?: string;
  listingLinkPattern: RegExp;
  detectMarkers: Array<string | RegExp>;
  canonicalizeSurface(url: string): {
    canonicalUrl: string;
    surfaceType: CareerSurfaceType;
    boardToken?: string;
    finalUrl?: string;
    metadata?: Record<string, unknown>;
  } | null;
  buildBoardUrlsFromToken?: (token: string) => string[];
  allowCompanyTokenGuess?: boolean;
  preflightTokens?: boolean;
};

export function createHeuristicProvider(
  config: HeuristicProviderConfig,
): AtsProvider {
  const provider: AtsProvider = {
    id: config.id,
    label: config.label,
    async detectSurfaces(company, hints, memory) {
      const surfaces: ProviderSurface[] = [];
      const pushSurface = (
        rawUrl: string,
        origin: string,
        confidence: number,
        warnings: string[] = [],
      ) => {
        const canonical = config.canonicalizeSurface(rawUrl);
        if (!canonical) return;
        surfaces.push(
          buildProviderSurface(config.id, config.label, company, {
            ...canonical,
            confidence,
            warnings,
            metadata: { origin, ...(canonical.metadata || {}) },
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

      const explicitTokenUrls = candidateTokenUrls(
        config,
        hints.explicitTokens,
        memory,
      );
      for (const url of explicitTokenUrls) {
        if (config.preflightTokens && !(await preflight(url, config.detectMarkers))) {
          continue;
        }
        pushSurface(url, "hint_token", 0.78);
      }

      if (config.allowCompanyTokenGuess) {
        const companyTokenUrls = candidateTokenUrls(
          config,
          hints.companyTokens,
          memory,
        );
        for (const url of companyTokenUrls) {
          if (config.preflightTokens && !(await preflight(url, config.detectMarkers))) {
            continue;
          }
          pushSurface(url, "company_token", 0.6, [
            "Surface derived from company token heuristic.",
          ]);
        }
      }

      return dedupeSurfaces(surfaces, provider.scoreSurface);
    },
    async enumerateListings(surface, sessionManager) {
      const targetUrl = surface.finalUrl || surface.canonicalUrl || surface.boardUrl;
      const sessionResult = await sessionManager.run({
        url: targetUrl,
        instruction:
          config.browserInstruction || DEFAULT_PROVIDER_BROWSER_INSTRUCTION,
        timeoutMs: 20_000,
      });
      const payload = tryParseJson(sessionResult.text);
      const structured = extractStructuredListings(
        payload ?? sessionResult.text,
        surface,
        provider.extractExternalJobId,
      );
      if (structured.length > 0) return structured;
      return extractLinksFromHtml(
        sessionResult.text,
        surface,
        config.listingLinkPattern,
      );
    },
    canonicalizeUrl(url) {
      return config.canonicalizeSurface(url)?.canonicalUrl || null;
    },
    extractExternalJobId(url, payload) {
      const fromPayload = extractIdFromPayload(payload);
      if (fromPayload) return fromPayload;
      try {
        const parsed = new URL(url);
        for (const key of [
          "job",
          "jobId",
          "job_id",
          "posting_id",
          "req",
          "reqId",
          "requisitionId",
          "jobReq",
          "jobreq",
          "gh_jid",
        ]) {
          const value = parsed.searchParams.get(key);
          if (value) return value;
        }
        const segments = parsed.pathname.split("/").filter(Boolean);
        return segments[segments.length - 1] || "";
      } catch {
        return "";
      }
    },
    scoreSurface(surface) {
      let score = Math.round(surface.confidence * 100);
      const origin = String(surface.metadata.origin || "");
      if (origin === "memory") score += 8;
      if (origin === "hint_url") score += 6;
      if (origin === "company_domain") score += 4;
      if (origin === "company_token") score -= 8;
      if (surface.surfaceType === "provider_board") score += 2;
      return score;
    },
  };
  return provider;
}

async function preflight(
  url: string,
  markers: Array<string | RegExp>,
): Promise<boolean> {
  const result = await fetchText(url);
  if (!result.ok) return false;
  return looksLikeProviderMarkup(result.text, markers);
}

function candidateTokenUrls(
  config: HeuristicProviderConfig,
  tokens: string[],
  memory?: ProviderMemorySnapshot,
): string[] {
  if (!config.buildBoardUrlsFromToken) return [];
  const memoryUrls = new Set(collectMemoryUrls(config.id, memory));
  const out = new Set<string>();
  for (const token of tokens) {
    const trimmed = String(token || "").trim();
    if (!trimmed) continue;
    for (const url of config.buildBoardUrlsFromToken(trimmed)) {
      if (url) out.add(url);
    }
  }
  for (const url of memoryUrls) {
    out.add(url);
  }
  return [...out];
}

function extractIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  for (const key of [
    "id",
    "jobId",
    "job_id",
    "postingId",
    "posting_id",
    "reqId",
    "requisitionId",
    "referenceId",
    "openingId",
  ]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return "";
}
