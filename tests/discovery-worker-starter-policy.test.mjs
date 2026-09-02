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
import { decideExistingWorkerAction, parseStarterOptions } from "../scripts/lib/discovery-worker-policy.mjs";

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
