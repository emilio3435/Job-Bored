/**
 * The worker starter used to kill and restart ANY healthy worker it found
 * ("restarting to load latest code"). Every runtime self-repair — the
 * dashboard's full-boot, fix-setup, the keep-alive, launchd autostart — went
 * through it, so a self-repair SIGTERM'd the foreground `npm run dev` worker
 * and `concurrently -k` took the whole stack down (2026-09-02, twice).
 * Restarting a healthy worker is an explicit dev intent, never a default.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideExistingWorkerAction,
  decideHeldWorkerAction,
  parseStarterOptions,
} from "../scripts/lib/discovery-worker-policy.mjs";

describe("worker starter policy", () => {
  it("reuses a healthy worker by default", () => {
    assert.equal(decideExistingWorkerAction({ existingHealthy: true, restartExisting: false }), "reuse");
  });
  it("restarts a healthy worker only when explicitly asked", () => {
    assert.equal(decideExistingWorkerAction({ existingHealthy: true, restartExisting: true }), "restart");
  });
  it("starts a worker when none is healthy, regardless of the flag", () => {
    assert.equal(decideExistingWorkerAction({ existingHealthy: false, restartExisting: true }), "start");
    assert.equal(decideExistingWorkerAction({ existingHealthy: false, restartExisting: false }), "start");
  });
  it("--restart-existing and BROWSER_USE_DISCOVERY_RESTART_EXISTING=true both opt in; legacy REUSE_EXISTING=true forces reuse", () => {
    assert.equal(parseStarterOptions(["--restart-existing"], {}).restartExisting, true);
    assert.equal(parseStarterOptions([], { BROWSER_USE_DISCOVERY_RESTART_EXISTING: "true" }).restartExisting, true);
    assert.equal(parseStarterOptions([], {}).restartExisting, false);
    assert.equal(parseStarterOptions(["--restart-existing"], { BROWSER_USE_DISCOVERY_REUSE_EXISTING: "true" }).restartExisting, false);
  });
});

import { decideAfterChildExit } from "../scripts/lib/discovery-worker-policy.mjs";

describe("worker starter supervision — a worker terminated by someone else must not take the dev stack down", () => {
  // 2026-09-02 09:19: Beat 5 saved the SerpApi key → /__proxy/full-boot restarted
  // the worker to load the new env → SIGTERM → the starter exited 0 → concurrently -k.
  it("holds the process open when a healthy replacement worker took the port", () => {
    assert.equal(decideAfterChildExit({ signal: "SIGTERM", initiatedByUs: false, replacementHealthy: true }), "hold");
  });
  it("respawns when the worker was killed and nothing replaced it", () => {
    assert.equal(decideAfterChildExit({ signal: "SIGTERM", initiatedByUs: false, replacementHealthy: false }), "respawn");
  });
  it("exits normally when the shutdown was ours (Ctrl-C / concurrently teardown)", () => {
    assert.equal(decideAfterChildExit({ signal: "SIGTERM", initiatedByUs: true, replacementHealthy: false }), "exit");
  });
  it("exits when the worker died on its own with a code (crash) rather than a signal", () => {
    assert.equal(decideAfterChildExit({ signal: null, code: 1, initiatedByUs: false, replacementHealthy: false }), "exit");
  });
});

describe("worker starter hold-watch — a reused worker that later dies must not leave a zombie holder", () => {
  // 2026-09-16: `npm run dev` kept the starter alive via holdProcessOpenForExistingWorker
  // (noopInterval, no child) after --restart-existing thought :8644 was healthy.
  // The real listener then disappeared and the starter never respawned — health
  // checks failed with connection refused while web+scraper stayed up.
  it("keeps holding while the reused worker is still healthy", () => {
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: true, shuttingDown: false }),
      "keep_holding",
    );
  });
  it("respawns when the reused worker is no longer healthy (after consecutive misses on a free port)", () => {
    // BEAUDIT G6 residual: a single missed probe from a busy worker must not
    // respawn (that respawn hit EADDRINUSE, exited 1, and tore the stack
    // down). Respawn needs consecutive misses plus a free port.
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 3, portFree: true }),
      "respawn",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 1, portFree: true }),
      "keep_holding",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 3, portFree: false }),
      "keep_holding",
    );
  });
  it("exits on our own shutdown instead of respawning into a tearing-down stack", () => {
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: true }),
      "exit",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: true, shuttingDown: true }),
      "exit",
    );
  });
});
