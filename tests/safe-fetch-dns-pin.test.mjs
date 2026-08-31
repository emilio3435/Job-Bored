import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeFetch } from "../server/security-boundaries.mjs";

const PRIVATE_NETWORK = /private-network/;
const PUBLIC_TEST_NET = [{ address: "192.0.2.1", family: 4 }];
const LOOPBACK = [{ address: "127.0.0.1", family: 4 }];
const METADATA = [{ address: "169.254.169.254", family: 4 }];

function redirectResponse(location) {
  return {
    status: 302,
    headers: { get: (key) => (key.toLowerCase() === "location" ? location : null) },
  };
}

function okResponse() {
  return { status: 200, headers: { get: () => null } };
}

describe("F0C-SEC04-REBIND", () => {
  it("fails at connect when a public hostname rebinds to loopback", async () => {
    let lookups = 0;
    const lookupImpl = async () => {
      lookups += 1;
      return lookups === 1 ? PUBLIC_TEST_NET : LOOPBACK;
    };
    await assert.rejects(
      () => safeFetch("http://rebind.example.invalid/latest/meta-data", {}, { lookupImpl }),
      PRIVATE_NETWORK,
    );
    assert.ok(lookups >= 2, `connect-time lookup must run; got ${lookups}`);
  });

  it("fails at connect when a public hostname rebinds to cloud metadata", async () => {
    let lookups = 0;
    const lookupImpl = async () => {
      lookups += 1;
      return lookups === 1 ? PUBLIC_TEST_NET : METADATA;
    };
    await assert.rejects(
      () => safeFetch("http://rebind.example.invalid/latest/meta-data", {}, { lookupImpl }),
      PRIVATE_NETWORK,
    );
    assert.ok(lookups >= 2, `connect-time lookup must run; got ${lookups}`);
  });
});

describe("F0C-SEC04-REDIR", () => {
  it("blocks a public first hop that redirects to a metadata IP", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return calls.length === 1
        ? redirectResponse("http://169.254.169.254/latest/meta-data")
        : okResponse();
    };
    const lookupImpl = async () => PUBLIC_TEST_NET;
    await assert.rejects(
      () => safeFetch("https://example.com/start", {}, { fetchImpl, lookupImpl }),
      PRIVATE_NETWORK,
    );
    assert.equal(calls.length, 1);
  });

  it("blocks a public first hop that redirects to a hostname that DNS-resolves private", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return calls.length === 1
        ? redirectResponse("http://rebind.example.com/latest/meta-data")
        : okResponse();
    };
    const lookupImpl = async (hostname) => {
      if (hostname === "rebind.example.com") return METADATA;
      return PUBLIC_TEST_NET;
    };
    await assert.rejects(
      () => safeFetch("https://example.com/start", {}, { fetchImpl, lookupImpl }),
      PRIVATE_NETWORK,
    );
    assert.equal(calls.length, 1);
  });
});

describe("F0C-RUN11-ABORT", () => {
  it("aborts during DNS instead of waiting out the lookup", async () => {
    const lookupImpl = async () => {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 8000);
        timer.unref();
      });
      return PUBLIC_TEST_NET;
    };
    const controller = new AbortController();
    const started = Date.now();
    const pending = safeFetch(
      "http://jobs.example.invalid/hang",
      { signal: controller.signal },
      { lookupImpl },
    );
    setTimeout(() => controller.abort(), 40);
    await assert.rejects(pending, (error) => error && error.name === "AbortError");
    assert.ok(Date.now() - started < 1000, "abort must not wait for the lookup timeout");
  });

  it("aborts the pinned connect, not just the caller promise", async () => {
    const lookupImpl = async () => PUBLIC_TEST_NET;
    const controller = new AbortController();
    const started = Date.now();
    const pending = safeFetch(
      "http://jobs.example.invalid/hang",
      { signal: controller.signal },
      { lookupImpl },
    );
    setTimeout(() => controller.abort(), 40);
    await assert.rejects(pending, (error) => error && error.name === "AbortError");
    assert.ok(Date.now() - started < 1000, "abort must not wait for TCP timeout");
  });
});
