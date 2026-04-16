import type { RawListing } from "../../contracts.ts";
import type { BrowserUseSessionManager } from "../session.ts";
import {
  LEVER_BROWSER_INSTRUCTION,
  buildLeverBoardUrl,
  buildLeverJobsUrl,
} from "../selectors/lever.ts";
import {
  buildProviderSurface,
  collectMemoryUrls,
  dedupeRawListings,
  dedupeSurfaces,
  extractLinksFromHtml,
  fetchJson,
  fetchText,
  objectString,
  objectValue,
  sanitizeCompensationValue,
  sanitizeDescriptionText,
  sanitizeTags,
  stringValue,
} from "./shared.ts";
import type {
  AtsProvider,
  ProviderDetectionHints,
  ProviderSurface,
} from "./types.ts";

export const leverProvider: AtsProvider = {
  id: "lever",
  label: "Lever",
  async detectSurfaces(company, hints, memory) {
    const surfaces: ProviderSurface[] = [];

    for (const url of collectMemoryUrls("lever", memory)) {
      const canonical = canonicalizeLeverSurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("lever", "Lever", company, {
          ...canonical,
          confidence: 0.99,
          metadata: { origin: "memory" },
        }),
      );
    }

    for (const url of hints.explicitUrls) {
      const canonical = canonicalizeLeverSurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("lever", "Lever", company, {
          ...canonical,
          confidence: 0.93,
          metadata: { origin: "hint_url" },
        }),
      );
    }

    for (const token of uniqueProbeTokens(hints)) {
      const endpoint = buildLeverJobsUrl(token);
      const payload = await fetchJson(endpoint);
      if (payload.ok) {
        surfaces.push(
          buildProviderSurface("lever", "Lever", company, {
            ...canonicalizeLeverSurface(buildLeverBoardUrl(token))!,
            confidence: hints.explicitTokens.includes(token) ? 0.97 : 0.88,
            metadata: {
              origin: hints.explicitTokens.includes(token)
                ? "hint_token"
                : "company_token",
            },
            warnings: hints.explicitTokens.includes(token)
              ? []
              : ["Surface derived from company token heuristic."],
          }),
        );
        continue;
      }

      const html = await fetchText(buildLeverBoardUrl(token));
      if (
        html.ok &&
        (/jobs\.lever\.co/i.test(html.text) || /"lever"/i.test(html.text))
      ) {
        surfaces.push(
          buildProviderSurface("lever", "Lever", company, {
            ...canonicalizeLeverSurface(buildLeverBoardUrl(token))!,
            confidence: hints.explicitTokens.includes(token) ? 0.74 : 0.58,
            metadata: {
              origin: hints.explicitTokens.includes(token)
                ? "hint_token"
                : "company_token",
            },
            warnings: [
              "Detected from HTML probe instead of the postings API.",
              ...(hints.explicitTokens.includes(token)
                ? []
                : ["Surface derived from company token heuristic."]),
            ],
          }),
        );
      }
    }

    return dedupeSurfaces(surfaces, leverProvider.scoreSurface);
  },
  async enumerateListings(surface, sessionManager) {
    const boardToken = surface.boardToken || extractLeverBoardToken(surface.canonicalUrl);
    if (!boardToken) return [];
    const endpoint = buildLeverJobsUrl(boardToken);
    const payload = await fetchJson(endpoint);
    if (payload.ok) {
      const listings = extractLeverListings(payload.data, surface);
      if (listings.length) return maybeFilterToDirectSurface(surface, listings);
    }

    const sessionResult = await sessionManager.run({
      url: endpoint,
      instruction: LEVER_BROWSER_INSTRUCTION,
      timeoutMs: 20_000,
    });
    const listings = extractLeverListings(sessionResult.text, surface);
    if (listings.length) return maybeFilterToDirectSurface(surface, listings);
    return maybeFilterToDirectSurface(
      surface,
      extractLinksFromHtml(
        sessionResult.text,
        surface,
        /jobs\.lever\.co\/[^"'\\s>]+/i,
      ),
    );
  },
  canonicalizeUrl(url) {
    return canonicalizeLeverSurface(url)?.canonicalUrl || null;
  },
  extractExternalJobId(url, payload) {
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const fromPayload = stringValue(record.id);
    if (fromPayload) return fromPayload;
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    } catch {
      return "";
    }
  },
  scoreSurface(surface) {
    let score = Math.round(surface.confidence * 100);
    if (surface.surfaceType === "provider_board") score += 3;
    if (surface.metadata.origin === "memory") score += 8;
    if (surface.metadata.origin === "hint_url") score += 5;
    if (surface.metadata.origin === "company_token") score -= 8;
    return score;
  },
};

function extractLeverListings(
  payload: unknown,
  surface: ProviderSurface,
): RawListing[] {
  const body =
    typeof payload === "string" ? safeParseJson(payload) ?? payload : payload;
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).postings)
      ? ((body as Record<string, unknown>).postings as unknown[])
      : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).jobs)
        ? ((body as Record<string, unknown>).jobs as unknown[])
        : [];
  return dedupeRawListings(
    rows
      .map((row) => {
        const record =
          row && typeof row === "object" && !Array.isArray(row)
            ? (row as Record<string, unknown>)
            : {};
        const categories = objectValue(record.categories);
        const title = stringValue(record.text) || stringValue(record.title);
        const url =
          stringValue(record.hostedUrl) ||
          stringValue(record.applyUrl) ||
          stringValue(record.url);
        if (!title || !url) return null;
        const normalizedUrl = leverProvider.canonicalizeUrl(url) || url;
        return {
          sourceId: "lever",
          sourceLabel: "Lever",
          providerType: "lever",
          sourceLane: "ats_provider",
          surfaceId: String(surface.metadata.surfaceId || ""),
          title,
          company: String(surface.metadata.companyName || ""),
          location:
            stringValue(categories.location) || stringValue(record.location),
          url: normalizedUrl,
          canonicalUrl: normalizedUrl,
          externalJobId: leverProvider.extractExternalJobId(normalizedUrl, record),
          compensationText:
            sanitizeCompensationValue(record.salaryRange) ||
            sanitizeCompensationValue(record.compensation),
          contact: stringValue(record.leadName) || stringValue(record.contact),
          descriptionText:
            sanitizeDescriptionText(record.description) ||
            sanitizeDescriptionText(record.text),
          tags: sanitizeTags([
            objectString(categories, "team"),
            objectString(categories, "department"),
            objectString(categories, "commitment"),
            objectString(categories, "location"),
          ]),
          metadata: {
            sourceQuery: surface.canonicalUrl || surface.boardUrl,
            postingId: record.id,
          },
        } satisfies RawListing;
      })
      .filter((entry): entry is RawListing => !!entry),
  );
}

function canonicalizeLeverSurface(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "jobs.lever.co") return null;
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    return {
      canonicalUrl: parsed.toString(),
      surfaceType: parts.length > 1 ? "job_posting" : "provider_board",
      boardToken: parts[0] || "",
    } as const;
  } catch {
    return null;
  }
}

function extractLeverBoardToken(url: string): string {
  return canonicalizeLeverSurface(url)?.boardToken || "";
}

function uniqueProbeTokens(hints: ProviderDetectionHints): string[] {
  const out = new Set<string>();
  for (const token of [...hints.explicitTokens, ...hints.companyTokens]) {
    const trimmed = String(token || "").trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
}

function maybeFilterToDirectSurface(
  surface: ProviderSurface,
  listings: RawListing[],
): RawListing[] {
  if (surface.surfaceType !== "job_posting") return listings;
  const jobId = leverProvider.extractExternalJobId(surface.canonicalUrl);
  if (!jobId) return listings;
  return listings.filter(
    (listing) => leverProvider.extractExternalJobId(listing.url) === jobId,
  );
}

function safeParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

