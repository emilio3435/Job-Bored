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

test("handleIngestUrlWebhook rejects non-string googleAccessToken", async () => {
  const response = await handleIngestUrlWebhook(
    makeRequest({ googleAccessToken: { token: "bad" } }),
    makeDependencies(),
  );

  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).message, /googleAccessToken/);
});

test("handleIngestUrlWebhook blocked_aggregator with missing Browser Use key lands url-only row without scraping", async () => {
  let fetcherCalls = 0;
  let scraperCalls = 0;
  let writerCalls = 0;
  let capturedLead: Record<string, unknown> | null = null;
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
  assert.equal(body.strategy, "url_only");
  assert.equal(body.appended, true);
  // Fetchers still skipped (no point calling Greenhouse for LinkedIn URL).
  assert.equal(fetcherCalls, 0);
  // Cheerio scraper also skipped — LinkedIn will 403 it anyway; save the RTT.
  assert.equal(scraperCalls, 0);
  // But the writer IS called — that's the whole point of the new behavior.
  assert.equal(writerCalls, 1);
  assert.ok(capturedLead, "lead should have been written");
  // Title derived from URL path, not a generic "Job at linkedin" fallback.
  assert.match(
    String((capturedLead as Record<string, unknown>).title),
    /Senior Product Manager At Plaid/i,
  );
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
            sourceLabel: "URL paste (Browser Use Cloud)",
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
  assert.equal(capturedLead?.sourceLabel, "URL paste (Browser Use Cloud)");
  assert.match(
    String((capturedLead?.metadata as Record<string, unknown>)?.sourceQuery || ""),
    /browser_use_cloud:/i,
  );
  assert.doesNotMatch(response.body, /bu_test_key/);
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
          sourceLabel: "Greenhouse (URL paste)",
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

test("handleIngestUrlWebhook generic_https scrape failure lands url-only row", async () => {
  // When the Cheerio scrape throws (HTTP 4xx/5xx upstream, timeout, etc.)
  // the handler falls back to a URL-only RawListing and still lands the row,
  // rather than returning scrape_failed and forcing manual fill. The
  // dashboard's drawer enrichment can retry when the user opens the row.
  let writerCalls = 0;
  let capturedLead: Record<string, unknown> | null = null;
  const response = await handleIngestUrlWebhook(
    makeRequest({
      url: "https://careers.example.com/roles/principal-engineer-payments",
    }),
    makeDependencies({
      scrapeJobPosting: async () => {
        throw new Error("HTTP 403");
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
  assert.equal(body.strategy, "url_only");
  assert.equal(writerCalls, 1);
  assert.ok(capturedLead);
  assert.match(
    String((capturedLead as Record<string, unknown>).title),
    /Principal Engineer Payments/i,
  );
  assert.match(
    String((capturedLead as Record<string, unknown>).company),
    /Careers|Example/i,
  );
});

test("handleIngestUrlWebhook Browser Use error falls back to url-only row and logs failure", async () => {
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
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "url_only");
  assert.equal(writerCalls, 1);
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
