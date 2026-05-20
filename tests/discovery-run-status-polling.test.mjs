import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCorsHeaders } from "../integrations/browser-use-discovery/src/http/origin-guard.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const workerTemplate = readFileSync(
  join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
  "utf8",
);

describe("discovery run status polling", () => {
  it("polls the local browser-use worker on localhost instead of the public ngrok URL", () => {
    const resolverStart = appJs.indexOf(
      "function getDiscoveryStatusPollingWebhookUrl(",
    );
    assert.notEqual(resolverStart, -1, "status polling resolver must exist");
    const resolverEnd = appJs.indexOf(
      "\n}\n\nfunction buildDiscoveryStatusPollHeaders",
      resolverStart,
    );
    assert.notEqual(resolverEnd, -1, "resolver body must be readable");
    const resolverSource = appJs.slice(resolverStart, resolverEnd);

    assert.match(resolverSource, /isLocalDashboardOrigin\(\)/);
    assert.match(resolverSource, /normalizeDiscoveryLocalWebhookUrl\(/);
    assert.match(resolverSource, /browser_use_worker/);
    assert.match(resolverSource, /buildDiscoveryTunnelTargetUrl\(/);
    assert.match(resolverSource, /isLikelyCloudflareWorkerUrl\(/);
  });

  it("uses the status polling resolver before each poll loop starts", () => {
    const pollingStart = appJs.indexOf(
      "async function startDiscoveryStatusPolling(",
    );
    assert.notEqual(pollingStart, -1, "polling loop must exist");
    const pollingEnd = appJs.indexOf(
      "\n}\n\n/** Stop any active polling loop",
      pollingStart,
    );
    assert.notEqual(pollingEnd, -1, "polling body must be readable");
    const pollingSource = appJs.slice(pollingStart, pollingEnd);

    assert.match(
      pollingSource,
      /const pollingWebhookUrl = getDiscoveryStatusPollingWebhookUrl\(webhookUrl\);/,
    );
    assert.match(pollingSource, /pollRunStatus\(pollingWebhookUrl\)/);
    assert.match(pollingSource, /tracker\.isTerminal\(\)/);
    assert.doesNotMatch(pollingSource, /pollRunStatus\(webhookUrl\)/);
    assert.doesNotMatch(
      pollingSource,
      /updated\.isTerminal\(\)/,
      "getState() returns a plain object, not tracker methods",
    );
  });

  it("retries persisted failures caused by status polling after reload", () => {
    assert.match(appJs, /resumeFromStatusPollingFailure\(\)/);
    assert.match(appJs, /function resumeDiscoveryStatusPollingIfNeeded\(\)/);

    const resumeStart = appJs.indexOf(
      "function resumeDiscoveryStatusPollingIfNeeded()",
    );
    assert.notEqual(resumeStart, -1, "resume helper must exist");
    const resumeEnd = appJs.indexOf(
      "\n}\n\n/**\n * Render current run status",
      resumeStart,
    );
    assert.notEqual(resumeEnd, -1, "resume helper body must be readable");
    const resumeSource = appJs.slice(resumeStart, resumeEnd);

    assert.match(resumeSource, /resumeFromStatusPollingFailure\(\)/);
    assert.match(resumeSource, /discoveryRunTracker\.isActive\(\)/);
    assert.match(resumeSource, /startDiscoveryStatusPolling\(/);
    assert.doesNotMatch(
      resumeSource,
      /next\.isActive\(\)/,
      "getState() returns a plain object, not tracker methods",
    );
    assert.match(
      appJs,
      /preloadDiscoveryUiState\(\);\s*resumeDiscoveryStatusPollingIfNeeded\(\);/,
    );
  });

  it("can bypass ngrok's browser warning when a browser must poll ngrok directly", () => {
    const headersStart = appJs.indexOf(
      "function buildDiscoveryStatusPollHeaders(",
    );
    assert.notEqual(headersStart, -1, "poll header helper must exist");
    const headersEnd = appJs.indexOf(
      "\n}\n\n/**\n * Fetch and process",
      headersStart,
    );
    assert.notEqual(headersEnd, -1, "poll header helper body must be readable");
    const headersSource = appJs.slice(headersStart, headersEnd);

    assert.match(headersSource, /Accept:\s*"application\/json"/);
    assert.match(headersSource, /isLikelyNgrokUrl\(statusUrl\)/);
    assert.match(headersSource, /"ngrok-skip-browser-warning":\s*"true"/);
    assert.match(
      appJs,
      /headers:\s*buildDiscoveryStatusPollHeaders\(statusUrl\)/,
    );
  });

  it("allows the ngrok bypass header through the local worker CORS preflight", () => {
    const headers = buildCorsHeaders(
      ["http://localhost:8080"],
      "http://localhost:8080",
    );
    assert.match(
      headers["Access-Control-Allow-Headers"],
      /ngrok-skip-browser-warning/,
    );
  });

  it("keeps the Cloudflare relay template compatible with that browser header", () => {
    assert.match(workerTemplate, /Ngrok-Skip-Browser-Warning/);
  });
});
