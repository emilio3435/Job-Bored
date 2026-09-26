// BEAUDIT A14: the worker router, booted in-process on node:http port 0.
// Covers pre-route parsing (A1's `//`), the 404/405/413 mapping, the
// catch-all, the route aliases, `POST /runs/:id/cancel` (A21) and the
// api-error.v1 envelope on every error body (E7 / A13).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import { createRunCancelRegistry } from "../../src/webhook/run-async-lifecycle.ts";
import {
  createWorkerRequestListener,
  type WorkerRouteHandlers,
} from "../../src/webhook/worker-router.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as { default: (a: unknown) => void }).default(ajv);
const validateApiError = ajv.compile(
  JSON.parse(readFileSync(join(repoRoot, "schemas", "api-error.v1.schema.json"), "utf8")),
);

const SECRET = "router-secret";

type Handled = { route: string; body: string };

async function boot(options: {
  handlers?: Partial<WorkerRouteHandlers>;
  statuses?: Record<string, Record<string, unknown>>;
  cancelRegistry?: ReturnType<typeof createRunCancelRegistry>;
  readBody?: () => Promise<string>;
} = {}) {
  const handled: Handled[] = [];
  const reply = (route: string) => async (req: { bodyText: string }) => {
    handled.push({ route, body: req.bodyText });
    return {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true, route }),
    };
  };
  const handlers: WorkerRouteHandlers = {
    discovery: reply("discovery"),
    discoveryProfile: reply("discoveryProfile"),
    pipelineUpdate: reply("pipelineUpdate"),
    ingestUrl: reply("ingestUrl"),
    cleanupExpired: reply("cleanupExpired"),
    ...options.handlers,
  };
  const statuses = options.statuses || {};
  const server: Server = createServer(
    createWorkerRequestListener({
      runtimeConfig: {
        runMode: "local",
        allowedOrigins: [],
        allowedHosts: [],
        webhookSecret: SECRET,
      },
      runStatusStore: { get: (id: string) => (statuses[id] as never) ?? null },
      cancelRegistry: options.cancelRegistry,
      buildHealthPayload: async () => ({ ok: true, service: "test" }),
      handlers,
      logEvent: () => {},
      ...(options.readBody ? { readBody: options.readBody } : {}),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const send = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; body: Record<string, unknown>; text: string; headers: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path,
            method: init.method || "GET",
            headers: { host: `127.0.0.1:${port}`, ...(init.headers || {}) },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () => {
              let body: Record<string, unknown> = {};
              try {
                body = JSON.parse(text);
              } catch {}
              resolve({ status: res.statusCode || 0, body, text, headers: res.headers });
            });
          },
        );
        req.on("error", reject);
        if (init.body) req.write(init.body);
        req.end();
      },
    );
  return { send, handled, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function assertApiError(body: Record<string, unknown>, code?: string) {
  assert.equal(validateApiError(body), true, `not api-error.v1: ${JSON.stringify(body)} ${ajv.errorsText(validateApiError.errors)}`);
  if (code) assert.equal(body.code, code);
  assert.equal(body.ok, false, "legacy ok:false is kept");
  assert.equal(typeof body.message, "string", "legacy message is kept");
}

const authed = { "x-discovery-secret": SECRET, "content-type": "application/json" };

test("A14/A1: a raw `//` path is a 400 api-error and the listener keeps serving", async () => {
  const app = await boot();
  try {
    const raw = await app.send("//");
    assert.equal(raw.status, 400);
    assertApiError(raw.body, "malformed_url");
    const health = await app.send("/health");
    assert.equal(health.status, 200);
  } finally {
    await app.close();
  }
});

test("A14/E7: an unknown path is a JSON 404 api-error", async () => {
  const app = await boot();
  try {
    const res = await app.send("/nope");
    assert.equal(res.status, 404);
    assert.match(String(res.headers["content-type"]), /application\/json/);
    assertApiError(res.body, "not_found");
  } finally {
    await app.close();
  }
});

test("A14: route aliases dispatch to their handlers", async () => {
  const app = await boot();
  try {
    for (const [path, route] of [
      ["/", "discovery"],
      ["/webhook", "discovery"],
      ["/discovery", "discovery"],
      ["/discovery-profile", "discoveryProfile"],
      ["/pipeline-update", "pipelineUpdate"],
      ["/ingest-url", "ingestUrl"],
      ["/cleanup-expired", "cleanupExpired"],
    ]) {
      const res = await app.send(path, { method: "POST", headers: authed, body: "{}" });
      assert.equal(res.status, 200, path);
      assert.equal(res.body.route, route, path);
    }
  } finally {
    await app.close();
  }
});

test("A14/E7: 405 and 401 are api-errors", async () => {
  const app = await boot();
  try {
    const wrongMethod = await app.send("/webhook");
    assert.equal(wrongMethod.status, 405);
    assertApiError(wrongMethod.body, "method_not_allowed");
    const noSecret = await app.send("/webhook", { method: "POST", body: "{}" });
    assert.equal(noSecret.status, 401);
    assertApiError(noSecret.body, "unauthorized");
    assert.ok(noSecret.body.nextStep, "the auth remediation becomes nextStep");
  } finally {
    await app.close();
  }
});

test("A14/E7: an oversized body is a route-neutral 413 api-error", async () => {
  const { BodyTooLargeError } = await import("../../src/http/body-limit.ts");
  const app = await boot({
    readBody: async () => {
      throw new BodyTooLargeError(1);
    },
  });
  try {
    const res = await app.send("/ingest-url", { method: "POST", headers: authed, body: "{}" });
    assert.equal(res.status, 413);
    assertApiError(res.body, "payload_too_large");
    assert.doesNotMatch(String(res.body.error), /ATS|ingest|discovery/i);
  } finally {
    await app.close();
  }
});

test("A14: a throwing handler answers a 500 api-error and the worker survives", async () => {
  const app = await boot({
    handlers: {
      pipelineUpdate: async () => {
        throw new Error("patcher exploded");
      },
    },
  });
  try {
    const res = await app.send("/pipeline-update", { method: "POST", headers: authed, body: "{}" });
    assert.equal(res.status, 500);
    assertApiError(res.body, "internal_error");
    assert.equal(res.body.retryable, true);
    assert.match(String(res.body.detail), /exploded/);
    assert.equal((await app.send("/health")).status, 200);
  } finally {
    await app.close();
  }
});

test("E7/A13: a handler's legacy {ok:false,message} body leaves with the envelope, reason becomes code", async () => {
  const app = await boot({
    handlers: {
      ingestUrl: async () => ({
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, reason: "blocked_aggregator", host: "x", message: "blocked", hint: "Try the employer link." }),
      }),
      pipelineUpdate: async () => ({
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, message: "No matching Pipeline row." }),
      }),
    },
  });
  try {
    const ingest = await app.send("/ingest-url", { method: "POST", headers: authed, body: "{}" });
    assert.equal(ingest.status, 200, "ingest outcomes keep HTTP 200 for the dashboard");
    assertApiError(ingest.body, "blocked_aggregator");
    assert.equal(ingest.body.reason, "blocked_aggregator");
    assert.equal(ingest.body.nextStep, "Try the employer link.");
    const patch = await app.send("/pipeline-update", { method: "POST", headers: authed, body: "{}" });
    assert.equal(patch.status, 404);
    assertApiError(patch.body, "not_found");
  } finally {
    await app.close();
  }
});

test("A14: GET /runs/:id serves the status and a missing run is a 404 api-error", async () => {
  const app = await boot({
    statuses: { run_1: { runId: "run_1", status: "running", terminal: false } },
  });
  try {
    const found = await app.send("/runs/run_1");
    assert.equal(found.status, 200);
    assert.equal(found.body.runId, "run_1");
    const missing = await app.send("/runs/run_2");
    assert.equal(missing.status, 404);
    assertApiError(missing.body, "run_not_found");
  } finally {
    await app.close();
  }
});

test("A21: POST /runs/:id/cancel requires the secret, cancels a live run, and refuses a finished one", async () => {
  const registry = createRunCancelRegistry();
  const statuses: Record<string, Record<string, unknown>> = {
    run_live: { runId: "run_live", status: "running", terminal: false },
    run_done: { runId: "run_done", status: "completed", terminal: true },
    run_elsewhere: { runId: "run_elsewhere", status: "running", terminal: false },
  };
  let cancelledWith = "";
  registry.register("run_live", async (reason) => {
    cancelledWith = reason;
    statuses.run_live = { runId: "run_live", status: "failed", terminal: true, error: reason };
    return { cancelled: true, status: statuses.run_live as never };
  });
  const app = await boot({ statuses, cancelRegistry: registry });
  try {
    const anon = await app.send("/runs/run_live/cancel", { method: "POST" });
    assert.equal(anon.status, 401);
    assertApiError(anon.body, "unauthorized");
    assert.equal(registry.has("run_live"), true, "an unauthenticated call cancels nothing");

    const getCancel = await app.send("/runs/run_live/cancel", { headers: authed });
    assert.equal(getCancel.status, 405);

    const ok = await app.send("/runs/run_live/cancel", { method: "POST", headers: authed });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.cancelled, true);
    assert.equal((ok.body.run as Record<string, unknown>).status, "failed");
    assert.match(cancelledWith, /cancelled by user/i);

    const done = await app.send("/runs/run_done/cancel", { method: "POST", headers: authed });
    assert.equal(done.status, 409);
    assertApiError(done.body, "run_already_terminal");

    const elsewhere = await app.send("/runs/run_elsewhere/cancel", { method: "POST", headers: authed });
    assert.equal(elsewhere.status, 409);
    assertApiError(elsewhere.body, "run_not_cancellable");

    const missing = await app.send("/runs/run_none/cancel", { method: "POST", headers: authed });
    assert.equal(missing.status, 404);
    assertApiError(missing.body, "run_not_found");
  } finally {
    await app.close();
  }
});

test("A21 repair: POST /runs/:id/cancel answers 503 cancel_status_not_saved when the cancelled status could not be persisted", async () => {
  const registry = createRunCancelRegistry();
  const statuses: Record<string, Record<string, unknown>> = {
    run_live: { runId: "run_live", status: "running", terminal: false },
    run_slow: { runId: "run_slow", status: "running", terminal: false },
  };
  registry.register("run_live", async () => ({ cancelled: true, status: null, saved: false }));
  registry.register("run_slow", async () => ({
    cancelled: true,
    stopConfirmed: false,
    status: { runId: "run_slow", status: "failed", terminal: true } as never,
  }));
  const app = await boot({ statuses, cancelRegistry: registry });
  try {
    const unsaved = await app.send("/runs/run_live/cancel", { method: "POST", headers: authed });
    assert.equal(unsaved.status, 503);
    assertApiError(unsaved.body, "cancel_status_not_saved");
    assert.equal(unsaved.body.retryable, true);
    assert.equal(registry.has("run_live"), true, "a retry can still save the cancel");

    const unconfirmed = await app.send("/runs/run_slow/cancel", { method: "POST", headers: authed });
    assert.equal(unconfirmed.status, 200);
    assert.equal(unconfirmed.body.cancelled, true);
    assert.equal(unconfirmed.body.stopConfirmed, false);
  } finally {
    await app.close();
  }
});
