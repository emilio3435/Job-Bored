import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import { buildAcceptedRunStatus, createDiscoveryRunStatusStore } from "../../src/state/run-status-store.ts";
import { createWorkerRequestListener } from "../../src/webhook/worker-router.ts";

test("RUNHIST GET /runs pages durable summaries and returns hosted detail paths", async () => {
  const store = createDiscoveryRunStatusStore(":memory:");
  for (const [runId, at] of [
    ["run_old", "2026-09-27T00:00:00.000Z"],
    ["run_new", "2026-09-27T00:01:00.000Z"],
    ["ingest_hidden", "2026-09-27T00:02:00.000Z"],
  ]) {
    const accepted = buildAcceptedRunStatus({
      runId, trigger: "manual", acceptedAt: at,
      request: { sheetId: "sheet", variationKey: runId.startsWith("ingest_") ? "ingest_url" : "", requestedAt: at },
    });
    store.put({
      ...accepted, status: "completed", terminal: true, completedAt: at,
      runStats: { schemaVersion: 1, funnel: { written: 2, candidates: 3 } },
    });
  }
  const listener = createWorkerRequestListener({
    runtimeConfig: { runMode: "hosted", allowedOrigins: [], allowedHosts: [], webhookSecret: "test-secret" },
    runStatusStore: store,
    buildHealthPayload: async () => ({ ok: true }),
    handlers: {
      discovery: async () => ({ status: 200, headers: {}, body: "{}" }),
      discoveryProfile: async () => ({ status: 200, headers: {}, body: "{}" }),
      pipelineUpdate: async () => ({ status: 200, headers: {}, body: "{}" }),
      ingestUrl: async () => ({ status: 200, headers: {}, body: "{}" }),
      cleanupExpired: async () => ({ status: 200, headers: {}, body: "{}" }),
    },
    logEvent: () => {},
  });
  const send = (url: string, secret = "test-secret") => new Promise<{ status: number; body: Record<string, any> }>((resolve) => {
    const request = {
      method: "GET", url, headers: secret ? { "x-discovery-secret": secret } : {},
    } as unknown as IncomingMessage;
    const response = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      end(body: string) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    } as unknown as ServerResponse;
    listener(request, response);
  });

  assert.equal((await send("/runs", "")).status, 401);
  const first = await send("/runs?limit=1");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.runs.map((run: { runId: string }) => run.runId), ["run_new"]);
  assert.deepEqual(first.body.runs[0].headline, { written: 2, candidates: 3 });
  assert.match(first.body.runs[0].statusPath, /^\/runs\/run_new\?statusToken=/);
  assert.equal((await send(first.body.runs[0].statusPath, "")).status, 200);
  const next = await send(`/runs?limit=1&before=${encodeURIComponent(first.body.nextBefore)}`);
  assert.deepEqual(next.body.runs.map((run: { runId: string }) => run.runId), ["run_old"]);
  assert.equal(next.body.nextBefore, null);
  assert.equal((await send("/runs?before=bad!", "test-secret")).status, 400);
  store.close();
});
