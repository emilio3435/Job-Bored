// BEAUDIT lane X: egress hardening of the shared SSRF primitive.
// C8  — credential headers must not follow a cross-origin redirect.
// C9  — the response body is capped while streaming, not after buffering.
// E8  — NAT64 / 6to4 / Teredo / site-local / benchmark ranges are private.
// Hermetic: injected fetchImpl and stubbed DNS, no sockets.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  safeFetch,
  validateScrapeTarget,
  validateScrapeTargetWithDns,
} from "../server/security-boundaries.mjs";

const PRIVATE_NETWORK = /private-network/;

function recordingFetch(handler) {
  const hops = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    hops.push({
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      headers: Object.fromEntries(headers.entries()),
      body: init.body == null ? null : String(init.body),
    });
    return handler(String(url), hops.length);
  };
  return { fetchImpl, hops };
}

describe("C8 safeFetch redirect credential stripping", () => {
  it("drops credential headers when a redirect changes origin (promoted C-safefetch-redirect-headers probe)", async () => {
    const { fetchImpl, hops } = recordingFetch((url) =>
      url.startsWith("https://generativelanguage.googleapis.com/")
        ? new Response(null, {
            status: 307,
            headers: { location: "https://attacker.example/collect" },
          })
        : new Response("ok", { status: 200 }),
    );
    await assert.rejects(
      () =>
        safeFetch(
          "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": "probe-canary-key",
              authorization: "Bearer probe-canary-token",
              "content-type": "application/json",
            },
            body: "{}",
          },
          { fetchImpl },
        ),
      /cross-origin redirect/i,
    );
    assert.equal(hops.length, 1, "a cross-origin 307 with a body must not be replayed");
  });

  it("strips api-key, authorization and cookie headers on a cross-origin GET redirect", async () => {
    const { fetchImpl, hops } = recordingFetch((url) =>
      url.startsWith("https://api.example.com/")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://other.example.net/landing" },
          })
        : new Response("ok", { status: 200 }),
    );
    const response = await safeFetch(
      "https://api.example.com/v1/thing",
      {
        headers: {
          "x-goog-api-key": "probe-canary-key",
          "x-api-key": "probe-canary-key-2",
          Authorization: "Bearer probe-canary-token",
          Cookie: "sid=probe",
          accept: "text/html",
        },
      },
      { fetchImpl },
    );
    assert.equal(response.status, 200);
    assert.equal(hops.length, 2);
    const second = hops[1].headers;
    assert.equal(second["x-goog-api-key"], undefined);
    assert.equal(second["x-api-key"], undefined);
    assert.equal(second.authorization, undefined);
    assert.equal(second.cookie, undefined);
    assert.equal(second.accept, "text/html", "non-credential headers survive");
  });

  it("keeps credential headers on a same-origin redirect", async () => {
    const { fetchImpl, hops } = recordingFetch((url) =>
      url.endsWith("/old")
        ? new Response(null, { status: 302, headers: { location: "/new" } })
        : new Response("ok", { status: 200 }),
    );
    await safeFetch(
      "https://api.example.com/old",
      { headers: { "x-goog-api-key": "probe-canary-key" } },
      { fetchImpl },
    );
    assert.equal(hops[1].url, "https://api.example.com/new");
    assert.equal(hops[1].headers["x-goog-api-key"], "probe-canary-key");
  });

  it("turns a 303 (and a POST 302) into a bodiless GET", async () => {
    for (const status of [303, 302]) {
      const { fetchImpl, hops } = recordingFetch((url) =>
        url.endsWith("/submit")
          ? new Response(null, { status, headers: { location: "/done" } })
          : new Response("ok", { status: 200 }),
      );
      await safeFetch(
        "https://api.example.com/submit",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{\"a\":1}" },
        { fetchImpl },
      );
      assert.equal(hops[1].method, "GET", `status ${status}`);
      assert.equal(hops[1].body, null, `status ${status}`);
      assert.equal(hops[1].headers["content-type"], undefined, `status ${status}`);
    }
  });

  it("honors redirect: \"error\" for fixed-host API calls", async () => {
    const { fetchImpl, hops } = recordingFetch(() =>
      new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }),
    );
    await assert.rejects(
      () => safeFetch("https://api.example.com/x", { redirect: "error" }, { fetchImpl }),
      /redirect/i,
    );
    assert.equal(hops.length, 1);
  });
});

describe("C9 safeFetch streaming body cap", () => {
  function endlessBody() {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls > 10_000) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      stream,
      get pulls() {
        return pulls;
      },
      get cancelled() {
        return cancelled;
      },
    };
  }

  it("errors the body and cancels the source once maxBytes is passed", async () => {
    const source = endlessBody();
    const fetchImpl = async () =>
      new Response(source.stream, { status: 200, headers: { "content-type": "text/html" } });
    const response = await safeFetch("https://jobs.example.com/huge", {}, { fetchImpl, maxBytes: 256 * 1024 });
    await assert.rejects(() => response.text(), /exceeds/i);
    assert.ok(source.pulls < 20, `source must stop near the cap; pulled ${source.pulls} chunks`);
    assert.equal(source.cancelled, true, "the upstream body must be cancelled");
  });

  it("rejects up front when content-length is over maxBytes", async () => {
    const fetchImpl = async () =>
      new Response("x".repeat(2048), { status: 200, headers: { "content-length": "2048" } });
    await assert.rejects(
      () => safeFetch("https://jobs.example.com/big", {}, { fetchImpl, maxBytes: 1024 }),
      /exceeds/i,
    );
  });

  it("passes bodies under the cap through untouched and keeps the final URL", async () => {
    const fetchImpl = async (url) =>
      url.endsWith("/a")
        ? new Response(null, { status: 302, headers: { location: "/b" } })
        : new Response("<title>ok</title>", { status: 200 });
    const response = await safeFetch("https://jobs.example.com/a", {}, { fetchImpl, maxBytes: 1024 });
    assert.equal(await response.text(), "<title>ok</title>");
    assert.equal(response.url, "https://jobs.example.com/b");
  });

  it("tags blocked targets with code SSRF_BLOCKED", async () => {
    await assert.rejects(
      () => safeFetch("http://127.0.0.1:9/", {}, { fetchImpl: async () => new Response("x") }),
      (error) => error.code === "SSRF_BLOCKED" && PRIVATE_NETWORK.test(error.message),
    );
  });
});

describe("E8 SSRF classifier covers embedded-IPv4 and reserved ranges (promoted probe-e-ssrf)", () => {
  const blockedLiterals = [
    "http://[64:ff9b::7f00:1]/", // NAT64 embedding 127.0.0.1
    "http://[64:ff9b::a9fe:a9fe]/", // NAT64 embedding 169.254.169.254
    "http://[64:ff9b::127.0.0.1]/", // NAT64, dotted tail
    "http://[64:ff9b:1::a00:5]/", // local-use NAT64 64:ff9b:1::/48
    "http://[2002:7f00:1::]/", // 6to4 embedding 127.0.0.1
    "http://[2002:a9fe:a9fe::1]/", // 6to4 embedding metadata
    "http://[2001:0:4136:e378:8000:63bf:80ff:fffe]/", // Teredo client 127.0.0.1
    "http://198.18.0.1/", // 198.18.0.0/15 benchmark
    "http://198.19.255.254/",
    "http://[fec0::1]/", // deprecated site-local
    "http://[ff02::1]/", // multicast
    "http://[::ffff:0:7f00:1]/", // IPv4-translated ::ffff:0:0/96
  ];
  for (const url of blockedLiterals) {
    it(`blocks literal ${url}`, () => {
      const result = validateScrapeTarget(url);
      assert.equal(result.ok, false, `${url} must be blocked`);
    });
  }

  const allowedLiterals = [
    "http://[64:ff9b::808:808]/", // NAT64 embedding 8.8.8.8
    "http://[2002:808:808::1]/", // 6to4 embedding 8.8.8.8
    "http://[2606:4700:4700::1111]/",
    "http://198.20.0.1/",
    "http://8.8.8.8/",
  ];
  for (const url of allowedLiterals) {
    it(`allows public literal ${url}`, () => {
      assert.equal(validateScrapeTarget(url).ok, true, `${url} must stay allowed`);
    });
  }

  const dnsCases = [
    ["a.example", [{ address: "64:ff9b::7f00:1", family: 6 }]],
    ["b.example", [{ address: "2002:a9fe:a9fe::1", family: 6 }]],
    ["c.example", [{ address: "198.18.5.5", family: 4 }]],
    ["d.example", [{ address: "fec0::5", family: 6 }]],
  ];
  for (const [host, addrs] of dnsCases) {
    it(`blocks a DNS answer of ${addrs[0].address}`, async () => {
      const result = await validateScrapeTargetWithDns(`https://${host}/job`, {
        lookupImpl: async () => addrs,
      });
      assert.equal(result.ok, false);
    });
  }
});
