import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateProfile,
  CompanyTarget,
  DiscoveryRunLogRow,
  WorkerRuntimeConfig,
} from "../../src/contracts.ts";
import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryProfileWebhook } from "../../src/webhook/handle-discovery-profile.ts";

function makeRuntimeConfig(): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "test-api-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 5,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "secret-xyz",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
    serpApiKey: "",
  };
}

const CANNED_PROFILE: CandidateProfile = {
  targetRoles: ["Senior Engineer"],
  skills: ["typescript"],
  seniority: "senior",
  locations: ["Remote"],
  remotePolicy: "remote",
  industries: [],
};

const CANNED_COMPANIES: CompanyTarget[] = [
  {
    name: "Example Co",
    companyKey: "example-co",
    normalizedName: "example-co",
    domains: ["example.com"],
    roleTags: ["senior engineer"],
    geoTags: ["remote"],
  },
];

function makeDeps(logSink: Array<[string, Record<string, unknown>]>) {
  return {
    runtimeConfig: makeRuntimeConfig(),
    extractCandidateProfile: async () => CANNED_PROFILE,
    discoverCompaniesForProfile: async () => [...CANNED_COMPANIES],
    log: (event: string, details: Record<string, unknown>) => {
      logSink.push([event, details]);
    },
  };
}

test("POST /discovery-profile accepts trigger:'scheduled-local' and records it on the accepted-request log", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Experienced engineer.",
        trigger: "scheduled-local",
      }),
    },
    makeDeps(logSink),
  );

  assert.equal(response.status, 200);
  const accepted = logSink.find(([event]) => event === "discovery.profile.request_accepted");
  assert.ok(accepted, "expected request_accepted log entry");
  assert.equal(accepted![1].trigger, "scheduled-local");
});

test("POST /discovery-profile rejects unknown trigger value with 400", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Experienced engineer.",
        trigger: "definitely-not-a-valid-enum",
      }),
    },
    makeDeps(logSink),
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /trigger must be one of/);
});

test("POST /discovery-profile omits trigger when not provided", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Experienced engineer.",
      }),
    },
    makeDeps(logSink),
  );

  const accepted = logSink.find(([event]) => event === "discovery.profile.request_accepted");
  assert.ok(accepted);
  assert.equal(accepted![1].trigger, null);
});

type LoggerCall = { sheetId: string; row: DiscoveryRunLogRow };

function makeLoggingDeps(
  logSink: Array<[string, Record<string, unknown>]>,
  loggerCalls: LoggerCall[],
  extras: {
    discoverThrows?: boolean;
    nowSequence?: string[];
  } = {},
) {
  const dates = (extras.nowSequence || [
    "2026-04-21T15:00:00.000Z",
    "2026-04-21T15:00:03.000Z",
  ]).map((iso) => new Date(iso));
  let nowIndex = 0;
  return {
    ...makeDeps(logSink),
    discoveryRunsSource: "worker@profile-test",
    now: () => dates[Math.min(nowIndex++, dates.length - 1)],
    discoveryRunsLogger: {
      append: async (sheetId: string, row: DiscoveryRunLogRow) => {
        loggerCalls.push({ sheetId, row });
        return { ok: true as const, created: false };
      },
    },
    discoverCompaniesForProfile: async () => {
      if (extras.discoverThrows) throw new Error("gemini is down");
      return [...CANNED_COMPANIES];
    },
  };
}

test("POST /discovery-profile manual success logs DiscoveryRuns row with zero lead writes/updates", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const loggerCalls: LoggerCall[] = [];

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Senior engineer.",
        sheetId: "sheet-opt-b",
        trigger: "manual",
      }),
    },
    makeLoggingDeps(logSink, loggerCalls),
  );

  assert.equal(response.status, 200);
  assert.equal(loggerCalls.length, 1);
  const [{ sheetId, row }] = loggerCalls;
  assert.equal(sheetId, "sheet-opt-b");
  assert.equal(row.trigger, "manual");
  assert.equal(row.status, "success");
  assert.equal(row.leadsWritten, 0);
  assert.equal(row.leadsUpdated, 0);
  assert.equal(row.companiesSeen, CANNED_COMPANIES.length);
  assert.equal(row.source, "worker@profile-test");
  assert.equal(row.variationKey, "sheet-opt-b");
  assert.equal(row.error, "");
  assert.equal(row.runAt, "2026-04-21T15:00:03.000Z");
  assert.equal(row.durationS, 3);
});

test("POST /discovery-profile refresh without explicit trigger defaults to 'cli' in the log", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const loggerCalls: LoggerCall[] = [];

  await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "refresh",
        sheetId: "sheet-opt-b",
      }),
    },
    {
      ...makeLoggingDeps(logSink, loggerCalls),
      loadStoredWorkerConfig: async (id: string) => ({
        sheetId: id,
        mode: "hosted" as const,
        timezone: "UTC",
        companies: [],
        includeKeywords: [],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "",
        seniority: "",
        maxLeadsPerRun: 25,
        enabledSources: ["grounded_web"] as const,
        schedule: { enabled: false, cron: "" },
        candidateProfile: {
          resumeText: "stored",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      }),
      upsertStoredWorkerConfig: async (_rc, input) =>
        ({
          sheetId: input.sheetId,
          mode: "hosted" as const,
          timezone: "UTC",
          companies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"] as const,
          schedule: { enabled: false, cron: "" },
        }) as any,
    },
  );

  assert.equal(loggerCalls.length, 1);
  assert.equal(loggerCalls[0].row.trigger, "cli");
  assert.equal(loggerCalls[0].row.status, "success");
});

test("POST /discovery-profile logs a failure row when company discovery throws (non-blocking)", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const loggerCalls: LoggerCall[] = [];

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Senior engineer.",
        sheetId: "sheet-opt-b",
        trigger: "scheduled-local",
      }),
    },
    makeLoggingDeps(logSink, loggerCalls, { discoverThrows: true }),
  );

  assert.equal(response.status, 502);
  assert.equal(loggerCalls.length, 1);
  assert.equal(loggerCalls[0].row.status, "failure");
  assert.equal(loggerCalls[0].row.trigger, "scheduled-local");
  assert.equal(loggerCalls[0].row.leadsWritten, 0);
  assert.equal(loggerCalls[0].row.companiesSeen, 0);
  assert.match(loggerCalls[0].row.error, /Company discovery failed/);
});

test("POST /discovery-profile does NOT log for mode:status, mode:schedule-status, mode:skip_company", async () => {
  const cases = [
    {
      mode: "status",
      body: { mode: "status", sheetId: "sheet-opt-b" },
      extraDeps: {
        loadStoredWorkerConfig: async (id: string) => ({
          sheetId: id,
          mode: "hosted" as const,
          timezone: "UTC",
          companies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"] as const,
          schedule: { enabled: false, cron: "" },
        }),
      },
    },
    {
      mode: "schedule-status",
      body: { mode: "schedule-status", sheetId: "sheet-opt-b" },
      extraDeps: {
        loadStoredWorkerConfig: async (id: string) => ({
          sheetId: id,
          mode: "hosted" as const,
          timezone: "UTC",
          companies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"] as const,
          schedule: { enabled: false, cron: "" },
        }),
      },
    },
    {
      mode: "skip_company",
      body: {
        mode: "skip_company",
        sheetId: "sheet-opt-b",
        skipCompanyKeys: ["foo"],
      },
      extraDeps: {
        loadStoredWorkerConfig: async (id: string) => ({
          sheetId: id,
          mode: "hosted" as const,
          timezone: "UTC",
          companies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"] as const,
          schedule: { enabled: false, cron: "" },
        }),
        upsertStoredWorkerConfig: async (_rc: unknown, input: { sheetId: string }) =>
          ({
            sheetId: input.sheetId,
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
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
          }) as any,
      },
    },
  ];
  for (const c of cases) {
    const logSink: Array<[string, Record<string, unknown>]> = [];
    const loggerCalls: LoggerCall[] = [];
    await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: JSON.stringify({
          event: DISCOVERY_PROFILE_EVENT,
          schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
          ...c.body,
        }),
      },
      {
        ...makeLoggingDeps(logSink, loggerCalls),
        ...c.extraDeps,
      },
    );
    assert.equal(
      loggerCalls.length,
      0,
      `mode=${c.mode} should not fire the runs logger, got ${loggerCalls.length} calls`,
    );
  }
});
