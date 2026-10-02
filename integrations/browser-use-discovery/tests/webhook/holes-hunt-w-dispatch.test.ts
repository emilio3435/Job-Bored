// HOLES HUNT-W: how a hunt run reaches the /webhook pipeline
// (docs/INTERFACE-HUNTS.md §4.3) and the §0.9 "awaiting sheet write" flow (§5).
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryWebhookRequestV1,
  type NormalizedLead,
} from "../../src/contracts.ts";
import { createHuntRunDispatcher } from "../../src/webhook/handle-hunts.ts";
import {
  deriveIdempotentRunId,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";
import { createDiscoveryRunStatusStore } from "../../src/state/run-status-store.ts";
import type { HuntRecord } from "../../src/state/hunt-store.ts";

const SECRET = "hunt-dispatch-secret";
const NOW = "2026-10-02T13:00:30.000Z";

const HUNT: HuntRecord = {
  id: "hunt_0123456789abcdef0123456789abcdef",
  name: "Designer",
  status: "active",
  searchPlan: {
    planVersion: 1,
    generatedAt: "2026-10-01T08:00:00.000Z",
    seed: "seed-a",
    trigger: "manual",
    facets: { roles: ["Product Designer"], locations: ["Remote"] },
    query: { targetRoles: "Product Designer", locations: "Remote", keywordsInclude: "Figma", sourcePreset: "browser_plus_ats" },
  },
  tweaks: { locations: "Austin" },
  explorationShare: 0.45,
  schedule: { kind: "daily", hour: 8, minute: 0 },
  timezone: "America/Chicago",
  sheetId: "sheet_hunt",
  sourceRunId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  nextRunAt: "2026-10-02T13:00:00.000Z",
  queuedAt: null,
  queuedTrigger: null,
  lastRunAt: null,
  lastRunId: null,
  lastError: null,
};

const NO_CREDENTIAL = {
  webhookSecret: SECRET,
  runMode: "local" as const,
  googleAccessToken: "",
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleOAuthTokenJson: "",
  googleOAuthTokenFile: "",
};

const lead = { title: "Product Designer", company: "Acme", url: "https://example.com/jobs/1" } as unknown as NormalizedLead;

/** A webhook handler whose run finds one lead and cannot write it (no credential). */
function webhookDependencies(options: { allowMissingSheetsCredential?: boolean; seen?: Array<{ request: DiscoveryWebhookRequestV1; trigger: string }> }) {
  const runStatusStore = createDiscoveryRunStatusStore(":memory:");
  return {
    runStatusStore,
    dependencies: {
      runSynchronously: true,
      runStatusStore,
      ...(options.allowMissingSheetsCredential ? { allowMissingSheetsCredential: true } : {}),
      now: () => new Date(NOW),
      async runDiscovery(request: DiscoveryWebhookRequestV1, trigger: "manual" | "scheduled", deps: { runId?: string; checkpointSelectedLeads?(sheetId: string, leads: NormalizedLead[]): void }) {
        options.seen?.push({ request, trigger });
        deps.checkpointSelectedLeads?.(request.sheetId, [lead]);
        const message = "No Google Sheets credential available for the discovery worker.";
        return {
          run: { runId: deps.runId, trigger, request, config: { sheetId: request.sheetId, searchPlan: request.discoveryProfile?.searchPlan } },
          lifecycle: {
            runId: deps.runId, trigger, startedAt: NOW, completedAt: NOW, state: "partial",
            companyCount: 1, detectionCount: 1, listingCount: 1, normalizedLeadCount: 1,
          },
          extractionResults: [],
          sourceSummary: [],
          writeResult: {
            sheetId: request.sheetId, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0,
            warnings: [`Sheet write failed during token phase: ${message}`],
            writeError: { phase: "token", message },
          },
          warnings: [],
        };
      },
      runDependencies: {
        runtimeConfig: NO_CREDENTIAL,
        loadStoredWorkerConfig: async (sheetId: string) => ({ sheetId, companies: [{ name: "Acme" }], enabledSources: ["greenhouse"] }),
        mergeDiscoveryConfig: (stored: Record<string, unknown>, request: Record<string, unknown>) => ({
          ...stored, companies: [{ name: "Acme" }], atsCompanies: [],
          variationKey: request.variationKey, requestedAt: request.requestedAt,
        }),
        now: () => new Date(NOW),
      },
    },
  };
}

test("HUNT-W: a hunt run posts its tweaked plan, trigger and slot key to the /webhook handler", async () => {
  const requests: Array<{ headers: Record<string, unknown>; bodyText: string }> = [];
  const shares = new Map<string, number>();
  const expectedRunId = deriveIdempotentRunId({ sheetId: "sheet_hunt", idempotencyKey: `hunt:${HUNT.id}:2026-10-02T13:00:00.000Z` });
  const dispatch = createHuntRunDispatcher({
    webhookSecret: SECRET,
    now: () => new Date(NOW),
    async handleDiscovery(request) {
      requests.push(request);
      return {
        status: 202,
        headers: {},
        body: JSON.stringify({ ok: true, kind: "accepted_async", runId: expectedRunId, statusPath: `/runs/${expectedRunId}`, pollAfterMs: 2000, message: "accepted" }),
      };
    },
    rememberRunShare: (runId, share) => shares.set(runId, share),
  });

  const outcome = await dispatch(HUNT, "scheduled-hunt", { slotAt: "2026-10-02T13:00:00.000Z" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 202);
  assert.equal(outcome.runId, expectedRunId);
  assert.equal(shares.get(expectedRunId), 0.45, "the hunt's share is keyed by the run id the handler derives");

  assert.equal(requests[0].headers["x-discovery-secret"], SECRET);
  const body = JSON.parse(requests[0].bodyText);
  assert.equal(body.event, DISCOVERY_WEBHOOK_EVENT);
  assert.equal(body.schemaVersion, DISCOVERY_WEBHOOK_SCHEMA_VERSION);
  assert.equal(body.sheetId, "sheet_hunt");
  assert.equal(body.trigger, "scheduled-hunt");
  assert.equal(body.idempotencyKey, `hunt:${HUNT.id}:2026-10-02T13:00:00.000Z`);
  assert.equal(body.variationKey, `hunt-${HUNT.id}-202610021300`);
  assert.equal(body.requestedAt, NOW);
  assert.equal(body.discoveryProfile.locations, "Austin");
  assert.equal(body.discoveryProfile.targetRoles, "Product Designer");
  assert.equal(body.discoveryProfile.sourcePreset, "browser_plus_ats");
  assert.equal(body.discoveryProfile.searchPlan.query.locations, "Austin");
  assert.deepEqual(body.discoveryProfile.searchPlan.facets.locations, ["Austin"]);
  assert.equal(body.discoveryProfile.searchPlan.generatedAt, NOW);
  assert.equal(body.discoveryProfile.searchPlan.trigger, "scheduled-hunt");
  assert.equal("googleAccessToken" in body, false);
  assert.equal("hunt" in body, false, "the /webhook request carries no hunt reference");
});

test("HUNT-W: run-now carries the caller's token and a click-unique key; a refusal is not ok", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const dispatch = createHuntRunDispatcher({
    webhookSecret: SECRET,
    now: () => new Date(NOW),
    async handleDiscovery(request) {
      bodies.push(JSON.parse(request.bodyText));
      return { status: 400, headers: {}, body: JSON.stringify({ ok: false, message: "Discovery intent cannot be blank." }) };
    },
  });
  const outcome = await dispatch(HUNT, "hunt", { googleAccessToken: "ya29.example-token" });
  assert.equal(bodies[0].trigger, "hunt");
  assert.equal(bodies[0].idempotencyKey, `hunt:${HUNT.id}:now:${NOW}`);
  assert.equal(bodies[0].googleAccessToken, "ya29.example-token");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 400);
  assert.equal(outcome.message, "Discovery intent cannot be blank.");
});

test("HUNT-W: a dispatch that finds a live run reports busy and posts nothing", async () => {
  let posted = 0;
  const dispatch = createHuntRunDispatcher({
    webhookSecret: SECRET,
    now: () => new Date(NOW),
    isRunActive: () => true,
    async handleDiscovery() {
      posted += 1;
      return { status: 202, headers: {}, body: "{}" };
    },
  });
  const outcome = await dispatch(HUNT, "scheduled-hunt");
  assert.equal(outcome.busy, true);
  assert.equal(outcome.ok, false);
  assert.equal(posted, 0);
});

test("HUNT-W: without a Sheet credential a /webhook run is refused, but a hunt run executes and holds its leads", async () => {
  const plain = webhookDependencies({});
  const refused = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-discovery-secret": SECRET },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT, schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_hunt", variationKey: "plain", requestedAt: NOW, trigger: "scheduled-local",
        discoveryProfile: { targetRoles: "Product Designer" },
      }),
    },
    plain.dependencies as never,
  );
  assert.equal(refused.status, 409);

  const seen: Array<{ request: DiscoveryWebhookRequestV1; trigger: string }> = [];
  const deferred = webhookDependencies({ allowMissingSheetsCredential: true, seen });
  const dispatch = createHuntRunDispatcher({
    webhookSecret: SECRET,
    now: () => new Date(NOW),
    handleDiscovery: (request) => handleDiscoveryWebhook(request, deferred.dependencies as never),
  });
  const outcome = await dispatch(HUNT, "scheduled-hunt", { slotAt: "2026-10-02T13:00:00.000Z" });
  assert.equal(outcome.ok, true, String(outcome.message));
  // The body passed the real parser and schema: the run saw the hunt trigger.
  assert.equal(seen[0].trigger, "scheduled");
  assert.equal(seen[0].request.trigger, "scheduled-hunt");
  assert.equal(seen[0].request.discoveryProfile?.searchPlan?.query?.locations, "Austin");

  const [summary] = deferred.runStatusStore.list()?.runs || [];
  assert.equal(summary.runId, outcome.runId);
  assert.equal(summary.status, "write_failed");
  assert.deepEqual(summary.awaitingSheetWrite, { leads: 1 });
});
