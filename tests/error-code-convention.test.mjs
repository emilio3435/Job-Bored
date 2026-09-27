// W2SQ lane E: one error-code convention. Every API error code the worker
// (integrations/browser-use-discovery) and the local server (server/) emit is
// lower_snake_case matching /^[a-z][a-z0-9_]*$/ — the api-error.v1 `code`
// field, the internal error.code values that become response codes, and the
// codes read back by in-repo consumers.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

// Node.js system codes the sources compare against (read, never emitted as an
// API code); not part of the convention.
const SYSTEM_CODES = new Set(["ENOENT", "EACCES", "EISDIR"]);

const SCAN_ROOTS = [
  "server",
  "integrations/browser-use-discovery/src",
  "integrations/browser-use-discovery/bin",
];
const SCAN_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".mts", ".cts"]);

// Narrow patterns for the positions where an error code literal can sit: the
// `code`/`reason` object field, an assignment or comparison against `.code` or
// a `code` binding, and an identifier-like startsWith prefix check.
const CODE_LITERAL_PATTERNS = [
  /\bcode\s*:\s*['"]([^'"]+)['"]/g,
  /\bcode\s*={1,3}\s*['"]([^'"]+)['"]/g,
  /\.startsWith\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g,
];

/** @returns {string[]} absolute paths of the scanned source files */
function collectSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
      } else if (
        SCAN_EXTENSIONS.has(extname(entry)) &&
        !entry.endsWith(".min.js") &&
        !entry.endsWith("-lock.json") &&
        entry !== "package-lock.json"
      ) {
        out.push(path);
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(join(repoRoot, root));
  return out.sort();
}

describe("W2SQ-E — one lower_snake_case error-code convention", () => {
  it("every code literal in worker and server sources matches the convention", () => {
    const violations = [];
    for (const path of collectSourceFiles()) {
      const rel = path.slice(repoRoot.length + 1);
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const pattern of CODE_LITERAL_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(line)) !== null) {
            const code = match[1];
            if (SYSTEM_CODES.has(code)) continue;
            if (!CODE_PATTERN.test(code)) {
              violations.push(`${rel}:${index + 1}: ${JSON.stringify(code)}`);
            }
          }
        }
      });
    }
    assert.equal(
      violations.length,
      0,
      `uppercase/non-snake error codes remain:\n${violations.join("\n")}`,
    );
  });

  it("no retired UPPER_SNAKE code literal remains in worker or server sources", () => {
    // The exact codes the convention replaced (W2SQ-E). A straggler in any
    // position — including helper arguments the narrow patterns miss, such as
    // truncatedDraftError's code parameter — fails here.
    const retired = [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "METHOD_NOT_ALLOWED",
      "CONFLICT",
      "PAYLOAD_TOO_LARGE",
      "MISDIRECTED_REQUEST",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "UPSTREAM_ERROR",
      "SERVICE_UNAVAILABLE",
      "UPSTREAM_TIMEOUT",
      "INVALID_REQUEST",
      "INVALID_JSON",
      "INVALID_PROFILE",
      "HOST_NOT_ALLOWED",
      "SSRF_BLOCKED",
      "BODY_TOO_LARGE",
      "WORKER_CONFIG_MISSING",
      "WORKER_CONFIG_INVALID",
      "WORKER_CONFIG_NO_SHEET",
      "NO_SHEETS_CREDENTIAL",
      "GEMINI_NOT_CONFIGURED",
      "PROFILE_PROVIDER_NOT_CONFIGURED",
      "PROFILE_PROVIDER_REQUEST_FAILED",
      "PROFILE_PROVIDER_HTTP_ERROR",
      "PROFILE_PROVIDER_TRUNCATED",
      "PROFILE_PROVIDER_EMPTY_RESPONSE",
      "PROFILE_PROVIDER_PARSE_ERROR",
      "GEMINI_REQUEST_FAILED",
      "GEMINI_HTTP_ERROR",
      "GEMINI_TRUNCATED",
      "GEMINI_EMPTY_RESPONSE",
      "GEMINI_PARSE_ERROR",
      "EMPTY_RESUME",
    ];
    const hits = [];
    for (const path of collectSourceFiles()) {
      const rel = path.slice(repoRoot.length + 1);
      const text = readFileSync(path, "utf8");
      for (const code of retired) {
        if (text.includes(`"${code}"`) || text.includes(`'${code}'`)) {
          hits.push(`${rel}: ${code}`);
        }
      }
    }
    assert.equal(hits.length, 0, `retired codes remain:\n${hits.join("\n")}`);
  });

  it("the exported status-code maps match the convention", async () => {
    const serverCodes = await import("../server/api-error-codes.mjs");
    const workerCodes = await import(
      "../integrations/browser-use-discovery/src/webhook/api-error.ts"
    );
    for (const [label, map] of [
      ["server API_ERROR_STATUS_CODES", serverCodes.API_ERROR_STATUS_CODES],
      ["worker STATUS_CODES", workerCodes.STATUS_CODES],
    ]) {
      assert.ok(map && typeof map === "object", `${label} is exported`);
      for (const [status, code] of Object.entries(map)) {
        assert.equal(typeof code, "string", `${label}[${status}] is a string`);
        assert.match(code, CODE_PATTERN, `${label}[${status}] = ${code}`);
      }
    }
  });
});
