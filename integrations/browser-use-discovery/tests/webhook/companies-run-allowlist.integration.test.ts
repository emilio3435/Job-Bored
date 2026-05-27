/**
 * End-to-end integration test for the per-run company picker.
 *
 * Contract: docs/INTERFACE-COMPANY-ALLOWLIST.md §§2–3, §6.
 *
 * Unit-level semantics (merge intersection, negative-list precedence,
 * unknown-key drop, validation rejection codes) are already covered by
 * the backend workspace's tests in:
 *   - tests/webhook/config.test.ts           (mergeDiscoveryConfig cases)
 *   - tests/webhook/handle-discovery-webhook.test.ts  (400 rejection cases)
 *
 * What was NOT covered by those unit tests: the *wiring* from
 * POST /discovery handler → request payload → runDiscovery dispatch →
 * mergeDiscoveryConfig result. If a future refactor forgets to pass
 * `companyAllowlist` from the parsed request into the run dependencies,
 * the unit tests still pass (they call mergeDiscoveryConfig directly)
 * but the end-to-end behavior silently breaks. That's the regression
 * this test guards against.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

const SECRET = "integration-proof-xyz789";

function createMemoryRunStatusStore() {
  const states: any[] = [];
  return {
    states,
    put(payload: any) {
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId: string) {
      for (let i = states.length - 1; i >= 0; i -= 1) {
        if (states[i].runId === runId) return states[i];
      }
      return null;
    },
    close() {},
  };
}

function baseRuntimeConfig() {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "",
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "oauth-proof-123",
    webhookSecret: SECRET,
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1" as const,
    runMode: "hosted" as const,
    asyncAckByDefault: true,
    useStructuredExtraction: false,
  };
}

function baseRun() {
  return {
    run: {
      runId: "run_int",
      trigger: "manual" as const,
      request: {
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_int",
        variationKey: "var_int",
        requestedAt: "2026-04-23T00:00:00.000Z",
      },
      config: {
        sheetId: "sheet_int",
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
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
        variationKey: "var_int",
        requestedAt: "2026-04-23T00:00:00.000Z",
      },
    },
    lifecycle: {
      runId: "run_int",
      trigger: "manual" as const,
      startedAt: "2026-04-23T00:00:00.000Z",
      completedAt: "2026-04-23T00:00:01.000Z",
      state: "completed" as const,
      companyCount: 0,
      detectionCount: 0,
      listingCount: 0,
      normalizedLeadCount: 0,
    },
    extractionResults: [],
    sourceSummary: [],
    writeResult: {
      sheetId: "sheet_int",
      appended: 0,
      updated: 0,
      skippedDuplicates: 0,
      skippedBlacklist: 0,
      warnings: [],
    },
    warnings: [],
  };
}

test("POST /discovery wires companyAllowlist → runDiscovery → mergeDiscoveryConfig intersects active+history and honors negative list", async () => {
  // Capture the EffectiveDiscoveryConfig the real worker would run with,
  // computed by the real mergeDiscoveryConfig (not a test stub). This
  // proves: (a) parser accepted the payload; (b) handler forwarded
  // companyAllowlist into the request passed to runDiscovery; (c) the
  // run dependencies wired the real merge function; (d) merge applied
  // allowlist ∩ (active ∪ history) with negative-list precedence.
  let capturedCompanies: string[] | null = null;
  let capturedRequest: any = null;
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = {
    runSynchronously: true,
    asyncPollAfterMs: 2000,
    runStatusPathForRun: (runId: string) => `/runs/${runId}`,
    runStatusStore,
    runDiscovery: async (request: any, _trigger: any, runDeps: any) => {
      capturedRequest = request;
      const stored = await runDeps.loadStoredWorkerConfig(request.sheetId);
      const merged = runDeps.mergeDiscoveryConfig(stored, request);
      capturedCompanies = merged.companies.map((c: any) => c.companyKey);
      return baseRun();
    },
    runDependencies: {
      runtimeConfig: baseRuntimeConfig(),
      sourceAdapterRegistry: {
        adapters: [],
        detectBoards: async () => [],
        collectListings: async () => [],
      },
      pipelineWriter: {
        write: async () => ({
          sheetId: "sheet_int",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        }),
      },
      loadStoredWorkerConfig: async () => ({
        sheetId: "sheet_int",
        mode: "hosted" as const,
        timezone: "UTC",
        companies: [
          { name: "Notion", companyKey: "notion", normalizedName: "notion" },
          { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
        ],
        companyHistory: [
          { name: "Figma", companyKey: "figma", normalizedName: "figma" },
          { name: "Airtable", companyKey: "airtable", normalizedName: "airtable" },
        ],
        negativeCompanyKeys: ["airtable"],
        includeKeywords: [],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "",
        seniority: "",
        maxLeadsPerRun: 25,
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      }),
      mergeDiscoveryConfig, // real function, not a stub
      now: () => new Date("2026-04-23T00:00:00.000Z"),
    },
  };

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SECRET,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_int",
        variationKey: "var_int",
        requestedAt: "2026-04-23T00:00:00.000Z",
        // "airtable" is in the allowlist AND in negativeCompanyKeys — it
        // MUST be dropped (eliminated companies stay eliminated).
        // "figma" is in history only — should surface in the run.
        // "notion" is in active — should surface in the run.
        // "unknown" isn't in stored state — silently dropped.
        companyAllowlist: ["notion", "figma", "airtable", "unknown"],
      }),
    },
    dependencies as any,
  );

  assert.equal(response.status, 200, `handler rejected valid payload: ${response.body}`);
  assert.ok(capturedRequest !== null, "runDiscovery was never invoked");
  assert.deepEqual(
    capturedRequest.companyAllowlist?.sort(),
    ["airtable", "figma", "notion", "unknown"],
    "companyAllowlist did not reach runDiscovery in normalized form",
  );
  assert.ok(capturedCompanies !== null, "merge did not run inside runDiscovery");
  assert.deepEqual(
    (capturedCompanies ?? []).sort(),
    ["figma", "notion"],
    "effective companies should be allowlist ∩ (active ∪ history) minus skipped; airtable+unknown must be absent",
  );
});

test("POST /discovery without companyAllowlist preserves pre-feature behavior", async () => {
  // Regression guard: when the field is absent, the merge should treat
  // the run identically to how it behaved before the feature shipped —
  // i.e. just the active list (history and allowlist logic both dormant).
  let capturedCompanies: string[] | null = null;
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = {
    runSynchronously: true,
    asyncPollAfterMs: 2000,
    runStatusPathForRun: (runId: string) => `/runs/${runId}`,
    runStatusStore,
    runDiscovery: async (request: any, _trigger: any, runDeps: any) => {
      const stored = await runDeps.loadStoredWorkerConfig(request.sheetId);
      const merged = runDeps.mergeDiscoveryConfig(stored, request);
      capturedCompanies = merged.companies.map((c: any) => c.companyKey);
      return baseRun();
    },
    runDependencies: {
      runtimeConfig: baseRuntimeConfig(),
      sourceAdapterRegistry: {
        adapters: [],
        detectBoards: async () => [],
        collectListings: async () => [],
      },
      pipelineWriter: {
        write: async () => ({
          sheetId: "sheet_int",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        }),
      },
      loadStoredWorkerConfig: async () => ({
        sheetId: "sheet_int",
        mode: "hosted" as const,
        timezone: "UTC",
        companies: [
          { name: "Notion", companyKey: "notion", normalizedName: "notion" },
          { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
        ],
        companyHistory: [
          { name: "Figma", companyKey: "figma", normalizedName: "figma" },
        ],
        negativeCompanyKeys: [],
        includeKeywords: [],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "",
        seniority: "",
        maxLeadsPerRun: 25,
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      }),
      mergeDiscoveryConfig,
      now: () => new Date("2026-04-23T00:00:00.000Z"),
    },
  };

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SECRET,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_int",
        variationKey: "var_int",
        requestedAt: "2026-04-23T00:00:00.000Z",
        // companyAllowlist intentionally omitted.
      }),
    },
    dependencies as any,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (capturedCompanies ?? []).sort(),
    ["notion", "ramp"],
    "absent allowlist should leave active companies intact and NOT pull in history",
  );
});
