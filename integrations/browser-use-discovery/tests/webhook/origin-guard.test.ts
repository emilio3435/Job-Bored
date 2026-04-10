import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCorsHeaders,
  isOriginAllowed,
  resolveAllowedOrigin,
} from "../../src/http/origin-guard.ts";

test("resolveAllowedOrigin mirrors an explicitly allowed browser origin", () => {
  assert.equal(
    resolveAllowedOrigin(
      ["http://localhost:8080", "http://127.0.0.1:8080"],
      "http://localhost:8080",
    ),
    "http://localhost:8080",
  );
});

test("resolveAllowedOrigin fails closed when hosted origins are unset", () => {
  assert.equal(resolveAllowedOrigin([], "https://dashboard.example.com"), "");
});

test("isOriginAllowed permits non-browser requests without an Origin header", () => {
  assert.equal(isOriginAllowed([], ""), true);
});

test("buildCorsHeaders omits access-control-allow-origin for disallowed origins", () => {
  const headers = buildCorsHeaders(
    ["http://localhost:8080"],
    "https://dashboard.example.com",
  );
  assert.equal("Access-Control-Allow-Origin" in headers, false);
  assert.equal(headers.Vary, "Origin");
});

test("buildCorsHeaders preserves explicit wildcard origins", () => {
  const headers = buildCorsHeaders(["*"], "https://dashboard.example.com");
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
});
