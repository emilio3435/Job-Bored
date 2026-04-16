import type { RawListing } from "../../contracts.ts";
import type { BrowserUseSessionManager } from "../session.ts";
import {
  ASHBY_BROWSER_INSTRUCTION,
  buildAshbyBoardUrl,
  buildAshbyJobsUrl,
} from "../selectors/ashby.ts";
import {
  arrayOfObjects,
  buildProviderSurface,
  collectMemoryUrls,
  dedupeRawListings,
  dedupeSurfaces,
  extractLinksFromHtml,
  fetchJson,
  fetchText,
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

export const ashbyProvider: AtsProvider = {
  id: "ashby",
  label: "Ashby",
  async detectSurfaces(company, hints, memory) {
    const surfaces: ProviderSurface[] = [];

    for (const url of collectMemoryUrls("ashby", memory)) {
      const canonical = canonicalizeAshbySurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("ashby", "Ashby", company, {
          ...canonical,
          confidence: 0.99,
          metadata: { origin: "memory" },
        }),
      );
    }

    for (const url of hints.explicitUrls) {
      const canonical = canonicalizeAshbySurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("ashby", "Ashby", company, {
          ...canonical,
          confidence: 0.93,
          metadata: { origin: "hint_url" },
        }),
      );
    }

    for (const token of uniqueProbeTokens(hints)) {
      const probeUrl = buildAshbyJobsUrl(token, false);
      const payload = await fetchJson(probeUrl);
      if (payload.ok) {
        surfaces.push(
          buildProviderSurface("ashby", "Ashby", company, {
            ...canonicalizeAshbySurface(buildAshbyBoardUrl(token))!,
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

      const html = await fetchText(buildAshbyBoardUrl(token));
      if (
        html.ok &&
        (/ashby/i.test(html.text) || /jobs\.ashbyhq\.com/i.test(html.text))
      ) {
        surfaces.push(
          buildProviderSurface("ashby", "Ashby", company, {
            ...canonicalizeAshbySurface(buildAshbyBoardUrl(token))!,
            confidence: hints.explicitTokens.includes(token) ? 0.74 : 0.58,
            metadata: {
              origin: hints.explicitTokens.includes(token)
                ? "hint_token"
                : "company_token",
            },
            warnings: [
              "Detected from HTML probe instead of the posting API.",
              ...(hints.explicitTokens.includes(token)
                ? []
                : ["Surface derived from company token heuristic."]),
            ],
          }),
        );
      }
    }

    return dedupeSurfaces(surfaces, ashbyProvider.scoreSurface);
  },
  async enumerateListings(surface, sessionManager) {
    const boardToken = surface.boardToken || extractAshbyBoardToken(surface.canonicalUrl);
    if (!boardToken) return [];
    const endpoint = buildAshbyJobsUrl(boardToken, true);
    const payload = await fetchJson(endpoint);
    if (payload.ok) {
      const listings = extractAshbyListings(payload.data, surface);
      if (listings.length) return maybeFilterToDirectSurface(surface, listings);
    }

    const sessionResult = await sessionManager.run({
      url: endpoint,
      instruction: ASHBY_BROWSER_INSTRUCTION,
      timeoutMs: 20_000,
    });
    const listings = extractAshbyListings(sessionResult.text, surface);
    if (listings.length) return maybeFilterToDirectSurface(surface, listings);
    return maybeFilterToDirectSurface(
      surface,
      extractLinksFromHtml(
        sessionResult.text,
        surface,
        /jobs\.ashbyhq\.com\/[^"'\\s>]+/i,
      ),
    );
  },
  canonicalizeUrl(url) {
    return canonicalizeAshbySurface(url)?.canonicalUrl || null;
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

function extractAshbyListings(
  payload: unknown,
  surface: ProviderSurface,
): RawListing[] {
  const body =
    typeof payload === "string" ? safeParseJson(payload) ?? payload : payload;
  const jobs =
    body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).jobs)
      ? ((body as Record<string, unknown>).jobs as unknown[])
      : [];
  return dedupeRawListings(
    jobs
      .map((job) => {
        const record =
          job && typeof job === "object" && !Array.isArray(job)
            ? (job as Record<string, unknown>)
            : {};
        const secondaryLocations = arrayOfObjects(record.secondaryLocations)
          .map((entry) => stringValue(entry.location))
          .filter(Boolean);
        const normalizedUrl =
          ashbyProvider.canonicalizeUrl(
            stringValue(record.jobUrl) ||
              stringValue(record.url) ||
              stringValue(record.absoluteUrl) ||
              buildAshbyBoardUrl(surface.boardToken || ""),
          ) || "";
        if (!normalizedUrl || !stringValue(record.title)) return null;
        return {
          sourceId: "ashby",
          sourceLabel: "Ashby",
          providerType: "ashby",
          sourceLane: "ats_provider",
          surfaceId: String(surface.metadata.surfaceId || ""),
          title: stringValue(record.title),
          company: String(surface.metadata.companyName || ""),
          location: [
            stringValue(record.location),
            ...secondaryLocations,
          ].join(", "),
          url: normalizedUrl,
          canonicalUrl: normalizedUrl,
          externalJobId: ashbyProvider.extractExternalJobId(normalizedUrl, record),
          compensationText:
            sanitizeCompensationValue(record.compensation) ||
            sanitizeCompensationValue(record.compensationText),
          contact: "",
          descriptionText:
            sanitizeDescriptionText(record.descriptionHtml) ||
            sanitizeDescriptionText(record.description),
          tags: sanitizeTags([
            stringValue(record.department),
            stringValue(record.team),
            stringValue(record.employmentType),
          ]),
          metadata: {
            sourceQuery: surface.canonicalUrl || surface.boardUrl,
            jobId: record.id,
          },
        } satisfies RawListing;
      })
      .filter((entry): entry is RawListing => !!entry),
  );
}

function canonicalizeAshbySurface(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null;
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

function extractAshbyBoardToken(url: string): string {
  return canonicalizeAshbySurface(url)?.boardToken || "";
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
  const jobId = ashbyProvider.extractExternalJobId(surface.canonicalUrl);
  if (!jobId) return listings;
  return listings.filter(
    (listing) => ashbyProvider.extractExternalJobId(listing.url) === jobId,
  );
}

function safeParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

