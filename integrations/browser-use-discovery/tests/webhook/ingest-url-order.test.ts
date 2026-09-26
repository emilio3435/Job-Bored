// BEAUDIT A3 / A4: promotes probes/A/ingest-order.mts.
// A3: /ingest-url must prove a Sheets credential before any paid or outbound
// extraction. A4: a rejected Sheet write must land in the handler's own catch
// (a `reason` the dashboard switches on), not escape to the router.
import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig } from "../../src/config.ts";
import { handleIngestUrlWebhook } from "../../src/webhook/handle-ingest-url.ts";

const SECRET = "ingest-order-secret";

function runtimeConfigWithoutGoogle() {
  // Explicit env with no Google credential and no worker-config file.
  return loadRuntimeConfig({
    BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: SECRET,
    BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    BROWSER_USE_DISCOVERY_WORKER_CONFIG: "/nonexistent/jobbored-worker-config.json",
    BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "test-gemini-key",
  } as never);
}

function ingestRequest(body: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: "ingest.url.request",
      schemaVersion: 1,
      url: "https://boards.greenhouse.io/acme/jobs/123",
      sheetId: "1AbCdEfGhIjKlMnOpQrSt",
      ...body,
    }),
  };
}

function countingExtractors() {
  const calls = { greenhouse: 0, gemini: 0, browserUse: 0, scrape: 0 };
  return {
    calls,
    deps: {
      fetchGreenhouseJob: (async () => {
        calls.greenhouse += 1;
        return { ok: false, message: "stub 404", httpStatus: 404 };
      }) as never,
      extractWithGeminiUrlContext: (async () => {
        calls.gemini += 1;
        return {
          ok: true,
          rawListing: {
            title: "Staff Engineer",
            company: "Acme",
            url: "https://boards.greenhouse.io/acme/jobs/123",
            descriptionText: "Build things. ".repeat(40),
          },
        };
      }) as never,
      extractWithBrowserUseCloud: (async () => {
        calls.browserUse += 1;
        return { ok: false };
      }) as never,
      scrapeJobPosting: (async () => {
        calls.scrape += 1;
        return { ok: false, message: "stub" };
      }) as never,
    },
  };
}

test("A3: /ingest-url with no Sheets credential answers 409 before any extraction call", async () => {
  const runtimeConfig = runtimeConfigWithoutGoogle();
  const { calls, deps } = countingExtractors();
  const response = await handleIngestUrlWebhook(ingestRequest(), {
    runtimeConfig,
    pipelineWriter: {
      write: async () => {
        throw new Error("must not write");
      },
    },
    ...deps,
  });
  assert.equal(response.status, 409);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "sheets_credential_missing");
  assert.deepEqual(calls, { greenhouse: 0, gemini: 0, browserUse: 0, scrape: 0 });
});

test("A3: async /ingest-url with no Sheets credential answers 409 instead of queueing a run", async () => {
  const runtimeConfig = runtimeConfigWithoutGoogle();
  const { calls, deps } = countingExtractors();
  const puts: unknown[] = [];
  const response = await handleIngestUrlWebhook(ingestRequest({ async: true }), {
    runtimeConfig,
    pipelineWriter: { write: async () => ({}) as never },
    runStatusStore: {
      put: (p: unknown) => puts.push(p),
      get: () => null,
      close() {},
    } as never,
    ...deps,
  });
  assert.equal(response.status, 409);
  assert.equal(puts.length, 0, "no run status is created for a request that cannot write");
  assert.deepEqual(calls, { greenhouse: 0, gemini: 0, browserUse: 0, scrape: 0 });
});

test("A3: a per-request googleAccessToken satisfies the credential check", async () => {
  const runtimeConfig = runtimeConfigWithoutGoogle();
  const { deps } = countingExtractors();
  const response = await handleIngestUrlWebhook(
    ingestRequest({ googleAccessToken: "dashboard-token" }),
    {
      runtimeConfig,
      pipelineWriter: {
        write: async () => ({ appended: 1, updated: 0, skippedDuplicates: 0 }) as never,
      },
      ...deps,
    },
  );
  assert.notEqual(response.status, 409);
});

test("A4: a rejected Sheet write is answered by the handler with a reason, not thrown to the router", async () => {
  const runtimeConfig = runtimeConfigWithoutGoogle();
  const { deps } = countingExtractors();
  let threw: unknown = null;
  let response: { status: number; body: string } | null = null;
  try {
    response = await handleIngestUrlWebhook(
      ingestRequest({ googleAccessToken: "dashboard-token" }),
      {
        runtimeConfig,
        pipelineWriter: {
          write: async () => {
            throw new Error("Sheets API 403: caller does not have permission");
          },
        },
        ...deps,
      },
    );
  } catch (error) {
    threw = error;
  }
  assert.equal(threw, null, "the write rejection must not escape the handler");
  assert.equal(response?.status, 500);
  const body = JSON.parse(String(response?.body));
  assert.equal(body.reason, "worker_error");
  assert.match(body.message, /403/);
});

test("A4: the manual-fill write path also keeps a write rejection inside the handler", async () => {
  const runtimeConfig = runtimeConfigWithoutGoogle();
  let threw: unknown = null;
  let response: { status: number; body: string } | null = null;
  try {
    response = await handleIngestUrlWebhook(
      ingestRequest({
        googleAccessToken: "dashboard-token",
        url: "https://example.com/jobs/1",
        manual: { title: "Staff Engineer", company: "Acme" },
      }),
      {
        runtimeConfig,
        pipelineWriter: {
          write: async () => {
            throw new Error("Sheets API 500");
          },
        },
      },
    );
  } catch (error) {
    threw = error;
  }
  assert.equal(threw, null);
  assert.equal(JSON.parse(String(response?.body)).reason, "worker_error");
});
