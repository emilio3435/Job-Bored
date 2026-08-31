import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCorsHeaders,
  isOriginAllowed,
  resolveAllowedOrigin,
} from "../../src/http/origin-guard.ts";
import * as runStatusAuth from "../../src/webhook/run-status-auth.ts";

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

test("F1B-P2-CORS: x-run-status-token is on the documented CORS header path", () => {
  const headers = buildCorsHeaders(
    ["http://localhost:8080"],
    "http://localhost:8080",
  );
  assert.match(
    headers["Access-Control-Allow-Headers"],
    /x-run-status-token/i,
  );
});

test("F1B-P2-CORS: nested run IDs are rejected in the documented { ok:false, message } shape", () => {
  const parseRunStatusPath = (
    runStatusAuth as {
      parseRunStatusPath?: (path: string) =>
        | { ok: true; runId: string }
        | { ok: false; status: number; body: { ok: false; message: string } };
    }
  ).parseRunStatusPath;
  assert.equal(typeof parseRunStatusPath, "function");
  const nested = parseRunStatusPath!("/runs/foo/bar");
  assert.equal(nested.ok, false);
  if (nested.ok) return;
  assert.equal(nested.status, 400);
  assert.equal(nested.body.ok, false);
  assert.match(nested.body.message, /nested/i);
  const encoded = parseRunStatusPath!("/runs/foo%2Fbar");
  assert.equal(encoded.ok, false);
  const malformed = parseRunStatusPath!("/runs/%");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.ok ? 0 : malformed.status, 400);
  const ok = parseRunStatusPath!("/runs/run_abc");
  assert.deepEqual(ok, { ok: true, runId: "run_abc" });
});
