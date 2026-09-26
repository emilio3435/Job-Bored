// BEAUDIT A2 / A12 / A21: the shared async run lifecycle.
// Promotes probes/A/lifecycle.mts `[stuck]` into regression tests, and pins the
// cancel path and the safety-timer grace window.
import assert from "node:assert/strict";
import test from "node:test";

import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";
import { handleIngestUrlWebhook } from "../../src/webhook/handle-ingest-url.ts";
import {
  computeSafetyDelayMs,
  createRunCancelRegistry,
} from "../../src/webhook/run-async-lifecycle.ts";

const SECRET = "lifecycle-proof-secret";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrSt";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Status = Record<string, unknown> & {
  runId: string;
  status: string;
  terminal: boolean;
};

function createMemoryStore(
  shouldThrow: (payload: Status, attempt: number) => boolean = () => false,
) {
  const states: Status[] = [];
  let attempt = 0;
  return {
    states,
    put(payload: Status) {
      attempt += 1;
      if (shouldThrow(payload, attempt)) {
        throw new Error("EIO: simulated disk write failure");
      }
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
}

function fakeResult(runId: string) {
  const completedAt = new Date().toISOString();
  return {
    run: {
      runId,
      trigger: "manual",
      request: {
        sheetId: SHEET_ID,
        variationKey: "var-life",
        requestedAt: "2026-09-25T10:00:00.000Z",
      },
      config: { sheetId: SHEET_ID },
    },
    lifecycle: {
      state: "completed",
      companyCount: 1,
      listingCount: 1,
      normalizedLeadCount: 1,
      completedAt,
      startedAt: completedAt,
    },
    writeResult: { appended: 1, updated: 0 },
    warnings: [],
    sourceSummary: [],
  };
}

function discoveryRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId: SHEET_ID,
      variationKey: "var-life",
      requestedAt: new Date().toISOString(),
      googleAccessToken: "request-token",
      discoveryProfile: { targetRoles: "Engineer" },
      ...overrides,
    }),
  };
}

function discoveryDeps(input: {
  store: ReturnType<typeof createMemoryStore>;
  runDiscovery: (req: unknown, trigger: unknown, deps: Record<string, unknown>) => Promise<unknown>;
  history?: unknown[];
  events?: string[];
  maxRunDurationMs?: number;
  cancelRegistry?: ReturnType<typeof createRunCancelRegistry>;
}) {
  const history = input.history ?? [];
  const logger = {
    append: async (_sheetId: string, row: unknown) => {
      history.push(row);
      return { ok: true };
    },
  };
  return {
    runSynchronously: false,
    runStatusStore: input.store,
    runDiscovery: input.runDiscovery,
    maxRunDurationMs: input.maxRunDurationMs ?? 5_000,
    ...(input.cancelRegistry ? { cancelRegistry: input.cancelRegistry } : {}),
    log: (event: string) => input.events?.push(event),
    createDiscoveryRunsLoggerForRequest: () => logger,
    runDependencies: {
      runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
      loadStoredWorkerConfig: async () => ({
        sheetId: SHEET_ID,
        companies: [{ name: "Acme" }],
      }),
      discoveryRunsLogger: logger,
      now: () => new Date(),
      randomId: (prefix: string) =>
        `${prefix}_${Math.random().toString(16).slice(2, 10)}`,
    },
  } as never;
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

test("A2: a throwing terminal status write falls back to a failed status instead of sticking in running", async () => {
  // Throws on the FIRST terminal write only (the `completed` one).
  let terminalWrites = 0;
  const store = createMemoryStore((payload) => {
    if (!payload.terminal) return false;
    terminalWrites += 1;
    return terminalWrites === 1;
  });
  const events: string[] = [];
  const history: unknown[] = [];
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    discoveryDeps({
      store,
      events,
      history,
      runDiscovery: async (_req, _trigger, deps) => fakeResult(String(deps.runId)),
    }),
  );
  assert.equal(response.status, 202);
  const { runId } = JSON.parse(response.body);
  const final = await waitFor(() => store.get(runId), (s) => s?.terminal === true);
  assert.equal(final?.terminal, true, "the run must not stay non-terminal");
  assert.equal(final?.status, "failed");
  assert.match(String(final?.error), /could not be saved/);
  assert.ok(events.includes("discovery.run_status.terminal_write_failed"));
  assert.ok(!events.includes("discovery.run.late_failure_ignored"));
  await waitFor(() => history.length, (n) => n > 0);
  assert.equal(history.length, 1, "the fallback failure writes one history row");
});

test("A2: when every terminal write fails the safety timer stays armed and retries at the deadline", async () => {
  const store = createMemoryStore((payload) => payload.terminal === true);
  const events: string[] = [];
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    discoveryDeps({
      store,
      events,
      maxRunDurationMs: 20,
      runDiscovery: async (_req, _trigger, deps) => fakeResult(String(deps.runId)),
    }),
  );
  assert.equal(response.status, 202);
  await sleep(80);
  // completed write, fallback failed write, then the safety timer's partial write.
  const failures = events.filter((e) => e === "discovery.run_status.terminal_write_failed");
  assert.ok(failures.length >= 3, `expected the safety timer to retry, saw ${failures.length} failed writes`);
});

test("A2: async /ingest-url falls back to a failed status when its terminal write throws", async () => {
  let terminalWrites = 0;
  const store = createMemoryStore((payload) => {
    if (!payload.terminal) return false;
    terminalWrites += 1;
    return terminalWrites === 1;
  });
  const response = await handleIngestUrlWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": SECRET },
      bodyText: JSON.stringify({
        event: "ingest.url.request",
        schemaVersion: 1,
        url: "https://boards.greenhouse.io/acme/jobs/123",
        sheetId: SHEET_ID,
        async: true,
        googleAccessToken: "request-token",
      }),
    },
    {
      runtimeConfig: { webhookSecret: SECRET, runMode: "local" } as never,
      pipelineWriter: {
        write: async () => ({ appended: 1, updated: 0, skippedDuplicates: 0 }) as never,
      },
      fetchGreenhouseJob: (async () => ({
        ok: true,
        rawListing: {
          sourceId: "greenhouse",
          title: "Staff Engineer",
          company: "Acme",
          url: "https://boards.greenhouse.io/acme/jobs/123",
          descriptionText: "Build reliable systems for customers. ".repeat(30),
        },
      })) as never,
      runStatusStore: store as never,
      randomId: () => "ingest_life",
    },
  );
  assert.equal(response.status, 202);
  const final = await waitFor(() => store.get("ingest_life"), (s) => s?.terminal === true);
  assert.equal(final?.terminal, true);
  assert.equal(final?.status, "failed");
  assert.match(String(final?.error), /could not be saved/);
});

test("A12: the safety timer fires after a grace window past maxRunDurationMs", () => {
  assert.equal(computeSafetyDelayMs(60 * 60 * 1000), 60 * 60 * 1000 + 30_000);
  assert.equal(computeSafetyDelayMs(200), 210);
  assert.ok(computeSafetyDelayMs(1) > 1);
});

test("A12: a run that times out on its own at maxRunDurationMs reports its real outcome, not the backstop's partial", async () => {
  const store = createMemoryStore();
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    discoveryDeps({
      store,
      maxRunDurationMs: 200,
      runDiscovery: async (_req, _trigger, deps) => {
        await sleep(200);
        return fakeResult(String(deps.runId));
      },
    }),
  );
  const { runId } = JSON.parse(response.body);
  const final = await waitFor(() => store.get(runId), (s) => s?.terminal === true, 1_000);
  assert.equal(final?.status, "completed");
});

test("A21: cancelling a live run aborts its signal, writes a cancelled failed status and a history row", async () => {
  const store = createMemoryStore();
  const history: unknown[] = [];
  const registry = createRunCancelRegistry();
  let seenSignal: AbortSignal | undefined;
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    discoveryDeps({
      store,
      history,
      cancelRegistry: registry,
      runDiscovery: (_req, _trigger, deps) =>
        new Promise((_resolve, reject) => {
          seenSignal = deps.abortSignal as AbortSignal;
          seenSignal.addEventListener("abort", () => reject(seenSignal?.reason));
        }),
    }),
  );
  const { runId } = JSON.parse(response.body);
  assert.ok(registry.has(runId), "a live async run registers for cancel");
  const outcome = registry.cancel(runId);
  assert.equal(outcome.ok, true);
  assert.equal(seenSignal?.aborted, true, "runDiscovery's abortSignal fires");
  const final = store.get(runId);
  assert.equal(final?.status, "failed");
  assert.equal(final?.terminal, true);
  assert.match(String(final?.error), /cancelled by user/i);
  assert.equal(registry.has(runId), false);
  await waitFor(() => history.length, (n) => n > 0);
  assert.equal(history.length, 1);
  await sleep(5);
  assert.equal(store.get(runId)?.status, "failed", "the late abort rejection does not overwrite it");
  assert.deepEqual(registry.cancel(runId), { ok: false, reason: "not_running" });
});

test("A21: a finished run leaves the cancel registry", async () => {
  const store = createMemoryStore();
  const registry = createRunCancelRegistry();
  const response = await handleDiscoveryWebhook(
    discoveryRequest(),
    discoveryDeps({
      store,
      cancelRegistry: registry,
      runDiscovery: async (_req, _trigger, deps) => fakeResult(String(deps.runId)),
    }),
  );
  const { runId } = JSON.parse(response.body);
  await waitFor(() => store.get(runId), (s) => s?.terminal === true);
  assert.equal(registry.size(), 0);
});
