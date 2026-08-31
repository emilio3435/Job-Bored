import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let truth = null;
try {
  truth = require("../discovery-readiness-truth.js");
} catch (_) {
  // The first run is intentionally red before the module exists.
}

function classify(snapshot, engineState, lastCheckedAt) {
  assert.equal(
    typeof truth?.classifyDiscoveryReadiness,
    "function",
    "discovery-readiness-truth.js must export classifyDiscoveryReadiness",
  );
  return truth.classifyDiscoveryReadiness(snapshot, engineState, lastCheckedAt);
}

test("SETUP-03: an unverified saved endpoint is ready_to_test, never verified", () => {
  const result = classify(
    { savedWebhookUrl: "https://discovery.example/run", sheetConfigured: true },
    { state: "unverified", webhookUrl: "https://discovery.example/run" },
    "2026-08-31T12:00:00.000Z",
  );

  assert.deepEqual(result, {
    level: "ready_to_test",
    reason: "endpoint_unverified",
    label: "Ready to test",
  });
});

test("SETUP-03-stale: a connected endpoint with an old check is stale", () => {
  assert.equal(typeof truth?.DEFAULT_STALE_AFTER_MS, "number");
  const lastCheckedAt = new Date(
    Date.now() - truth.DEFAULT_STALE_AFTER_MS - 1,
  ).toISOString();
  const result = classify(
    { savedWebhookUrl: "https://discovery.example/run", sheetConfigured: true },
    { state: "connected", webhookUrl: "https://discovery.example/run" },
    lastCheckedAt,
  );

  assert.equal(result.level, "stale");
  assert.equal(result.reason, "verification_stale");
  assert.equal(result.label, "Discovery check stale");
});

test("SETUP-01 visibility: clearing a previously saved webhook is blocked/webhook_cleared", () => {
  const result = classify(
    {
      savedWebhookUrl: "",
      previousSavedWebhookUrl: "https://discovery.example/run",
      sheetConfigured: true,
    },
    { state: "unverified", webhookUrl: "https://discovery.example/run" },
    "2026-08-31T12:00:00.000Z",
  );

  assert.equal(result.level, "blocked");
  assert.equal(result.reason, "webhook_cleared");
  assert.equal(result.label, "Discovery blocked");
});

test("SETUP-03 drawer probe: readiness chip delegates to engine truth", () => {
  const drawerSource = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
  const start = drawerSource.indexOf("function refreshDiscoveryDrawerStatusChip()");
  const end = drawerSource.indexOf(
    "\n}\n\nfunction getLocalDiscoveryWorkerHealthUrlForSources",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = drawerSource.slice(start, end);

  assert.match(block, /classifyDiscoveryReadiness/);
  assert.doesNotMatch(
    block,
    /view\s*&&\s*view\.runDiscoveryEnabled\s*&&\s*hasWebhook[\s\S]*Discovery ready/,
  );
});

/* R4: the unstyled-chip trap. The classifier replaced the drawer's old chip
   vocabulary, and its success level is "verified" — it can never emit the
   "ready" the green CSS rule was keyed to. A verbatim port therefore ships a
   fully configured endpoint with an unstyled chip, and nothing on either side
   catches it: the classifier's own tests only look at the returned level, and
   the drawer probe only checks that the classifier is called. This test closes
   that seam by deriving the vocabulary from the classifier itself, so adding a
   level without painting it fails here rather than in someone's browser. */
test("SETUP-03 chip styling: every level the classifier can emit is styled", () => {
  const classifierSource = readFileSync(
    join(repoRoot, "discovery-readiness-truth.js"),
    "utf8",
  );
  const chipCss = readFileSync(
    join(repoRoot, "css/legacy-discovery-drawer.css"),
    "utf8",
  );

  const levels = [
    ...new Set(
      [...classifierSource.matchAll(/result\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
    ),
  ];
  assert.ok(
    levels.includes("verified") && levels.length >= 4,
    `expected the classifier vocabulary, got ${JSON.stringify(levels)}`,
  );

  for (const level of levels) {
    assert.match(
      chipCss,
      new RegExp(`\\.discovery-drawer__chip\\[data-state="${level}"\\]`),
      `readiness level "${level}" has no .discovery-drawer__chip rule — it renders unstyled`,
    );
  }
});
