import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

function makeRequest() {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_123",
    variationKey: "var_123",
    requestedAt: "2026-04-09T12:00:00.000Z",
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node,typescript",
      maxLeadsPerRun: "2",
    },
  };
}

test("runDiscovery composes config, adapters, normalizer, and writer", async () => {
  const calls = {
    loadStoredWorkerConfig: 0,
    mergeDiscoveryConfig: 0,
    detectBoards: 0,
    listJobs: 0,
    write: 0,
  };

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => {
            calls.listJobs += 1;
            return [
              {
                sourceId: "greenhouse",
                sourceLabel: "Greenhouse",
                title: "Senior Backend Engineer",
                company: "Acme",
                location: "Remote",
                url: "https://jobs.example.com/backend-engineer?utm_source=linkedin",
                compensationText: "$180k-$210k",
                contact: "",
                descriptionText:
                  "Build node services in TypeScript for a remote-first team.",
                tags: ["node", "typescript"],
                metadata: {
                  sourceQuery: "board",
                },
              },
            ];
          },
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }) => {
        calls.detectBoards += 1;
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId, leads) => {
        calls.write += 1;
        assert.equal(sheetId, "sheet_123");
        assert.equal(leads.length, 1);
        assert.equal(
          leads[0].url,
          "https://jobs.example.com/backend-engineer",
        );
        return {
          sheetId,
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: ["writer warning"],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => {
      calls.loadStoredWorkerConfig += 1;
      assert.equal(sheetId, "sheet_123");
      return {
        sheetId,
        mode: "hosted",
        timezone: "UTC",
        companies: [{ name: "Acme" }],
        includeKeywords: ["TypeScript"],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "remote-first",
        seniority: "senior",
        maxLeadsPerRun: 5,
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      };
    },
    mergeDiscoveryConfig: (stored, request) => {
      calls.mergeDiscoveryConfig += 1;
      return {
        ...stored,
        variationKey: request.variationKey,
        requestedAt: request.requestedAt,
        targetRoles: ["Backend Engineer"],
        includeKeywords: ["node", "typescript"],
        excludeKeywords: [],
        locations: ["Remote"],
        remotePolicy: "remote-first",
        seniority: "senior",
        maxLeadsPerRun: 2,
      };
    },
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_abc123`,
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(calls.loadStoredWorkerConfig, 1);
  assert.equal(calls.mergeDiscoveryConfig, 1);
  assert.equal(calls.detectBoards, 1);
  assert.equal(calls.listJobs, 1);
  assert.equal(calls.write, 1);
  assert.equal(result.run.runId, "run_abc123");
  assert.equal(result.run.trigger, "manual");
  assert.equal(result.run.config.variationKey, "var_123");
  assert.equal(result.run.config.requestedAt, "2026-04-09T12:00:00.000Z");
  assert.equal(result.lifecycle.state, "partial");
  assert.equal(result.lifecycle.normalizedLeadCount, 1);
  assert.equal(result.writeResult.appended, 1);
  assert.match(result.warnings.join(" | "), /writer warning/);
});
