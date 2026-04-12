import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadRuntimeConfig,
  loadStoredWorkerConfig,
  mergeDiscoveryConfig,
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
  assert.deepEqual(DEFAULT_ENABLED_SOURCE_IDS, [
    "greenhouse",
    "lever",
    "ashby",
    "grounded_web",
  ]);
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

  assert.deepEqual(result.enabledSources, [
    "greenhouse",
    "lever",
    "ashby",
    "grounded_web",
  ]);
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

test("resolveSourcePreset falls back to browser_only when only grounded_web is enabled", () => {
  const stored = makeStoredConfig({
    enabledSources: ["grounded_web"],
  });
  assert.equal(resolveSourcePreset(undefined, stored), "browser_only");
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
  assert.equal(resolveSourcePreset(undefined, stored), "browser_only");
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
  assert.equal(result.sourcePreset, "browser_only");
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
