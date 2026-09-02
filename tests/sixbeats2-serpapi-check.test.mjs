/**
 * SIXBEATS-2 NEW-3 — the fuel check is REAL.
 *
 * The acceptance rerun (evidence/rerun-09-02, NEW-3) watched Beat 5 report
 * "Google Jobs index connected — 100 searches/mo" after nothing more than an
 * env write and a worker restart: the key was never shown to SerpApi, so a
 * typo'd key produced a confident green check and a discovery engine that
 * would find nothing the next morning.
 *
 * SIXBEATS2-SPEC locked decision 5 makes the check real: a dev-server route
 * calls SerpApi's account endpoint SERVER-SIDE (the browser cannot — no CORS
 * on serpapi.com, and the key has no business crossing an origin it does not
 * have to) and answers `{ok, plan, searchesLeft}`.
 *
 * These probes hold the route to that contract with a stubbed upstream:
 * the local-origin posture of its sibling proxies, a real quota on success,
 * and a NAMED reason for every failure so the beat can offer a next action
 * instead of a shrug.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };

const ACCOUNT_URL = "https://serpapi.com/account.json";

/** A free-plan account.json, in SerpApi's own field names. */
const FREE_ACCOUNT = {
  account_email: "someone@example.test",
  plan_name: "Free",
  searches_per_month: 100,
  plan_searches_left: 97,
  total_searches_left: 97,
  this_month_usage: 3,
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function withDevServer(fn) {
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server);
  }
}

/**
 * Intercept ONLY serpapi.com. The test's own requests to the dev-server go
 * through the real fetch, so the mock cannot accidentally answer them.
 */
let realFetch = null;
const upstreamCalls = [];

function stubUpstream(handler) {
  upstreamCalls.length = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.startsWith(ACCOUNT_URL)) {
      upstreamCalls.push(u);
      return handler(new URL(u), init);
    }
    return realFetch(url, init);
  };
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function postCheck(baseUrl, body, extraHeaders = {}) {
  return fetch(`${baseUrl}/__proxy/serpapi-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /__proxy/serpapi-check (SIXBEATS2 NEW-3, locked decision 5)", () => {
  it("asks SerpApi about the key and returns the real quota", async () => {
    stubUpstream(
      async () =>
        new Response(JSON.stringify(FREE_ACCOUNT), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await withDevServer(async (baseUrl) => {
      const resp = await postCheck(baseUrl, { key: "serp-live-key" });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.ok, true);
      assert.equal(
        body.plan,
        "Free",
        "the beat's quota line names the plan the key actually has",
      );
      assert.equal(
        body.searchesLeft,
        97,
        "97 searches left is the truth; '100 searches/mo' was a decoration",
      );
      assert.equal(upstreamCalls.length, 1, "exactly one upstream call");
      assert.equal(
        new URL(upstreamCalls[0]).searchParams.get("api_key"),
        "serp-live-key",
        "the key is presented to SerpApi, which is the whole point of the check",
      );
    });
  });

  it("names an invalid key rather than reporting connected", async () => {
    // SerpApi answers a bad key with 401 and an `error` string.
    stubUpstream(
      async () =>
        new Response(JSON.stringify({ error: "Invalid API key." }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await withDevServer(async (baseUrl) => {
      const resp = await postCheck(baseUrl, { key: "not-a-key" });
      assert.equal(resp.status, 200, "a classified answer, not a transport error");
      const body = await resp.json();
      assert.equal(body.ok, false);
      assert.equal(body.reason, "invalid_key");
      assert.equal(body.plan, undefined, "no quota is invented for a dead key");
    });
  });

  it("treats a 200 carrying an `error` string as an invalid key", async () => {
    // Some SerpApi errors arrive 200-with-error; a naive `resp.ok` check is
    // exactly how the rerun's green-on-nothing happened.
    stubUpstream(
      async () =>
        new Response(JSON.stringify({ error: "Invalid API key." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await withDevServer(async (baseUrl) => {
      const body = await (await postCheck(baseUrl, { key: "x" })).json();
      assert.equal(body.ok, false);
      assert.equal(body.reason, "invalid_key");
    });
  });

  it("says unreachable when SerpApi cannot be contacted", async () => {
    stubUpstream(async () => {
      throw new TypeError("fetch failed");
    });
    await withDevServer(async (baseUrl) => {
      const body = await (await postCheck(baseUrl, { key: "serp-live-key" })).json();
      assert.equal(body.ok, false);
      assert.equal(
        body.reason,
        "unreachable",
        "'offline' and 'wrong key' need different next actions",
      );
    });
  });

  it("rejects an empty key without calling SerpApi", async () => {
    stubUpstream(async () => new Response("{}", { status: 200 }));
    await withDevServer(async (baseUrl) => {
      const resp = await postCheck(baseUrl, { key: "   " });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.equal(body.ok, false);
      assert.equal(body.reason, "empty_key");
      assert.equal(upstreamCalls.length, 0);
    });
  });

  it("refuses a cross-origin caller, like every sibling /__proxy route", async () => {
    stubUpstream(async () => new Response("{}", { status: 200 }));
    await withDevServer(async (baseUrl) => {
      const resp = await postCheck(
        baseUrl,
        { key: "serp-live-key" },
        { Origin: "https://evil.example.com" },
      );
      assert.equal(resp.status, 403);
      assert.equal(
        upstreamCalls.length,
        0,
        "a remote page must not be able to spend someone's SerpApi quota",
      );
    });
  });
});
