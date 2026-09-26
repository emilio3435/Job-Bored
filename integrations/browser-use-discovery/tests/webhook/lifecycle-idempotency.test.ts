// LIFECYCLE-1 — a byte-identical redelivery of one webhook payload must not
// start a second run.
//
// WHAT THE GUARD CATCHES. The run identity is derived from the payload triple
// `sheetId` + `variationKey` + `requestedAt` (`deriveIdempotentRunId`), so two
// deliveries of THE SAME BODY resolve to the same runId and the second is
// answered from the run-status store instead of dispatching again:
//   - an at-least-once relay/proxy/tunnel retry of a POST it could not confirm;
//   - a manual and a scheduled dispatch colliding on an identical body;
//   - any client that retries the request it already built, unchanged.
// Before this suite the worker could not tell such a redelivery from a new run
// at all: two byte-identical POSTs ran discovery twice and appended two
// DiscoveryRuns rows.
//
// WHAT IT DOES NOT CATCH — a user re-click. The dashboard aborts the dispatch
// POST after `timeoutMs` (default 15s, discovery-wizard-verify.js:674-683);
// on a slow link the browser can abort AFTER the worker minted a runId and
// started a run, the user sees a network error and clicks "Run discovery"
// again. That second click is NOT deduped: every dispatch path stamps a fresh
// `requestedAt` off the wall clock — discovery-readiness.js:685 (the dashboard
// "Run discovery" path), discovery-payload.js:293, :372, :390,
// discovery-wizard-verify.js:671 — and `generateVariationKey`
// (discovery-payload.js:371-386) hashes that same timestamp, so the re-click
// differs in two of the three identity fields and derives a different runId.
// It starts a SECOND run, with a second DiscoveryRuns row and a second
// browser/LLM/Sheets bill. `"a user re-click is NOT deduped"` below pins that
// cost so nobody reads this suite as having solved it. Closing it needs a
// stable client-side idempotency key on the request, which the webhook schema
// (`contracts.ts` `DiscoveryWebhookRequestV1`) does not carry — a follow-up,
// not this guard.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  deriveIdempotentRunId,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";

const SECRET = "lifecycle-secret-abc123";
const SHEET_ID = "sheet_lifecycle";
const VARIATION_KEY = "var_lifecycle";
const REQUESTED_AT = "2026-04-09T12:00:00.000Z";

type Json = Record<string, unknown>;

function bodyFor(overrides: Json = {}): string {
  return JSON.stringify({
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: SHEET_ID,
    variationKey: VARIATION_KEY,
    requestedAt: REQUESTED_AT,
    ...overrides,
  });
}

function requestFor(bodyText: string, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discovery-secret": SECRET,
      ...headers,
    },
    bodyText,
  };
}

function createMemoryRunStatusStore() {
  const states: any[] = [];
  return {
    states,
    put(payload: any) {
      const existing = states.filter((s) => s.runId === payload.runId).pop();
      if (existing?.terminal) return;
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

/**
 * A promise plus its resolver — the explicit control this suite uses instead of
 * a wall-clock sleep. `runGate` holds the async run open so a duplicate arrives
 * while the original is genuinely in flight; `runStarted` lets the test await
 * that the run really began.
 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type HarnessOptions = {
  runSynchronously?: boolean;
  runStatusStore?: ReturnType<typeof createMemoryRunStatusStore> | null;
  gate?: Promise<void> | null;
  onRunStart?(runId: string): void;
  /** When set, `runDiscovery` throws with this message instead of succeeding. */
  failWith?: string;
};

/**
 * One dependency object shared across deliveries — the same worker process
 * handling both POSTs, which is what a redelivery actually hits.
 */
function makeHarness(options: HarnessOptions = {}) {
  const runStatusStore =
    options.runStatusStore === null
      ? undefined
      : (options.runStatusStore ?? createMemoryRunStatusStore());
  const appends: Array<{ sheetId: string; row: any }> = [];
  const pipelineWrites: any[] = [];
  const runIds: string[] = [];
  let idSeq = 0;

  const dependencies: any = {
    runSynchronously: options.runSynchronously ?? true,
    asyncPollAfterMs: 2000,
    runStatusPathForRun: (runId: string) => `/runs/${runId}`,
    ...(runStatusStore ? { runStatusStore } : {}),
    async runDiscovery(_request: any, trigger: any, deps: any) {
      const runId = deps.runId;
      runIds.push(runId);
      options.onRunStart?.(runId);
      if (options.gate) await options.gate;
      if (options.failWith) throw new Error(options.failWith);
      await deps.pipelineWriter?.write?.({ runId });
      await deps.discoveryRunsLogger?.append(SHEET_ID, {
        runAt: "2026-04-09T12:00:01.000Z",
        trigger: "manual",
        status: "success",
        durationS: 1,
        companiesSeen: 0,
        leadsWritten: 0,
        leadsUpdated: 0,
        source: "worker",
        variationKey: VARIATION_KEY,
        error: "",
      });
      return {
        run: {
          runId,
          trigger,
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: SHEET_ID,
            variationKey: VARIATION_KEY,
            requestedAt: REQUESTED_AT,
          },
          config: { sheetId: SHEET_ID },
        },
        lifecycle: {
          runId,
          trigger,
          startedAt: "2026-04-09T12:00:00.000Z",
          completedAt: "2026-04-09T12:00:01.000Z",
          state: "completed",
          companyCount: 0,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: SHEET_ID,
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
    runDependencies: {
      runtimeConfig: {
        webhookSecret: SECRET,
        googleAccessToken: "oauth-proof-lifecycle",
        runMode: "local",
        asyncAckByDefault: false,
      },
      discoveryRunsLogger: {
        async append(sheetId: string, row: any) {
          appends.push({ sheetId, row });
          return { ok: true, created: false };
        },
      },
      pipelineWriter: {
        async write(payload: any) {
          pipelineWrites.push(payload);
          return {};
        },
      },
      loadStoredWorkerConfig: async () => ({
        sheetId: SHEET_ID,
        companies: [{ name: "Acme" }],
        enabledSources: ["greenhouse"],
      }),
      mergeDiscoveryConfig: (stored: any, request: any) => ({
        ...stored,
        variationKey: request.variationKey,
        requestedAt: request.requestedAt,
      }),
      now: () => new Date(REQUESTED_AT),
      // Production mints `run_<uuid>` per POST; this stand-in is just as fresh
      // per call, so a test that still sees one runId across two deliveries is
      // seeing the idempotency guard, not a coincidence.
      randomId: (prefix: string) => `${prefix}_${(idSeq += 1)}`,
    },
    now: () => new Date(REQUESTED_AT),
  };

  return { dependencies, runStatusStore, appends, pipelineWrites, runIds };
}

async function deliver(dependencies: any, bodyText = bodyFor(), headers = {}) {
  const response = await handleDiscoveryWebhook(
    requestFor(bodyText, headers),
    dependencies,
  );
  return { response, ack: JSON.parse(response.body) };
}

// ---------------------------------------------------------------------------
// Row 15 / 16 / 17 — duplicate delivery, exactly-once effects
// ---------------------------------------------------------------------------

test("LIFECYCLE-1: a duplicate delivery resolves to the original runId and starts no second run", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  const second = await deliver(harness.dependencies);

  assert.equal(first.response.status, 200, "first delivery is accepted");
  assert.equal(
    second.response.status,
    200,
    "duplicate delivery is answered, not errored",
  );
  assert.equal(
    second.ack.runId,
    first.ack.runId,
    "duplicate delivery must resolve to the SAME runId",
  );
  assert.equal(
    second.ack.statusPath,
    first.ack.statusPath,
    "the duplicate's poller must be pointed at the original run",
  );
  assert.deepEqual(
    harness.runIds,
    [first.ack.runId],
    "discovery must run exactly once across both deliveries",
  );
});

test("LIFECYCLE-1: a duplicate delivery writes exactly one DiscoveryRuns row", async () => {
  const harness = makeHarness();

  await deliver(harness.dependencies);
  await deliver(harness.dependencies);

  assert.equal(
    harness.appends.length,
    1,
    "exactly one DiscoveryRuns row must be written across both deliveries",
  );
  assert.equal(harness.appends[0].sheetId, SHEET_ID);
});

test("LIFECYCLE-1: a duplicate delivery performs exactly one Pipeline write", async () => {
  const harness = makeHarness();

  await deliver(harness.dependencies);
  await deliver(harness.dependencies);

  assert.equal(
    harness.pipelineWrites.length,
    1,
    "a redelivery must not re-run the pipeline write (doubled browser/LLM/Sheets cost)",
  );
});

test("LIFECYCLE-1: a duplicate arriving while the original run is still in flight returns the live run", async () => {
  const gate = deferred();
  const runStarted = deferred<string>();
  const harness = makeHarness({
    runSynchronously: false,
    gate: gate.promise,
    onRunStart: (runId) => runStarted.resolve(runId),
  });

  const first = await deliver(harness.dependencies);
  assert.equal(first.response.status, 202);
  assert.equal(first.ack.kind, "accepted_async");

  // No sleep: wait on the run actually announcing itself.
  const inFlightRunId = await runStarted.promise;
  assert.equal(inFlightRunId, first.ack.runId);

  const second = await deliver(harness.dependencies);
  assert.equal(
    second.response.status,
    202,
    "a duplicate for a run still in flight is still an accepted ack",
  );
  assert.equal(second.ack.kind, "accepted_async");
  assert.equal(second.ack.runId, first.ack.runId);
  assert.equal(second.ack.statusPath, first.ack.statusPath);
  assert.equal(
    second.ack.message,
    harness.runStatusStore!.get(first.ack.runId).message,
    "the duplicate ack reports the live run's current message",
  );
  assert.equal(harness.runIds.length, 1, "no second run was dispatched");

  gate.resolve();
});

test("LIFECYCLE-1: a duplicate of a finished run returns its terminal outcome, not a new run", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  const second = await deliver(harness.dependencies);

  assert.equal(second.response.status, 200);
  assert.equal(second.ack.ok, true);
  assert.equal(second.ack.outcome.runId, first.ack.runId);
  assert.equal(second.ack.outcome.terminal, true);
  assert.equal(second.ack.outcome.status, "completed");
  assert.equal(harness.runIds.length, 1);
});

test("LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as completed_sync (contract has no failed-ack kind — see QA MINOR-3)", async () => {
  // Characterization, not an endorsement. `existing.terminal` is true for a
  // failure as much as for a success, and `DiscoveryWebhookAck`
  // (`contracts.ts` `DiscoveryWebhookAck`) pins `ok: true` with only
  // `accepted_async` / `completed_sync` — there is no failure ack to return.
  // So the SAME run answers 500 `{ok:false}` on its first delivery and 200
  // `{ok:true, kind:"completed_sync"}` on its redelivery. The honesty lives in
  // the body: `outcome.status` is "failed" and `message` says so, which is what
  // the dashboard poller reads (`isAsyncDiscoveryAcceptedResponse`,
  // discovery-wizard-verify.js:208-222, treats a 200-with-runId as accepted and
  // then polls `/runs/:id`, which reports the failure). Changing the ack
  // shape would break the LD-3 contract, so this test pins the wart instead of
  // hiding it; if the contract ever grows a failure kind, this test is the one
  // that must change.
  const harness = makeHarness({ failWith: "browser session crashed" });

  const first = await deliver(harness.dependencies);
  assert.equal(first.response.status, 500, "the original delivery reports the failure");
  assert.equal(first.ack.ok, false);
  assert.equal(first.ack.message, "browser session crashed");

  const second = await deliver(harness.dependencies);

  assert.equal(
    second.response.status,
    200,
    "the redelivery is answered from the store, not re-run",
  );
  assert.equal(second.ack.ok, true, "the ack contract has no ok:false terminal shape");
  assert.equal(second.ack.kind, "completed_sync");
  assert.equal(
    second.ack.runId,
    harness.runIds[0],
    "the redelivery resolves to the ORIGINAL failed run",
  );
  assert.equal(second.ack.statusPath, `/runs/${harness.runIds[0]}`);
  assert.equal(
    second.ack.outcome.status,
    "failed",
    "the outcome body stays honest even though the ack envelope says ok:true",
  );
  assert.equal(second.ack.outcome.terminal, true);
  assert.equal(second.ack.outcome.error, "browser session crashed");
  assert.match(second.ack.message, /failed/i);

  assert.equal(
    harness.runIds.length,
    1,
    "a failed run must not be silently retried by a redelivery",
  );
  assert.equal(
    harness.appends.length,
    1,
    "the failed run wrote exactly one DiscoveryRuns row; the redelivery adds none",
  );
  assert.equal(
    harness.appends[0].row.status,
    "failure",
    "that one row records the failure honestly, unlike the ok:true ack envelope",
  );
  assert.equal(harness.appends[0].row.error, "browser session crashed");
});

// ---------------------------------------------------------------------------
// The guard must not swallow genuinely distinct runs
// ---------------------------------------------------------------------------

test("LIFECYCLE-1: a different requestedAt starts a fresh run", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  const second = await deliver(
    harness.dependencies,
    bodyFor({ requestedAt: "2026-04-09T12:05:00.000Z" }),
  );

  assert.notEqual(
    second.ack.runId,
    first.ack.runId,
    "a second user click stamps a fresh requestedAt and must run again",
  );
  assert.equal(harness.runIds.length, 2);
  assert.equal(harness.appends.length, 2);
});

// ---------------------------------------------------------------------------
// The limitation this guard does NOT close — a user re-click (QA MAJOR-2)
// ---------------------------------------------------------------------------

test("LIFECYCLE-1: a user re-click is NOT deduped — a fresh requestedAt starts a second run, second row, second bill", async () => {
  // The header explains why: every dispatch path stamps `requestedAt` off the
  // wall clock (discovery-readiness.js:685, discovery-payload.js:293/:372/:390,
  // discovery-wizard-verify.js:671), so the two POSTs a double-click produces
  // differ in that field — and in the `variationKey` hashed from it. This test
  // exists so the cost is PINNED, not merely described: if someone later claims
  // the double-click case is handled, this test contradicts them, and if they
  // genuinely close it (a client-supplied idempotency key), this test is the
  // one that must be rewritten.
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  // Identical user input, identical everything — only the clock moved.
  const second = await deliver(
    harness.dependencies,
    bodyFor({ requestedAt: "2026-04-09T12:00:07.000Z" }),
  );

  assert.notEqual(
    second.ack.runId,
    first.ack.runId,
    "a re-click derives a different runId — the guard cannot see it as a duplicate",
  );
  assert.deepEqual(
    harness.runIds,
    [first.ack.runId, second.ack.runId],
    "TWO discovery runs are dispatched: this is the cost LIFECYCLE-1 does not prevent",
  );
  assert.equal(harness.appends.length, 2, "two DiscoveryRuns rows, one per click");
  assert.equal(
    harness.pipelineWrites.length,
    2,
    "two pipeline writes — the doubled browser/LLM/Sheets bill is real",
  );
});

test("LIFECYCLE-1: a different variationKey starts a fresh run", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  const second = await deliver(
    harness.dependencies,
    bodyFor({ variationKey: "var_other" }),
  );

  assert.notEqual(second.ack.runId, first.ack.runId);
  assert.equal(harness.runIds.length, 2);
});

test("LIFECYCLE-1: a different sheetId starts a fresh run", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  const second = await deliver(
    harness.dependencies,
    bodyFor({ sheetId: "sheet_other" }),
  );

  assert.notEqual(second.ack.runId, first.ack.runId);
  assert.equal(harness.runIds.length, 2);
});

test("LIFECYCLE-1: without a run-status store the runId stays random, so nothing collapses", async () => {
  const harness = makeHarness({ runStatusStore: null });

  const first = await deliver(harness.dependencies);
  const second = await deliver(harness.dependencies);

  assert.equal(first.ack.runId, "run_1");
  assert.equal(second.ack.runId, "run_2");
  assert.equal(
    harness.runIds.length,
    2,
    "with no store there is nothing to look a duplicate up in — behavior is unchanged",
  );
});

// ---------------------------------------------------------------------------
// Order invariant: the guard sits after auth/parse/preflight, never before
// ---------------------------------------------------------------------------

test("LIFECYCLE-1: a redelivery with a bad secret is still rejected 401 before any dedupe", async () => {
  const harness = makeHarness();

  const first = await deliver(harness.dependencies);
  assert.equal(first.response.status, 200);

  const replay = await handleDiscoveryWebhook(
    requestFor(bodyFor(), { "x-discovery-secret": "wrong-secret" }),
    harness.dependencies,
  );

  assert.equal(replay.status, 401, "auth runs before the idempotency lookup");
  const body = JSON.parse(replay.body);
  assert.equal(body.ok, false);
  assert.equal(body.auth.category, "secret_mismatch");
  assert.equal(body.runId, undefined, "a rejected replay leaks no runId");
});

test("LIFECYCLE-1: an unparseable redelivery is still rejected 400 before any dedupe", async () => {
  const harness = makeHarness();

  await deliver(harness.dependencies);

  const replay = await handleDiscoveryWebhook(
    requestFor("{not json"),
    harness.dependencies,
  );

  assert.equal(replay.status, 400, "JSON parse runs before the idempotency lookup");
});

test("LIFECYCLE-1: an invalid requestedAt is rejected at parse, so it can never collapse runs", async () => {
  const harness = makeHarness();

  const response = await handleDiscoveryWebhook(
    requestFor(bodyFor({ requestedAt: "not-a-date" })),
    harness.dependencies,
  );

  // Finding for the report: `requestedAt` validity is enforced in
  // parseWebhookRequest (step 3, a 400), NOT in preflight — so by the time the
  // idempotency guard runs, `requestedAt` is always a parseable timestamp.
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).message, /requestedAt/);
  assert.equal(harness.runIds.length, 0);
});

test("LIFECYCLE-1: a duplicate ack never echoes the per-request googleAccessToken", async () => {
  const harness = makeHarness();
  const withToken = bodyFor({ googleAccessToken: "user-oauth-token-should-not-echo" });

  await deliver(harness.dependencies, withToken);
  const second = await deliver(harness.dependencies, withToken);

  assert.equal(second.response.status, 200);
  assert.ok(
    !second.response.body.includes("user-oauth-token-should-not-echo"),
    "the duplicate ack must not carry the caller's Google access token back",
  );
});

// ---------------------------------------------------------------------------
// The derivation itself is a pure function — no clock, no randomness, no I/O
// ---------------------------------------------------------------------------

test("LIFECYCLE-1: deriveIdempotentRunId is deterministic for one request identity", () => {
  const identity = {
    sheetId: SHEET_ID,
    variationKey: VARIATION_KEY,
    requestedAt: REQUESTED_AT,
  };
  const a = deriveIdempotentRunId(identity);
  const b = deriveIdempotentRunId({ ...identity });

  assert.equal(a, b);
  assert.match(String(a), /^run_[0-9a-f]{32}$/);
});

test("LIFECYCLE-1: deriveIdempotentRunId separates every identity field", () => {
  const base = {
    sheetId: SHEET_ID,
    variationKey: VARIATION_KEY,
    requestedAt: REQUESTED_AT,
  };
  const ids = new Set([
    deriveIdempotentRunId(base),
    deriveIdempotentRunId({ ...base, sheetId: "sheet_other" }),
    deriveIdempotentRunId({ ...base, variationKey: "var_other" }),
    deriveIdempotentRunId({ ...base, requestedAt: "2026-04-09T12:05:00.000Z" }),
  ]);

  assert.equal(ids.size, 4, "no two distinct identities may share a runId");
});

test("LIFECYCLE-1: deriveIdempotentRunId cannot be forged by moving a field boundary", () => {
  // A separator-free join would let "ab"+"c" and "a"+"bc" collide.
  assert.notEqual(
    deriveIdempotentRunId({
      sheetId: "ab",
      variationKey: "c",
      requestedAt: REQUESTED_AT,
    }),
    deriveIdempotentRunId({
      sheetId: "a",
      variationKey: "bc",
      requestedAt: REQUESTED_AT,
    }),
  );
});

test("LIFECYCLE-1: deriveIdempotentRunId returns null without a usable requestedAt", () => {
  const base = { sheetId: SHEET_ID, variationKey: VARIATION_KEY };

  assert.equal(deriveIdempotentRunId({ ...base }), null);
  assert.equal(deriveIdempotentRunId({ ...base, requestedAt: "" }), null);
  assert.equal(deriveIdempotentRunId({ ...base, requestedAt: "   " }), null);
  assert.equal(deriveIdempotentRunId({ ...base, requestedAt: "not-a-date" }), null);
});
