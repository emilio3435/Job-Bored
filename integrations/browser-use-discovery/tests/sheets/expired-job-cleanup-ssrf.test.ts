// BEAUDIT D15: expired-job cleanup fetched any Link in the Sheet, loopback and
// metadata included, with redirect:"follow". Promotes p14-cleanup-loopback-fetch.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { responseFromIncomingMessage } from "../../../../server/security-boundaries.mjs";
import { checkJobPostingUrl } from "../../src/cleanup/expired-job-cleanup.ts";

test("checkJobPostingUrl never fetches a loopback Link and flags it for review", async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(String(req.url));
    res.end("internal admin page: apply now");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await checkJobPostingUrl(
      `http://127.0.0.1:${port}/internal-only`,
      { timeoutMs: 2000 },
    );
    assert.deepEqual(hits, []);
    assert.equal(result.status, "unknown");
    assert.match(result.reason, /private-network/);
  } finally {
    server.close();
  }
});

test("checkJobPostingUrl refuses a redirect to cloud metadata", async () => {
  const calls: string[] = [];
  const result = await checkJobPostingUrl("https://jobs.example.com/role", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url.startsWith("https://jobs.example.com/")
        ? new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          })
        : new Response("Apply now", { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(calls, ["https://jobs.example.com/role"]);
  assert.equal(result.status, "unknown");
  assert.notEqual(result.status, "open");
  assert.match(result.reason, /private-network/);
});

test("checkJobPostingUrl refuses a hostname that resolves to a private address", async () => {
  const calls: string[] = [];
  const result = await checkJobPostingUrl("https://internal.example.com/role", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("Apply now", { status: 200 });
    }) as typeof fetch,
    lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
  });
  assert.deepEqual(calls, []);
  assert.equal(result.status, "unknown");
});

test("checkJobPostingUrl follows a public redirect and reports the final URL", async () => {
  const result = await checkJobPostingUrl("https://jobs.example.com/old", {
    fetchImpl: (async (input: RequestInfo | URL) =>
      String(input).endsWith("/old")
        ? new Response(null, { status: 301, headers: { location: "/new" } })
        : new Response("<button>Apply now</button>", { status: 200 })) as typeof fetch,
  });
  assert.equal(result.status, "open");
  assert.equal(result.finalUrl, "https://jobs.example.com/new");
});

// Repair round: a gzip posting must be decoded before classification, or the
// "no longer accepting" copy is never seen and the row stays unknown.
test("checkJobPostingUrl decodes a gzip posting before classifying it", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.end(gzipSync("<html><body><h1>Engineer</h1><button>Apply now</button></body></html>"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await checkJobPostingUrl("https://jobs.example.com/role", {
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          http
            .get({ host: "127.0.0.1", port, path: "/", signal: init?.signal ?? undefined }, (res) =>
              resolve(responseFromIncomingMessage(res, { url: String(input) })),
            )
            .on("error", reject);
        })) as typeof fetch,
    });
    assert.equal(result.status, "open");
  } finally {
    server.close();
  }
});
