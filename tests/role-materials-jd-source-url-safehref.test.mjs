/**
 * Pins the role-materials.js JD-source-URL XSS hardening.
 *
 * Vulnerability: the "Source URL: <a href=...>" line in the JD-paste form
 * passed ctx.jobUrl straight through escapeHtml. escapeHtml HTML-encodes
 * the *characters* but doesn't drop scheme — `javascript:alert(1)` is a
 * perfectly valid HTML-encoded href that browsers still execute on click.
 *
 * Fix: gate ctx.jobUrl through a safeHref that returns the URL only when
 * the scheme is http/https. javascript:, data:, file:, ws: become empty
 * string and the entire "Source URL: …" segment is omitted.
 *
 * This is a source-shape pin: we read role-materials.js verbatim because
 * the JD-paste form runs against a real role-region DOM that we don't
 * have here. The patterns are deterministic and survive renaming.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const roleMaterialsJs = readFileSync(
  join(repoRoot, "role-materials.js"),
  "utf8",
);

describe("role-materials JD-source-URL safeHref guard", () => {
  it("declares a safeHref helper that drops non-http(s) URLs", () => {
    // The helper must exist AND must reject javascript:/data:/etc. We
    // verify by source-shape: the regex /^https?:\/\//i and a fallback
    // return "" path.
    assert.match(
      roleMaterialsJs,
      /function\s+safeHref\s*\([^)]*\)\s*\{[\s\S]{0,400}\/\^https\?:\\\/\\\/\/i[\s\S]{0,200}return\s+""/,
      "expected a safeHref(url) function in role-materials.js that returns '' for non-http(s)",
    );
  });

  it("threads jobUrl through safeHref before rendering the Source URL anchor", () => {
    // The brittle thing about the previous code was that ctx.jobUrl
    // hit `<a href="` directly. After the fix, ctx.jobUrl flows through
    // safeHref FIRST, the result lands in a __href var, and the anchor
    // is only emitted when __href is non-empty. Assert that ladder.
    assert.match(
      roleMaterialsJs,
      /var\s+__href\s*=\s*safeHref\(ctx\.jobUrl\)\s*;/,
      "expected `var __href = safeHref(ctx.jobUrl);` in the JD-paste form",
    );
    assert.match(
      roleMaterialsJs,
      /var\s+__sourceUrl\s*=\s*__href[\s\S]{0,400}Source URL:[\s\S]{0,400}escapeHtml\(__href\)/,
      "expected __sourceUrl to gate the Source URL anchor on __href and escape it",
    );
  });

  it("no longer emits the raw `escapeHtml(ctx.jobUrl)` anchor pattern", () => {
    // Pin the bad pattern is gone. The regression test: if anyone
    // reintroduces ` href="' + escapeHtml(ctx.jobUrl) + '"`, this fails.
    assert.doesNotMatch(
      roleMaterialsJs,
      /href="'\s*\+\s*escapeHtml\(ctx\.jobUrl\)\s*\+\s*'"/,
      "ctx.jobUrl must not be interpolated into an href without safeHref",
    );
  });
});
