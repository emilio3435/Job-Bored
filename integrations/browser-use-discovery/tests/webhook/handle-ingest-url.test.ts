import assert from "node:assert/strict";
import test from "node:test";

import {
  INGEST_URL_EVENT,
  INGEST_URL_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import type { WorkerRuntimeConfig } from "../../src/config.ts";
import { handleIngestUrlWebhook } from "../../src/webhook/handle-ingest-url.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    browserUseApiKey: "",
    browserUseProfileId: "",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 6,
    groundedSearchMaxPagesPerCompany: 4,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "secret-xyz",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "local",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
    serpApiKey: "",
    ...overrides,
  };
}

function makeRequest(bodyOverrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { "x-discovery-secret": "secret-xyz" },
    bodyText: JSON.stringify({
      event: INGEST_URL_EVENT,
      schemaVersion: INGEST_URL_SCHEMA_VERSION,
      sheetId: "sheet_123",
      url: "https://www.notion.so/careers/product-marketing-manager",
      ...bodyOverrides,
    }),
  };
}

function makeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    runtimeConfig: makeRuntimeConfig(),
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 1,
        updated: 0,
        skippedDuplicates: 0,
        skippedBlacklist: 0,
        warnings: [],
      }),
    },
    ...overrides,
  };
}

function createMemoryRunStatusStore() {
  const states = new Map<string, Record<string, unknown>>();
  return {
    states,
    put(payload: Record<string, unknown>) {
      states.set(String(payload.runId), payload);
    },
    get(runId: string) {
      return states.get(runId) || null;
    },
    close() {},
  };
}

async function waitForTerminalStatus(
  store: ReturnType<typeof createMemoryRunStatusStore>,
  runId: string,
) {
  for (let i = 0; i < 25; i += 1) {
    const state = store.get(runId);
    if (state?.terminal) return state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return store.get(runId);
}

test("handleIngestUrlWebhook returns 405 on GET", async () => {
  const response = await handleIngestUrlWebhook(
    {
      method: "GET",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: "",
    },
    makeDependencies(),
  );
  assert.equal(response.status, 405);
});

test("handleIngestUrlWebhook returns 401 on missing secret", async () => {
  const response = await handleIngestUrlWebhook(
    {
      method: "POST",
      headers: {},
      bodyText: JSON.stringify({
        event: INGEST_URL_EVENT,
        schemaVersion: INGEST_URL_SCHEMA_VERSION,
        url: "https://example.com/job",
      }),
    },
    makeDependencies(),
  );
  assert.equal(response.status, 401);
});

test("handleIngestUrlWebhook returns 400 on bad JSON", async () => {
  const response = await handleIngestUrlWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: "not-json",
    },
    makeDependencies(),
  );
  assert.equal(response.status, 400);
});

test("handleIngestUrlWebhook returns 400 on invalid URL", async () => {
  const response = await handleIngestUrlWebhook(
    makeRequest({ url: "not-a-url" }),
    makeDependencies(),
  );
  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "invalid_url");
});

test("handleIngestUrlWebhook returns 400 on private-network URL", async () => {
  const response = await handleIngestUrlWebhook(
    makeRequest({ url: "http://127.0.0.1:3000/api" }),
    makeDependencies(),
  );
  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "private_network");
});

test("handleIngestUrlWebhook rejects manual-fill malformed URL before writing", async () => {
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "not-a-url",
      manual: {
        title: "Growth Marketing Manager",
        company: "Example Co",
      },
    }),
    makeDependencies({
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          throw new Error("should not write malformed manual URL");
        },
      },
    }),
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.reason, "invalid_url");
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook rejects manual-fill private URL before writing", async () => {
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "http://localhost:3000/jobs/123",
      manual: {
        title: "Growth Marketing Manager",
        company: "Example Co",
      },
    }),
    makeDependencies({
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          throw new Error("should not write private manual URL");
        },
      },
    }),
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.reason, "private_network");
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook routes per-request googleAccessToken into the pipeline writer", async () => {
  let factoryCalls = 0;
  let capturedToken = "";
  let requestWriterCalls = 0;
  let defaultWriterCalls = 0;

  const response = await handleIngestUrlWebhook(
    makeRequest({
      googleAccessToken: "dashboard-token-123",
      url: "https://example.com/jobs/growth-marketing-manager",
    }),
    makeDependencies({
      pipelineWriter: {
        write: async () => {
          defaultWriterCalls += 1;
          throw new Error("default writer should not be used with request token");
        },
      },
      createPipelineWriterForRequest: (runtimeConfigOverride: WorkerRuntimeConfig) => {
        factoryCalls += 1;
        capturedToken = runtimeConfigOverride.googleAccessToken;
        return {
          write: async () => {
            requestWriterCalls += 1;
            return {
              sheetId: "sheet_123",
              appended: 1,
              updated: 0,
              skippedDuplicates: 0,
              skippedBlacklist: 0,
              warnings: [],
            };
          },
        };
      },
      scrapeJobPosting: async () => ({
        url: "https://example.com/jobs/growth-marketing-manager",
        title: "Growth Marketing Manager",
        description: "Own growth marketing programs.",
        method: "cheerio",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).ok, true);
  assert.equal(factoryCalls, 1);
  assert.equal(capturedToken, "dashboard-token-123");
  assert.equal(requestWriterCalls, 1);
  assert.equal(defaultWriterCalls, 0);
  assert.doesNotMatch(response.body, /dashboard-token-123/);
});

test("handleIngestUrlWebhook async Add URL routes per-request googleAccessToken into the pipeline writer", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  let factoryCalls = 0;
  let capturedToken = "";
  let requestWriterCalls = 0;
  let defaultWriterCalls = 0;

  const response = await handleIngestUrlWebhook(
    makeRequest({
      async: true,
      googleAccessToken: "dashboard-token-async",
      url: "https://example.com/jobs/growth-marketing-manager",
    }),
    makeDependencies({
      randomId: () => "ingest_async_token_test",
      runStatusStore,
      runStatusPathForRun: (runId: string) => `/runs/${runId}`,
      pipelineWriter: {
        write: async () => {
          defaultWriterCalls += 1;
          throw new Error("default writer should not be used with request token");
        },
      },
      createPipelineWriterForRequest: (runtimeConfigOverride: WorkerRuntimeConfig) => {
        factoryCalls += 1;
        capturedToken = runtimeConfigOverride.googleAccessToken;
        return {
          write: async () => {
            requestWriterCalls += 1;
            return {
              sheetId: "sheet_123",
              appended: 1,
              updated: 0,
              skippedDuplicates: 0,
              skippedBlacklist: 0,
              warnings: [],
            };
          },
        };
      },
      scrapeJobPosting: async () => ({
        url: "https://example.com/jobs/growth-marketing-manager",
        title: "Growth Marketing Manager",
        description: "Own growth marketing programs.",
        method: "cheerio",
      }),
    }),
  );

  assert.equal(response.status, 202);
  const terminal = await waitForTerminalStatus(
    runStatusStore,
    "ingest_async_token_test",
  );
  assert.ok(terminal, "terminal run status should be written");
  assert.equal(terminal?.status, "completed");
  assert.equal(factoryCalls, 1);
  assert.equal(capturedToken, "dashboard-token-async");
  assert.equal(requestWriterCalls, 1);
  assert.equal(defaultWriterCalls, 0);
});

test("handleIngestUrlWebhook rejects non-string googleAccessToken", async () => {
  const response = await handleIngestUrlWebhook(
    makeRequest({ googleAccessToken: { token: "bad" } }),
    makeDependencies(),
  );

  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).message, /googleAccessToken/);
});

test("handleIngestUrlWebhook blocked_aggregator with missing Browser Use key rejects without writing", async () => {
  let fetcherCalls = 0;
  let scraperCalls = 0;
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://www.linkedin.com/jobs/view/senior-product-manager-at-plaid",
    }),
    makeDependencies({
      fetchGreenhouseJob: async () => {
        fetcherCalls += 1;
        throw new Error("should not be called");
      },
      fetchLeverJob: async () => {
        fetcherCalls += 1;
        throw new Error("should not be called");
      },
      fetchAshbyJob: async () => {
        fetcherCalls += 1;
        throw new Error("should not be called");
      },
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        throw new Error("should not be called");
      },
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "blocked_aggregator");
  assert.match(body.hint, /employer careers|ATS posting/i);
  // Fetchers still skipped (no point calling Greenhouse for LinkedIn URL).
  assert.equal(fetcherCalls, 0);
  // Cheerio scraper also skipped — LinkedIn will 403 it anyway; save the RTT.
  assert.equal(scraperCalls, 0);
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook blocked_aggregator uses Browser Use Cloud when configured", async () => {
  let extractorCalls = 0;
  let writerCalls = 0;
  let capturedLead: Record<string, unknown> | null = null;
  let capturedProfileId = "";
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://www.linkedin.com/jobs/view/senior-product-manager-at-plaid",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        browserUseApiKey: "bu_test_key",
        browserUseProfileId: "profile_123",
      }),
      extractWithBrowserUseCloud: async (input) => {
        extractorCalls += 1;
        capturedProfileId = input.runtimeConfig.browserUseProfileId;
        return {
          ok: true as const,
          confidence: 0.91,
          rawListing: {
            sourceId: "ingest_url_browser_use",
            sourceLabel: "Browser Use",
            sourceLane: "grounded_web",
            title: "Senior Product Manager",
            company: "Plaid",
            location: "Remote",
            url: input.url,
            canonicalUrl: input.url,
            finalUrl: input.url,
            descriptionText:
              "Own the product roadmap for account connectivity and partner launches.",
            metadata: {
              sourceQuery: `browser_use_cloud:${input.url}`,
            },
          },
        };
      },
      scrapeJobPosting: async () => {
        throw new Error("blocked aggregator should not use Cheerio first");
      },
      pipelineWriter: {
        write: async (_sheetId, leads) => {
          writerCalls += 1;
          capturedLead = leads[0] as unknown as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "browser_use_cloud");
  assert.equal(extractorCalls, 1);
  assert.equal(writerCalls, 1);
  assert.equal(capturedProfileId, "profile_123");
  assert.equal(capturedLead?.title, "Senior Product Manager");
  assert.equal(capturedLead?.company, "Plaid");
  assert.equal(capturedLead?.sourceLabel, "Browser Use");
  assert.match(
    String((capturedLead?.metadata as Record<string, unknown>)?.sourceQuery || ""),
    /browser_use_cloud:/i,
  );
  assert.doesNotMatch(response.body, /bu_test_key/);
});

test("handleIngestUrlWebhook rejects source-gated Browser Use placeholders without writing", async () => {
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://www.linkedin.com/jobs/search-results?currentJobId=4415950551",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        browserUseApiKey: "bu_test_key",
      }),
      extractWithBrowserUseCloud: async (input) => ({
        ok: true as const,
        confidence: 0,
        rawListing: {
          sourceId: "ingest_url_browser_use",
          sourceLabel: "Browser Use",
          sourceLane: "grounded_web",
          title: "Unavailable",
          company: "LinkedIn (source gated)",
          location: "",
          url: input.url,
          canonicalUrl: input.url,
          finalUrl: input.url,
          descriptionText: "clean ATS",
          metadata: {
            browserUseConfidence: 0,
            sourceQuery: `browser_use_cloud:${input.url}`,
          },
        },
      }),
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "low_quality_extraction");
  assert.match(body.hint, /employer careers|ATS posting/i);
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook async Add URL returns statusPath and stores final Browser Use result", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  const response = await handleIngestUrlWebhook(
    makeRequest({
      async: true,
      url: "https://www.linkedin.com/jobs/view/senior-product-manager-at-plaid",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        browserUseApiKey: "bu_test_key",
      }),
      randomId: () => "ingest_async_test",
      runStatusStore,
      runStatusPathForRun: (runId: string) => `/runs/${runId}`,
      extractWithBrowserUseCloud: async (input) => ({
        ok: true as const,
        confidence: 0.93,
        rawListing: {
          sourceId: "ingest_url_browser_use",
          sourceLabel: "Browser Use",
          sourceLane: "grounded_web",
          title: "Senior Product Manager",
          company: "Plaid",
          location: "Remote",
          url: input.url,
          canonicalUrl: input.url,
          finalUrl: input.url,
          descriptionText:
            "Own product strategy for trusted financial data connectivity.",
        },
      }),
    }),
  );

  assert.equal(response.status, 202);
  const ack = JSON.parse(response.body);
  assert.equal(ack.ok, true);
  assert.equal(ack.kind, "accepted_async");
  assert.equal(ack.runId, "ingest_async_test");
  assert.equal(ack.statusPath, "/runs/ingest_async_test");

  const terminal = await waitForTerminalStatus(
    runStatusStore,
    "ingest_async_test",
  );
  assert.ok(terminal, "terminal run status should be written");
  assert.equal(terminal?.status, "completed");
  assert.equal(terminal?.terminal, true);
  assert.equal(
    (terminal?.ingestResult as Record<string, unknown>)?.strategy,
    "browser_use_cloud",
  );
  assert.equal(
    ((terminal?.ingestResult as Record<string, unknown>)?.lead as Record<
      string,
      unknown
    >)?.title,
    "Senior Product Manager",
  );
  assert.doesNotMatch(JSON.stringify(terminal), /bu_test_key/);
});

test("handleIngestUrlWebhook async Add URL terminal status fails for low-quality Browser Use output", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      async: true,
      url: "https://www.linkedin.com/jobs/search-results?currentJobId=4415950551",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        browserUseApiKey: "bu_test_key",
      }),
      randomId: () => "ingest_low_quality_async_test",
      runStatusStore,
      runStatusPathForRun: (runId: string) => `/runs/${runId}`,
      extractWithBrowserUseCloud: async (input) => ({
        ok: true as const,
        confidence: 0,
        rawListing: {
          sourceId: "ingest_url_browser_use",
          sourceLabel: "Browser Use",
          sourceLane: "grounded_web",
          title: "Unavailable",
          company: "LinkedIn (source gated)",
          url: input.url,
          canonicalUrl: input.url,
          finalUrl: input.url,
          descriptionText: "clean ATS",
          metadata: {
            browserUseConfidence: 0,
          },
        },
      }),
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 202);
  const terminal = await waitForTerminalStatus(
    runStatusStore,
    "ingest_low_quality_async_test",
  );
  assert.equal(terminal?.status, "failed");
  assert.equal(terminal?.terminal, true);
  assert.equal(
    (terminal?.ingestResult as Record<string, unknown>)?.reason,
    "low_quality_extraction",
  );
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook ats_direct happy path appends row", async () => {
  let writerCalls = 0;
  let browserUseCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({ url: "https://boards.greenhouse.io/plaid/jobs/4728292004" }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ browserUseApiKey: "bu_test_key" }),
      extractWithBrowserUseCloud: async () => {
        browserUseCalls += 1;
        throw new Error("Browser Use should not run after ATS success");
      },
      fetchGreenhouseJob: async () => ({
        ok: true as const,
        rawListing: {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          providerType: "greenhouse",
          sourceLane: "company_surface",
          title: "Senior Product Manager",
          company: "Plaid",
          location: "Remote",
          url: "https://boards.greenhouse.io/plaid/jobs/4728292004",
          canonicalUrl: "https://boards.greenhouse.io/plaid/jobs/4728292004",
          descriptionText: "Drive product outcomes.",
        },
      }),
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "ats_api");
  assert.equal(body.appended, true);
  assert.equal(writerCalls, 1);
  assert.equal(browserUseCalls, 0);
});

test("handleIngestUrlWebhook current Greenhouse host uses ATS API details", async () => {
  let scraperCalls = 0;
  let browserUseCalls = 0;
  let capturedFetchInput: Record<string, string> | null = null;
  let capturedLead: Record<string, unknown> | null = null;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://job-boards.greenhouse.io/figma/jobs/5998147004?gh_jid=5998147004",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ browserUseApiKey: "bu_test_key" }),
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        throw new Error("scraper should not run after ATS success");
      },
      extractWithBrowserUseCloud: async () => {
        browserUseCalls += 1;
        throw new Error("Browser Use should not run after ATS success");
      },
      fetchGreenhouseJob: async (input: Record<string, string>) => {
        capturedFetchInput = input;
        return {
          ok: true as const,
          rawListing: {
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            providerType: "greenhouse",
            sourceLane: "company_surface",
            title: "Director, Growth Marketing",
            company: "Figma",
            location: "San Francisco, CA • New York, NY • United States",
            url: "https://boards.greenhouse.io/figma/jobs/5998147004",
            canonicalUrl: "https://boards.greenhouse.io/figma/jobs/5998147004",
            descriptionText: "Lead paid search and growth marketing programs.",
            tags: ["Growth Marketing", "Director", "Marketing"],
          },
        };
      },
      pipelineWriter: {
        write: async (_sheetId: string, leads: unknown[]) => {
          capturedLead = leads[0] as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "ats_api");
  assert.deepEqual(capturedFetchInput, {
    slug: "figma",
    jobId: "5998147004",
  });
  assert.equal(capturedLead?.title, "Director, Growth Marketing");
  assert.equal(capturedLead?.company, "Figma");
  assert.equal(capturedLead?.sourceLabel, "Greenhouse");
  assert.equal(
    capturedLead?.url,
    "https://job-boards.greenhouse.io/figma/jobs/5998147004?gh_jid=5998147004",
  );
  assert.deepEqual(capturedLead?.tags, [
    "Growth Marketing",
    "Director",
    "Marketing",
  ]);
  assert.equal(scraperCalls, 0);
  assert.equal(browserUseCalls, 0);
});

test("handleIngestUrlWebhook uses Gemini URL context tier before Cheerio", async () => {
  let geminiCalls = 0;
  let scraperCalls = 0;
  let browserUseCalls = 0;
  let capturedLead: Record<string, unknown> | null = null;
  const logs: Array<{ event: string }> = [];
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/product-marketing-manager",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        geminiApiKey: "AIza-test-key",
        browserUseApiKey: "bu_test_key",
      }),
      extractWithGeminiUrlContext: async (input) => {
        geminiCalls += 1;
        return {
          ok: true as const,
          confidence: 0.88,
          rawListing: {
            sourceId: "ingest_url_gemini",
            sourceLabel: "Gemini URL context",
            sourceLane: "grounded_web",
            title: "Product Marketing Manager",
            company: "Example Co",
            location: "Remote",
            url: input.url,
            canonicalUrl: input.url,
            finalUrl: input.url,
            descriptionText:
              "Own product marketing strategy and go-to-market launches.",
            metadata: {
              sourceQuery: `gemini_url_context:${input.url}`,
              geminiConfidence: 0.88,
            },
          },
        };
      },
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        throw new Error("Cheerio should not run after Gemini success");
      },
      extractWithBrowserUseCloud: async () => {
        browserUseCalls += 1;
        throw new Error("Browser Use should not run after Gemini success");
      },
      log: (event: string) => {
        logs.push({ event });
      },
      pipelineWriter: {
        write: async (_sheetId: string, leads: unknown[]) => {
          capturedLead = leads[0] as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "gemini_url_context");
  assert.equal(geminiCalls, 1);
  assert.equal(scraperCalls, 0);
  assert.equal(browserUseCalls, 0);
  assert.equal(capturedLead?.title, "Product Marketing Manager");
  assert.equal(capturedLead?.company, "Example Co");
  assert.ok(
    logs.some(
      (entry) => entry.event === "discovery.run.ingest_url_gemini_completed",
    ),
  );
  assert.doesNotMatch(response.body, /AIza-test-key/);
});

test("handleIngestUrlWebhook falls through to Cheerio when Gemini URL context is weak", async () => {
  let geminiCalls = 0;
  let scraperCalls = 0;
  const logs: Array<{ event: string }> = [];
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/growth-product-manager",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ geminiApiKey: "AIza-test-key" }),
      extractWithGeminiUrlContext: async () => {
        geminiCalls += 1;
        return {
          ok: false as const,
          reason: "low_quality_extraction",
          message: "Gemini could not extract enough real job details.",
        };
      },
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        return {
          url: "https://careers.example.com/roles/growth-product-manager",
          title: "Growth Product Manager",
          description: "Own growth product strategy and run experiments.",
          method: "cheerio",
        };
      },
      log: (event: string) => {
        logs.push({ event });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "cheerio_dom");
  assert.equal(geminiCalls, 1);
  assert.equal(scraperCalls, 1);
  assert.ok(
    logs.some(
      (entry) => entry.event === "discovery.run.ingest_url_gemini_skipped",
    ),
  );
});

test("handleIngestUrlWebhook skips Gemini URL context when the optional Google tool key is absent", async () => {
  let geminiCalls = 0;
  let scraperCalls = 0;
  const logs: Array<{ event: string; details: Record<string, unknown> }> = [];
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/openrouter-compatible-role",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ geminiApiKey: "" }),
      extractWithGeminiUrlContext: async () => {
        geminiCalls += 1;
        throw new Error("Gemini URL Context should not run without a Gemini key");
      },
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        return {
          url: "https://careers.example.com/roles/openrouter-compatible-role",
          title: "OpenRouter Compatible Role",
          description:
            "Support provider-compatible discovery without optional Google tools.",
          method: "cheerio",
        };
      },
      log: (event: string, details: Record<string, unknown>) => {
        logs.push({ event, details });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "cheerio_dom");
  assert.equal(geminiCalls, 0);
  assert.equal(scraperCalls, 1);
  const skipLog = logs.find(
    (entry) => entry.event === "discovery.run.ingest_url_gemini_skipped",
  );
  assert.equal(skipLog?.details.reason, "missing_api_key");
  assert.equal(skipLog?.details.tool, "url_context");
  assert.equal(skipLog?.details.optional, true);
});

test("handleIngestUrlWebhook skips Gemini URL context after ATS success", async () => {
  let geminiCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({ url: "https://boards.greenhouse.io/plaid/jobs/4728292004" }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ geminiApiKey: "AIza-test-key" }),
      extractWithGeminiUrlContext: async () => {
        geminiCalls += 1;
        throw new Error("Gemini should not run after ATS success");
      },
      fetchGreenhouseJob: async () => ({
        ok: true as const,
        rawListing: {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          providerType: "greenhouse",
          sourceLane: "company_surface",
          title: "Senior Product Manager",
          company: "Plaid",
          location: "Remote",
          url: "https://boards.greenhouse.io/plaid/jobs/4728292004",
          canonicalUrl: "https://boards.greenhouse.io/plaid/jobs/4728292004",
          descriptionText: "Drive product outcomes.",
        },
      }),
      pipelineWriter: {
        write: async () => ({
          sheetId: "sheet_123",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        }),
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "ats_api");
  assert.equal(geminiCalls, 0);
});

test("handleIngestUrlWebhook manual-fill happy path", async () => {
  let scraperCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://company.example/jobs/123",
      manual: {
        title: "Growth Marketing Manager",
        company: "Example Co",
        location: "Remote",
        description: "Own growth channels.",
        fitScore: 8,
      },
    }),
    makeDependencies({
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        throw new Error("should not be called");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "manual_fill");
  assert.equal(scraperCalls, 0);
});

test("handleIngestUrlWebhook clamps manual fitScore deterministically", async () => {
  let capturedLead: Record<string, unknown> | null = null;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://company.example/jobs/123",
      manual: {
        title: "Growth Marketing Manager",
        company: "Example Co",
        fitScore: 12.7,
      },
    }),
    makeDependencies({
      pipelineWriter: {
        write: async (_sheetId, leads) => {
          capturedLead = leads[0] as unknown as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.ok(capturedLead);
  assert.equal(capturedLead.fitScore, 10);
});

test("handleIngestUrlWebhook returns duplicate when writer reports skipped duplicate", async () => {
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://company.example/jobs/123",
      manual: {
        title: "Growth Marketing Manager",
        company: "Example Co",
      },
    }),
    makeDependencies({
      pipelineWriter: {
        write: async () => ({
          sheetId: "sheet_123",
          appended: 0,
          updated: 0,
          skippedDuplicates: 1,
          skippedBlacklist: 0,
          warnings: [],
        }),
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "duplicate");
});

test("handleIngestUrlWebhook generic_https uses Gemini URL context before Cheerio", async () => {
  let geminiCalls = 0;
  let scraperCalls = 0;
  let writerCalls = 0;
  let capturedLead: Record<string, unknown> | null = null;

  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/principal-engineer-payments",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({
        geminiApiKey: "test-gemini-key",
        geminiModel: "gemini-3.5-flash",
      }),
      extractWithGeminiUrlContext: async (input) => {
        geminiCalls += 1;
        return {
          ok: true as const,
          confidence: 0.88,
          rawListing: {
            sourceId: "ingest_url_gemini",
            sourceLabel: "Gemini URL context",
            sourceLane: "grounded_web",
            title: "Principal Engineer, Payments",
            company: "Example Co",
            location: "Remote",
            url: input.url,
            canonicalUrl: input.url,
            finalUrl: input.url,
            descriptionText:
              "Lead payment platform architecture and partner integrations.",
            metadata: {
              sourceQuery: `gemini_url_context:${input.url}`,
            },
          },
        };
      },
      scrapeJobPosting: async () => {
        scraperCalls += 1;
        throw new Error("Cheerio should not run when Gemini succeeds");
      },
      pipelineWriter: {
        write: async (_sheetId, leads) => {
          writerCalls += 1;
          capturedLead = leads[0] as unknown as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "gemini_url_context");
  assert.equal(geminiCalls, 1);
  assert.equal(scraperCalls, 0);
  assert.equal(writerCalls, 1);
  assert.equal(capturedLead?.title, "Principal Engineer, Payments");
  assert.equal(capturedLead?.company, "Example Co");
});

test("handleIngestUrlWebhook generic_https scrape failure rejects without writing", async () => {
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/principal-engineer-payments",
    }),
    makeDependencies({
      scrapeJobPosting: async () => {
        throw new Error("HTTP 403");
      },
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "scrape_failed");
  assert.match(body.hint, /employer careers|ATS posting/i);
  assert.equal(writerCalls, 0);
});

test("handleIngestUrlWebhook Browser Use error rejects without writing and logs failure", async () => {
  const logs: Array<{ event: string; details: Record<string, unknown> }> = [];
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://www.linkedin.com/jobs/view/4369653076",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ browserUseApiKey: "bu_test_key" }),
      extractWithBrowserUseCloud: async () => {
        throw new Error("Browser Use timed out after 120000ms");
      },
      log: (event: string, details: Record<string, unknown>) => {
        logs.push({ event, details });
      },
      pipelineWriter: {
        write: async () => {
          writerCalls += 1;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "blocked_aggregator");
  assert.equal(writerCalls, 0);
  assert.ok(
    logs.some(
      (entry) => entry.event === "discovery.run.ingest_url_browser_use_failed",
    ),
  );
  assert.doesNotMatch(JSON.stringify(logs), /bu_test_key/);
});

test("handleIngestUrlWebhook normal successful Cheerio scrape does not call Browser Use", async () => {
  let browserUseCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/growth-marketing-manager",
    }),
    makeDependencies({
      runtimeConfig: makeRuntimeConfig({ browserUseApiKey: "bu_test_key" }),
      extractWithBrowserUseCloud: async () => {
        browserUseCalls += 1;
        throw new Error("Browser Use should not run after usable scrape");
      },
      scrapeJobPosting: async () => ({
        url: "https://careers.example.com/roles/growth-marketing-manager",
        title: "Growth Marketing Manager",
        description: "Own growth marketing programs.",
        method: "cheerio",
      }),
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "cheerio_dom");
  assert.equal(browserUseCalls, 0);
});

test("handleIngestUrlWebhook cleans generic scrape title/company metadata", async () => {
  let capturedLead: Record<string, unknown> | null = null;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/jobs/5998147004",
    }),
    makeDependencies({
      scrapeJobPosting: async () => ({
        url: "https://careers.example.com/jobs/5998147004",
        title: "Job Application for Director, Growth Marketing at Figma",
        description: "Lead paid search and growth marketing programs.",
        skills: ["AI"],
        method: "cheerio",
      }),
      pipelineWriter: {
        write: async (_sheetId: string, leads: unknown[]) => {
          capturedLead = leads[0] as Record<string, unknown>;
          return {
            sheetId: "sheet_123",
            appended: 1,
            updated: 0,
            skippedDuplicates: 0,
            skippedBlacklist: 0,
            warnings: [],
          };
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "cheerio_dom");
  assert.equal(capturedLead?.title, "Director, Growth Marketing");
  assert.equal(capturedLead?.company, "Figma");
  assert.equal(capturedLead?.sourceLabel, "Company page");
  assert.deepEqual(capturedLead?.tags, [
    "Growth Marketing",
    "Director",
    "AI",
  ]);
});
