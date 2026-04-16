import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

const SHARED_SECRET = "ats-first-telemetry-secret";

function createMemoryRunStatusStore() {
  const states: Array<Record<string, unknown>> = [];
  return {
    states,
    put(payload: Record<string, unknown>) {
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId: string) {
      for (let index = states.length - 1; index >= 0; index -= 1) {
        if (states[index].runId === runId) {
          return states[index];
        }
      }
      return null;
    },
    close() {},
  };
}

function makeRunDependencies() {
  return {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 6,
      groundedSearchMaxPagesPerCompany: 4,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "telemetry-test-token",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: SHARED_SECRET,
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_telemetry",
        appended: 2,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_telemetry",
      mode: "hosted",
      timezone: "UTC",
      companies: [],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: Record<string, unknown>, request: Record<string, unknown>) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_plus_ats",
      effectiveSources: ["greenhouse", "grounded_web"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-13T00:00:00.000Z"),
        new Date("2026-04-13T00:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: () => "telemetry_contract",
  };
}

test("handleDiscoveryWebhook preserves planner-first source summary telemetry in terminal status", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_SECRET,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_telemetry",
        variationKey: "var_telemetry",
        requestedAt: "2026-04-13T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_plus_ats",
          targetRoles: "Backend Engineer",
          keywordsInclude: "typescript,node",
          locations: "Remote",
        },
      }),
    },
    {
      runSynchronously: true,
      runStatusStore,
      runStatusPathForRun: (runId) => `/runs/${runId}`,
      runDependencies: makeRunDependencies(),
      runDiscovery: async (_request, _trigger, runDeps) => ({
        run: {
          runId: runDeps.runId || "run_telemetry_contract",
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_telemetry",
            variationKey: "var_telemetry",
            requestedAt: "2026-04-13T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_telemetry",
            mode: "hosted",
            timezone: "UTC",
            companies: [],
            includeKeywords: ["typescript", "node"],
            excludeKeywords: [],
            targetRoles: ["Backend Engineer"],
            locations: ["Remote"],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["greenhouse", "grounded_web"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_telemetry",
            requestedAt: "2026-04-13T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId || "run_telemetry_contract",
          trigger: "manual",
          startedAt: "2026-04-13T00:00:00.000Z",
          completedAt: "2026-04-13T00:00:01.000Z",
          state: "completed",
          companyCount: 0,
          detectionCount: 3,
          listingCount: 4,
          normalizedLeadCount: 2,
        },
        extractionResults: [],
        sourceSummary: [
          {
            sourceId: "greenhouse",
            querySummary: "planned companies: Acme AI, Figma, Stripe",
            pagesVisited: 3,
            leadsSeen: 4,
            leadsAccepted: 2,
            leadsRejected: 1,
            companiesPlanned: 8,
            companiesSuppressed: 2,
            surfacesVerified: 5,
            canonicalSurfacesResolved: 3,
            canonicalSurfacesExtracted: 4,
            hintOnlyCandidatesSeen: 2,
            hintResolutionsSucceeded: 2,
            hintResolutionsDropped: 0,
            deadLinksSuppressed: 3,
            thirdPartyExtractionsBlocked: 2,
            junkHostsSuppressed: 1,
            duplicateListingsSuppressed: 6,
            warnings: [],
          },
          {
            sourceId: "grounded_web",
            querySummary: "verified surfaces: https://acme.example/careers",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 0,
            leadsRejected: 1,
            companiesPlanned: 8,
            companiesSuppressed: 2,
            surfacesVerified: 1,
            canonicalSurfacesResolved: 1,
            canonicalSurfacesExtracted: 1,
            hintOnlyCandidatesSeen: 2,
            hintResolutionsSucceeded: 1,
            hintResolutionsDropped: 1,
            deadLinksSuppressed: 1,
            thirdPartyExtractionsBlocked: 2,
            junkHostsSuppressed: 1,
            duplicateListingsSuppressed: 2,
            warnings: [
              "Hint-only board required canonical resolution before extraction.",
            ],
          },
        ],
        writeResult: {
          sheetId: "sheet_telemetry",
          appended: 2,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.kind, "completed_sync");

  const greenhouseSource = body.outcome.sources.find(
    (entry: Record<string, unknown>) => entry.sourceId === "greenhouse",
  );
  assert.ok(greenhouseSource, "greenhouse source summary should be present");
  assert.equal(greenhouseSource.companiesPlanned, 8);
  assert.equal(greenhouseSource.companiesSuppressed, 2);
  assert.equal(greenhouseSource.surfacesVerified, 5);
  assert.equal(greenhouseSource.canonicalSurfacesResolved, 3);
  assert.equal(greenhouseSource.canonicalSurfacesExtracted, 4);
  assert.equal(greenhouseSource.hintOnlyCandidatesSeen, 2);
  assert.equal(greenhouseSource.hintResolutionsSucceeded, 2);
  assert.equal(greenhouseSource.hintResolutionsDropped, 0);
  assert.equal(greenhouseSource.deadLinksSuppressed, 3);
  assert.equal(greenhouseSource.thirdPartyExtractionsBlocked, 2);
  assert.equal(greenhouseSource.junkHostsSuppressed, 1);
  assert.equal(greenhouseSource.duplicateListingsSuppressed, 6);
  assert.match(
    String(greenhouseSource.querySummary || ""),
    /planned companies/i,
  );

  const storedOutcome = runStatusStore.get(String(body.runId || ""));
  assert.ok(storedOutcome, "terminal status should be stored");
  const groundedSource = storedOutcome.sources.find(
    (entry: Record<string, unknown>) => entry.sourceId === "grounded_web",
  );
  assert.ok(groundedSource, "grounded_web source summary should be present");
  assert.equal(groundedSource.companiesPlanned, 8);
  assert.equal(groundedSource.companiesSuppressed, 2);
  assert.equal(groundedSource.surfacesVerified, 1);
  assert.equal(groundedSource.canonicalSurfacesResolved, 1);
  assert.equal(groundedSource.canonicalSurfacesExtracted, 1);
  assert.equal(groundedSource.hintOnlyCandidatesSeen, 2);
  assert.equal(groundedSource.hintResolutionsSucceeded, 1);
  assert.equal(groundedSource.hintResolutionsDropped, 1);
  assert.equal(groundedSource.deadLinksSuppressed, 1);
  assert.equal(groundedSource.thirdPartyExtractionsBlocked, 2);
  assert.equal(groundedSource.junkHostsSuppressed, 1);
  assert.equal(groundedSource.duplicateListingsSuppressed, 2);
  assert.match(
    String(groundedSource.warnings?.[0] || ""),
    /canonical resolution/i,
  );
});
