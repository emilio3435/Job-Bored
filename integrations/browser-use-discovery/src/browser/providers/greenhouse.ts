import type { CompanyTarget, RawListing } from "../../contracts.ts";
import type { BrowserUseSessionManager } from "../session.ts";
import {
  GREENHOUSE_BROWSER_INSTRUCTION,
  buildGreenhouseBoardInfoUrl,
  buildGreenhouseBoardUrl,
  buildGreenhouseJobsUrl,
} from "../selectors/greenhouse.ts";
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
  readFirstStringValue,
  sanitizeCompensationValue,
  sanitizeDescriptionText,
  sanitizeTags,
  stringArrayFrom,
  stringValue,
} from "./shared.ts";
import type {
  AtsProvider,
  ProviderDetectionHints,
  ProviderMemorySnapshot,
  ProviderSurface,
} from "./types.ts";

const GREENHOUSE_BOARD_HOSTS = new Set([
  "boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.greenhouse.io",
]);

export const greenhouseProvider: AtsProvider = {
  id: "greenhouse",
  label: "Greenhouse",
  async detectSurfaces(company, hints, memory) {
    const surfaces: ProviderSurface[] = [];

    for (const url of collectMemoryUrls("greenhouse", memory)) {
      const canonical = canonicalizeGreenhouseSurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("greenhouse", "Greenhouse", company, {
          ...canonical,
          confidence: 0.99,
          metadata: { origin: "memory" },
        }),
      );
    }

    for (const url of hints.explicitUrls) {
      const canonical = canonicalizeGreenhouseSurface(url);
      if (!canonical) continue;
      surfaces.push(
        buildProviderSurface("greenhouse", "Greenhouse", company, {
          ...canonical,
          confidence: 0.93,
          metadata: { origin: "hint_url" },
        }),
      );
    }

    for (const token of uniqueProbeTokens(hints)) {
      const endpoint = buildGreenhouseBoardInfoUrl(token);
      const payload = await fetchJson(endpoint);
      if (payload.ok) {
        const boardUrl = buildGreenhouseBoardUrl(token);
        surfaces.push(
          buildProviderSurface("greenhouse", "Greenhouse", company, {
            ...canonicalizeGreenhouseSurface(boardUrl)!,
            confidence: hints.explicitTokens.includes(token) ? 0.98 : 0.88,
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

      const boardUrl = buildGreenhouseBoardUrl(token);
      const html = await fetchText(boardUrl);
      if (
        html.ok &&
        (/greenhouse/i.test(html.text) || /\/jobs\/\d+/i.test(html.text))
      ) {
        surfaces.push(
          buildProviderSurface("greenhouse", "Greenhouse", company, {
            ...canonicalizeGreenhouseSurface(boardUrl)!,
            confidence: hints.explicitTokens.includes(token) ? 0.74 : 0.58,
            metadata: {
              origin: hints.explicitTokens.includes(token)
                ? "hint_token"
                : "company_token",
            },
            warnings: [
              "Detected from HTML probe instead of the public board API.",
              ...(hints.explicitTokens.includes(token)
                ? []
                : ["Surface derived from company token heuristic."]),
            ],
          }),
        );
      }
    }

    return dedupeSurfaces(surfaces, greenhouseProvider.scoreSurface);
  },
  async enumerateListings(surface, sessionManager) {
    const boardToken = surface.boardToken || extractGreenhouseBoardToken(surface.canonicalUrl);
    if (!boardToken) return [];
    const endpoint = buildGreenhouseJobsUrl(boardToken);
    const payload = await fetchJson(endpoint);
    if (payload.ok) {
      const listings = extractGreenhouseListings(payload.data, surface);
      if (listings.length) return maybeFilterToDirectSurface(surface, listings);
    }

    const sessionResult = await sessionManager.run({
      url: endpoint,
      instruction: GREENHOUSE_BROWSER_INSTRUCTION,
      timeoutMs: 20_000,
    });
    const structured = extractGreenhouseListings(sessionResult.text, surface);
    if (structured.length) return maybeFilterToDirectSurface(surface, structured);
    return maybeFilterToDirectSurface(
      surface,
      extractLinksFromHtml(
        sessionResult.text,
        surface,
        /boards(?:\.eu)?\.greenhouse\.io\/[^"'\\s>]+\/jobs\/\d+/i,
      ),
    );
  },
  canonicalizeUrl(url) {
    return canonicalizeGreenhouseSurface(url)?.canonicalUrl || null;
  },
  extractExternalJobId(url, payload) {
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const fromPayload =
      stringValue(record.id) || stringValue(record.internal_job_id);
    if (fromPayload) return fromPayload;
    const match = String(url || "").match(/\/jobs\/(\d+)/i);
    return match?.[1] || "";
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

function extractGreenhouseListings(
  payload: unknown,
  surface: ProviderSurface,
): RawListing[] {
  const body =
    typeof payload === "string" ? safeParseJson(payload) ?? payload : payload;
  const jobs = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).jobs)
      ? ((body as Record<string, unknown>).jobs as unknown[])
      : [];
  return dedupeRawListings(
    jobs
      .map((job) => {
        const record =
          job && typeof job === "object" && !Array.isArray(job)
            ? (job as Record<string, unknown>)
            : {};
        const title = stringValue(record.title) || stringValue(record.name);
        const url = stringValue(record.absolute_url) || stringValue(record.url);
        if (!title || !url) return null;
        const normalizedUrl = greenhouseProvider.canonicalizeUrl(url) || url;
        return {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          providerType: "greenhouse",
          sourceLane: "ats_provider",
          surfaceId: String(surface.metadata.surfaceId || ""),
          title,
          company: String(surface.metadata.companyName || ""),
          location:
            objectString(record.location, "name") || stringValue(record.location),
          url: normalizedUrl,
          canonicalUrl: normalizedUrl,
          externalJobId: greenhouseProvider.extractExternalJobId(
            normalizedUrl,
            record,
          ),
          compensationText: extractGreenhouseCompensation(record),
          contact: "",
          descriptionText: sanitizeDescriptionText(record.content),
          tags: sanitizeTags([
            ...stringArrayFrom(record.departments),
            ...stringArrayFrom(record.offices),
          ]),
          metadata: {
            sourceQuery: surface.canonicalUrl || surface.boardUrl,
            jobId: record.id,
            internalJobId: record.internal_job_id,
          },
        } satisfies RawListing;
      })
      .filter((entry): entry is RawListing => !!entry),
  );
}

function extractGreenhouseCompensation(
  record: Record<string, unknown>,
): string {
  const metadataObject = objectValue(record.metadata);
  for (const candidate of [
    metadataObject.compensation,
    metadataObject.compensation_text,
    metadataObject.compensationRange,
    metadataObject.compensation_range,
    metadataObject.salary,
    metadataObject.salaryRange,
    metadataObject.salary_range,
  ]) {
    const text = sanitizeCompensationValue(candidate);
    if (text) return text;
  }
  if (Array.isArray(record.metadata)) {
    for (const entry of record.metadata) {
      const row =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      const label = [
        stringValue(row.name),
        stringValue(row.label),
        stringValue(row.key),
      ]
        .filter(Boolean)
        .join(" ");
      if (!/compensation|salary|pay/i.test(label)) continue;
      const text = sanitizeCompensationValue(
        readFirstStringValue(row, ["value", "text", "content"]),
      );
      if (text) return text;
    }
  }
  return "";
}

function canonicalizeGreenhouseSurface(url: string) {
  try {
    const parsed = new URL(url);
    if (!GREENHOUSE_BOARD_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const boardToken = parts[0] || "";
    return {
      canonicalUrl: parsed.toString(),
      surfaceType:
        parts.includes("jobs") || /\/jobs\/\d+/i.test(parsed.pathname)
          ? "job_posting"
          : "provider_board",
      boardToken,
    } as const;
  } catch {
    return null;
  }
}

function extractGreenhouseBoardToken(url: string): string {
  return canonicalizeGreenhouseSurface(url)?.boardToken || "";
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
  const jobId = greenhouseProvider.extractExternalJobId(surface.canonicalUrl);
  if (!jobId) return listings;
  return listings.filter(
    (listing) => greenhouseProvider.extractExternalJobId(listing.url) === jobId,
  );
}

function safeParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

