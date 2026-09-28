// Run-lifecycle probes against the real handler + real run-status store, with runDiscovery stubbed
// (no network, no Sheets). Run from worktree root:
//   node --experimental-strip-types .lane-evidence/probes/lifecycle.mts
// Writes only under .lane-evidence/probes/tmp-*.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { handleDiscoveryWebhook } from "../../integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts";
import { createDiscoveryRunStatusStore } from "../../integrations/browser-use-discovery/src/state/run-status-store.ts";

const SECRET = "probe-secret";
const tmpRoot = resolve(".lane-evidence/probes");
const body = JSON.stringify({
  event: "command-center.discovery",
  schemaVersion: 1,
  sheetId: "1AbCdEfGhIjKlMnOpQrSt",
  variationKey: "var-retry",
  requestedAt: "2026-09-25T10:00:00.000Z",
  googleAccessToken: "probe-token",
  discoveryProfile: { targetRoles: "Engineer" },
});

function fakeResult(runId: string) {
  const completedAt = new Date().toISOString();
  return {
    run: {
      runId,
      trigger: "manual",
      request: { sheetId: "1AbCdEfGhIjKlMnOpQrSt", variationKey: "var-retry", requestedAt: "2026-09-25T10:00:00.000Z" },
      config: { sheetId: "1AbCdEfGhIjKlMnOpQrSt" },
    },
    lifecycle: { state: "completed", companyCount: 1, listingCount: 1, normalizedLeadCount: 1, completedAt, startedAt: completedAt },
    writeResult: { appended: 1, updated: 0 },
    warnings: [],
    sourceSummary: [],
  };
}

function deps(store: ReturnType<typeof createDiscoveryRunStatusStore>, runDiscovery: (req: unknown, trig: unknown, d: { runId: string }) => Promise<unknown>, historyRows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    runSynchronously: false,
    runStatusStore: store,
    runDiscovery: runDiscovery as never,
    maxRunDurationMs: 200,
    runDependencies: {
      runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
      loadStoredWorkerConfig: async () => ({ sheetId: "1AbCdEfGhIjKlMnOpQrSt", companies: [{ name: "Acme" }] }),
      discoveryRunsLogger: { append: async (_s: string, row: unknown) => { historyRows.push(row); return { ok: true }; } },
      now: () => new Date(),
      randomId: (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    } as never,
    ...extra,
  };
}
const req = { method: "POST", headers: { "x-discovery-secret": SECRET }, bodyText: body };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// P1: retried POST (identical body) -> how many runs?
{
  const dir = mkdtempSync(join(tmpRoot, "tmp-retry-"));
  const store = createDiscoveryRunStatusStore(dir);
  const history: unknown[] = [];
  let calls = 0;
  const run = async (_r: unknown, _t: unknown, d: { runId: string }) => { calls += 1; await sleep(20); return fakeResult(d.runId); };
  const a = JSON.parse((await handleDiscoveryWebhook(req, deps(store, run, history))).body);
  const b = JSON.parse((await handleDiscoveryWebhook(req, deps(store, run, history))).body);
  await sleep(100);
  console.log(`[retry] first=${a.kind}/${a.runId} second=${b.kind}/${b.runId} sameRunId=${a.runId === b.runId} runDiscoveryCalls=${calls} snapshots=${readdirSync(dir).length}`);
  rmSync(dir, { recursive: true, force: true });
}

// P2: terminal write throws on completion -> run stays non-terminal forever, safety timer cleared.
{
  const dir = mkdtempSync(join(tmpRoot, "tmp-stuck-"));
  const inner = createDiscoveryRunStatusStore(dir);
  const events: string[] = [];
  const flaky = {
    ...inner,
    put(p: { terminal: boolean }) {
      if (p.terminal) throw new Error("EIO: simulated disk write failure on terminal snapshot");
      inner.put(p as never);
    },
    get: inner.get,
  };
  const history: unknown[] = [];
  const run = async (_r: unknown, _t: unknown, d: { runId: string }) => fakeResult(d.runId);
  const d = deps(flaky as never, run, history, { log: (e: string) => events.push(e) });
  const ack = JSON.parse((await handleDiscoveryWebhook(req, d)).body);
  await sleep(600); // 3x maxRunDurationMs: safety timer would have fired if still armed
  const st = inner.get(ack.runId);
  console.log(`[stuck] runId=${ack.runId} status=${st?.status} terminal=${st?.terminal} events=${events.filter((e) => /completed|failed|ignored|force|terminal/.test(e)).join(",")}`);
  rmSync(dir, { recursive: true, force: true });
}

// P3: worker restart mid-run -> status flips to failed, but no DiscoveryRuns history row is attempted.
{
  const dir = mkdtempSync(join(tmpRoot, "tmp-restart-"));
  const store1 = createDiscoveryRunStatusStore(dir);
  const history: unknown[] = [];
  const never = () => new Promise(() => {});
  const d = deps(store1, never as never, history, { maxRunDurationMs: 60_000 });
  const ack = JSON.parse((await handleDiscoveryWebhook(req, d)).body);
  console.log(`[restart] before restart: ${store1.get(ack.runId)?.status}`);
  // Simulated restart: the server does exactly this at boot (server.ts:279-289).
  const store2 = createDiscoveryRunStatusStore(dir);
  const n = store2.markNonTerminalRunsAbandoned?.(new Date().toISOString());
  const after = store2.get(ack.runId);
  console.log(`[restart] abandoned=${n} status=${after?.status} terminal=${after?.terminal} historyRowsWritten=${history.length}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0); // the never-resolving run + its 60s safety timer would otherwise hold the loop
}
