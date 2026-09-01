import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANARY_EXIT_CODES,
  classifyCanary,
  formatCanaryReport,
  parseArgs,
  runCanary,
} from "../scripts/discovery-canary.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEALTH_MOCK_PATH = join(
  repoRoot,
  "integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json",
);
const NOW = "2026-09-01T12:00:00.000Z";

function healthyWorkerBody(extra = {}) {
  return { ...JSON.parse(readFileSync(HEALTH_MOCK_PATH, "utf8")), ...extra };
}

/**
 * A fetch double that records every call so tests can prove the canary is
 * read-only and never reaches Google Sheets.
 */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    return handler(String(url), init);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function readerReturning(runs, overrides = {}) {
  const reader = ({ stateDir } = {}) => {
    reader.calls.push(stateDir);
    return { available: true, reason: "", runs, ...overrides };
  };
  reader.calls = [];
  return reader;
}

function completedRun(runId, completedAt, status = "completed") {
  return { runId, status, completedAt };
}

const HEALTHY_INPUT = {
  maxAgeHours: 24,
  configErrors: [],
  health: { reachable: true, ok: true, statusCode: 200, isDiscoveryWorker: true },
  runHistory: {
    available: true,
    reason: "",
    newestSuccess: { runId: "run_fresh", status: "completed", ageHours: 1 },
  },
};

test("CANARY-1: classifyCanary reports healthy (exit 0) when the worker is the discovery worker and a recent successful run exists", () => {
  const result = classifyCanary(HEALTHY_INPUT);
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.reasons, ["worker_healthy", "successful_run_fresh"]);
  assert.equal(CANARY_EXIT_CODES.healthy, 0);
});

test("CANARY-1: classifyCanary reports stale (exit 1) when no successful discovery run has ever landed", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    runHistory: { available: true, reason: "", newestSuccess: null },
  });
  assert.equal(result.status, "stale");
  assert.ok(result.reasons.includes("no_successful_run"));
  assert.equal(CANARY_EXIT_CODES.stale, 1);
});

test("CANARY-1: classifyCanary reports stale (exit 1) when the newest successful run is older than --max-age-hours", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    runHistory: {
      available: true,
      reason: "",
      newestSuccess: { runId: "run_old", status: "completed", ageHours: 25.5 },
    },
  });
  assert.equal(result.status, "stale");
  assert.ok(result.reasons.includes("successful_run_stale"));
});

test("CANARY-1: classifyCanary reports unavailable (exit 2) when the worker is unreachable", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    health: { reachable: false, ok: false, statusCode: 0, isDiscoveryWorker: false },
  });
  assert.equal(result.status, "unavailable");
  assert.ok(result.reasons.includes("worker_unreachable"));
  assert.equal(CANARY_EXIT_CODES.unavailable, 2);
});

test("CANARY-1: classifyCanary reports unavailable (exit 2) when the worker answers but is not healthy", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    health: { reachable: true, ok: false, statusCode: 503, isDiscoveryWorker: false },
  });
  assert.equal(result.status, "unavailable");
  assert.ok(result.reasons.includes("worker_unhealthy"));
});

test("CANARY-1: classifyCanary reports unavailable (exit 2) when the run history cannot be read", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    runHistory: {
      available: false,
      reason: "run_state_unreadable",
      newestSuccess: null,
    },
  });
  assert.equal(result.status, "unavailable");
  assert.ok(result.reasons.includes("run_state_unreadable"));
});

test("CANARY-1: classifyCanary reports misconfigured (exit 3) when the worker port answers with a different service", () => {
  const result = classifyCanary({
    ...HEALTHY_INPUT,
    health: { reachable: true, ok: true, statusCode: 200, isDiscoveryWorker: false },
  });
  assert.equal(result.status, "misconfigured");
  assert.ok(result.reasons.includes("worker_not_discovery_service"));
  assert.equal(CANARY_EXIT_CODES.misconfigured, 3);
});

test("CANARY-1: classifyCanary applies precedence misconfigured > unavailable > stale > healthy", () => {
  // A foreign service (misconfigured) AND an unreadable history (unavailable)
  // AND no successful run (stale) all apply at once.
  const worst = classifyCanary({
    maxAgeHours: 24,
    configErrors: ["invalid_max_age_hours"],
    health: { reachable: true, ok: true, statusCode: 200, isDiscoveryWorker: false },
    runHistory: { available: false, reason: "run_state_unreadable", newestSuccess: null },
  });
  assert.equal(worst.status, "misconfigured");
  assert.deepEqual(worst.reasons, [
    "invalid_max_age_hours",
    "worker_not_discovery_service",
    "run_state_unreadable",
  ]);

  // Unavailable outranks stale.
  assert.equal(
    classifyCanary({
      ...HEALTHY_INPUT,
      health: { reachable: false, ok: false, statusCode: 0, isDiscoveryWorker: false },
      runHistory: { available: true, reason: "", newestSuccess: null },
    }).status,
    "unavailable",
  );

  // Stale outranks healthy.
  assert.equal(
    classifyCanary({
      ...HEALTHY_INPUT,
      runHistory: {
        available: true,
        reason: "",
        newestSuccess: { runId: "run_old", status: "empty", ageHours: 99 },
      },
    }).status,
    "stale",
  );
});

test("CANARY-1: runCanary pins the worker /health contract against health-response.ok.v1.json", async () => {
  const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
  const reader = readerReturning([completedRun("run_recent", "2026-09-01T11:00:00.000Z")]);
  const report = await runCanary({
    now: NOW,
    maxAgeHours: 24,
    workerUrl: "http://127.0.0.1:8644",
    stateDir: "/fixture/run-state",
    fetchImpl,
    readRunHistory: reader,
  });

  assert.equal(report.status, "healthy");
  assert.equal(report.exitCode, 0);
  assert.equal(report.checkedAt, NOW);
  assert.equal(report.worker.isDiscoveryWorker, true);
  assert.equal(report.worker.healthUrlOrigin, "http://127.0.0.1:8644");
  assert.equal(report.run.runId, "run_recent");
  assert.equal(report.run.completedAt, "2026-09-01T11:00:00.000Z");
  assert.equal(report.run.ageHours, 1);
  assert.deepEqual(reader.calls, ["/fixture/run-state"]);
  assert.deepEqual(fetchImpl.calls, [
    { url: "http://127.0.0.1:8644/health", method: "GET" },
  ]);
});

test("CANARY-1: runCanary ignores ingest_ runs and non-success statuses when picking the newest successful run", async () => {
  const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
  const report = await runCanary({
    now: NOW,
    maxAgeHours: 24,
    fetchImpl,
    readRunHistory: readerReturning([
      completedRun("ingest_abc", "2026-09-01T11:59:00.000Z"),
      completedRun("run_failed", "2026-09-01T11:58:00.000Z", "failed"),
      completedRun("run_running", "2026-09-01T11:57:00.000Z", "running"),
      completedRun("run_partial", "2026-09-01T09:00:00.000Z", "partial"),
      completedRun("run_empty", "2026-09-01T10:00:00.000Z", "empty"),
      completedRun("run_broken_timestamp", "not-a-timestamp"),
    ]),
  });

  assert.equal(report.status, "healthy");
  assert.equal(report.run.runId, "run_empty", "empty counts as success; newest wins");
  assert.equal(report.run.ageHours, 2);
});

test("CANARY-1: runCanary reports unavailable and exit 2 when the worker refuses the connection", async () => {
  const fetchImpl = stubFetch(async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:8644");
  });
  const report = await runCanary({
    now: NOW,
    fetchImpl,
    readRunHistory: readerReturning([completedRun("run_recent", "2026-09-01T11:00:00.000Z")]),
  });
  assert.equal(report.status, "unavailable");
  assert.equal(report.exitCode, 2);
  assert.deepEqual(
    report.reasons,
    ["worker_unreachable", "successful_run_fresh"],
    "an unreachable worker still reports the run-history fact honestly",
  );
  assert.equal(report.worker.reachable, false);
  assert.equal(report.worker.statusCode, 0);
});

test("CANARY-1: runCanary reports misconfigured and exit 3 for an unusable --worker-url, and never fetches", async () => {
  const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
  const report = await runCanary({
    now: NOW,
    workerUrl: "not a url",
    fetchImpl,
    readRunHistory: readerReturning([]),
  });
  assert.equal(report.status, "misconfigured");
  assert.equal(report.exitCode, 3);
  assert.ok(report.reasons.includes("worker_url_invalid"));
  assert.deepEqual(fetchImpl.calls, []);
});

test("CANARY-1: runCanary never reads Google Sheets and says so with a fixed reason", async () => {
  const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
  const report = await runCanary({
    now: NOW,
    fetchImpl,
    readRunHistory: readerReturning([completedRun("run_recent", "2026-09-01T11:00:00.000Z")]),
  });
  assert.deepEqual(report.sheets, {
    status: "unavailable",
    reason: "sheets_credential_not_available",
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(!/sheets\.googleapis|googleapis\.com/.test(fetchImpl.calls[0].url));
});

test("CANARY-1: the default run-history reader is read-only and leaves the run-state directory byte-for-byte untouched", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "canary-state-"));
  try {
    const encode = (runId) => Buffer.from(runId, "utf8").toString("base64url");
    writeFileSync(
      join(stateDir, `${encode("run_real")}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        runId: "run_real",
        writtenAt: "2026-09-01T11:00:00.000Z",
        status: {
          runId: "run_real",
          status: "completed",
          terminal: true,
          message: "Discovery completed — worker processed the run.",
          trigger: "manual",
          request: { sheetId: "sheet_abc", variationKey: "v1", requestedAt: NOW },
          acceptedAt: "2026-09-01T10:59:00.000Z",
          completedAt: "2026-09-01T11:00:00.000Z",
          updatedAt: "2026-09-01T11:00:00.000Z",
          warnings: [],
          sources: [],
        },
      })}\n`,
      "utf8",
    );
    // Crash leftovers and junk the writable store would sweep away.
    writeFileSync(join(stateDir, `${encode("run_orphan")}.json.tmp-1-2-3`), "{}", "utf8");
    writeFileSync(join(stateDir, `${encode("run_bad")}.json`), "{not json", "utf8");

    const before = readdirSync(stateDir)
      .sort()
      .map((name) => [name, readFileSync(join(stateDir, name), "utf8")]);

    const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
    const report = await runCanary({ now: NOW, stateDir, fetchImpl });

    const after = readdirSync(stateDir)
      .sort()
      .map((name) => [name, readFileSync(join(stateDir, name), "utf8")]);

    assert.deepEqual(after, before, "the canary must not mutate the run-state directory");
    assert.equal(report.status, "healthy");
    assert.equal(report.run.runId, "run_real");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("CANARY-1: the default run-history reader reports unavailable when the run-state directory is absent", async () => {
  const parent = mkdtempSync(join(tmpdir(), "canary-missing-"));
  try {
    const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody()));
    const report = await runCanary({
      now: NOW,
      stateDir: join(parent, "does-not-exist"),
      fetchImpl,
    });
    assert.equal(report.status, "unavailable");
    assert.equal(report.exitCode, 2);
    assert.ok(report.reasons.includes("run_state_unreadable"));
    assert.deepEqual(readdirSync(parent), [], "the reader must never create the directory");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("CANARY-1: neither the JSON nor the text report leaks tokens, sheet ids, job titles, or run error strings", async () => {
  const secrets = [
    "ya29.fakeACCESStokenVALUE",
    "1AbCdEfGhIjKlMnOpQrStUvWxYz_SHEETID",
    "Staff Platform Engineer at Acme Corp",
    "Sheets append failed for ya29.fakeACCESStokenVALUE",
    "https://hooks.example.invalid/webhook",
  ];
  const fetchImpl = stubFetch(async () =>
    jsonResponse(
      healthyWorkerBody({
        accessToken: secrets[0],
        sheetId: secrets[1],
        lastJobTitle: secrets[2],
        webhookUrl: secrets[4],
      }),
    ),
  );
  const report = await runCanary({
    now: NOW,
    fetchImpl,
    readRunHistory: readerReturning([
      {
        runId: "run_leaky",
        status: "completed",
        completedAt: "2026-09-01T11:00:00.000Z",
        sheetId: secrets[1],
        error: secrets[3],
        jobTitle: secrets[2],
        accessToken: secrets[0],
      },
    ]),
  });

  const rendered = `${JSON.stringify(report)}\n${formatCanaryReport(report)}`;
  for (const secret of secrets) {
    assert.ok(
      !rendered.includes(secret),
      `canary output leaked ${JSON.stringify(secret)}`,
    );
  }
  assert.ok(!/ya29\.|AIza|sk-/.test(rendered), "canary output leaked a credential prefix");
  assert.equal(report.run.runId, "run_leaky");
  assert.equal(report.status, "healthy");
});

test("CANARY-1: every emitted reason comes from the fixed enum", async () => {
  const allowed = new Set([
    "worker_healthy",
    "successful_run_fresh",
    "no_successful_run",
    "successful_run_stale",
    "worker_unreachable",
    "worker_unhealthy",
    "run_state_unreadable",
    "worker_not_discovery_service",
    "worker_url_invalid",
    "unknown_argument",
    "invalid_max_age_hours",
    "sheets_credential_not_available",
  ]);
  const inputs = [
    HEALTHY_INPUT,
    { ...HEALTHY_INPUT, runHistory: { available: true, reason: "", newestSuccess: null } },
    {
      ...HEALTHY_INPUT,
      health: { reachable: false, ok: false, statusCode: 0, isDiscoveryWorker: false },
    },
    {
      ...HEALTHY_INPUT,
      health: { reachable: true, ok: true, statusCode: 200, isDiscoveryWorker: false },
    },
    { ...HEALTHY_INPUT, configErrors: ["unknown_argument", "not_a_real_reason"] },
  ];
  for (const input of inputs) {
    for (const reason of classifyCanary(input).reasons) {
      assert.ok(allowed.has(reason), `unexpected reason ${reason}`);
    }
  }
});

test("CANARY-1: formatCanaryReport renders one honest human line per finding", async () => {
  const fetchImpl = stubFetch(async () => jsonResponse(healthyWorkerBody(), 503));
  const report = await runCanary({
    now: NOW,
    fetchImpl,
    readRunHistory: readerReturning([]),
  });
  const text = formatCanaryReport(report);
  assert.match(text, /^discovery canary \(read-only\)/);
  assert.match(text, /status: unavailable/);
  assert.match(text, /worker_unhealthy/);
  assert.match(text, /no_successful_run/);
  assert.match(text, /exit code: 2/);
  assert.ok(text.endsWith("\n"));
  assert.ok(
    !text.includes("may still be running"),
    "the canary never speculates about an unknown run",
  );
});

test("CANARY-1: parseArgs accepts the documented flags and rejects everything else", () => {
  assert.deepEqual(parseArgs([]), {
    help: false,
    json: false,
    maxAgeHours: 24,
    stateDir: "",
    workerUrl: "",
  });
  assert.deepEqual(
    parseArgs(["--max-age-hours", "6", "--json", "--state-dir", "/tmp/rs", "--worker-url", "http://127.0.0.1:9999"]),
    {
      help: false,
      json: true,
      maxAgeHours: 6,
      stateDir: "/tmp/rs",
      workerUrl: "http://127.0.0.1:9999",
    },
  );
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);

  for (const [argv, reason] of [
    [["--nope"], "unknown_argument"],
    [["--max-age-hours", "0"], "invalid_max_age_hours"],
    [["--max-age-hours", "1.5"], "invalid_max_age_hours"],
    [["--max-age-hours", "abc"], "invalid_max_age_hours"],
    [["--max-age-hours"], "invalid_max_age_hours"],
    [["--state-dir"], "unknown_argument"],
    [["--worker-url"], "unknown_argument"],
  ]) {
    assert.throws(
      () => parseArgs(argv),
      (error) => {
        assert.equal(error.canaryReason, reason, `argv ${JSON.stringify(argv)}`);
        return true;
      },
    );
  }
});

test("CANARY-1: an argument error maps to a misconfigured report with exit code 3", () => {
  let thrown = null;
  try {
    parseArgs(["--bogus"]);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "parseArgs must throw on an unknown flag");
  const report = classifyCanary({
    maxAgeHours: 24,
    configErrors: [thrown.canaryReason],
    health: { reachable: false, ok: false, statusCode: 0, isDiscoveryWorker: false },
    runHistory: { available: false, reason: "run_state_unreadable", newestSuccess: null },
  });
  assert.equal(report.status, "misconfigured");
  assert.equal(CANARY_EXIT_CODES[report.status], 3);
});
