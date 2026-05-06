import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSourcePath = join(
  repoRoot,
  "integrations",
  "cloudflare-relay-template",
  "src",
  "worker.js",
);

async function loadWorker() {
  const source = readFileSync(workerSourcePath, "utf8");
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const mod = await import(dataUrl);
  return mod.default;
}

test("relay health returns 200 without upstream fetch", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("unexpected");
  };
  try {
    const res = await worker.fetch(
      new Request("https://relay.example/health", { method: "GET" }),
      {},
    );
    assert.equal(res.status, 200);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relay forwards POST /discovery to DISCOVERY_TARGET /discovery", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"ok":true}', {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const req = new Request("https://relay.example/discovery", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret-1",
      },
      body: '{"event":"command-center.discovery"}',
    });
    const res = await worker.fetch(req, {
      DISCOVERY_TARGET: "https://abc.ngrok-free.app/",
      SHARED_SECRET: "secret-1",
    });

    assert.equal(res.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://abc.ngrok-free.app/discovery");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relay rejects relayed requests when SHARED_SECRET bearer is wrong", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}");
  };
  try {
    const res = await worker.fetch(
      new Request("https://relay.example/discovery", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: "{}",
      }),
      {
        DISCOVERY_TARGET: "https://abc.ngrok-free.app",
        SHARED_SECRET: "secret-1",
      },
    );
    assert.equal(res.status, 401);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relay forwards GET /runs/:runId to DISCOVERY_TARGET /runs/:runId", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('{"status":"complete"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const res = await worker.fetch(
      new Request("https://relay.example/runs/run-123?verbose=1", {
        method: "GET",
      }),
      { DISCOVERY_TARGET: "https://abc.ngrok-free.app" },
    );

    assert.equal(res.status, 200);
    assert.deepEqual(calls.map((call) => [call.url, call.init.method]), [
      ["https://abc.ngrok-free.app/runs/run-123?verbose=1", "GET"],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
