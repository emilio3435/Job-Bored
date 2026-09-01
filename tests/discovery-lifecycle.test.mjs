// LIFECYCLE-1 — browser-side characterization of the accepted-ack status path.
//
// The worker's ack contract is camelCase (`DiscoveryWebhookAck.statusPath`,
// contracts.ts:1041), but a relay/Apps Script hop can hand the dashboard the
// snake_case spelling instead. discovery-status-handoff.js:542 accepts both.
// That tolerance is load-bearing — without it the poller falls through to
// synthesis, which only works for a local worker, so a hosted run would silently
// never be polled. Nothing pinned it before this file (`grep -rn "status_path"
// tests/` -> 0 hits), so a refactor could have dropped the snake_case branch
// without a single test going red.
//
// Characterization only: no production file changes for this suite.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);

const LOCAL_WEBHOOK = "http://127.0.0.1:8644/webhook";
const HOSTED_STATUS_PATH = "/runs/run_x?statusToken=t";

/**
 * Mount discovery-status-handoff.js as the classic-global IIFE it is, using the
 * same vm harness as tests/run-status-honesty.test.mjs:67-117.
 */
function loadStatus(hostOverrides = {}) {
  const window = { location: { search: "", pathname: "/", hash: "" } };
  const document = { getElementById: () => null };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, {
    filename: "discovery-status-handoff.js",
  });
  window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => ({}),
      isActive: () => false,
      isTerminal: () => false,
    },
  };
  window.JobBoredDiscovery.status.host = {
    showToast: () => {},
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => LOCAL_WEBHOOK,
    normalizeDiscoveryWebhookIdentity: (url) => String(url || ""),
    isLocalWebhookCandidateUrl: () => true,
    isLocalDashboardOrigin: () => false,
    loadAllData: async () => {},
    ...hostOverrides,
  };
  return window.JobBoredDiscovery.status;
}

describe("LIFECYCLE-1 — accepted ack statusPath contract", () => {
  it("LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack", () => {
    const status = loadStatus();

    assert.equal(
      status.resolveAcceptedRunStatusPath(
        { runId: "run_x", statusPath: HOSTED_STATUS_PATH },
        LOCAL_WEBHOOK,
      ),
      HOSTED_STATUS_PATH,
      "the worker's own spelling must be used verbatim, query string included",
    );
  });

  it("LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack", () => {
    const status = loadStatus();

    assert.equal(
      status.resolveAcceptedRunStatusPath(
        { runId: "run_x", status_path: HOSTED_STATUS_PATH },
        LOCAL_WEBHOOK,
      ),
      HOSTED_STATUS_PATH,
      "a relay that snake_cases the ack must still point the poller at the run",
    );
  });

  it("LIFECYCLE-1: a snake_case ack from a hosted worker is polled rather than dropped", () => {
    // No synthesis is possible for a hosted worker, so if the snake_case branch
    // were removed this run would never be polled at all.
    const status = loadStatus({
      getDiscoveryWebhookUrl: () => "https://worker.example.test/webhook",
      isLocalWebhookCandidateUrl: () => false,
    });

    assert.equal(
      status.resolveAcceptedRunStatusPath(
        { runId: "run_x", status_path: HOSTED_STATUS_PATH },
        "https://worker.example.test/webhook",
      ),
      HOSTED_STATUS_PATH,
    );
    assert.equal(
      status.resolveAcceptedRunStatusPath(
        { runId: "run_x" },
        "https://worker.example.test/webhook",
      ),
      "",
      "control: with neither spelling present a hosted run yields no path",
    );
  });

  it("LIFECYCLE-1: camelCase wins when an ack carries both spellings", () => {
    const status = loadStatus();

    assert.equal(
      status.resolveAcceptedRunStatusPath(
        {
          runId: "run_x",
          statusPath: "/runs/run_camel",
          status_path: "/runs/run_snake",
        },
        LOCAL_WEBHOOK,
      ),
      "/runs/run_camel",
      "the worker's own contract spelling is authoritative",
    );
  });

  it("LIFECYCLE-1: a blank status_path falls through to synthesis instead of polling an empty path", () => {
    const status = loadStatus();

    assert.equal(
      status.resolveAcceptedRunStatusPath(
        { runId: "run_x", status_path: "   " },
        LOCAL_WEBHOOK,
      ),
      "/runs/run_x",
      "an empty spelling must not shadow the local synthesis fallback",
    );
  });
});
