import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryRun,
  type NormalizedLead,
  type RawListing,
} from "../contracts.ts";
import { normalizeLeadWithDiagnostics } from "./lead-normalizer.ts";

export function rawListingToSingleLead(
  raw: RawListing,
  ctx: {
    runId: string;
    sheetId: string;
    now?: () => Date;
    fitScoreOverride?: number;
  },
): NormalizedLead | null {
  const now = ctx.now || (() => new Date());
  const requestedAt = now().toISOString();
  const run: DiscoveryRun = {
    runId: String(ctx.runId || "ingest_url_run"),
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: String(ctx.sheetId || "").trim(),
      variationKey: "ingest_url",
      requestedAt,
    },
    config: {
      sheetId: String(ctx.sheetId || "").trim(),
      mode: "hosted",
      timezone: "UTC",
      companies: [],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 1,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "ingest_url",
      requestedAt,
      sourcePreset: "browser_only",
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: false,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 1,
        maxPagesPerCompany: 1,
        maxRuntimeMs: 60_000,
        maxTokensPerQuery: 1024,
      },
    },
  };

  const normalized = normalizeLeadWithDiagnostics(raw, run, {
    enforceRelevanceFilters: false,
  });
  if (!normalized.lead) return null;

  const fitScore = sanitizeFitScore(ctx.fitScoreOverride ?? 5);
  return {
    ...normalized.lead,
    fitScore,
    matchScore: null,
  };
}

function sanitizeFitScore(input: number): number {
  if (!Number.isFinite(input)) return 5;
  return Math.min(10, Math.max(0, Math.round(input)));
}
