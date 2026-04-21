import type {
  AtsSourceId,
  BoardContext,
  CompanyContext,
  CompanyTarget,
  DetectionResult,
  DiscoveryRun,
  NormalizedLead,
  RawListing,
  SourceAdapter,
  SupportedSourceId,
} from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import type { BrowserUseSessionManager } from "./session.ts";
import {
  createAtsProviderRegistry,
  type ProviderMemorySnapshot,
} from "./providers/index.ts";
import type { AtsProvider, ProviderSurface } from "./providers/types.ts";
import {
  buildDetectionHints,
  normalizeWhitespace,
  sanitizeCompensationValue,
  sanitizeDescriptionText,
  sanitizeTags,
} from "./providers/shared.ts";

export type SourceAdapterRegistry = {
  adapters: SourceAdapter[];
  detectBoards(
    companyContext: CompanyContext,
    effectiveSources: SupportedSourceId[],
    memory?: ProviderMemorySnapshot,
  ): Promise<DetectionResult[]>;
  collectListings(
    run: DiscoveryRun,
    detections: DetectionResult[],
  ): Promise<RawListing[]>;
};

export function createSourceAdapterRegistry(
  sessionManager: BrowserUseSessionManager,
): SourceAdapterRegistry {
  const providerRegistry = createAtsProviderRegistry();
  const adapters = providerRegistry.providers.map((provider) =>
    createCompatSourceAdapter(provider, sessionManager),
  );
  const adapterMap = new Map(adapters.map((adapter) => [adapter.sourceId, adapter]));
  return {
    adapters,
    async detectBoards(companyContext, effectiveSources, memory) {
      const atsSources = effectiveSources.filter((sourceId): sourceId is AtsSourceId =>
        !!providerRegistry.getProvider(sourceId as AtsSourceId),
      );
      return providerRegistry.detectSurfaces(
        companyContext.company,
        atsSources,
        memory,
      );
    },
    async collectListings(run, detections) {
      const enabled = new Set(run.config.enabledSources);
      const seen = new Set<string>();
      const listings: RawListing[] = [];
      for (const detection of detections) {
        if (!enabled.has(detection.sourceId)) continue;
        const adapter = adapterMap.get(detection.sourceId);
        if (!adapter) continue;
        const company = resolveCompanyForDetection(run, detection);
        if (!company) continue;
        const boardContext = buildBoardContext({ company, run }, detection);
        const raw = await adapter.listJobs(boardContext);
        for (const item of raw) {
          const key = normalizeLeadUrl(item.url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          listings.push(item);
        }
      }
      return listings;
    },
  };
}

export function buildBoardContext(
  companyContext: CompanyContext,
  detection: DetectionResult,
): BoardContext {
  return {
    sourceId: detection.sourceId,
    sourceLabel: detection.sourceLabel,
    boardUrl: detection.boardUrl,
    company: companyContext.company,
    run: companyContext.run,
    providerType: detection.providerType,
    boardToken: detection.boardToken,
    canonicalUrl: detection.canonicalUrl,
    surfaceId:
      detection.metadata && typeof detection.metadata === "object"
        ? String((detection.metadata as Record<string, unknown>).surfaceId || "")
        : "",
  };
}

function createCompatSourceAdapter(
  provider: AtsProvider,
  sessionManager: BrowserUseSessionManager,
): SourceAdapter {
  return {
    sourceId: provider.id,
    sourceLabel: provider.label,
    async detect(companyContext) {
      const hints = buildDetectionHints(companyContext.company, provider.id);
      const surfaces = await provider.detectSurfaces(companyContext.company, hints);
      return surfaces[0] || null;
    },
    async listJobs(boardContext) {
      const surface = boardContextToSurface(provider, boardContext);
      const listings = await provider.enumerateListings(surface, sessionManager);
      return listings.map((listing) => {
        const canonicalUrl = provider.canonicalizeUrl(listing.url) || normalizeLeadUrl(listing.url);
        const externalJobId =
          listing.externalJobId ||
          provider.extractExternalJobId(canonicalUrl, listing.metadata);
        return {
          ...listing,
          providerType: provider.id,
          sourceLane: "ats_provider",
          surfaceId: listing.surfaceId || boardContext.surfaceId || "",
          canonicalUrl,
          externalJobId,
        };
      });
    },
    async normalize(raw, run): Promise<NormalizedLead | null> {
      if (!raw.url) return null;
      const canonicalUrl =
        raw.canonicalUrl ||
        provider.canonicalizeUrl(raw.url) ||
        normalizeLeadUrl(raw.url);
      const sourceQuery =
        raw.metadata && typeof raw.metadata === "object"
          ? String((raw.metadata as Record<string, unknown>).sourceQuery || "")
          : "";
      return {
        sourceId: raw.sourceId,
        sourceLabel: raw.sourceLabel,
        title: normalizeWhitespace(raw.title),
        company: normalizeWhitespace(raw.company),
        location: normalizeWhitespace(raw.location || ""),
        url: normalizeLeadUrl(raw.url),
        compensationText: sanitizeCompensationValue(raw.compensationText || ""),
        fitScore: null,
        matchScore: null,
        favorite: false,
        dismissedAt: null,
        priority: "",
        tags: sanitizeTags(raw.tags || []),
        fitAssessment: sanitizeDescriptionText(raw.descriptionText).slice(0, 500),
        contact: normalizeWhitespace(raw.contact || ""),
        status: "New",
        appliedDate: "",
        notes: "",
        followUpDate: "",
        talkingPoints: "",
        logoUrl: "",
        discoveredAt: run.request.requestedAt || new Date().toISOString(),
        metadata: {
          runId: run.runId,
          variationKey: run.request.variationKey,
          sourceQuery: sourceQuery || `${raw.sourceLabel}:${raw.url}`,
          providerType: provider.id,
          externalJobId:
            raw.externalJobId ||
            provider.extractExternalJobId(canonicalUrl, raw.metadata),
          canonicalUrl,
          boardToken: raw.metadata?.boardToken
            ? String(raw.metadata.boardToken)
            : "",
          sourceLane: raw.sourceLane || "ats_provider",
          surfaceId: raw.surfaceId || "",
        },
      };
    },
  };
}

function boardContextToSurface(
  provider: AtsProvider,
  boardContext: BoardContext,
): ProviderSurface {
  const canonicalUrl =
    boardContext.canonicalUrl ||
    provider.canonicalizeUrl(boardContext.boardUrl) ||
    normalizeLeadUrl(boardContext.boardUrl);
  return {
    matched: true,
    sourceId: provider.id,
    sourceLabel: provider.label,
    providerType: provider.id,
    boardUrl: canonicalUrl,
    confidence: 1,
    warnings: [],
    surfaceType: isLikelyDirectJobSurface(canonicalUrl)
      ? "job_posting"
      : "provider_board",
    canonicalUrl,
    finalUrl: canonicalUrl,
    boardToken: boardContext.boardToken || "",
    sourceLane: "ats_provider",
    metadata: {
      companyName: boardContext.company.name,
      companyKey: boardContext.company.companyKey || "",
      surfaceId: boardContext.surfaceId || "",
    },
  };
}

function resolveCompanyForDetection(
  run: DiscoveryRun,
  detection: DetectionResult,
): CompanyTarget | null {
  const metadata =
    detection.metadata && typeof detection.metadata === "object"
      ? (detection.metadata as Record<string, unknown>)
      : {};
  const companyKey = String(metadata.companyKey || "").trim();
  const companyName = String(metadata.companyName || "").trim();
  if (companyKey) {
    const byKey = run.config.companies.find(
      (company) => String(company.companyKey || "").trim() === companyKey,
    );
    if (byKey) return byKey;
  }
  if (companyName) {
    const targetSlug = slugify(companyName);
    const byName = run.config.companies.find((company) => {
      const names = [company.name, company.normalizedName || "", ...(company.aliases || [])];
      return names.some((value) => slugify(value) === targetSlug);
    });
    if (byName) return byName;
  }
  const boardToken = detection.boardToken || "";
  if (boardToken) {
    const byHint = run.config.companies.find((company) => {
      const hint = company.boardHints?.[detection.sourceId];
      return (
        hint &&
        hint
          .split(/[\n,;]+/g)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .some((entry) => entry.includes(boardToken) || slugify(entry) === slugify(boardToken))
      );
    });
    if (byHint) return byHint;
  }
  const fallbackName =
    companyName ||
    humanizeBoardToken(boardToken) ||
    inferCompanyNameFromUrl(
      detection.canonicalUrl || detection.finalUrl || detection.boardUrl,
    );
  if (fallbackName) {
    return {
      name: fallbackName,
      companyKey: slugify(companyKey || fallbackName),
      normalizedName: slugify(fallbackName),
      aliases: [],
      domains: [],
      geoTags: [],
      roleTags: [],
      boardHints: {
        [detection.sourceId]:
          detection.canonicalUrl || detection.finalUrl || detection.boardUrl,
      },
    };
  }
  return run.config.companies[0] || null;
}

function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isLikelyDirectJobSurface(url: string): boolean {
  const value = String(url || "");
  return (
    /\/jobs\/\d+/i.test(value) ||
    /\/job\//i.test(value) ||
    /\/o\//i.test(value) ||
    /\/j\//i.test(value) ||
    /\/p\//i.test(value) ||
    /\/position\//i.test(value) ||
    /jobdetail\.ftl/i.test(value) ||
    /[?&](job|jobReq|jobreq)=/i.test(value)
  );
}

function humanizeBoardToken(value: string): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const primary = cleaned.split(/[/.]/).filter(Boolean)[0] || cleaned;
  return primary
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCompanyNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split("/").map((entry) => entry.trim()).filter(Boolean);
    const token =
      segments[0] ||
      hostname.split(".").find((part) => part && !["www", "jobs", "boards"].includes(part)) ||
      "";
    return humanizeBoardToken(token);
  } catch {
    return "";
  }
}
