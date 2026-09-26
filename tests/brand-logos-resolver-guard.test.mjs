/**
 * BEAUDIT G15/E5: the brand-logo resolver script lives outside the
 * server-only Docker context (../integrations/hermes-job-hunt). When it is
 * absent — hosted images, minimal installs — logo resolution must answer
 * 501 LOGOS_UNAVAILABLE, not a 502 spawn failure.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runResolver } from "../server/brand-logos.mjs";

describe("G15/E5 logo resolver guard", () => {
  it("runResolver rejects LOGOS_UNAVAILABLE when the script is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jobbored-logos-guard-"));
    try {
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(
        join(root, "logos.json"),
        JSON.stringify({ logos: [{ slug: "acme", source: "upload", detail: "u" }] }),
        "utf8",
      );
      const previous = process.env.HERMES_LOGO_RESOLVER_SCRIPT;
      process.env.HERMES_LOGO_RESOLVER_SCRIPT = join(root, "missing-resolver.py");
      try {
        await assert.rejects(runResolver({ templateRoot: root }), (err) => {
          assert.equal(err && err.code, "LOGOS_UNAVAILABLE");
          assert.equal(err && err.statusCode, 501);
          return true;
        });
      } finally {
        if (previous === undefined) delete process.env.HERMES_LOGO_RESOLVER_SCRIPT;
        else process.env.HERMES_LOGO_RESOLVER_SCRIPT = previous;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
