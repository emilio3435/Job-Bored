// HOLES HUNT-W §1: `hunt` and `scheduled-hunt` are discovery run triggers in
// the request schema AND contracts.ts, and every consumer keeps the label.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DISCOVERY_RUN_TRIGGERS,
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryRunLogRow,
} from "../../src/contracts.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

const SECRET = "hunt-trigger-secret";
const REQUESTED_AT = "2026-10-02T12:00:00.000Z";
const schema = JSON.parse(
  readFileSync(
    new URL("../../../../schemas/discovery-webhook-request.v1.schema.json", import.meta.url),
    "utf8",
  ),
);

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

function makeRequest(trigger: string) {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_hunt",
    variationKey: "hunt-var",
    requestedAt: REQUESTED_AT,
    trigger,
  };
}

function makeRunDependencies(logged: DiscoveryRunLogRow[]) {
  return {
    runtimeConfig: { webhookSecret: SECRET, runMode: "hosted", googleAccessToken: "" },
    sourceAdapterRegistry: { adapters: [], detectBoards: async () => [], collectListings: async () => [] },
    pipelineWriter: {
      write: async (sheetId: string) => ({
        sheetId, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [],
      }),
    },
    discoveryRunsLogger: {
      append: async (_sheetId: string, row: DiscoveryRunLogRow) => {
        logged.push(row);
        return { ok: true as const, created: false };
      },
    },
    loadStoredWorkerConfig: async (sheetId: string) => ({
      sheetId, mode: "hosted" as const, timezone: "UTC", companies: [{ name: "Acme" }],
      includeKeywords: [], excludeKeywords: [], targetRoles: ["Designer"], locations: [],
      remotePolicy: "", seniority: "", maxLeadsPerRun: 5, enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: Record<string, unknown>, request: Record<string, unknown>) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only" as const,
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date(REQUESTED_AT),
    randomId: (prefix: string) => `${prefix}_hunt_trigger`,
  };
}

test("HUNT-W: the request schema and DISCOVERY_RUN_TRIGGERS list the same triggers, hunt and scheduled-hunt included", () => {
  const schemaTriggers = [...schema.properties.trigger.enum].sort();
  assert.deepEqual(schemaTriggers, [...DISCOVERY_RUN_TRIGGERS].sort());
  assert.ok(schemaTriggers.includes("hunt"));
  assert.ok(schemaTriggers.includes("scheduled-hunt"));
});

test("HUNT-W: the DiscoveryRuns row records hunt and scheduled-hunt as sent", async () => {
  for (const [trigger, dispatcher] of [["hunt", "manual"], ["scheduled-hunt", "scheduled"]] as const) {
    const logged: DiscoveryRunLogRow[] = [];
    await runDiscovery(
      makeRequest(trigger) as never,
      dispatcher,
      makeRunDependencies(logged) as never,
    );
    assert.equal(logged.length, 1, `${trigger}: one DiscoveryRuns row`);
    assert.equal(logged[0].trigger, trigger);
  }
});

test("HUNT-W: POST /webhook accepts scheduled-hunt and dispatches it as a scheduled run", async () => {
  const dispatched: string[] = [];
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-discovery-secret": SECRET },
      bodyText: JSON.stringify(makeRequest("scheduled-hunt")),
    },
    {
      runSynchronously: true,
      async runDiscovery(request, trigger, deps) {
        dispatched.push(trigger);
        return runDiscovery(request, trigger, deps);
      },
      runDependencies: {
        ...makeRunDependencies([]),
        runtimeConfig: {
          webhookSecret: SECRET,
          runMode: "hosted",
          googleAccessToken: "hunt-trigger-token",
        },
      } as never,
      now: () => new Date(REQUESTED_AT),
    },
  );
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(dispatched, ["scheduled"]);
});
