import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBroadcastHub,
  createClock,
  createDocument,
  createStorage,
  flush,
  loadDiscoveryTab,
  runStatusBody,
} from "./holes-disco-harness.mjs";

/* HOLES DISCO D13 — tabs share one run: the jb-discovery-run
   BroadcastChannel elects one tab to poll, the others mirror its state
   without polling or toasting, and a hidden tab pauses. */

function twoTabs(bodyFor) {
  const clock = createClock();
  const storage = createStorage();
  const hub = createBroadcastHub();
  const polls = [];
  const make = (name) => {
    const fetchImpl = async (url) => {
      polls.push({ tab: name, url: String(url) });
      const n = polls.length;
      return { ok: true, status: 200, json: async () => bodyFor(n) };
    };
    return loadDiscoveryTab({ clock, storage, hub, fetch: fetchImpl, document: createDocument() });
  };
  // Tab b is opened on demand: before the run starts it must learn it over
  // the channel, after the run starts it reads it from storage like a reload.
  const a = make("a");
  return { a, openB: () => make("b"), clock, polls };
}

function startIn(tab) {
  tab.tracker.beginTracking({
    runId: "run_x",
    statusPath: "/runs/run_x",
    pollAfterMs: 2000,
    webhookUrl: tab.webhookUrl,
  });
  void tab.status.startDiscoveryStatusPolling(tab.webhookUrl);
}

describe("D13 · one tab polls a run; the others mirror it", () => {
  it("a second tab that knows the run does not poll it too", async () => {
    const { a, openB, clock, polls } = twoTabs(() => runStatusBody("run_x"));
    startIn(a);
    await flush();
    const b = openB();
    assert.equal(b.tracker.getState().runId, "run_x");
    b.status.resumeDiscoveryStatusPollingIfNeeded();
    await clock.advance(10000);
    assert.equal(polls.length, 5, `one poller at 2 s for 10 s, saw ${polls.length}`);
  });

  it("the other tab learns the run without reloading, and a second Run there is run_active", async () => {
    const { a, openB } = twoTabs(() => runStatusBody("run_x"));
    const b = openB();
    startIn(a);
    await flush();
    assert.equal(b.tracker.getState().runId, "run_x");
    assert.equal(b.tracker.isActive(), true);
  });

  it("only the polling tab toasts the outcome; the other refreshes its board quietly", async () => {
    const done = runStatusBody("run_x", {
      status: "completed",
      terminal: true,
      writeResult: { appended: 2, updated: 0 },
    });
    const { a, openB, clock } = twoTabs((n) => (n >= 2 ? done : runStatusBody("run_x")));
    startIn(a);
    await flush();
    const b = openB();
    b.status.resumeDiscoveryStatusPollingIfNeeded();
    a.toasts.length = 0;
    b.toasts.length = 0;
    await clock.advance(6000);
    assert.equal(b.tracker.getState().status, "completed");
    const all = [...a.toasts, ...b.toasts].filter((t) => /Found 2 new roles/.test(t.message));
    assert.equal(all.length, 1, "the outcome is announced once across tabs");
    assert.equal(b.loads.length, 1, "the quiet tab still reloads its board");
  });

  it("when the polling tab goes away, another tab takes over", async () => {
    const { a, openB, clock, polls } = twoTabs(() => runStatusBody("run_x"));
    startIn(a);
    await flush();
    const b = openB();
    b.status.resumeDiscoveryStatusPollingIfNeeded();
    await clock.advance(4000);
    assert.ok(polls.every((p) => p.tab === "a"));
    a.document.setVisibility("hidden");
    await flush();
    await clock.advance(4000);
    assert.ok(polls.some((p) => p.tab === "b"), "tab b polls once tab a stepped back");
  });
});

describe("D13 · a hidden tab pauses polling", () => {
  it("polls nothing while hidden and polls at once when shown", async () => {
    const polls = [];
    const tab = loadDiscoveryTab({
      fetch: async (url) => {
        polls.push(String(url));
        return { ok: true, status: 200, json: async () => runStatusBody("run_x") };
      },
    });
    startIn(tab);
    await tab.clock.advance(2000);
    assert.equal(polls.length, 1);
    tab.document.setVisibility("hidden");
    await tab.clock.advance(60000);
    assert.equal(polls.length, 1, "no polls while hidden");
    tab.document.setVisibility("visible");
    await flush();
    assert.equal(polls.length, 2, "polled immediately on visible");
    await tab.clock.advance(2000);
    assert.equal(polls.length, 3, "and back on the normal cadence");
  });
});
