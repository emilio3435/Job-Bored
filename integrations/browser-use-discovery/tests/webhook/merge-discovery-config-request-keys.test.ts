import assert from "node:assert/strict";
import test from "node:test";

import { mergeDiscoveryConfig } from "../../src/config.ts";
import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryWebhookRequestV1,
  type StoredWorkerConfig,
} from "../../src/contracts.ts";

function makeStoredConfig(
  overrides: Partial<StoredWorkerConfig> & Record<string, unknown> = {},
): StoredWorkerConfig {
  return {
    sheetId: "sheet_r6",
    mode: "local",
    timezone: "America/Chicago",
    companies: [
      { name: "Notion", companyKey: "notion" },
      { name: "Ramp", companyKey: "ramp" },
    ],
    atsCompanies: [{ name: "Ashby", companyKey: "ashby" }],
    includeKeywords: ["AI"],
    excludeKeywords: [],
    targetRoles: ["Product Engineer"],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "",
    maxLeadsPerRun: 20,
    enabledSources: ["greenhouse", "grounded_web"],
    schedule: { enabled: false, cron: "0 7 * * 1-5" },
    discoveryProfile: { sourcePreset: "browser_plus_ats" },
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<DiscoveryWebhookRequestV1> = {},
): DiscoveryWebhookRequestV1 {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_r6",
    variationKey: "r6-request-keys",
    requestedAt: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

test("R6-DISC-REQ-01 request groundedWebEnabled overrides stored source routing", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig({ groundedWebEnabled: true }),
    makeRequest({ discoveryProfile: { groundedWebEnabled: false } }),
  );

  assert.deepEqual(result.effectiveSources, ["greenhouse"]);
});

test("R6-DISC-REQ-02 unknown allowlist fails closed by default", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig(),
    makeRequest({ companyAllowlist: ["unknown-company"] }),
  );

  assert.deepEqual(result.companies, []);
  assert.deepEqual(result.atsCompanies, []);
});

test("R6-DISC-REQ-03 explicit unrestricted fallback preserves stored company pools", () => {
  const result = mergeDiscoveryConfig(
    makeStoredConfig(),
    makeRequest({
      companyAllowlist: ["unknown-company"],
      allowUnrestrictedFallback: true,
    }),
  );

  assert.deepEqual(
    result.companies.map((company) => company.companyKey),
    ["notion", "ramp"],
  );
  assert.deepEqual(
    result.atsCompanies?.map((company) => company.companyKey),
    ["ashby"],
  );
});
