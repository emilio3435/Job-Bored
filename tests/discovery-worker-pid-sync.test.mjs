/**
 * Lane C (tunnel-leak repair): scripts/start-discovery-worker-local.mjs must
 * sync the recorded workerPid in discovery-local-bootstrap.json to the LIVE
 * listener owner on boot, so a PID left behind by a previous boot can never
 * masquerade as the current owner (the stale-PID/EADDRINUSE confusion).
 *
 * The file-writing call sites are covered indirectly: these tests pin the
 * decision core (pure, no fs, no spawn) that both write paths funnel through.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveLiveListenerOwnerPid,
  resolveWorkerPidRecord,
} from "../scripts/start-discovery-worker-local.mjs";

describe("resolveLiveListenerOwnerPid — live owner truth", () => {
  it("returns the first live listener PID", () => {
    assert.equal(
      resolveLiveListenerOwnerPid(8644, { listPids: () => [1234, 5678] }),
      1234,
    );
  });

  it("returns 0 when nothing listens (honest empty, not a stale PID)", () => {
    assert.equal(resolveLiveListenerOwnerPid(8644, { listPids: () => [] }), 0);
  });

  it("returns null when the port cannot be inspected (lsof missing)", () => {
    assert.equal(resolveLiveListenerOwnerPid(8644, { listPids: () => null }), null);
    assert.equal(
      resolveLiveListenerOwnerPid(8644, { listPids: () => undefined }),
      null,
    );
  });
});

describe("resolveWorkerPidRecord — PID file sync decision", () => {
  it("adopts the live owner, replacing a stale recorded PID", () => {
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: 1234, existingPid: 999 }),
      { workerPid: 1234, changed: true },
    );
  });

  it("clears a stale recorded PID to null when nothing listens", () => {
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: 0, existingPid: 999 }),
      { workerPid: null, changed: true },
    );
  });

  it("keeps the recorded PID when the port cannot be inspected", () => {
    // Staleness can't be proven without inspection — never clobber blind.
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: null, existingPid: 999 }),
      { workerPid: 999, changed: false },
    );
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: null, existingPid: undefined }),
      { workerPid: null, changed: false },
    );
  });

  it("reports unchanged when the recorded PID already matches the live owner", () => {
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: 1234, existingPid: 1234 }),
      { workerPid: 1234, changed: false },
    );
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: 0, existingPid: null }),
      { workerPid: null, changed: false },
    );
  });

  it("treats non-PID recordings (0, negative, junk) as empty", () => {
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: 1234, existingPid: 0 }),
      { workerPid: 1234, changed: true },
    );
    assert.deepEqual(
      resolveWorkerPidRecord({ liveOwnerPid: "1234", existingPid: 1234 }),
      { workerPid: null, changed: true },
    );
  });
});
