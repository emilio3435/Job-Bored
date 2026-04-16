import type {
  AtsSourceId,
  CareerSurfaceType,
  CompanyTarget,
  DetectionResult,
  RawListing,
} from "../../contracts.ts";
import type { BrowserUseSessionManager } from "../session.ts";

export type ProviderDetectionHints = {
  sourceId: AtsSourceId;
  rawHints: string[];
  explicitUrls: string[];
  explicitTokens: string[];
  companyTokens: string[];
  aliases: string[];
  domains: string[];
};

export type ProviderMemorySnapshot = {
  urls?: string[];
  surfaces?: Array<{
    providerType?: AtsSourceId;
    canonicalUrl?: string;
    finalUrl?: string;
    boardToken?: string;
  }>;
};

export type ProviderSurface = DetectionResult & {
  matched: true;
  providerType: AtsSourceId;
  surfaceType: CareerSurfaceType;
  canonicalUrl: string;
  metadata: Record<string, unknown>;
};

export type AtsProvider = {
  id: AtsSourceId;
  label: string;
  detectSurfaces(
    company: CompanyTarget,
    hints: ProviderDetectionHints,
    memory?: ProviderMemorySnapshot,
  ): Promise<ProviderSurface[]>;
  enumerateListings(
    surface: ProviderSurface,
    sessionManager: BrowserUseSessionManager,
  ): Promise<RawListing[]>;
  canonicalizeUrl(url: string): string | null;
  extractExternalJobId(url: string, payload?: unknown): string;
  scoreSurface(surface: ProviderSurface): number;
};

export type AtsProviderRegistry = {
  providers: AtsProvider[];
  getProvider(sourceId: AtsSourceId): AtsProvider | undefined;
  detectSurfaces(
    company: CompanyTarget,
    effectiveSources: AtsSourceId[],
    memory?: ProviderMemorySnapshot,
  ): Promise<ProviderSurface[]>;
};

