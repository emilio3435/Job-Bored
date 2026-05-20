/**
 * Tests for the discovery drawer + companyAllowlist/companyBlocklist
 * webhook payload behavior.
 *
 * The drawer (markup in `index.html` and logic in `app.js`) is the single
 * surface for shaping a discovery search. Run discovery opens the drawer
 * when setup is ready; otherwise the existing setup wizard path runs.
 *
 * These tests do not boot a browser — they validate static structure of
 * the markup, the payload-builder source, and a behavioral simulation of
 * the company list sanitization that runs in the browser.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);

describe("Discovery drawer markup + open/close lifecycle", () => {
  it("has a #discoveryDrawer element using the shared detail-overlay/detail-drawer classes", () => {
    assert.ok(
      indexHtml.includes('id="discoveryDrawer"'),
      "discovery drawer element must exist",
    );
    assert.ok(
      indexHtml.includes("detail-overlay--discovery"),
      "discovery drawer must reuse detail-overlay pattern",
    );
    assert.ok(
      indexHtml.includes("detail-drawer detail-drawer--discovery"),
      "discovery drawer must reuse detail-drawer skin",
    );
  });

  it("does not contain the legacy #discoveryPrefsModal markup", () => {
    assert.ok(
      !indexHtml.includes('id="discoveryPrefsModal"'),
      "legacy modal must be removed in favor of drawer",
    );
    assert.ok(
      !indexHtml.includes('class="dp-tabs"'),
      "old tab UI must be removed",
    );
  });

  it("has Safe / Adjacent / Stretch AI ideation cards in the drawer body", () => {
    assert.match(indexHtml, /data-stratum="safe"/);
    assert.match(indexHtml, /data-stratum="adjacent"/);
    assert.match(indexHtml, /data-stratum="stretch"/);
  });

  it("has visible company targeting controls (allow + block lists)", () => {
    assert.match(indexHtml, /id="dpCompanyAllowlistChips"/);
    assert.match(indexHtml, /id="dpCompanyBlocklistChips"/);
    assert.match(indexHtml, /id="dpCompanyAllowlistAddBtn"/);
  });

  it("declares openDiscoveryDrawer / initDiscoveryDrawer as the entry points", () => {
    assert.match(appJs, /function openDiscoveryDrawer\(/);
    assert.match(appJs, /function initDiscoveryDrawer\(/);
    assert.ok(
      !/function openDiscoveryPrefsModal\(/.test(appJs),
      "legacy modal entry point must be removed",
    );
    assert.ok(
      !/function initDiscoveryPrefsModal\(/.test(appJs),
      "legacy modal init must be removed",
    );
  });

  it("Run discovery opens the tailoring drawer from the header click", () => {
    const initButtonStart = appJs.indexOf("function initDiscoveryButton()");
    assert.notEqual(initButtonStart, -1, "initDiscoveryButton must exist");
    const initButtonEnd = appJs.indexOf("\n  if (closeBtn)", initButtonStart);
    assert.notEqual(initButtonEnd, -1, "click handler section must be readable");
    const handlerSource = appJs.slice(initButtonStart, initButtonEnd);
    assert.match(handlerSource, /openBtn\.addEventListener\("click"/);
    assert.match(handlerSource, /openDiscoveryDrawer\(\)/);
    assert.doesNotMatch(
      handlerSource,
      /!view\.runDiscoveryEnabled\s*\|\|\s*!hasWebhook/,
      "header click should not skip the tailoring drawer just because setup is incomplete",
    );
    assert.doesNotMatch(
      handlerSource,
      /\/__proxy\/full-boot/,
      "header click should not bypass the tailoring drawer with local full-boot",
    );
  });

  it("wires the discovery drawer before the no-sheet early return", () => {
    const initStart = appJs.indexOf("function init()");
    assert.notEqual(initStart, -1, "init must exist");
    const initEnd = appJs.indexOf("\n}\n\n/**", initStart);
    assert.notEqual(initEnd, -1, "init body must be readable");
    const initSource = appJs.slice(initStart, initEnd);
    const noSheetGate = initSource.indexOf("if (!SHEET_ID)");
    assert.ok(noSheetGate > 0, "init should still have a no-sheet gate");
    assert.ok(
      initSource.indexOf("initDiscoveryDrawer()") > 0 &&
        initSource.indexOf("initDiscoveryDrawer()") < noSheetGate,
      "drawer listeners must be registered before the no-sheet gate",
    );
    assert.ok(
      initSource.indexOf("initDiscoveryButton()") > 0 &&
        initSource.indexOf("initDiscoveryButton()") < noSheetGate,
      "header button listener must be registered before the no-sheet gate",
    );
    // The no-webhook run path still routes through setup after the user
    // has had a chance to tailor and save the drawer fields.
    assert.match(
      appJs,
      /requestDiscoverySetup\(\{\s*entryPoint:\s*"run_discovery"/,
    );
  });

  it("starts runs through the resolved discovery transport, not the setup wizard autodetect shortcut", () => {
    const resolverStart = appJs.indexOf(
      "async function resolveDiscoveryRunWebhookUrl()",
    );
    assert.notEqual(resolverStart, -1, "run transport resolver must exist");
    const resolverEnd = appJs.indexOf(
      "\n}\n\n/** Notify automation",
      resolverStart,
    );
    assert.notEqual(resolverEnd, -1, "resolver body must be readable");
    const resolverSource = appJs.slice(resolverStart, resolverEnd);
    assert.match(
      resolverSource,
      /hydrateDiscoveryTransportSetupFromLocalBootstrap\(\)/,
      "run should hydrate local bootstrap state before declaring setup missing",
    );
    assert.match(
      resolverSource,
      /refreshDiscoveryReadinessSnapshot\(\{\s*force:\s*true,\s*rerender:\s*false,\s*\}\)/,
      "run should refresh readiness so live tunnel/bootstrap URLs can be used",
    );

    const candidateStart = appJs.indexOf(
      "function getDiscoveryRunWebhookUrlCandidates(",
    );
    assert.notEqual(candidateStart, -1, "candidate resolver must exist");
    const candidateEnd = appJs.indexOf(
      "\n}\n\nasync function resolveDiscoveryRunWebhookUrl",
      candidateStart,
    );
    assert.notEqual(candidateEnd, -1, "candidate resolver body must be readable");
    const candidateSource = appJs.slice(candidateStart, candidateEnd);
    assert.match(candidateSource, /state\.relayTargetUrl/);
    assert.match(candidateSource, /getCloudflareRelayTargetInfo\(\)/);
    assert.match(candidateSource, /buildDiscoveryTunnelTargetUrl\(/);

    const triggerStart = appJs.indexOf("async function triggerDiscoveryRun()");
    assert.notEqual(triggerStart, -1, "triggerDiscoveryRun must exist");
    const triggerEnd = appJs.indexOf(
      "\n}\n\n/**\n * POST a test payload",
      triggerStart,
    );
    assert.notEqual(triggerEnd, -1, "triggerDiscoveryRun body must be readable");
    const triggerSource = appJs.slice(triggerStart, triggerEnd);
    assert.match(
      triggerSource,
      /const hook = await resolveDiscoveryRunWebhookUrl\(\);/,
      "run should use the transport resolver before falling back to setup",
    );
    assert.doesNotMatch(
      triggerSource,
      /const hook = normalizeDiscoveryWebhookIdentity\(getDiscoveryWebhookUrl\(\)\);/,
      "run should not depend only on the saved config webhook URL",
    );
    assert.match(
      triggerSource,
      /skipAutodetect:\s*true/,
      "no-url fallback should show setup instead of the already-set-up toast",
    );
  });
});

describe("buildDiscoveryWebhookPayload — companyAllowlist / companyBlocklist", () => {
  it("includes companyAllowlist and companyBlocklist as top-level fields", () => {
    const builderStart = appJs.indexOf("async function buildDiscoveryWebhookPayload(");
    assert.ok(builderStart !== -1, "builder function must exist");
    const builderEnd = appJs.indexOf("\n}\n", builderStart);
    const body = appJs.slice(builderStart, builderEnd);
    assert.match(body, /companyAllowlist:\s*companyAllowlist\.length/);
    assert.match(body, /companyBlocklist:\s*companyBlocklist\.length/);
  });

  it("uses `undefined` so empty lists are dropped from the wire payload", () => {
    const builderStart = appJs.indexOf("async function buildDiscoveryWebhookPayload(");
    const builderEnd = appJs.indexOf("\n}\n", builderStart);
    const body = appJs.slice(builderStart, builderEnd);
    assert.match(
      body,
      /companyAllowlist:\s*companyAllowlist\.length\s*\?\s*companyAllowlist\s*:\s*undefined/,
    );
    assert.match(
      body,
      /companyBlocklist:\s*companyBlocklist\.length\s*\?\s*companyBlocklist\s*:\s*undefined/,
    );
  });

  it("strips the duplicates from discoveryProfile so wire has exactly one source of truth", () => {
    const builderStart = appJs.indexOf("async function buildDiscoveryWebhookPayload(");
    const builderEnd = appJs.indexOf("\n}\n", builderStart);
    const body = appJs.slice(builderStart, builderEnd);
    assert.match(body, /delete stripped\.companyAllowlist/);
    assert.match(body, /delete stripped\.companyBlocklist/);
  });

  it("simulated: sanitizer trims, dedupes (case-insensitive), and caps at 50", () => {
    function sanitize(raw) {
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      const out = [];
      for (const v of raw) {
        if (typeof v !== "string") continue;
        const t = v.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= 50) break;
      }
      return out;
    }
    assert.deepEqual(sanitize(["Stripe", "  Linear  ", "stripe", "Vercel"]), [
      "Stripe",
      "Linear",
      "Vercel",
    ]);
    assert.deepEqual(sanitize([]), []);
    assert.deepEqual(sanitize(undefined), []);
    assert.deepEqual(sanitize([null, "", "  ", 42, "Acme"]), ["Acme"]);
    const big = Array.from({ length: 60 }, (_, i) => `Co${i}`);
    assert.equal(sanitize(big).length, 50);
  });
});

describe("user-content-store — companyAllowlist / companyBlocklist persistence", () => {
  it("normalizeDiscoveryProfile returns companyAllowlist + companyBlocklist", () => {
    assert.match(
      userContentStoreJs,
      /companyAllowlist:\s*normalizeCompanyList\(o\.companyAllowlist\)/,
    );
    assert.match(
      userContentStoreJs,
      /companyBlocklist:\s*normalizeCompanyList\(o\.companyBlocklist\)/,
    );
  });

  it("normalizeCompanyList caps entries at 50 and dedupes case-insensitively", () => {
    assert.match(userContentStoreJs, /function normalizeCompanyList\(/);
    assert.match(
      userContentStoreJs,
      /if \(out\.length >= 50\) break/,
    );
  });
});

describe("AI ideation generates Safe/Adjacent/Stretch strata", () => {
  it("generateDiscoverySuggestions returns { safe, adjacent, stretch }", () => {
    const sigStart = appJs.indexOf("async function generateDiscoverySuggestions(");
    assert.ok(sigStart !== -1, "generateDiscoverySuggestions must exist");
    const slice = appJs.slice(sigStart, sigStart + 6000);
    assert.match(slice, /safe:\s*normalizeStratum/);
    assert.match(slice, /adjacent:\s*normalizeStratum/);
    assert.match(slice, /stretch:\s*normalizeStratum/);
  });

  it("normalizeStratum coerces companyAllowlist via the sanitizer", () => {
    assert.match(
      appJs,
      /function normalizeStratum\([\s\S]*?companyAllowlist:\s*sanitizeCompanyEntries/,
    );
  });

  it("applyStratumToDrawer overwrites the allowlist (auto-include companies by default)", () => {
    assert.match(
      appJs,
      /function applyStratumToDrawer\([\s\S]*?discoveryDrawerState\.allow\s*=\s*sanitizeCompanyEntries/,
    );
  });
});

describe("Run guard: blank intent without AI strata still blocks the run", () => {
  it("the drawer Run handler shows a warning when both targetRoles and keywordsInclude are blank", () => {
    // The handler is inside initDiscoveryDrawer.
    const initStart = appJs.indexOf("function initDiscoveryDrawer(");
    assert.ok(initStart !== -1);
    const slice = appJs.slice(initStart, initStart + 8000);
    assert.match(
      slice,
      /Add target roles or keywords, or pick an AI idea above/,
    );
  });
});
