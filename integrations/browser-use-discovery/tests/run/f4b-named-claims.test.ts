import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { createGroundedSearchClient } from "../../src/grounding/grounded-search.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

const NOW = "2026-04-09T12:00:00.000Z";
const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = `
      <html>
      <head><title>Backend Engineer at TimeoutCo</title></head>
      <body>
        <h1>Backend Engineer</h1>
        <button>Apply now</button>
        <p>${"Job description, responsibilities, and qualifications for the role. ".repeat(10)}</p>
        <a href="${url}">${url}</a>
      </body>
      </html>
    `;
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

function emptyGeminiResponse() {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ results: [] }) }],
          },
          groundingMetadata: {
            webSearchQueries: ["focused query"],
            groundingChunks: [],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeUnrestrictedRun(retryBroadeningEnabled: boolean) {
  return {
    runId: "run_f4b_retry",
    trigger: "manual" as const,
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_f4b",
      variationKey: "var_f4b_retry",
      requestedAt: NOW,
    },
    config: {
      sheetId: "sheet_f4b",
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [{ name: "" }],
      includeKeywords: ["typescript"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 5,
      enabledSources: ["grounded_web" as const],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_f4b_retry",
      requestedAt: NOW,
      sourcePreset: "browser_only" as const,
      effectiveSources: ["grounded_web" as const],
      ultraPlanTuning: {
        multiQueryEnabled: true,
        retryBroadeningEnabled,
        parallelCompanyProcessingEnabled: false,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 4,
        maxPagesPerCompany: 2,
        maxRuntimeMs: 5_000,
        maxTokensPerQuery: 1024,
        multiQueryCap: 1,
      },
    },
  };
}

function makeRuntimeConfig() {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "test-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 4,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted" as const,
    asyncAckByDefault: true,
    useStructuredExtraction: false,
  };
}

function makeGroundedRunRequest() {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_f4b_order",
    variationKey: "var_f4b_order",
    requestedAt: NOW,
    discoveryProfile: {
      sourcePreset: "browser_only",
      targetRoles: "Backend Engineer",
      keywordsInclude: "node",
      locations: "Remote",
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: "1",
      groundedSearchTuning: { maxRuntimeMs: 25 },
    },
  };
}

function createRunDependencies(overrides: Record<string, unknown> = {}) {
  const writtenLeads: Array<Record<string, unknown>> = [];
  return {
    writtenLeads,
    runtimeConfig: makeRuntimeConfig(),
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Backend Engineer remote jobs"],
        candidates: [
          {
            url: "https://timeout.example/jobs/backend-engineer",
            title: "Backend Engineer at TimeoutCo",
            pageType: "job",
            reason: "Direct job page",
            sourceDomain: "timeout.example",
          },
        ],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async ({ url }: { url: string }) => ({
        url,
        text: JSON.stringify({
          pageType: "job",
          jobs: [
            {
              title: "Backend Engineer",
              company: "TimeoutCo",
              location: "Remote",
              url: "https://timeout.example/jobs/backend-engineer",
              descriptionText: "Build Node services.",
              compensationText: "$160k-$180k",
              tags: ["node"],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async (sheetId: string, leads: Array<Record<string, unknown>>) => {
        writtenLeads.push(...leads);
        return {
          sheetId,
          appended: leads.length,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId: string) => ({
      sheetId,
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [{ name: "TimeoutCo" }],
      includeKeywords: ["node"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 5,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      sourcePreset: "browser_only" as const,
    }),
    mergeDiscoveryConfig,
    now: () => new Date(NOW),
    randomId: (prefix: string) => `${prefix}_f4b`,
    ...overrides,
  };
}

test("F4B-RUN06-RETRY: retry broadening does not execute when disabled", async () => {
  let geminiCalls = 0;
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      geminiCalls += 1;
      return emptyGeminiResponse();
    },
  });

  const run = makeUnrestrictedRun(false);
  const result = await client.search(run.config.companies[0], run as never);

  assert.equal(result.diagnostics?.retryBroadeningEnabled, false);
  assert.equal(
    geminiCalls,
    result.diagnostics?.focusedQueryCount,
    "F4B-RUN06-RETRY: disabled retry broadening must not fire extra outbound rungs beyond the focused queries",
  );
});

test("F4B-RUN08-ORDER: budgets start at run entry, not after extraction", async () => {
  const events: string[] = [];
  const dependencies = createRunDependencies({
    checkpointRunProgress(checkpoint: {
      phase: string;
      budget?: { totalMs?: number };
    }) {
      events.push(
        checkpoint.budget
          ? `phase:${checkpoint.phase}:budgeted`
          : `phase:${checkpoint.phase}`,
      );
    },
    browserSessionManager: {
      run: async ({ url }: { url: string }) => {
        events.push("deep-extract");
        return {
          url,
          text: JSON.stringify({
            pageType: "job",
            jobs: [
              {
                title: "Backend Engineer",
                company: "TimeoutCo",
                location: "Remote",
                url,
                descriptionText: "Build Node services.",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
    groundedSearchClient: {
      search: async () => {
        events.push("scout-search");
        return {
          searchQueries: ["Backend Engineer remote jobs"],
          candidates: [
            {
              url: "https://timeout.example/jobs/backend-engineer",
              title: "Backend Engineer at TimeoutCo",
              pageType: "job",
              reason: "Direct job page",
              sourceDomain: "timeout.example",
            },
          ],
          warnings: [],
        };
      },
    },
  });

  await runDiscovery(makeGroundedRunRequest() as never, "manual", dependencies as never);

  assert.equal(
    events[0],
    "phase:initializing:budgeted",
    "F4B-RUN08-ORDER: run budget must start at initializing, before any extraction",
  );
  const scoreIndex = events.findIndex((event) => event.startsWith("phase:score"));
  const extractIndex = events.indexOf("deep-extract");
  const searchIndex = events.indexOf("scout-search");
  assert.ok(searchIndex >= 0, "lightweight scout search must run");
  assert.ok(scoreIndex >= 0, "score phase must run");
  assert.ok(extractIndex >= 0, "deep extract must run");
  assert.ok(
    searchIndex < scoreIndex,
    "F4B-RUN08-ORDER: lightweight scout must precede rank/select",
  );
  assert.ok(
    scoreIndex < extractIndex,
    "F4B-RUN08-ORDER: deep extract must wait until after frontier selection",
  );
});

test("F4B-RUN11-CANCEL: outer timeout AbortSignal cancels browser/fetch/provider work, not just the wrapper", async () => {
  let receivedSignal: AbortSignal | undefined;
  let sawAbort = false;
  const dependencies = createRunDependencies({
    sourceTimeoutMs: 25,
    browserSessionManager: {
      run: async ({
        url,
        abortSignal,
      }: {
        url: string;
        abortSignal?: AbortSignal;
      }) => {
        receivedSignal = abortSignal;
        if (!abortSignal) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return {
            url,
            text: "[]",
            metadata: { mode: "browser_use_command" },
          };
        }
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(undefined), 200);
          abortSignal.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              clearTimeout(timer);
              reject(abortSignal.reason ?? new Error("aborted"));
            },
            { once: true },
          );
        });
        return {
          url,
          text: "[]",
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  const result = await runDiscovery(
    makeGroundedRunRequest() as never,
    "manual",
    dependencies as never,
  );

  assert.ok(receivedSignal, "F4B-RUN11-CANCEL: browser work must receive an AbortSignal");
  assert.equal(receivedSignal.aborted, true, "F4B-RUN11-CANCEL: timeout must abort the underlying signal");
  assert.equal(sawAbort, true, "F4B-RUN11-CANCEL: underlying browser work must observe abort, not just wrapper timeout");
  assert.ok(
    result.warnings.some((warning: string) => /timed out/i.test(warning)),
    `expected timeout warning, saw: ${result.warnings.join(" | ")}`,
  );
});
