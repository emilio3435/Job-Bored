import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBroadcastHub,
  createClock,
  createStorage,
  loadDiscoveryTab,
} from "./holes-disco-harness.mjs";

/* HOLES DISCO — runs the browser cannot watch settle: they stop blocking,
   they stop re-toasting on every reload, and the user can dismiss them. */

const KEY = "command_center_discovery_run_state";

function reload(tab) {
  // A reload is a fresh tab over the same origin storage.
  return loadDiscoveryTab({
    clock: tab.clock,
    storage: tab.storage,
    hub: createBroadcastHub(),
  });
}

describe("D5 · an accepted run with no status path", () => {
  function untrackedRun() {
    const tab = loadDiscoveryTab({ clock: createClock(), storage: createStorage() });
    tab.tracker.beginTracking({
      runId: "run_u",
      statusPath: "",
      webhookUrl: tab.webhookUrl,
      statusUnavailable: true,
    });
    tab.status.renderDiscoveryRunStatus();
    return tab;
  }

  it("is surfaced once when it starts, then settles instead of staying pending", () => {
    const tab = untrackedRun();
    assert.equal(tab.toasts.length, 1);
    assert.match(tab.toasts[0].message, /can't send live updates/);
    assert.equal(tab.tracker.isSettled(), true);
    assert.equal(tab.tracker.isActive(), false, "it no longer blocks a new run");
  });

  it("does not re-toast on every reload", () => {
    const first = untrackedRun();
    for (let i = 0; i < 3; i += 1) {
      const next = reload(first);
      next.status.resumeDiscoveryStatusPollingIfNeeded();
      assert.deepEqual(next.toasts, [], `reload ${i + 1} stayed quiet`);
    }
  });

  it("can be dismissed", () => {
    const tab = untrackedRun();
    tab.status.dismissDiscoveryRun();
    assert.equal(tab.tracker.getState().status, "idle");
    assert.equal(tab.storage.getItem(KEY), null);
  });
});

describe("D6 · a lost run, or one the worker has no record of", () => {
  function lostRun(how) {
    const tab = loadDiscoveryTab({ clock: createClock(), storage: createStorage() });
    tab.tracker.beginTracking({
      runId: "run_l",
      statusPath: "/runs/run_l",
      webhookUrl: tab.webhookUrl,
    });
    if (how === "404") {
      tab.tracker.markStatusEndpointTerminal(tab.status.describeTerminalRunStatusPoll(404));
    } else {
      tab.tracker.markStatusConnectionLost("Lost the status connection after multiple attempts.");
    }
    return tab;
  }

  for (const how of ["404", "lost"]) {
    it(`(${how}) settles and stays quiet across reloads`, () => {
      const first = lostRun(how);
      assert.equal(first.tracker.isSettled(), true);
      assert.equal(first.tracker.isActive(), false);
      for (let i = 0; i < 2; i += 1) {
        const next = reload(first);
        next.status.resumeDiscoveryStatusPollingIfNeeded();
        assert.deepEqual(next.toasts, [], `reload ${i + 1} stayed quiet`);
      }
    });

    it(`(${how}) can be dismissed, which clears the stored run for every reader`, () => {
      const tab = lostRun(how);
      tab.status.dismissDiscoveryRun();
      assert.equal(tab.tracker.getState().status, "idle");
      assert.equal(tab.storage.getItem(KEY), null);
      const next = reload(tab);
      assert.equal(next.tracker.getState().runId, "");
    });
  }
});
