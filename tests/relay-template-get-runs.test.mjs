/**
 * Regression tests for the Cloudflare Worker relay template — GET /runs/*
 * proxy-through. Without this, the dashboard's status polling (which sends
 * GET to https://...workers.dev/runs/<id>) gets HTTP 405 and shows
 *   "Status polling failed after multiple attempts."
 *
 * Lane: feat/discovery-autodetect-silent-recover
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerJs = readFileSync(
  join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
  "utf8",
);

describe("Cloudflare Worker template — GET /runs/* relay", () => {
  it("CORS Allow-Methods includes GET (so the browser will even send it)", () => {
    assert.ok(
      /Access-Control-Allow-Methods["'\s:]+["'][^"']*\bGET\b/.test(workerJs),
      "Access-Control-Allow-Methods must include GET",
    );
  });

  it("isRelayReadOnlyPath helper exists and gates only /runs", () => {
    assert.ok(
      workerJs.includes("function isRelayReadOnlyPath"),
      "isRelayReadOnlyPath helper must exist",
    );
    // Must whitelist /runs and /runs/<id> but nothing else.
    assert.ok(
      /pathname === ["']\/runs["']/.test(workerJs),
      "must accept exact /runs path",
    );
    assert.ok(
      /pathname\.startsWith\(["']\/runs\/["']\)/.test(workerJs),
      "must accept /runs/<id> sub-paths",
    );
  });

  it("non-POST GET to non-/runs paths still returns 405 (no open proxy)", () => {
    // Proxy guard: the only GET we forward is for /runs/*. Make sure the
    // method check still rejects everything else.
    assert.ok(
      /isReadOnlyGet[\s\S]{0,200}Method Not Allowed/.test(workerJs),
      "method check must use isReadOnlyGet so non-POST non-/runs returns 405",
    );
  });

  it("GET request body is undefined, not consumed (avoids the 'Body has already been read' bug)", () => {
    assert.ok(
      /isReadOnlyGet \? undefined : await request\.text\(\)/.test(workerJs),
      "GET path must skip request.text() since GET has no body",
    );
  });

  it("upstream fetch uses GET when isReadOnlyGet, POST otherwise", () => {
    assert.ok(
      /method: isReadOnlyGet \? ["']GET["'] : ["']POST["']/.test(workerJs),
      "upstream method must mirror the incoming method for the read-only path",
    );
  });
});
