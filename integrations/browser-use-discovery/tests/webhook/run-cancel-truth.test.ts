// BEAUDIT A21 repair round 2: a cancel answer must be true.
// 1. It waits for Sheet writes that were already in flight, or says the stop
//    is unconfirmed.
// 2. The real runner, cancelled mid board detection, reports cancelled (not a
//    `partial` run with a partial history row).
// 3. A cancelled status that could not be saved is not acknowledged as a
//    durable cancel.
import assert from "node:assert/strict";
import test from "node:test";

import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";
import {
  createRunCancelRegistry,
  guardWriterWithSignal,
  runAsyncLifecycle,
} from "../../src/webhook/run-async-lifecycle.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

const SECRET = "cancel-truth-secret";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrSt";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Status = Record<string, unknown> & {
  runId: string;
  status: string;
  terminal: boolean;
};

function createMemoryStore(
  events: string[] = [],
  shouldThrow: (payload: Status) => boolean = () => false,
) {
  const states: Status[] = [];
  const store = {
    states,
    failWrites: shouldThrow,
    put(payload: Status) {
      if (store.failWrites(payload)) {
        throw new Error("EIO: simulated disk write failure");
      }
      events.push(`status:${payload.status}`);
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId: string) {
      for (let index = states.length - 1; index >= 0; index -= 1) {
        if (states[index].runId === runId) return states[index];
      }
      return null;
    },
    close() {},
  };
  return store;
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (Date.now() < deadline) {
    value = read();
    if (predicate(value)) return value;
    await sleep(2);
  }
  return value;
}

function discoveryRequest() {
  return {
    method: "POST",
    headers: { "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId: SHEET_ID,
      variationKey: "var-cancel",
      requestedAt: new Date().toISOString(),
      googleAccessToken: "request-token",
      discoveryProfile: { targetRoles: "Engineer" },
    }),
  };
}

function fakeResult(runId: string) {
  const at = new Date().toISOString();
  return {
    run: { runId, trigger: "manual", request: { sheetId: SHEET_ID }, config: { sheetId: SHEET_ID } },
    lifecycle: { state: "completed", companyCount: 1, listingCount: 1, normalizedLeadCount: 1, completedAt: at, startedAt: at },
    writeResult: { appended: 1, updated: 0 },
    warnings: [],
    sourceSummary: [],
  };
}

function handlerDeps(input: {
  store: ReturnType<typeof createMemoryStore>;
  registry: ReturnType<typeof createRunCancelRegistry>;
  runDiscovery: (req: never, trigger: never, deps: never) => Promise<unknown>;
  history?: Array<Record<string, unknown>>;
  runDependencies?: Record<string, unknown>;
}) {
  const history = input.history ?? [];
  const logger = {
    append: async (_sheetId: string, row: Record<string, unknown>) => {
      history.push(row);
      return { ok: true, created: false };
    },
  };
  return {
    runSynchronously: false,
    runStatusStore: input.store,
    runDiscovery: input.runDiscovery,
    maxRunDurationMs: 5_000,
    cancelRegistry: input.registry,
    createDiscoveryRunsLoggerForRequest: () => logger,
    runDependencies: {
      runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
      loadStoredWorkerConfig: async () => ({ sheetId: SHEET_ID, companies: [{ name: "Acme" }] }),
      now: () => new Date(),
      randomId: (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2, 10)}`,
      ...input.runDependencies,
      discoveryRunsLogger: logger,
    },
  } as never;
}

test("A21 repair: cancel waits for a Sheet write that was already in flight before it reports the stop", async () => {
  const events: string[] = [];
  const store = createMemoryStore(events);
  const registry = createRunCancelRegistry();
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    handlerDeps({
      store,
      registry,
      // Mirrors withAbortableTimeout: the runner gives up on the write the
      // moment the signal aborts, while the write itself keeps going.
      runDiscovery: (async (_req: unknown, _trigger: unknown, deps: Record<string, unknown>) => {
        const signal = deps.abortSignal as AbortSignal;
        const writer = deps.pipelineWriter as { write(sheetId: string, leads: unknown[]): Promise<unknown> };
        const write = writer.write(SHEET_ID, [{ title: "lead" }]);
        write.catch(() => {});
        await Promise.race([
          write,
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        ]);
        return fakeResult(String(deps.runId));
      }) as never,
      runDependencies: {
        pipelineWriter: {
          async write() {
            events.push("write-started");
            await sleep(80);
            events.push("write-landed");
            return { appended: 1, updated: 0 };
          },
        },
      },
    }),
  );
  const { runId } = JSON.parse(response.body);
  await waitFor(() => events.includes("write-started"), Boolean);
  const outcome = await registry.cancel(runId);
  events.push("cancel-response");
  await sleep(120);
  assert.ok(events.includes("write-landed"));
  assert.ok(
    events.indexOf("write-landed") < events.indexOf("status:failed"),
    `the cancelled status lands after the in-flight write: ${events.join(" -> ")}`,
  );
  assert.ok(events.indexOf("write-landed") < events.indexOf("cancel-response"));
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.stopConfirmed, true);
  }
});

test("A21 repair: a write still in flight at the settle deadline makes the stop unconfirmed", async () => {
  const store = createMemoryStore();
  const registry = createRunCancelRegistry();
  const runningStatus = {
    runId: "run_unconfirmed",
    trigger: "manual",
    status: "running",
    terminal: false,
    message: "Discovery run is running.",
    acceptedAt: new Date().toISOString(),
    request: { sheetId: SHEET_ID, variationKey: "v", requestedAt: new Date().toISOString() },
  } as never;
  store.put(runningStatus);
  let landed = false;
  runAsyncLifecycle({
    runId: "run_unconfirmed",
    runMode: "async",
    maxRunDurationMs: 5_000,
    runStatusStore: store as never,
    runningStatus,
    now: () => new Date(),
    eventPrefix: "discovery.run",
    cancelRegistry: registry,
    cancelSettleTimeoutMs: 30,
    work: async (signal, writes) => {
      const writer = guardWriterWithSignal(
        {
          async write() {
            await sleep(150);
            landed = true;
            return {};
          },
        },
        signal,
        writes,
      );
      const write = writer.write();
      write.catch(() => {});
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      return null;
    },
    buildTerminalStatus: () => runningStatus,
  });
  await sleep(5);
  const outcome = await registry.cancel("run_unconfirmed");
  assert.equal(landed, false, "the write had not settled when cancel answered");
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.stopConfirmed, false, "an unsettled write must not be reported as a confirmed stop");
    assert.match(String(outcome.status?.message), /may still/i);
  }
  await sleep(200);
});

test("A21 repair: the real runner cancelled during board detection reports cancelled, not partial", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
  try {
    const store = createMemoryStore();
    const registry = createRunCancelRegistry();
    const history: Array<Record<string, unknown>> = [];
    let detecting = false;
    const response = await handleDiscoveryWebhook(
      discoveryRequest(),
      handlerDeps({
        store,
        registry,
        history,
        runDiscovery: runDiscovery as never,
        runDependencies: {
          runtimeConfig: {
            webhookSecret: SECRET,
            runMode: "local",
            stateDatabasePath: "",
            workerConfigPath: "",
            browserUseCommand: "",
            geminiApiKey: "",
            serpApiKey: "",
            useStructuredExtraction: false,
            allowedOrigins: [],
          },
          sourceAdapterRegistry: {
            adapters: [],
            detectBoards: () => {
              detecting = true;
              return new Promise(() => {});
            },
            collectListings: async () => [],
          },
          pipelineWriter: {
            write: async (sheetId: string) => ({
              sheetId, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [],
            }),
          },
          loadStoredWorkerConfig: async (sheetId: string) => ({
            sheetId,
            mode: "local",
            timezone: "UTC",
            companies: [{ name: "Acme" }],
            includeKeywords: [],
            excludeKeywords: [],
            targetRoles: ["Engineer"],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 5,
            enabledSources: ["greenhouse"],
            schedule: { enabled: false, cron: "" },
          }),
          mergeDiscoveryConfig: (stored: Record<string, unknown>, request: Record<string, unknown>) => ({
            ...stored,
            sheetId: request.sheetId,
            variationKey: request.variationKey,
            requestedAt: request.requestedAt,
            sourcePreset: "ats_only",
            effectiveSources: ["greenhouse"],
          }),
        },
      }),
    );
    assert.equal(response.status, 202, response.body);
    const { runId } = JSON.parse(response.body);
    await waitFor(() => detecting, Boolean);
    assert.equal(detecting, true, "the real runner reached board detection");
    const outcome = await registry.cancel(runId);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.cancelled, true, "a cancel mid-detection is a cancel");
      assert.equal(outcome.status?.status, "failed");
    }
    assert.match(String(store.get(runId)?.error), /cancelled by user/i);
    await waitFor(() => history.length, (n) => n > 0);
    await sleep(10);
    assert.equal(history.length, 1, "exactly one history row");
    assert.notEqual(history[0].status, "partial");
    assert.match(String(history[0].error), /cancelled by user/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("A21 repair: a cancelled status that cannot be saved is reported as not saved, and a retry can still land it", async () => {
  const store = createMemoryStore([], (payload) => payload.status === "failed");
  const registry = createRunCancelRegistry();
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    handlerDeps({
      store,
      registry,
      runDiscovery: (async (_req: unknown, _trigger: unknown, deps: Record<string, unknown>) => {
        const signal = deps.abortSignal as AbortSignal;
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      }) as never,
    }),
  );
  const { runId } = JSON.parse(response.body);
  await sleep(5);
  const first = await registry.cancel(runId);
  assert.equal(first.ok, false, "an unsaved cancel is not acknowledged");
  if (!first.ok) {
    assert.equal(first.reason, "status_not_saved");
  }
  assert.equal(store.get(runId)?.status, "running");
  assert.equal(registry.has(runId), true, "the run stays cancellable so a retry can save the status");
  store.failWrites = () => false;
  const retry = await registry.cancel(runId);
  assert.equal(retry.ok, true);
  if (retry.ok) {
    assert.equal(retry.cancelled, true);
    assert.equal(retry.status?.status, "failed");
  }
  assert.equal(store.get(runId)?.status, "failed");
  assert.equal(registry.has(runId), false);
});
