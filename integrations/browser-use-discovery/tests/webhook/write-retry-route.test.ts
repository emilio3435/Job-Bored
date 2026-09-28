import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createWorkerRequestListener } from "../../src/webhook/worker-router.ts";

test("retry-write authenticates, hides saved leads, and replays only the write", async () => {
  const leads = [{ url: "https://example.com/jobs/1", title: "Role" }] as never;
  const statuses = new Map<string, any>([["run_retry", {
    runId: "run_retry", status: "write_failed", terminal: true,
    message: "Write failed", trigger: "manual",
    request: { sheetId: "sheet", variationKey: "v", requestedAt: "2026-09-28T00:00:00Z" },
    acceptedAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z",
    selectedLeads: leads, warnings: [], sources: [],
  }]]);
  let writes = 0;
  const dummy = async () => ({ status: 200, headers: {}, body: "{}" });
  const listener = createWorkerRequestListener({
    runtimeConfig: { runMode: "hosted", allowedOrigins: [], allowedHosts: [], webhookSecret: "stub-secret" },
    runStatusStore: {
      get: (id) => statuses.get(id) || null,
      finishWriteRetry: (payload) => { statuses.set(payload.runId, payload); },
    },
    retryWrite: async (sheetId, selected) => {
      writes++;
      assert.equal(sheetId, "sheet");
      assert.deepEqual(selected, leads);
      return { sheetId, appended: 1, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] };
    },
    buildHealthPayload: async () => ({}),
    handlers: { discovery: dummy, discoveryProfile: dummy, pipelineUpdate: dummy, ingestUrl: dummy, cleanupExpired: dummy },
    logEvent: () => {},
    readBody: async () => "",
  });
  const invoke = (method: string, url: string, secret = "") => new Promise<{ status: number; body: any }>((resolve) => {
    const request = { method, url, headers: secret ? { "x-discovery-secret": secret } : {} } as IncomingMessage;
    const response = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      end(body: string) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    } as unknown as ServerResponse;
    listener(request, response);
  });
  assert.equal((await invoke("POST", "/runs/run_retry/retry-write")).status, 401);
  assert.equal((await invoke("GET", "/runs/run_retry", "stub-secret")).body.selectedLeads, undefined);
  const retried = await invoke("POST", "/runs/run_retry/retry-write", "stub-secret");
  assert.equal(retried.status, 200);
  assert.equal(writes, 1);
  assert.equal(statuses.get("run_retry")?.status, "completed");
  assert.equal(statuses.get("run_retry")?.selectedLeads, undefined);
});
