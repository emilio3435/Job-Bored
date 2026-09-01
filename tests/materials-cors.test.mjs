import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("materials CORS", () => {
  it("allows browser PUT preflight for writing job-description.md", () => {
    const source = readFileSync(join(repoRoot, "server", "index.mjs"), "utf8");
    const match = source.match(
      /Access-Control-Allow-Methods["'\s,]+["']([^"']+)["']/,
    );

    assert.ok(match, "server must set Access-Control-Allow-Methods");
    assert.ok(
      match[1].split(",").map((method) => method.trim()).includes("PUT"),
      "job-description.md writes use PUT and must pass browser CORS preflight",
    );
  });

  it("F0D-F11-FWD does not use X-Forwarded-Host/Proto to decide CORS origin", () => {
    const source = readFileSync(join(repoRoot, "server", "index.mjs"), "utf8");
    assert.doesNotMatch(
      source,
      /x-forwarded-host/i,
      "CORS must not trust X-Forwarded-Host",
    );
    assert.doesNotMatch(
      source,
      /x-forwarded-proto/i,
      "CORS must not trust X-Forwarded-Proto",
    );
  });
});
