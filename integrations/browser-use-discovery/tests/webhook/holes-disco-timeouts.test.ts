// HOLES DISCO D4 / §0.11: the worker's ceilings are generous because the
// scrape is massive. A run may take 3 h, each source 3 min, the matcher 90 s,
// grounded search 15 min, and Gemini and Browser Use calls 90 s. A run carried
// by the dashboard's Google token keeps that whole budget instead of being cut
// at 50 min; a token that expires before the write ends the run write_failed
// with its leads kept, and the dashboard retries the write.
import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_BROWSER_COMMAND_TIMEOUT_MS } from "../../src/browser/session.ts";
import { loadRuntimeConfig, mergeDiscoveryConfig } from "../../src/config.ts";
import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  collectGroundedWebListings,
  DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
} from "../../src/grounding/grounded-search.ts";
import {
  DEFAULT_MATCHER_TIMEOUT_MS,
  DEFAULT_MAX_RUN_DURATION_MS as RUN_DISCOVERY_MAX_RUN_DURATION_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
} from "../../src/run/run-discovery.ts";
import {
  DEFAULT_MAX_RUN_DURATION_MS,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";

const THREE_HOURS_MS = 10_800_000;
const SECRET = "holes-disco-secret";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrSt";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_123",
    variationKey: "var_123",
    requestedAt: "2026-10-02T09:00:00.000Z",
    ...overrides,
  };
}

function makeStoredConfig() {
  return {
    sheetId: "sheet_123",
    mode: "local",
    timezone: "America/Chicago",
    companies: [{ name: "Scale AI" }],
    includeKeywords: ["AI"],
    excludeKeywords: [],
    targetRoles: ["Growth Marketing"],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "",
    maxLeadsPerRun: 20,
    enabledSources: ["greenhouse", "ashby"],
    schedule: { enabled: false, cron: "0 7 * * 1-5" },
  };
}

function groundedRuntimeFor(
  sourcePreset: string,
  groundedSearchTuning?: Record<string, unknown>,
) {
  return mergeDiscoveryConfig(
    makeStoredConfig() as never,
    makeRequest({
      discoveryProfile: {
        sourcePreset,
        targetRoles: "Senior Engineer",
        ...(groundedSearchTuning ? { groundedSearchTuning } : {}),
      },
    }) as never,
  ).groundedSearchTuning.maxRuntimeMs;
}

test("§0.11: the worker lets a run take 3 hours by default", () => {
  const config = loadRuntimeConfig({ BROWSER_USE_DISCOVERY_RUN_MODE: "local" });
  assert.equal(config.maxRunDurationMs, THREE_HOURS_MS);
  assert.equal(DEFAULT_MAX_RUN_DURATION_MS, THREE_HOURS_MS);
});

test("§0.11: runDiscovery's own abort fallback is the same 3 hours", () => {
  // A caller that omits maxRunDurationMs must not be killed at 1 h while the
  // dashboard's status backstop waits 3 h (Grok DISCO review).
  assert.equal(RUN_DISCOVERY_MAX_RUN_DURATION_MS, THREE_HOURS_MS);
});

test("§0.11: grounded search gets 15 minutes in every preset", () => {
  for (const preset of ["browser_only", "ats_only", "browser_plus_ats"]) {
    assert.equal(groundedRuntimeFor(preset), 900_000, `${preset} default`);
    assert.equal(
      groundedRuntimeFor(preset, { maxResultsPerCompany: 20 }),
      900_000,
      `${preset} with a partial override`,
    );
  }
});

test("§0.11: an explicit grounded runtime is still kept as given", () => {
  assert.equal(groundedRuntimeFor("browser_only", { maxRuntimeMs: 30_000 }), 30_000);
});

test("§0.11: each source gets 3 minutes and the matcher 90 seconds", () => {
  assert.equal(DEFAULT_SOURCE_TIMEOUT_MS, 180_000);
  assert.equal(DEFAULT_MATCHER_TIMEOUT_MS, 90_000);
});

test("§0.11: Gemini and Browser Use calls get 90 seconds", () => {
  assert.equal(DEFAULT_GEMINI_REQUEST_TIMEOUT_MS, 90_000);
  assert.equal(DEFAULT_BROWSER_COMMAND_TIMEOUT_MS, 90_000);
});

test("§0.11: a grounded page visit gives Browser Use 90 seconds", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const description =
    "This role includes job description, responsibilities, qualifications, and an apply now path for current openings. ".repeat(8);
  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Notion Careers</title></head><body><h1>Open Roles</h1><a href="/jobs/123">Backend Engineer</a><p>${description}</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as typeof fetch;

  const visits: Array<number | undefined> = [];
  const run = {
    runId: "run_holes_disco",
    trigger: "manual",
    request: makeRequest({ sheetId: "sheet_123" }),
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Notion" }],
      includeKeywords: ["marketing"],
      excludeKeywords: [],
      targetRoles: ["Product Marketing Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-10-02T09:00:00.000Z",
    },
  };
  await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: {
      browserUseCommand: "browser-use",
      geminiApiKey: "placeholder-api-value-abc123",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      runMode: "hosted",
      useStructuredExtraction: false,
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.notion.so/careers",
            title: "Notion Careers",
            pageType: "careers",
            reason: "Employer careers page",
            sourceDomain: "www.notion.so",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url, timeoutMs }: { url: string; timeoutMs?: number }) => {
        visits.push(timeoutMs);
        return {
          url,
          text: JSON.stringify({ pageType: "listings", jobs: [] }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  } as never);

  assert.deepEqual(visits, [90_000]);
});

function createMemoryStore() {
  const states: Array<Record<string, unknown>> = [];
  return {
    put(payload: Record<string, unknown>) {
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId: string) {
      for (let index = states.length - 1; index >= 0; index -= 1) {
        if (states[index].runId === runId) return states[index];
      }
      return null;
    },
    close() {},
  };
}

test("§0.11: a run carrying the dashboard's Google token keeps the full 3-hour budget", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createMemoryStore();
  const logger = { append: async () => ({ ok: true }) };
  let runBudgetMs = 0;
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": SECRET },
      bodyText: JSON.stringify({
        ...makeRequest({ sheetId: SHEET_ID, requestedAt: new Date().toISOString() }),
        googleAccessToken: "dashboard-token",
        discoveryProfile: { targetRoles: "Engineer" },
      }),
    },
    {
      runSynchronously: false,
      runStatusStore: store,
      maxRunDurationMs: THREE_HOURS_MS,
      runDiscovery: async (_request: unknown, _trigger: unknown, runDeps: { maxRunDurationMs?: number }) => {
        runBudgetMs = Number(runDeps.maxRunDurationMs);
        return new Promise(() => {});
      },
      createDiscoveryRunsLoggerForRequest: () => logger,
      runDependencies: {
        runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
        maxRunDurationMs: THREE_HOURS_MS,
        loadStoredWorkerConfig: async () => ({ sheetId: SHEET_ID, companies: [{ name: "Acme" }] }),
        discoveryRunsLogger: logger,
        now: () => new Date(),
        randomId: (prefix: string) => `${prefix}_holesdisco`,
      },
    } as never,
  );
  assert.equal(response.status, 202);
  const runId = String(JSON.parse(response.body).runId || "");
  assert.ok(runId);

  // The old cap cut a token run at 50 min (+30 s status grace).
  t.mock.timers.tick(51 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runBudgetMs, THREE_HOURS_MS);
  const status = store.get(runId);
  assert.equal(status?.terminal, false, `still running at 51 min, got ${String(status?.status)}`);
});
