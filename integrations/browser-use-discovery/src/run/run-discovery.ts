import type {
  BrowserUseExtractionResult,
  DiscoveryRun,
  DiscoveryWebhookRequestV1,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
  StoredWorkerConfig,
} from "../contracts.ts";
import type { ResolvedRunSettings, WorkerRuntimeConfig } from "../config.ts";
import type { SourceAdapterRegistry } from "../browser/source-adapters.ts";
import { buildBoardContext } from "../browser/source-adapters.ts";
import { normalizeLead } from "../normalize/lead-normalizer.ts";
import type { PipelineWriter } from "../sheets/pipeline-writer.ts";

export type RunDiscoveryDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  sourceAdapterRegistry: SourceAdapterRegistry;
  pipelineWriter: PipelineWriter;
  runId?: string;
  loadStoredWorkerConfig(sheetId: string): Promise<StoredWorkerConfig>;
  mergeDiscoveryConfig(
    storedConfig: StoredWorkerConfig,
    request: DiscoveryWebhookRequestV1,
  ): ResolvedRunSettings;
  now(): Date;
  randomId(prefix: string): string;
};

export type RunDiscoveryResult = {
  run: DiscoveryRun;
  lifecycle: {
    runId: string;
    trigger: "manual" | "scheduled";
    startedAt: string;
    completedAt: string;
    state: "completed" | "partial" | "empty";
    companyCount: number;
    detectionCount: number;
    listingCount: number;
    normalizedLeadCount: number;
  };
  extractionResults: BrowserUseExtractionResult[];
  writeResult: PipelineWriteResult;
  warnings: string[];
};

export async function runDiscovery(
  request: DiscoveryWebhookRequestV1,
  trigger: "manual" | "scheduled",
  dependencies: RunDiscoveryDependencies,
): Promise<RunDiscoveryResult> {
  const startedAt = dependencies.now().toISOString();
  const storedConfig = await dependencies.loadStoredWorkerConfig(request.sheetId);
  const config = dependencies.mergeDiscoveryConfig(storedConfig, request);
  const runId = dependencies.runId || dependencies.randomId("run");
  const run: DiscoveryRun = {
    runId,
    trigger,
    request,
    config,
  };

  const warnings: string[] = [];
  if (!config.companies.length) {
    warnings.push("No companies are configured for this discovery run.");
  }

  const adapterMap = new Map(
    dependencies.sourceAdapterRegistry.adapters.map((adapter) => [
      adapter.sourceId,
      adapter,
    ]),
  );
  const extractionResultsBySource = new Map<string, BrowserUseExtractionResult>();
  const normalizedLeads: NormalizedLead[] = [];
  let detectionCount = 0;
  let listingCount = 0;

  for (const company of config.companies) {
    try {
      const detections = await dependencies.sourceAdapterRegistry.detectBoards({
        company,
        run,
      });
      detectionCount += detections.length;

      for (const detection of detections) {
        const adapter = adapterMap.get(detection.sourceId);
        if (!adapter) {
          warnings.push(`No adapter registered for source ${detection.sourceId}.`);
          continue;
        }

        const boardContext = buildBoardContext({ company, run }, detection);
        const extractionResult =
          extractionResultsBySource.get(detection.sourceId) ||
          createExtractionResult(runId, detection.sourceId, boardContext.boardUrl);

        try {
          const rawListings = await adapter.listJobs(boardContext);
          listingCount += rawListings.length;
          extractionResult.querySummary = uniqueJoin([
            extractionResult.querySummary,
            boardContext.boardUrl,
          ]);
          extractionResult.stats.pagesVisited += 1;
          extractionResult.stats.leadsSeen += rawListings.length;

          for (const rawListing of rawListings) {
            const normalized = normalizeRawListing(rawListing, run);
            if (!normalized) continue;
            normalizedLeads.push(normalized);
            extractionResult.leads.push(normalized);
            extractionResult.stats.leadsAccepted += 1;
          }
        } catch (error) {
          const message = `Listing collection failed for ${detection.sourceId}: ${formatError(error)}`;
          extractionResult.warnings.push(message);
          warnings.push(message);
        }

        extractionResultsBySource.set(detection.sourceId, extractionResult);
      }
    } catch (error) {
      warnings.push(
        `Company detection failed for ${company.name}: ${formatError(error)}`,
      );
    }
  }

  let leadsToWrite = dedupeNormalizedLeads(normalizedLeads);
  if (config.maxLeadsPerRun > 0 && leadsToWrite.length > config.maxLeadsPerRun) {
    warnings.push(`Truncated leads to maxLeadsPerRun=${config.maxLeadsPerRun}.`);
    leadsToWrite = leadsToWrite.slice(0, config.maxLeadsPerRun);
  }

  const writeResult =
    leadsToWrite.length > 0
      ? await dependencies.pipelineWriter.write(config.sheetId, leadsToWrite)
      : {
          sheetId: config.sheetId,
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };

  warnings.push(...writeResult.warnings);
  for (const extractionResult of extractionResultsBySource.values()) {
    warnings.push(...extractionResult.warnings);
  }

  const completedAt = dependencies.now().toISOString();
  const lifecycleState =
    leadsToWrite.length === 0
      ? "empty"
      : warnings.length > 0
        ? "partial"
        : "completed";

  return {
    run,
    lifecycle: {
      runId,
      trigger,
      startedAt,
      completedAt,
      state: lifecycleState,
      companyCount: config.companies.length,
      detectionCount,
      listingCount,
      normalizedLeadCount: leadsToWrite.length,
    },
    extractionResults: [...extractionResultsBySource.values()],
    writeResult,
    warnings,
  };
}

function createExtractionResult(
  runId: string,
  sourceId: string,
  querySummary: string,
): BrowserUseExtractionResult {
  return {
    runId,
    sourceId,
    querySummary,
    leads: [],
    warnings: [],
    stats: {
      pagesVisited: 0,
      leadsSeen: 0,
      leadsAccepted: 0,
    },
  };
}

function normalizeRawListing(
  rawListing: RawListing,
  run: DiscoveryRun,
): NormalizedLead | null {
  return normalizeLead(rawListing, run);
}

function dedupeNormalizedLeads(leads: NormalizedLead[]): NormalizedLead[] {
  const byUrl = new Map<string, NormalizedLead>();
  for (const lead of leads) {
    if (!lead.url) continue;
    const existing = byUrl.get(lead.url);
    if (!existing || (lead.fitScore || 0) > (existing.fitScore || 0)) {
      byUrl.set(lead.url, lead);
    }
  }
  return [...byUrl.values()];
}

function uniqueJoin(values: string[]): string {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ].join(" | ");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
