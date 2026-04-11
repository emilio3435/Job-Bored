import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAllowedBrowserOrigins,
  resolveAllowedBrowserOrigin,
  validateScrapeTarget,
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
});
