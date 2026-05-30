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
const discoveryPayloadJs = readFileSync(
  join(repoRoot, "discovery-payload.js"),
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

  it("exposes the canonical Discovery sub-tab tablist (Search · Sources · Automation · Connection · History)", () => {
    assert.match(indexHtml, /id="discoverySubtabs"/);
    ["search", "sources", "automation", "connection", "history"].forEach(
      (id) => {
        assert.ok(
          indexHtml.includes(`id="dd-tab-${id}"`),
          `drawer must have sub-tab button #dd-tab-${id}`,
        );
        assert.ok(
          indexHtml.includes(`id="dd-panel-${id}"`),
          `drawer must have sub-tab panel #dd-panel-${id}`,
        );
      },
    );
  });

  it("Connection sub-tab carries the webhook URL/secret and Apps Script controls (moved from Settings)", () => {
    const conn = indexHtml.indexOf('id="dd-panel-connection"');
    assert.ok(conn !== -1, "Connection panel must exist");
    const after = indexHtml.slice(conn);
    const next = after.indexOf('id="dd-panel-history"');
    assert.ok(next !== -1, "Connection panel must precede History");
    const block = after.slice(0, next);
    assert.match(block, /id="settingsDiscoveryWebhookUrl"/);
    assert.match(block, /id="settingsDiscoveryWebhookSecret"/);
    assert.match(block, /id="settingsAppsScriptDetails"/);
    assert.match(block, /id="settingsDiscoveryEngineStatus"/);
    assert.match(block, /id="settingsDiscoveryTestBtn"/);
    assert.match(block, /id="settingsDiscoveryGuideBtn"/);
    assert.match(block, /id="settingsDiscoveryLocalSetupBtn"/);
    assert.match(block, /id="settingsDiscoveryRelayBtn"/);
  });

  it("Automation sub-tab carries the Tier 1/2/3 schedule controls (moved from Profile)", () => {
    const auto = indexHtml.indexOf('id="dd-panel-automation"');
    assert.ok(auto !== -1, "Automation panel must exist");
    const after = indexHtml.slice(auto);
    const next = after.indexOf('id="dd-panel-connection"');
    assert.ok(next !== -1, "Automation panel must precede Connection");
    const block = after.slice(0, next);
    assert.match(block, /id="settingsProfileAutoRefreshToggle"/);
    assert.match(block, /id="settingsProfileScheduleLocalEnable"/);
    assert.match(block, /id="settingsProfileScheduleLocalTime"/);
    assert.match(block, /id="settingsProfileScheduleCloudEnable"/);
    assert.match(block, /id="settingsProfileScheduleCloudTime"/);
  });

  it("Sources sub-tab carries source preset, grounded web, and SerpApi callout", () => {
    const sources = indexHtml.indexOf('id="dd-panel-sources"');
    assert.ok(sources !== -1, "Sources panel must exist");
    const after = indexHtml.slice(sources);
    const next = after.indexOf('id="dd-panel-automation"');
    assert.ok(next !== -1, "Sources panel must precede Automation");
    const block = after.slice(0, next);
    assert.match(block, /id="dpSourcePresetGroup"/);
    assert.match(block, /id="dpGroundedWeb"/);
    assert.match(block, /id="settingsSerpApiCallout"/);
  });

  it("Settings modal no longer renders legacy Discovery controls", () => {
    const legacyDiscoveryPanelId = ["settings", "panel", "discovery"].join("-");
    const legacyDiscoveryTabId = ["settings", "tab", "discovery"].join("-");
    assert.ok(
      !indexHtml.includes(`id="${legacyDiscoveryPanelId}"`),
      "legacy Discovery panel must be removed",
    );
    assert.ok(
      !indexHtml.includes(`id="${legacyDiscoveryTabId}"`),
      "legacy Discovery tab button must be removed",
    );
    // Old duplicate Discovery preferences fields (settingsDiscoveryTargetRoles
    // et al.) must not be re-introduced anywhere — the canonical inputs are
    // dpTargetRoles, dpLocations, … inside the drawer.
    [
      "settingsDiscoveryTargetRoles",
      "settingsDiscoveryLocations",
      "settingsDiscoveryRemotePolicy",
      "settingsDiscoverySeniority",
      "settingsDiscoveryKeywordsInclude",
      "settingsDiscoveryKeywordsExclude",
      "settingsDiscoveryMaxLeadsPerRun",
      "settingsDiscoveryGroundedWeb",
    ].forEach((id) => {
      assert.ok(
        !indexHtml.includes(`id="${id}"`),
        `duplicate Discovery preference input #${id} must not exist`,
      );
    });
  });

  it("Settings modal no longer renders legacy Profile controls", () => {
    const legacyProfilePanelId = ["settings", "panel", "profile"].join("-");
    const legacyProfileTabId = ["settings", "tab", "profile"].join("-");
    assert.ok(
      !indexHtml.includes(`id="${legacyProfilePanelId}"`),
      "legacy Profile panel must be removed",
    );
    assert.ok(
      !indexHtml.includes(`id="${legacyProfileTabId}"`),
      "legacy Profile tab button must be removed",
    );
    // The legacy schedule card class must not be re-introduced anywhere.
    assert.ok(
      !/class="settings-profile-block settings-profile-schedule"/.test(
        indexHtml,
      ),
      "discovery schedule card must live in the drawer Automation sub-tab only",
    );
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
    assert.doesNotMatch(
      handlerSource,
      /requestDiscoverySetup\(/,
      "header click should not detour into setup before opening the drawer",
    );
    assert.doesNotMatch(
      handlerSource,
      /localRecoveryState|needsRecovery/,
      "stale local recovery state must not prevent the drawer from opening",
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
    assert.match(candidateSource, /snapshot_tunnel_target/);
    assert.match(candidateSource, /getCloudflareRelayTargetInfo\(\)/);
    assert.match(candidateSource, /buildDiscoveryTunnelTargetUrl\(/);
    assert.match(candidateSource, /source:\s*"configured"/);
    assert.match(resolverSource, /scoreDiscoveryRunWebhookCandidates\(/);

    const triggerStart = appJs.indexOf("async function triggerDiscoveryRun(");
    assert.notEqual(triggerStart, -1, "triggerDiscoveryRun must exist");
    const triggerEnd = appJs.indexOf(
      "\n}\n\nwindow.JobBoredDiscovery",
      triggerStart,
    );
    assert.notEqual(triggerEnd, -1, "triggerDiscoveryRun body must be readable");
    const triggerSource = appJs.slice(triggerStart, triggerEnd);
    assert.match(
      triggerSource,
      /let hook = await resolveDiscoveryRunWebhookUrl\(\);/,
      "run should use the transport resolver before falling back to setup",
    );
    assert.match(
      triggerSource,
      /ensureLocalDiscoveryAutoSetupForRun\(\)/,
      "run should try local automatic setup before showing setup instructions",
    );
    assert.ok(
      triggerSource.indexOf("ensureLocalDiscoveryAutoSetupForRun()") <
        triggerSource.indexOf("resolveDiscoveryRunWebhookUrl()"),
      "run should validate local setup before selecting a local webhook URL",
    );
    assert.match(
      appJs,
      /async function ensureLocalDiscoveryAutoSetupForRun\(\)[\s\S]*\/__proxy\/discovery-state[\s\S]*\/__proxy\/fix-setup/,
      "local automatic setup should probe readiness before using the setup proxy",
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
    assert.match(
      triggerSource,
      /runTrigger/,
      "manual and scheduled callers should share triggerDiscoveryRun with an explicit trigger label",
    );
    assert.match(
      appJs,
      /refreshDiscoveryWebhookSecretFromBootstrapForEndpoint/,
      "local secret mismatch recovery should refresh the bootstrap secret instead of only asking for a reload",
    );
  });

  it("surfaces missing local worker source config before opening/running discovery", () => {
    const readinessStart = appJs.indexOf(
      "async function fetchLocalDiscoveryWorkerSourceReadiness()",
    );
    assert.notEqual(
      readinessStart,
      -1,
      "fetchLocalDiscoveryWorkerSourceReadiness must exist",
    );
    const readinessEnd = appJs.indexOf(
      "\n}\n\nfunction getDiscoverySourceReadinessIssues",
      readinessStart,
    );
    assert.notEqual(
      readinessEnd,
      -1,
      "fetchLocalDiscoveryWorkerSourceReadiness body must be readable",
    );
    const readinessSource = appJs.slice(readinessStart, readinessEnd);
    assert.match(
      appJs,
      /function getLocalDiscoveryWorkerHealthUrlForSources\([\s\S]*getDiscoveryLocalWebhookHealthUrl\(localWebhookUrl\)/,
      "source readiness should resolve the local worker /health endpoint",
    );
    assert.match(
      readinessSource,
      /fetch\(healthUrl,[\s\S]*mode:\s*"cors"[\s\S]*cache:\s*"no-store"/,
      "drawer source readiness should read the local worker /health endpoint",
    );
    assert.match(
      appJs,
      /function getDiscoverySourceReadinessIssues\([\s\S]*groundedWeb[\s\S]*Gemini API key[\s\S]*serpApiGoogleJobs[\s\S]*SerpApi key/,
      "source readiness should call out missing Gemini and SerpApi config",
    );
    assert.match(
      appJs,
      /function renderDiscoveryDrawerSourceReadiness\([\s\S]*discoveryDrawerLastRun[\s\S]*Source config missing/,
      "drawer header should show missing source config instead of hiding it in a later partial run",
    );

    const openStart = appJs.indexOf("function openDiscoveryDrawer()");
    assert.notEqual(openStart, -1, "openDiscoveryDrawer must exist");
    const openEnd = appJs.indexOf("\n}\n\nfunction closeDiscoveryDrawer", openStart);
    assert.notEqual(openEnd, -1, "openDiscoveryDrawer body must be readable");
    const openSource = appJs.slice(openStart, openEnd);
    assert.match(openSource, /refreshDiscoveryDrawerSourceReadiness\(\)/);

    const triggerStart = appJs.indexOf("async function triggerDiscoveryRun(");
    assert.notEqual(triggerStart, -1, "triggerDiscoveryRun must exist");
    const triggerEnd = appJs.indexOf(
      "\n}\n\nwindow.JobBoredDiscovery",
      triggerStart,
    );
    assert.notEqual(triggerEnd, -1, "triggerDiscoveryRun body must be readable");
    const triggerSource = appJs.slice(triggerStart, triggerEnd);
    assert.match(triggerSource, /warnDiscoverySourceReadinessBeforeRun\(\)/);
  });
});

describe("buildDiscoveryWebhookPayload — companyAllowlist / companyBlocklist", () => {
  it("delegates browser Run discovery payloads to the shared payload builder", () => {
    assert.match(appJs, /window\.JobBoredDiscoveryPayload/);
    assert.match(appJs, /sharedBuilder\.buildDiscoveryWebhookPayload/);
  });

  it("includes companyAllowlist and companyBlocklist as top-level fields", () => {
    assert.match(discoveryPayloadJs, /companyAllowlist:\s*allow/);
    assert.match(discoveryPayloadJs, /companyBlocklist:\s*block/);
  });

  it("uses `undefined` so empty lists are dropped from the wire payload", () => {
    assert.match(
      discoveryPayloadJs,
      /\.\.\.\(allow\.length\s*\?\s*\{\s*companyAllowlist:\s*allow\s*\}\s*:\s*\{\}\)/,
    );
    assert.match(
      discoveryPayloadJs,
      /\.\.\.\(block\.length\s*\?\s*\{\s*companyBlocklist:\s*block\s*\}\s*:\s*\{\}\)/,
    );
  });

  it("strips the duplicates from discoveryProfile so wire has exactly one source of truth", () => {
    assert.match(discoveryPayloadJs, /delete wireProfile\.companyAllowlist/);
    assert.match(discoveryPayloadJs, /delete wireProfile\.companyBlocklist/);
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
