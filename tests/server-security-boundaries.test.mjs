import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAllowedBrowserOrigins,
  redactSecrets,
  resolveAllowedBrowserOrigin,
  trustedRequestOriginParts,
  validateScrapeTarget,
  validateScrapeTargetWithDns,
  safeFetch,
} from "../server/security-boundaries.mjs";

describe("server security boundaries", () => {
  it("defaults localhost listeners to the local dashboard origins", () => {
    assert.deepEqual(
      normalizeAllowedBrowserOrigins("", { listenHost: "127.0.0.1" }),
      [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "https://localhost:8080",
      ],
    );
  });

  it("fails closed for hosted listeners without explicit browser origins", () => {
    assert.deepEqual(
      normalizeAllowedBrowserOrigins("", { listenHost: "0.0.0.0" }),
      [],
    );
  });

  it("allows same-origin browser requests without extra configuration", () => {
    assert.equal(
      resolveAllowedBrowserOrigin("https://app.example.com", {
        allowedOrigins: [],
        requestHost: "app.example.com",
        requestProtocol: "https",
      }),
      "https://app.example.com",
    );
  });

  it("rejects unrelated cross-origin browser requests by default", () => {
    assert.equal(
      resolveAllowedBrowserOrigin("https://dashboard.example.com", {
        allowedOrigins: [],
        requestHost: "api.example.com",
        requestProtocol: "https",
      }),
      "",
    );
  });

  it("rejects localhost and private-network scrape targets", () => {
    assert.deepEqual(validateScrapeTarget("http://127.0.0.1:3000/job"), {
      ok: false,
      error: "Local and private-network scrape targets are not allowed",
    });
    assert.deepEqual(validateScrapeTarget("https://192.168.1.10/job"), {
      ok: false,
      error: "Local and private-network scrape targets are not allowed",
    });
  });

  it("accepts public http and https scrape targets", () => {
    assert.deepEqual(validateScrapeTarget("https://example.com/jobs/123"), {
      ok: true,
      url: "https://example.com/jobs/123",
    });
    assert.deepEqual(validateScrapeTarget("http://example.com/jobs/123"), {
      ok: true,
      url: "http://example.com/jobs/123",
    });
  });

  it("blocks IPv4-mapped IPv6 loopback and cloud-metadata addresses", () => {
    for (const host of [
      "http://[::ffff:127.0.0.1]/x",
      "http://[::ffff:169.254.169.254]/latest/meta-data",
      "http://[::1]/x",
      "http://[fd00::1]/x",
      "http://[fe80::1]/x",
    ]) {
      assert.equal(validateScrapeTarget(host).ok, false, `${host} should be blocked`);
    }
  });

  it("blocks encoded IPv4 literals that resolve to loopback/metadata", () => {
    for (const host of [
      "http://2130706433/x", // 127.0.0.1
      "http://0x7f000001/x",
      "http://127.1/x",
      "http://0177.0.0.1/x",
    ]) {
      assert.equal(validateScrapeTarget(host).ok, false, `${host} should be blocked`);
    }
  });

  it("blocks CGNAT and multicast ranges", () => {
    assert.equal(validateScrapeTarget("http://100.64.0.1/x").ok, false);
    assert.equal(validateScrapeTarget("http://224.0.0.1/x").ok, false);
  });
});
describe("DNS-aware scrape validation", () => {
  it("blocks public hostnames that resolve to a private address", async () => {
    const lookupImpl = async () => [{ address: "169.254.169.254", family: 4 }];
    const result = await validateScrapeTargetWithDns("https://rebind.example.com/x", { lookupImpl });
    assert.equal(result.ok, false);
  });

  it("allows hostnames that resolve to public addresses", async () => {
    const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    const result = await validateScrapeTargetWithDns("https://example.com/x", { lookupImpl });
    assert.equal(result.ok, true);
  });

  it("fails closed when DNS resolution errors", async () => {
    const lookupImpl = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await validateScrapeTargetWithDns("https://broken.example.com/x", { lookupImpl });
    assert.equal(result.ok, false);
  });
});

describe("safeFetch redirect re-validation", () => {
  function redirectResponse(location) {
    return { status: 302, headers: { get: (k) => (k.toLowerCase() === "location" ? location : null) } };
  }
  function okResponse() {
    return { status: 200, headers: { get: () => null } };
  }

  it("rejects a redirect that points at a private address", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return calls.length === 1 ? redirectResponse("http://169.254.169.254/meta") : okResponse();
    };
    await assert.rejects(
      () => safeFetch("https://example.com/start", {}, { fetchImpl, resolveDns: false }),
      /private-network/,
    );
    assert.equal(calls.length, 1);
  });

  it("follows redirects to public hosts", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return calls.length === 1 ? redirectResponse("https://jobs.example.org/final") : okResponse();
    };
    const res = await safeFetch("https://example.com/start", {}, { fetchImpl, resolveDns: false });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, ["https://example.com/start", "https://jobs.example.org/final"]);
  });

  it("fail-closed DNS blocks a redirect hostname that resolves private", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/start")) {
        return redirectResponse("http://rebind.example.com/meta");
      }
      return okResponse();
    };
    const lookupImpl = async (hostname) => {
      if (hostname === "rebind.example.com") {
        return [{ address: "169.254.169.254", family: 4 }];
      }
      return [{ address: "192.0.2.1", family: 4 }];
    };
    await assert.rejects(
      () => safeFetch("https://example.com/start", {}, { fetchImpl, lookupImpl }),
      /private-network/,
    );
  });
});

describe("F0D-F11-FWD trusted request origin parts", () => {
  it("ignores spoofed X-Forwarded-Host and X-Forwarded-Proto", () => {
    const req = {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === "origin") return "https://evil.example";
        if (key === "x-forwarded-host") return "evil.example";
        if (key === "x-forwarded-proto") return "https";
        if (key === "host") return "127.0.0.1:3847";
        return "";
      },
      secure: false,
      protocol: "http",
    };
    const parts = trustedRequestOriginParts(req);
    assert.equal(parts.requestHost, "127.0.0.1:3847");
    assert.equal(parts.requestProtocol, "http");
    assert.equal(
      resolveAllowedBrowserOrigin(parts.requestOrigin, {
        allowedOrigins: [],
        requestHost: parts.requestHost,
        requestProtocol: parts.requestProtocol,
      }),
      "",
    );
  });

  it("redacts provider keys from error strings", () => {
    assert.match(
      redactSecrets("invalid key sk-leaked-provider-secret-SHOULD-NOT-ECHO"),
      /\[redacted\]/,
    );
    assert.doesNotMatch(
      redactSecrets("Authorization: Bearer sk-leaked-provider-secret-SHOULD-NOT-ECHO"),
      /sk-leaked/,
    );
  });
});
