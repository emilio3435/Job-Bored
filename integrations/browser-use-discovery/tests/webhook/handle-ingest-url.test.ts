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

test("handleIngestUrlWebhook blocked_aggregator lands url-only row without scraping", async () => {
  // LinkedIn/Indeed/etc. block scrapers. Instead of forcing a manual-fill
  // modal, the handler now builds a minimal URL-only RawListing
  // (hostname-derived company, slug-derived title) and lands the row. The
  // dashboard's drawer enrichment pass fills in details on row open.
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

test("handleIngestUrlWebhook ats_direct happy path appends row", async () => {
  let writerCalls = 0;
  const response = await handleIngestUrlWebhook(
    makeRequest({ url: "https://boards.greenhouse.io/plaid/jobs/4728292004" }),
    makeDependencies({
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
