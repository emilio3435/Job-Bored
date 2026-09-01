import assert from "node:assert/strict";
import test from "node:test";

import { safeFetch } from "../../src/net/safe-fetch.ts";

test("worker safeFetch blocks a metadata redirect hop", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/start")) {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    }
    return new Response("ok", { status: 200 });
  };
  await assert.rejects(
    () =>
      safeFetch(
        "https://example.com/start",
        {},
        {
          fetchImpl,
          lookupImpl: async () => [{ address: "192.0.2.1", family: 4 }],
        },
      ),
    /private-network/,
  );
});

test("worker safeFetch fails at connect when DNS rebinds to loopback", async () => {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups += 1;
    return lookups === 1
      ? [{ address: "192.0.2.1", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }];
  };
  await assert.rejects(
    () => safeFetch("http://rebind.example.invalid/x", {}, { lookupImpl }),
    /private-network/,
  );
  assert.ok(lookups >= 2);
});
