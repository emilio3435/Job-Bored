#!/usr/bin/env node
/**
 * tools/smoke-jb-v2.mjs — Conductor / Phase 4
 * ------------------------------------------------------------
 * Deterministic, read-only smoke harness for the v2 redesign.
 * Runs as `node --test`. No live network, no Sheet writebacks.
 *
 * 13 checks across the four flag-gated regions and the legacy
 * fallback. Each check inspects on-disk artifacts only:
 *   - index.html composition (region hosts, script load order,
 *     toggle UI markup, JB_V2 plumbing).
 *   - {dawn,lattice,scribe,welcome}.{css,js} existence and that
 *     CSS rules are scoped under `body.jb-v2`.
 *   - tokens-v2.css and jb-v2.css present.
 *   - Legacy canonical functions (updateJobStatus,
 *     completeOnboarding, expandedJobKeys) still exist in app.js
 *     so flag-OFF behavior is preserved.
 *   - tools/lint-tokens.mjs passes on the v2 CSS surface.
 *
 * Fallback note: we use content-equality on canonical function
 * signatures (not SHAs) because app.js / style.css legitimately
 * receive non-v2 edits between Phase 3 and Phase 4. See
 * AGENTS.md and Phase 4 brief.
 *
 * Usage:
 *   node --test tools/smoke-jb-v2.mjs
 *   npm run smoke:jb-v2
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

function readRoot(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function fileExists(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) && statSync(p).isFile();
}

const REGIONS = ["dawn", "lattice", "scribe", "welcome"];

// ---------------------------------------------------------------------------
// Check 1 — index.html declares all four region hosts with data-region attrs.
// ---------------------------------------------------------------------------
test("smoke 1/13: index.html exposes four data-region hosts", () => {
  const html = readRoot("index.html");
  for (const r of REGIONS) {
    assert.match(
      html,
      new RegExp(`data-region=["']${r}["']`),
      `missing data-region="${r}" host in index.html`,
    );
  }
});

// ---------------------------------------------------------------------------
// Check 2 — JB_V2 flag plumbing is intact: window.JB_V2.{on,enable,disable}.
// ---------------------------------------------------------------------------
test("smoke 2/13: window.JB_V2 plumbing present in index.html", () => {
  const html = readRoot("index.html");
  assert.match(html, /window\.JB_V2\s*=\s*\{/, "window.JB_V2 assignment missing");
  assert.match(html, /enable\s*:\s*function/, "JB_V2.enable missing");
  assert.match(html, /disable\s*:\s*function/, "JB_V2.disable missing");
  assert.match(html, /classList\.add\(['"]jb-v2['"]\)/, "body.jb-v2 add missing");
  assert.match(
    html,
    /classList\.remove\(['"]jb-v2['"]\)/,
    "body.jb-v2 remove missing",
  );
});

// ---------------------------------------------------------------------------
// Check 3 — tokens-v2.css and jb-v2.css both load before any region CSS.
// ---------------------------------------------------------------------------
test("smoke 3/13: token & base CSS load before region CSS", () => {
  const html = readRoot("index.html");
  const tokensIdx = html.indexOf('href="tokens-v2.css"');
  const jbV2Idx = html.indexOf('href="jb-v2.css"');
  assert.ok(tokensIdx > -1, "tokens-v2.css link missing");
  assert.ok(jbV2Idx > -1, "jb-v2.css link missing");
  for (const r of REGIONS) {
    const idx = html.indexOf(`href="${r}.css"`);
    assert.ok(idx > -1, `${r}.css link missing`);
    assert.ok(
      tokensIdx < idx,
      `tokens-v2.css must load before ${r}.css`,
    );
    assert.ok(jbV2Idx < idx, `jb-v2.css must load before ${r}.css`);
  }
});

// ---------------------------------------------------------------------------
// Check 4 — every region CSS file exists and scopes rules under body.jb-v2.
// ---------------------------------------------------------------------------
test("smoke 4/13: each region CSS is scoped under body.jb-v2", () => {
  for (const r of REGIONS) {
    const rel = `${r}.css`;
    assert.ok(fileExists(rel), `${rel} missing`);
    const css = readRoot(rel);
    assert.match(
      css,
      /body\.jb-v2/,
      `${rel} has no body.jb-v2 scope (would leak into legacy UI)`,
    );
  }
});

// ---------------------------------------------------------------------------
// Check 5 — every region JS file exists and is loaded from index.html.
// ---------------------------------------------------------------------------
test("smoke 5/13: each region JS file exists and is loaded", () => {
  const html = readRoot("index.html");
  for (const r of REGIONS) {
    const rel = `${r}.js`;
    assert.ok(fileExists(rel), `${rel} missing`);
    assert.match(
      html,
      new RegExp(`src=["']${r}\\.js["']`),
      `${rel} not referenced in index.html`,
    );
  }
});

// ---------------------------------------------------------------------------
// Check 6 — Settings toggle markup exists in Setup tab.
// ---------------------------------------------------------------------------
test("smoke 6/13: Settings → Setup tab contains the v2 toggle", () => {
  const html = readRoot("index.html");
  assert.match(html, /id=["']settingsJbV2Toggle["']/, "toggle input missing");
  assert.match(html, /role=["']switch["']/, "switch role missing");
  assert.match(
    html,
    /class=["']jb-v2-switch__track["']/,
    "switch track markup missing",
  );
});

// ---------------------------------------------------------------------------
// Check 7 — settings-jb-v2-tab.js loads after settings-tabs.js.
// ---------------------------------------------------------------------------
test("smoke 7/13: settings-jb-v2-tab.js loads after settings-tabs.js", () => {
  const html = readRoot("index.html");
  const tabsIdx = html.indexOf('src="settings-tabs.js"');
  const v2Idx = html.indexOf('src="settings-jb-v2-tab.js"');
  assert.ok(tabsIdx > -1, "settings-tabs.js script missing");
  assert.ok(v2Idx > -1, "settings-jb-v2-tab.js script missing");
  assert.ok(tabsIdx < v2Idx, "v2 tab controller must load after tabs controller");
});

// ---------------------------------------------------------------------------
// Check 8 — schema maps the toggle field to the Setup tab.
// ---------------------------------------------------------------------------
test("smoke 8/13: schema maps settingsJbV2Toggle → Setup tab", () => {
  const src = readRoot("settings-tab-schema.js");
  assert.match(
    src,
    /settingsJbV2Toggle\s*:\s*SETTINGS_TAB_IDS\.SETUP/,
    "settingsJbV2Toggle not mapped to SETUP tab",
  );
});

// ---------------------------------------------------------------------------
// Check 9 — switch CSS uses --jb-* tokens (no raw hex in the new block).
// ---------------------------------------------------------------------------
test("smoke 9/13: jb-v2-switch CSS is token-only", () => {
  const css = readRoot("settings-tabs.css");
  const match = css.match(
    /\/\* ── jb-v2 toggle switch[\s\S]*?\/\* ── Mobile/,
  );
  assert.ok(match, "jb-v2 toggle switch CSS block not found");
  const block = match[0];
  // Strip comments before scanning for raw hex.
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const hex = stripped.match(/#(?:[0-9a-f]{3,8})\b/gi);
  assert.equal(
    hex,
    null,
    `raw hex literal in switch CSS: ${(hex || []).join(", ")}`,
  );
  assert.match(block, /var\(--jb-/, "switch CSS does not consume any --jb-* token");
});

// ---------------------------------------------------------------------------
// Check 10 — legacy canonical hooks survive (flag-OFF must keep working).
// ---------------------------------------------------------------------------
test("smoke 10/13: app.js retains legacy canonical hooks", () => {
  const src = readRoot("app.js");
  assert.match(
    src,
    /async function updateJobStatus\(/,
    "updateJobStatus signature changed/missing — legacy writeback at risk",
  );
  assert.match(
    src,
    /completeOnboarding\(\)/,
    "completeOnboarding call site missing",
  );
  assert.match(
    src,
    /const expandedJobKeys = new Set\(\)/,
    "expandedJobKeys set missing — expand persistence broken",
  );
});

// ---------------------------------------------------------------------------
// Check 11 — controller file is syntactically valid JS.
// ---------------------------------------------------------------------------
test("smoke 11/13: settings-jb-v2-tab.js parses cleanly", () => {
  const result = spawnSync(
    process.execPath,
    ["--check", join(ROOT, "settings-jb-v2-tab.js")],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `node --check failed:\n${result.stderr || result.stdout}`,
  );
});

// ---------------------------------------------------------------------------
// Check 12 — legacy chrome is hidden when body.jb-v2 (Phase 4 close-out).
// Without this rule, both UIs render simultaneously and the redesign is
// effectively invisible. See ROLLOUT.md.
// ---------------------------------------------------------------------------
test("smoke 12/13: legacy panels hidden, regions auth-gated, chrome preserved", () => {
  assert.ok(
    fileExists("jb-v2-legacy-hide.css"),
    "jb-v2-legacy-hide.css missing",
  );
  const css = readRoot("jb-v2-legacy-hide.css");
  // Must hide the two legacy content surfaces.
  assert.match(
    css,
    /body\.jb-v2\s+#dashboard\s*>\s*\.command-strip\.daily-brief-panel/,
    "daily-brief-panel hide rule missing",
  );
  assert.match(
    css,
    /body\.jb-v2\s+#dashboard\s*>\s*main\.main-content/,
    "main-content hide rule missing",
  );
  // Must NOT hide the whole #dashboard (would kill the top-bar / settings gear).
  assert.doesNotMatch(
    css,
    /body\.jb-v2\s+#dashboard\s*\{\s*display:\s*none/,
    "#dashboard wholesale hide present — kills the top-bar / settings gear",
  );
  // Must auth-gate the regions on #dashboard visibility.
  assert.match(
    css,
    /:has\(#dashboard:not\(\[style\*="display:\s*none"\]\)\)/,
    "regions are not auth-gated on #dashboard visibility",
  );
  // Must NOT show empty-mode Welcome (would trap the user with a full-bleed overlay).
  assert.doesNotMatch(
    css,
    /\[data-region="welcome"\]\[data-mode="empty"\][^{]*\{[^}]*display:\s*flex/,
    "empty-mode Welcome is being shown — full-bleed overlay traps the user",
  );
  const html = readRoot("index.html");
  assert.match(
    html,
    /href=["']jb-v2-legacy-hide\.css["']/,
    "jb-v2-legacy-hide.css not linked from index.html",
  );
});

// ---------------------------------------------------------------------------
// Check 13 — token lint passes on the entire v2 CSS surface.
// ---------------------------------------------------------------------------
test("smoke 13/13: tools/lint-tokens.mjs passes (0 findings)", () => {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "tools/lint-tokens.mjs"), "--quiet"],
    { encoding: "utf8", cwd: ROOT },
  );
  assert.equal(result.status, 0, `lint-tokens failed:\n${result.stdout}`);
  assert.match(result.stdout, /^0 findings/, "expected 0 findings");
});
