// DISCAT C1 (D5): GET /candidates on the worker router, booted on port 0.
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  CandidateCatalogListQuery,
  CandidateCatalogListResult,
} from "../../src/contracts.ts";
import { createWorkerRequestListener } from "../../src/webhook/worker-router.ts";

const SECRET = "candidates-secret";

async function boot(runMode: "local" | "hosted" = "local") {
  const queries: CandidateCatalogListQuery[] = [];
  const reply = async () => ({ status: 200, headers: {}, body: "{}" });
  const server: Server = createServer(
    createWorkerRequestListener({
      runtimeConfig: {
        runMode,
        allowedOrigins: [],
        allowedHosts: [],
        webhookSecret: SECRET,
      },
      runStatusStore: { get: () => null },
      buildHealthPayload: async () => ({ ok: true }),
      handlers: {
        discovery: reply,
        discoveryProfile: reply,
        pipelineUpdate: reply,
        ingestUrl: reply,
        cleanupExpired: reply,
      },
      logEvent: () => {},
      candidateCatalog: {
        listCandidates(query: CandidateCatalogListQuery): CandidateCatalogListResult {
          queries.push(query);
          return {
            rows: [
              {
                sheetId: "sheet_a",
                fingerprintKey: "url:https://boards.greenhouse.io/acme/jobs/1",
                companyKey: "acme",
                title: "Backend Engineer",
                url: "https://boards.greenhouse.io/acme/jobs/1",
                sourceId: "greenhouse",
                status: "backlog",
                rejectReason: "",
                rejectDetail: "",
                fitScore: 6,
                matchScore: 8,
                leadPayload: { title: "Backend Engineer" },
                firstSeenAt: "2026-09-26T00:00:00.000Z",
                lastSeenAt: "2026-09-26T00:00:00.000Z",
                seenCount: 1,
                lastRunId: "run_1",
              },
            ],
            counts: { backlog: 1, rejected: 4 },
            total: 5,
          };
        },
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const send = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers: { host: `127.0.0.1:${port}`, ...headers },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode || 0, body: JSON.parse(text || "{}") });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  return {
    send,
    queries,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("should return catalog rows and counts by status for GET /candidates", async () => {
  const app = await boot();
  try {
    const res = await app.send("/candidates?status=backlog&limit=5000");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.counts, { backlog: 1, rejected: 4 });
    assert.equal(res.body.total, 5);
    const rows = res.body.rows as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "backlog");
    assert.equal("leadPayload" in rows[0], false, "lead payloads stay server-side");
    assert.deepEqual(app.queries[0], { status: "backlog", limit: 1000, sheetId: null });

    const defaults = await app.send("/candidates");
    assert.equal(defaults.status, 200);
    assert.deepEqual(app.queries[1], { status: null, limit: 100, sheetId: null });
  } finally {
    await app.close();
  }
});

test("should reject an unknown status with a 400 api-error", async () => {
  const app = await boot();
  try {
    const res = await app.send("/candidates?status=bogus");
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "invalid_status");
    assert.equal(res.body.ok, false);
    assert.equal(app.queries.length, 0);
  } finally {
    await app.close();
  }
});

test("should require the webhook secret for GET /candidates on a hosted worker", async () => {
  const app = await boot("hosted");
  try {
    const denied = await app.send("/candidates");
    assert.equal(denied.status, 401);
    const allowed = await app.send("/candidates", { "x-discovery-secret": SECRET });
    assert.equal(allowed.status, 200);
  } finally {
    await app.close();
  }
});
