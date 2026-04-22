import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateProfile,
  CompanyTarget,
  StoredWorkerConfig,
  WorkerRuntimeConfig,
} from "../../src/contracts.ts";
import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryProfileWebhook } from "../../src/webhook/handle-discovery-profile.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
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
    ...overrides,
  };
}

const CANNED_PROFILE: CandidateProfile = {
  targetRoles: ["Growth Marketing Manager", "Performance Marketing Lead"],
  skills: ["SEO", "paid acquisition", "lifecycle", "AI automation"],
  seniority: "senior",
  yearsOfExperience: 7,
  locations: ["Remote", "Denver", "United States"],
  remotePolicy: "remote",
  industries: ["AI tooling", "B2B SaaS"],
};

const CANNED_COMPANIES: CompanyTarget[] = [
  {
    name: "Notion",
    companyKey: "notion",
    normalizedName: "notion",
    domains: ["notion.so"],
    roleTags: ["growth marketing", "performance marketing"],
    geoTags: ["remote"],
  },
  {
    name: "Ramp",
    companyKey: "ramp",
    normalizedName: "ramp",
    domains: ["ramp.com"],
    roleTags: ["growth marketing"],
    geoTags: ["remote", "new york"],
  },
  {
    name: "Figma",
    companyKey: "figma",
    normalizedName: "figma",
    domains: ["figma.com"],
    roleTags: ["performance marketing"],
    geoTags: ["remote", "san francisco"],
  },
];

function makeHappyDeps(overrides: {
  upsertStoredWorkerConfig?: (
    runtimeConfig: WorkerRuntimeConfig,
    input: { sheetId: string; mutations: Partial<StoredWorkerConfig> },
  ) => Promise<StoredWorkerConfig>;
  logSink?: Array<[string, Record<string, unknown>]>;
}) {
  return {
    runtimeConfig: makeRuntimeConfig(),
    extractCandidateProfile: async () => CANNED_PROFILE,
    discoverCompaniesForProfile: async () => [...CANNED_COMPANIES],
    upsertStoredWorkerConfig: overrides.upsertStoredWorkerConfig,
    log: overrides.logSink
      ? (event: string, details: Record<string, unknown>) => {
          overrides.logSink!.push([event, details]);
        }
      : undefined,
  };
}

test("POST /discovery-profile happy path returns profile + companies and does not persist by default", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const deps = makeHappyDeps({ logSink });

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Senior Growth Marketer with 7 years of experience.",
      }),
    },
    deps,
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, false);
  assert.deepEqual(body.profile, CANNED_PROFILE);
  assert.equal(body.companies.length, CANNED_COMPANIES.length);
  assert.equal(body.companies[0].name, "Notion");
});

test("POST /discovery-profile persists companies when persist:true + sheetId is provided", async () => {
  let captured:
    | {
        runtimeConfig: WorkerRuntimeConfig;
        sheetId: string;
        mutations: Partial<StoredWorkerConfig>;
      }
    | null = null;
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const deps = makeHappyDeps({
    logSink,
    upsertStoredWorkerConfig: async (runtimeConfig, input) => {
      captured = { runtimeConfig, ...input };
      return {
        sheetId: input.sheetId,
        mode: runtimeConfig.runMode,
        timezone: "UTC",
        companies: input.mutations.companies || [],
        atsCompanies: [],
        includeKeywords: [],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "",
        seniority: "",
        maxLeadsPerRun: 25,
        enabledSources: ["grounded_web"],
        schedule: { enabled: false, cron: "" },
      } as StoredWorkerConfig;
    },
  });

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "Senior Growth Marketer.",
        persist: true,
        sheetId: "sheet_abc123",
      }),
    },
    deps,
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, true);
  assert.ok(captured, "upsertStoredWorkerConfig should be invoked");
  assert.equal(captured!.sheetId, "sheet_abc123");
  // Profile-derived roleTags/geoTags are stripped before persist (E-4
  // codex-challenge finding). The in-memory response still includes them
  // for the caller's preview.
  const expectedPersisted = CANNED_COMPANIES.map(
    ({ roleTags: _r, geoTags: _g, ...rest }) => rest,
  );
  assert.deepEqual(captured!.mutations.companies, expectedPersisted);
  assert.ok(
    Array.isArray(body.companies) &&
      body.companies.every(
        (c: { roleTags?: unknown; geoTags?: unknown }) =>
          Array.isArray(c.roleTags) && Array.isArray(c.geoTags),
      ),
    "response preview should retain roleTags/geoTags",
  );
  assert.ok(
    logSink.some(([event]) => event === "discovery.profile.persisted"),
    "should emit discovery.profile.persisted event",
  );
});

test("POST /discovery-profile rejects missing/invalid x-discovery-secret with 401", async () => {
  const deps = makeHappyDeps({});

  const missingHeader = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: {},
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "x",
      }),
    },
    deps,
  );
  assert.equal(missingHeader.status, 401);
  assert.match(missingHeader.body, /missing_secret_header/);

  const wrongHeader = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "not-the-secret" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "x",
      }),
    },
    deps,
  );
  assert.equal(wrongHeader.status, 401);
  assert.match(wrongHeader.body, /secret_mismatch/);
});

test("POST /discovery-profile rejects non-POST with 405", async () => {
  const deps = makeHappyDeps({});
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "GET",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: "",
    },
    deps,
  );
  assert.equal(response.status, 405);
});

test("POST /discovery-profile rejects empty intent (no resumeText, no form)", async () => {
  const deps = makeHappyDeps({});
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
      }),
    },
    deps,
  );
  assert.equal(response.status, 400);
  assert.match(response.body, /resumeText or form must be non-blank/);
});

test("POST /discovery-profile never logs raw resumeText content (PII guard)", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const deps = makeHappyDeps({ logSink });
  const secretResume =
    "SECRET-PII-MARKER: John Q. Public, john@example.com, SSN 123-45-6789.";

  await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: secretResume,
      }),
    },
    deps,
  );

  for (const [event, details] of logSink) {
    const serialized = JSON.stringify(details);
    assert.ok(
      !serialized.includes("SECRET-PII-MARKER"),
      `log event ${event} leaked raw resume content: ${serialized}`,
    );
    assert.ok(
      !serialized.includes("SSN 123-45-6789"),
      `log event ${event} leaked SSN substring: ${serialized}`,
    );
    assert.ok(
      !serialized.includes("john@example.com"),
      `log event ${event} leaked email substring: ${serialized}`,
    );
  }
  assert.ok(
    logSink.some(
      ([, details]) =>
        typeof details.resumeTextLength === "number" &&
        details.resumeTextLength === secretResume.length,
    ),
    "should record resumeTextLength as a safe proxy for resume content",
  );
});

test("POST /discovery-profile accepts form input only (no resumeText)", async () => {
  const deps = makeHappyDeps({});
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        form: {
          targetRoles: "Growth Marketing",
          skills: "SEO, paid",
          seniority: "senior",
        },
      }),
    },
    deps,
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
});

test("POST /discovery-profile repairs empty successful profile extraction before company discovery", async () => {
  let discoveredProfile: CandidateProfile | null = null;
  let capturedMutations: Partial<StoredWorkerConfig> | null = null;
  const logSink: Array<[string, Record<string, unknown>]> = [];

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: [
          "Senior Performance Marketing Manager.",
          "Led paid social, paid search, Google Ads, Meta Ads, CRM, lifecycle campaigns, SQL analytics, and B2B SaaS growth.",
          "Remote-friendly.",
        ].join("\n"),
        persist: true,
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => ({
        targetRoles: [],
        skills: [],
        seniority: "",
        locations: [],
        industries: [],
      }),
      discoverCompaniesForProfile: async (profile) => {
        discoveredProfile = profile;
        return [...CANNED_COMPANIES];
      },
      upsertStoredWorkerConfig: async (runtimeConfig, input) => {
        capturedMutations = input.mutations;
        return {
          sheetId: input.sheetId,
          mode: runtimeConfig.runMode,
          timezone: "UTC",
          companies: input.mutations.companies || [],
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
        } as StoredWorkerConfig;
      },
      log: (event, details) => {
        logSink.push([event, details]);
      },
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, true);
  assert.equal(body.fallback, undefined);
  assert.ok(discoveredProfile, "company discovery should receive a repaired profile");
  assert.ok(
    discoveredProfile!.targetRoles.includes("Performance Marketing Manager"),
  );
  assert.ok(discoveredProfile!.skills.includes("Google Ads"));
  assert.ok(discoveredProfile!.industries?.includes("B2B SaaS"));
  assert.equal(capturedMutations?.companies?.length, CANNED_COMPANIES.length);
  assert.ok(
    logSink.some(([event]) => event === "discovery.profile.extract_empty_fallback_used"),
    "should log the empty-extraction repair path",
  );
});

test("POST /discovery-profile returns 502 when profile extraction throws", async () => {
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "anything",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => {
        throw new Error("simulated Gemini outage");
      },
      discoverCompaniesForProfile: async () => [],
    },
  );
  assert.equal(response.status, 502);
  assert.match(response.body, /Profile extraction failed/);
});

test("POST /discovery-profile falls back to stored companies when profile extraction is quota-limited", async () => {
  let discoverCalled = false;
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText:
          "Senior product manager with SQL analytics and AI operations experience.",
        form: {
          targetRoles: "Senior Product Manager, AI Product Manager",
          skills: "SQL, analytics, roadmap",
          locations: "Denver, Remote US",
          remotePolicy: "remote",
        },
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => {
        throw new Error("Gemini HTTP 429: quota exceeded");
      },
      discoverCompaniesForProfile: async () => {
        discoverCalled = true;
        return [];
      },
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: CANNED_COMPANIES,
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
        }) as StoredWorkerConfig,
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.fallback.reason, "profile_extraction_failed");
  assert.equal(body.companies.length, CANNED_COMPANIES.length);
  assert.ok(body.profile.targetRoles.includes("Senior Product Manager"));
  assert.ok(body.profile.targetRoles.includes("AI Product Manager"));
  assert.equal(discoverCalled, false);
});

test("POST /discovery-profile does not persist fallback companies when profile extraction is quota-limited", async () => {
  let upsertCalled = false;
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText:
          "Senior product manager with SQL analytics and AI operations experience.",
        persist: true,
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => {
        throw new Error("Gemini HTTP 429: quota exceeded");
      },
      discoverCompaniesForProfile: async () => {
        throw new Error("should not run after extraction fallback");
      },
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: CANNED_COMPANIES,
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
        }) as StoredWorkerConfig,
      upsertStoredWorkerConfig: async () => {
        upsertCalled = true;
        throw new Error("fallback results should be preview-only");
      },
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, false);
  assert.equal(body.fallback.reason, "profile_extraction_failed");
  assert.equal(body.companies.length, CANNED_COMPANIES.length);
  assert.equal(upsertCalled, false);
});

test("POST /discovery-profile filters skipped companies from extraction fallback", async () => {
  let upsertCalled = false;
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText:
          "Senior product manager with SQL analytics and AI operations experience.",
        persist: true,
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => {
        throw new Error("Gemini HTTP 429: quota exceeded");
      },
      discoverCompaniesForProfile: async () => {
        throw new Error("should not run after extraction fallback");
      },
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: CANNED_COMPANIES,
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
          negativeCompanyKeys: ["notion", "ramp", "figma"],
        }) as StoredWorkerConfig,
      upsertStoredWorkerConfig: async () => {
        upsertCalled = true;
        throw new Error("fallback results should be preview-only");
      },
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, false);
  assert.equal(body.fallback.reason, "profile_extraction_failed");
  assert.match(body.fallback.message, /already been skipped/);
  assert.deepEqual(body.companies, []);
  assert.equal(upsertCalled, false);
});

test("POST /discovery-profile returns 502 when company discovery throws", async () => {
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "anything",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => CANNED_PROFILE,
      discoverCompaniesForProfile: async () => {
        throw new Error("grounded search down");
      },
    },
  );
  assert.equal(response.status, 502);
  assert.match(response.body, /Company discovery failed/);
});

test("POST /discovery-profile falls back to stored companies when company discovery fails", async () => {
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "anything",
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => CANNED_PROFILE,
      discoverCompaniesForProfile: async () => {
        throw new Error("Gemini HTTP 429: quota exceeded");
      },
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: CANNED_COMPANIES,
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
        }) as StoredWorkerConfig,
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.fallback.reason, "company_discovery_failed");
  assert.equal(body.companies.length, CANNED_COMPANIES.length);
  assert.deepEqual(body.profile, CANNED_PROFILE);
});

test("POST /discovery-profile does not persist fallback companies when company discovery fails", async () => {
  let upsertCalled = false;
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        resumeText: "anything",
        persist: true,
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      extractCandidateProfile: async () => CANNED_PROFILE,
      discoverCompaniesForProfile: async () => {
        throw new Error("Gemini HTTP 429: quota exceeded");
      },
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: CANNED_COMPANIES,
          atsCompanies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
        }) as StoredWorkerConfig,
      upsertStoredWorkerConfig: async () => {
        upsertCalled = true;
        throw new Error("fallback results should be preview-only");
      },
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.persisted, false);
  assert.equal(body.fallback.reason, "company_discovery_failed");
  assert.equal(body.companies.length, CANNED_COMPANIES.length);
  assert.equal(upsertCalled, false);
});

test("POST /discovery-profile mode:status returns snapshot from stored config", async () => {
  const storedConfig = {
    sheetId: "sheet_abc123",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [
      { name: "Notion", companyKey: "notion", normalizedName: "notion" },
      { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
    ],
    atsCompanies: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["grounded_web"],
    schedule: { enabled: false, cron: "" },
    candidateProfile: {
      resumeText: "x".repeat(1847),
      form: { targetRoles: "PM", skills: "SQL", seniority: "senior" },
      updatedAt: "2026-04-15T10:00:00.000Z",
    },
    negativeCompanyKeys: ["acme", "beta", "gamma"],
    lastRefreshAt: { at: "2026-04-20T08:00:00.000Z", source: "refresh" as const },
  } as StoredWorkerConfig;

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "status",
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () => storedConfig,
      // Gemini deps intentionally omitted — mode:status must not invoke them.
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.status, {
    hasStoredProfile: true,
    resumeTextLength: 1847,
    resumeText: "x".repeat(1847),
    form: { targetRoles: "PM", skills: "SQL", seniority: "senior" },
    formFieldCount: 3,
    profileUpdatedAt: "2026-04-15T10:00:00.000Z",
    companyCount: 2,
    negativeCompanyCount: 3,
    lastRefreshAt: "2026-04-20T08:00:00.000Z",
    lastRefreshSource: "refresh",
  });
});

test("POST /discovery-profile mode:status excludes skipped companies from companyCount", async () => {
  const storedConfig = {
    sheetId: "sheet_abc123",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [
      { name: "Notion", companyKey: "notion", normalizedName: "notion" },
      { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
    ],
    atsCompanies: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["grounded_web"],
    schedule: { enabled: false, cron: "" },
    negativeCompanyKeys: ["notion"],
  } as StoredWorkerConfig;

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "status",
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () => storedConfig,
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status.companyCount, 1);
  assert.equal(body.status.negativeCompanyCount, 1);
});

test("POST /discovery-profile mode:status returns empty snapshot when no stored profile", async () => {
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "status",
        sheetId: "sheet_fresh",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () => null,
    },
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.status, {
    hasStoredProfile: false,
    resumeTextLength: 0,
    resumeText: "",
    form: null,
    formFieldCount: 0,
    profileUpdatedAt: null,
    companyCount: 0,
    negativeCompanyCount: 0,
    lastRefreshAt: null,
    lastRefreshSource: null,
  });
});

test("POST /discovery-profile mode:status requires sheetId", async () => {
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "status",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () => null,
    },
  );
  assert.equal(response.status, 400);
  assert.match(response.body, /sheetId is required/);
});

test("POST /discovery-profile mode:skip_company removes skipped companies from stored targets", async () => {
  let mutations: Partial<StoredWorkerConfig> | null = null;
  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        event: DISCOVERY_PROFILE_EVENT,
        schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
        mode: "skip_company",
        skipCompanyKeys: ["notion", "figma"],
        sheetId: "sheet_abc123",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () =>
        ({
          sheetId: "sheet_abc123",
          mode: "hosted",
          timezone: "UTC",
          companies: [
            { name: "Notion", companyKey: "notion", normalizedName: "notion" },
            { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
          ],
          atsCompanies: [
            { name: "Figma", companyKey: "figma", normalizedName: "figma" },
          ],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["grounded_web"],
          schedule: { enabled: false, cron: "" },
          negativeCompanyKeys: ["acme"],
        }) as StoredWorkerConfig,
      upsertStoredWorkerConfig: async (_runtimeConfig, input) => {
        mutations = input.mutations;
        return {} as StoredWorkerConfig;
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(mutations?.negativeCompanyKeys, ["acme", "notion", "figma"]);
  assert.deepEqual(
    mutations?.companies?.map((company) => company.companyKey),
    ["ramp"],
  );
  assert.deepEqual(mutations?.atsCompanies, []);
});
