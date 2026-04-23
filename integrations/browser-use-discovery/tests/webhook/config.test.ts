import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadRuntimeConfig,
  loadStoredWorkerConfig,
  mergeDiscoveryConfig,
  resolveBrowserUseCommand,
  resolveSourcePreset,
} from "../../src/config.ts";
import {
  DEFAULT_ENABLED_SOURCE_IDS,
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_123",
    variationKey: "var_123",
    requestedAt: "2026-04-10T03:00:00.000Z",
    ...overrides,
  };
}

function makeStoredConfig(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

test("default enabled sources include grounded_web", () => {
  assert.ok(
    DEFAULT_ENABLED_SOURCE_IDS.includes("grounded_web"),
    "grounded_web should remain enabled by default",
  );
  assert.ok(
    DEFAULT_ENABLED_SOURCE_IDS.includes("greenhouse"),
    "greenhouse should remain enabled by default",
  );
  assert.ok(
    DEFAULT_ENABLED_SOURCE_IDS.includes("personio"),
    "expanded ATS providers should be enabled by default",
  );
});

test("loadRuntimeConfig defaults local workers to localhost browser origins", () => {
  const result = loadRuntimeConfig({
    BROWSER_USE_DISCOVERY_RUN_MODE: "local",
  });

  assert.deepEqual(result.allowedOrigins, [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ]);
});

test("loadRuntimeConfig fails closed for hosted workers without explicit browser origins", () => {
  const result = loadRuntimeConfig({
    BROWSER_USE_DISCOVERY_RUN_MODE: "hosted",
  });

  assert.deepEqual(result.allowedOrigins, []);
});

test("resolveBrowserUseCommand prefers explicit env over bundled fallback", () => {
  const result = resolveBrowserUseCommand(
    {
      BROWSER_USE_DISCOVERY_BROWSER_COMMAND: "custom-browser-use",
    },
    () => true,
  );

  assert.equal(result, "custom-browser-use");
});

test("resolveBrowserUseCommand uses bundled wrapper when env is unset and script exists", () => {
  const result = resolveBrowserUseCommand({}, (pathname) =>
    pathname.endsWith("bin/browser-use-agent-browser.mjs")
  );

  assert.match(result, /bin\/browser-use-agent-browser\.mjs$/);
});

test("resolveBrowserUseCommand falls back to browser-use when env is unset and wrapper is absent", () => {
  const result = resolveBrowserUseCommand({}, () => false);

  assert.equal(result, "browser-use");
});

test("loadRuntimeConfig loads discovery env file values and lets explicit env win", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "discovery-env-file-"));
  const envPath = join(tempDir, ".env");
  try {
    await writeFile(
      envPath,
      [
        "BROWSER_USE_DISCOVERY_RUN_MODE=local",
        "BROWSER_USE_DISCOVERY_GEMINI_API_KEY=file-gemini-key",
        "BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN=file-google-token",
      ].join("\n"),
      "utf8",
    );

    const result = loadRuntimeConfig({
      BROWSER_USE_DISCOVERY_ENV_FILE: envPath,
      BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN: "override-google-token",
    });

    assert.equal(result.runMode, "local");
    assert.equal(result.geminiApiKey, "file-gemini-key");
    assert.equal(result.googleAccessToken, "override-google-token");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mergeDiscoveryConfig auto-enables grounded_web for legacy ATS-only configs", () => {
  const result = mergeDiscoveryConfig(makeStoredConfig() as any, makeRequest());

  assert.deepEqual(result.enabledSources, [
    "greenhouse",
    "ashby",
    "grounded_web",
  ]);
});

test("mergeDiscoveryConfig respects explicit groundedWebEnabled=false opt-out", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      groundedWebEnabled: false,
    }) as any,
    makeRequest(),
  );

  assert.deepEqual(result.enabledSources, ["greenhouse", "ashby"]);
});

test("loadStoredWorkerConfig falls back to defaults with grounded_web enabled", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "discovery-config-"));
  const configPath = join(tempDir, "worker-config.json");
  await writeFile(configPath, JSON.stringify({}), "utf8");

  const result = await loadStoredWorkerConfig(
    {
      stateDatabasePath: join(tempDir, "state.sqlite"),
      workerConfigPath: configPath,
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
      webhookSecret: "",
      allowedOrigins: ["http://localhost:8080"],
      port: 8644,
      host: "127.0.0.1",
      runMode: "local",
      asyncAckByDefault: true,
    },
    "sheet_123",
  );

  assert.deepEqual(result.enabledSources, DEFAULT_ENABLED_SOURCE_IDS);
  assert.deepEqual(
    (result.atsCompanies || []).map((company) => company.name),
    ["Scale AI", "Figma", "Notion"],
  );
  assert.deepEqual(result.companies, []);
});

test("loadStoredWorkerConfig reuses configured companies as ATS seeds when atsCompanies is omitted", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "discovery-config-"));
  const configPath = join(tempDir, "worker-config.json");
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        companies: [{ name: "Acme AI" }, { name: "Stripe" }],
      }),
      "utf8",
    );

    const result = await loadStoredWorkerConfig(
      {
        stateDatabasePath: join(tempDir, "state.sqlite"),
        workerConfigPath: configPath,
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
        webhookSecret: "",
        allowedOrigins: ["http://localhost:8080"],
        port: 8644,
        host: "127.0.0.1",
        runMode: "local",
        asyncAckByDefault: true,
      },
      "sheet_123",
    );

    assert.deepEqual(
      (result.atsCompanies || []).map((company) => company.name),
      ["Acme AI", "Stripe"],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mergeDiscoveryConfig preserves ATS companies separately from broad company scope", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [],
      atsCompanies: [{ name: "Scale AI" }, { name: "Figma" }],
    }) as any,
    makeRequest(),
  );

  assert.deepEqual(result.companies, []);
  assert.deepEqual(
    (result.atsCompanies || []).map((company) => company.name),
    ["Scale AI", "Figma"],
  );
});

test("mergeDiscoveryConfig excludes skipped companies from run targets", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [
        { name: "Scale AI", companyKey: "scale-ai" },
        { name: "Figma", companyKey: "figma" },
        { name: "Ramp", companyKey: "ramp" },
      ],
      atsCompanies: [
        { name: "Notion", companyKey: "notion" },
        { name: "Ashby", companyKey: "ashby" },
      ],
      negativeCompanyKeys: ["scale-ai", "figma", "notion"],
    }) as any,
    makeRequest(),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["ramp"],
  );
  assert.deepEqual(
    (result.atsCompanies || []).map((company) => company.companyKey),
    ["ashby"],
  );
});

test("mergeDiscoveryConfig applies companyAllowlist across active companies plus history", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [
        { name: "Notion", companyKey: "notion", normalizedName: "notion" },
        { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
      ],
      companyHistory: [
        { name: "Figma", companyKey: "figma", normalizedName: "figma" },
      ],
    }) as any,
    makeRequest({
      companyAllowlist: ["notion", "figma"],
    }),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["notion", "figma"],
  );
});

test("mergeDiscoveryConfig companyAllowlist does not override negativeCompanyKeys", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [
        { name: "Notion", companyKey: "notion", normalizedName: "notion" },
        { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
      ],
      companyHistory: [
        { name: "Figma", companyKey: "figma", normalizedName: "figma" },
      ],
      negativeCompanyKeys: ["figma"],
    }) as any,
    makeRequest({
      companyAllowlist: ["notion", "figma"],
    }),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["notion"],
  );
});

test("mergeDiscoveryConfig drops unknown companyAllowlist keys silently", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [
        { name: "Notion", companyKey: "notion", normalizedName: "notion" },
        { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
      ],
      companyHistory: [
        { name: "Figma", companyKey: "figma", normalizedName: "figma" },
      ],
    }) as any,
    makeRequest({
      companyAllowlist: ["notion", "unknown-company"],
    }),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["notion"],
  );
});

test("mergeDiscoveryConfig treats empty companyAllowlist as a no-op", () => {
  const stored = makeStoredConfig({
    companies: [
      { name: "Notion", companyKey: "notion", normalizedName: "notion" },
      { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
    ],
    companyHistory: [
      { name: "Figma", companyKey: "figma", normalizedName: "figma" },
    ],
  }) as any;
  const baseline = mergeDiscoveryConfig(stored, makeRequest());
  const withEmptyAllowlist = mergeDiscoveryConfig(
    stored,
    makeRequest({ companyAllowlist: [] }),
  );

  assert.deepEqual(withEmptyAllowlist.companies, baseline.companies);
  assert.deepEqual(withEmptyAllowlist.atsCompanies, baseline.atsCompanies);
});

test("mergeDiscoveryConfig missing companyAllowlist preserves baseline behavior", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      companies: [
        { name: "Notion", companyKey: "notion", normalizedName: "notion" },
        { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
      ],
      companyHistory: [
        { name: "Figma", companyKey: "figma", normalizedName: "figma" },
      ],
    }) as any,
    makeRequest(),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["notion", "ramp"],
  );
});

// === resolveSourcePreset fallback truth table (VAL-API-006) ===

test("resolveSourcePreset uses request-level preset when provided", () => {
  const stored = makeStoredConfig();
  assert.equal(
    resolveSourcePreset("browser_only", stored),
    "browser_only",
  );
  assert.equal(
    resolveSourcePreset("ats_only", stored),
    "ats_only",
  );
  assert.equal(
    resolveSourcePreset("browser_plus_ats", stored),
    "browser_plus_ats",
  );
});

test("resolveSourcePreset uses stored discoveryProfile.sourcePreset when request omits preset", () => {
  const stored = makeStoredConfig({
    discoveryProfile: { sourcePreset: "ats_only" },
  });
  assert.equal(resolveSourcePreset(undefined, stored), "ats_only");
  assert.equal(resolveSourcePreset(null, stored), "ats_only");
});

test("resolveSourcePreset falls back to browser_plus_ats when no stored preset and mixed sources", () => {
  const stored = makeStoredConfig({
    enabledSources: ["greenhouse", "grounded_web"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "browser_plus_ats");
});

test("resolveSourcePreset falls back to browser_plus_ats when only grounded_web is enabled", () => {
  const stored = makeStoredConfig({
    enabledSources: ["grounded_web"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "browser_plus_ats");
});

test("resolveSourcePreset falls back to ats_only when only ATS lanes are enabled", () => {
  const stored = makeStoredConfig({
    enabledSources: ["greenhouse", "lever"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "ats_only");
});

test("resolveSourcePreset falls back to browser_plus_ats for default enabled sources", () => {
  const stored = makeStoredConfig({
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "browser_plus_ats");
});

test("resolveSourcePreset ignores invalid stored preset and falls back to source inference", () => {
  const stored = makeStoredConfig({
    discoveryProfile: { sourcePreset: "not_a_real_preset" },
    enabledSources: ["grounded_web"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "browser_plus_ats");
});

// === mergeDiscoveryConfig includes resolved sourcePreset (VAL-API-005, VAL-API-006) ===

test("mergeDiscoveryConfig includes resolved sourcePreset from request", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_only" },
    }),
  );
  assert.equal(result.sourcePreset, "browser_only");
});

test("mergeDiscoveryConfig resolves sourcePreset from stored config when request omits it", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      discoveryProfile: { sourcePreset: "ats_only" },
    }) as any,
    makeRequest(),
  );
  assert.equal(result.sourcePreset, "ats_only");
});

test("mergeDiscoveryConfig resolves sourcePreset from enabledSources fallback when no stored preset", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      enabledSources: ["grounded_web"],
    }) as any,
    makeRequest(),
  );
  assert.equal(result.sourcePreset, "browser_plus_ats");
});

test("mergeDiscoveryConfig resolves browser_plus_ats for mixed default sources", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      enabledSources: ["greenhouse", "grounded_web"],
    }) as any,
    makeRequest(),
  );
  assert.equal(result.sourcePreset, "browser_plus_ats");
});

test("mergeDiscoveryConfig request preset overrides stored preset", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({
      discoveryProfile: { sourcePreset: "ats_only" },
    }) as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_only" },
    }),
  );
  assert.equal(result.sourcePreset, "browser_only");
});

// === VAL-API-001: browser_only applies elevated agentic defaults when tuning fields are omitted ===

test("VAL-API-001: browser_only resolves elevated groundedSearchTuning defaults when omitted", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Senior Engineer" },
    }),
  );
  // browser_only should use elevated defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 12, "maxResultsPerCompany should be 12 for browser_only");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 8, "maxPagesPerCompany should be 8 for browser_only");
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, 300000, "maxRuntimeMs should be 300000 for browser_only");
  assert.equal(result.groundedSearchTuning.maxTokensPerQuery, 4096, "maxTokensPerQuery should be 4096 for browser_only");
});

test("VAL-API-001: browser_only resolves enabled ultraPlanTuning flags when omitted", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Senior Engineer" },
    }),
  );
  // browser_only should have all agentic flags enabled
  assert.equal(result.ultraPlanTuning.multiQueryEnabled, true, "multiQueryEnabled should be true for browser_only");
  assert.equal(result.ultraPlanTuning.retryBroadeningEnabled, true, "retryBroadeningEnabled should be true for browser_only");
  assert.equal(result.ultraPlanTuning.parallelCompanyProcessingEnabled, true, "parallelCompanyProcessingEnabled should be true for browser_only");
});

test("VAL-API-001: ats_only resolves legacy groundedSearchTuning defaults when omitted", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Senior Engineer" },
    }),
  );
  // ats_only should use legacy defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 6, "maxResultsPerCompany should be 6 for ats_only");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 4, "maxPagesPerCompany should be 4 for ats_only");
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, 180000, "maxRuntimeMs should be 180000 for ats_only");
  assert.equal(result.groundedSearchTuning.maxTokensPerQuery, 2048, "maxTokensPerQuery should be 2048 for ats_only");
});

test("VAL-API-001: ats_only resolves disabled ultraPlanTuning flags when omitted", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Senior Engineer" },
    }),
  );
  // ats_only should have all agentic flags disabled
  assert.equal(result.ultraPlanTuning.multiQueryEnabled, false, "multiQueryEnabled should be false for ats_only");
  assert.equal(result.ultraPlanTuning.retryBroadeningEnabled, false, "retryBroadeningEnabled should be false for ats_only");
  assert.equal(result.ultraPlanTuning.parallelCompanyProcessingEnabled, false, "parallelCompanyProcessingEnabled should be false for ats_only");
});

// === VAL-API-002: explicit browser_only tuning overrides are preserved exactly ===

test("VAL-API-002: explicit groundedSearchTuning override is preserved exactly", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        groundedSearchTuning: {
          maxResultsPerCompany: 20,
          maxPagesPerCompany: 15,
        },
      },
    }),
  );
  // Explicit overrides should be preserved
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 20, "explicit maxResultsPerCompany override should be preserved");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 15, "explicit maxPagesPerCompany override should be preserved");
  // Non-overridden fields should still use browser_only defaults
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, 300000, "non-overridden maxRuntimeMs should use browser_only default");
  assert.equal(result.groundedSearchTuning.maxTokensPerQuery, 4096, "non-overridden maxTokensPerQuery should use browser_only default");
});

test("VAL-API-002: explicit ultraPlanTuning override is preserved exactly", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        ultraPlanTuning: {
          multiQueryEnabled: false,
        },
      },
    }),
  );
  // Explicit override should be preserved
  assert.equal(result.ultraPlanTuning.multiQueryEnabled, false, "explicit multiQueryEnabled override should be preserved");
  // Non-overridden flags should still use browser_only defaults
  assert.equal(result.ultraPlanTuning.retryBroadeningEnabled, true, "non-overridden retryBroadeningEnabled should use browser_only default");
  assert.equal(result.ultraPlanTuning.parallelCompanyProcessingEnabled, true, "non-overridden parallelCompanyProcessingEnabled should use browser_only default");
});

test("VAL-API-002: partial groundedSearchTuning override preserves siblings correctly", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        groundedSearchTuning: {
          maxRuntimeMs: 120000,
        },
      },
    }),
  );
  // Only maxRuntimeMs should be overridden
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, 120000, "explicit maxRuntimeMs override should be preserved");
  // Other fields should use browser_only defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 12, "non-overridden maxResultsPerCompany should use browser_only default");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 8, "non-overridden maxPagesPerCompany should use browser_only default");
  assert.equal(result.groundedSearchTuning.maxTokensPerQuery, 4096, "non-overridden maxTokensPerQuery should use browser_only default");
});

// === VAL-API-003: multi-query, retry, and parallel flags are independently togglable ===

test("VAL-API-003: each ultraPlanTuning flag can be independently disabled", () => {
  // Variant 1: disable multiQuery only
  const result1 = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        ultraPlanTuning: { multiQueryEnabled: false },
      },
    }),
  );
  assert.equal(result1.ultraPlanTuning.multiQueryEnabled, false);
  assert.equal(result1.ultraPlanTuning.retryBroadeningEnabled, true);
  assert.equal(result1.ultraPlanTuning.parallelCompanyProcessingEnabled, true);

  // Variant 2: disable retryBroadening only
  const result2 = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        ultraPlanTuning: { retryBroadeningEnabled: false },
      },
    }),
  );
  assert.equal(result2.ultraPlanTuning.multiQueryEnabled, true);
  assert.equal(result2.ultraPlanTuning.retryBroadeningEnabled, false);
  assert.equal(result2.ultraPlanTuning.parallelCompanyProcessingEnabled, true);

  // Variant 3: disable parallelCompanyProcessing only
  const result3 = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        ultraPlanTuning: { parallelCompanyProcessingEnabled: false },
      },
    }),
  );
  assert.equal(result3.ultraPlanTuning.multiQueryEnabled, true);
  assert.equal(result3.ultraPlanTuning.retryBroadeningEnabled, true);
  assert.equal(result3.ultraPlanTuning.parallelCompanyProcessingEnabled, false);
});

// === VAL-API-005: browser_only uplift defaults do not leak into other presets ===

test("VAL-API-005: browser_plus_ats does not get browser_only uplift defaults", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Senior Engineer" },
    }),
  );
  // browser_plus_ats should use legacy defaults, not browser_only uplift defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 6, "browser_plus_ats should use legacy maxResultsPerCompany=6");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 4, "browser_plus_ats should use legacy maxPagesPerCompany=4");
  assert.equal(result.ultraPlanTuning.multiQueryEnabled, false, "browser_plus_ats should have multiQueryEnabled=false");
  assert.equal(result.ultraPlanTuning.retryBroadeningEnabled, false, "browser_plus_ats should have retryBroadeningEnabled=false");
});

test("VAL-API-005: ats_only does not get browser_only uplift defaults", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Senior Engineer" },
    }),
  );
  // ats_only should use legacy defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 6, "ats_only should use legacy maxResultsPerCompany=6");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 4, "ats_only should use legacy maxPagesPerCompany=4");
  assert.equal(result.ultraPlanTuning.multiQueryEnabled, false, "ats_only should have multiQueryEnabled=false");
  assert.equal(result.ultraPlanTuning.retryBroadeningEnabled, false, "ats_only should have retryBroadeningEnabled=false");
});

// === VAL-API-006: browser_only timeout default is uplifted above 60000ms while explicit override is preserved ===

test("VAL-API-006: omitted browser_only maxRuntimeMs defaults to > 60000ms", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Senior Engineer" },
    }),
  );
  // VAL-API-006: omitted timeout must be strictly greater than 60000ms
  assert.ok(result.groundedSearchTuning.maxRuntimeMs > 60000, "omitted maxRuntimeMs must be > 60000ms for browser_only");
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, 300000, "omitted maxRuntimeMs should be 300000ms for browser_only");
});

test("VAL-API-006: explicit maxRuntimeMs override is preserved exactly", () => {
  const explicitTimeout = 180000;
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        groundedSearchTuning: { maxRuntimeMs: explicitTimeout },
      },
    }),
  );
  // VAL-API-006: explicit override must be preserved exactly
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, explicitTimeout, "explicit maxRuntimeMs override should be preserved exactly");
  // Sibling fields should still use browser_only defaults
  assert.equal(result.groundedSearchTuning.maxResultsPerCompany, 12, "non-overridden maxResultsPerCompany should use browser_only default");
  assert.equal(result.groundedSearchTuning.maxPagesPerCompany, 8, "non-overridden maxPagesPerCompany should use browser_only default");
});

test("VAL-API-006: explicit override can be lower than uplift default", () => {
  // Explicit override of 30000 is lower than the uplifted default of 300000
  const explicitTimeout = 30000;
  const result = mergeDiscoveryConfig(
    makeStoredConfig() as any,
    makeRequest({
      discoveryProfile: {
        sourcePreset: "browser_only",
        targetRoles: "Senior Engineer",
        groundedSearchTuning: { maxRuntimeMs: explicitTimeout },
      },
    }),
  );
  // VAL-API-006: explicit override must be preserved exactly even when lower than default
  assert.equal(result.groundedSearchTuning.maxRuntimeMs, explicitTimeout, "explicit maxRuntimeMs override lower than default should be preserved");
});
