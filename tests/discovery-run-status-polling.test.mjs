import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCorsHeaders } from "../integrations/browser-use-discovery/src/http/origin-guard.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const bootstrapJs = readFileSync(join(repoRoot, "app-bootstrap.js"), "utf8");
const runOrchJs = readFileSync(
  join(repoRoot, "discovery-run-orchestration.js"),
  "utf8",
);
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const workerTemplate = readFileSync(
  join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
  "utf8",
);

describe("discovery run status polling", () => {
  it("polls the local browser-use worker on localhost instead of the public ngrok URL", () => {
    const resolverStart = statusHandoffJs.indexOf(
      "function getDiscoveryStatusPollingWebhookUrl(",
    );
    assert.notEqual(resolverStart, -1, "status polling resolver must exist");
    const resolverEnd = statusHandoffJs.indexOf(
      "\n}\n\nfunction buildDiscoveryStatusPollHeaders",
      resolverStart,
    );
    assert.notEqual(resolverEnd, -1, "resolver body must be readable");
    const resolverSource = statusHandoffJs.slice(resolverStart, resolverEnd);

    assert.match(resolverSource, /host\(\)\.isLocalDashboardOrigin\(\)/);
    assert.match(resolverSource, /host\(\)\.normalizeDiscoveryLocalWebhookUrl\(/);
    assert.match(resolverSource, /browser_use_worker/);
    assert.match(resolverSource, /host\(\)\.buildDiscoveryTunnelTargetUrl\(/);
    assert.match(resolverSource, /host\(\)\.isLikelyCloudflareWorkerUrl\(/);
  });

  it("uses the status polling resolver before each poll loop starts", () => {
    const pollingStart = statusHandoffJs.indexOf(
      "async function startDiscoveryStatusPolling(",
    );
    assert.notEqual(pollingStart, -1, "polling loop must exist");
    const pollingEnd = statusHandoffJs.indexOf(
      "\n}\n\n/** Stop any active polling loop",
      pollingStart,
    );
    assert.notEqual(pollingEnd, -1, "polling body must be readable");
    const pollingSource = statusHandoffJs.slice(pollingStart, pollingEnd);

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
    assert.doesNotMatch(
      pollingSource,
      /markFailed\(\s*["']Status polling failed/,
      "polling transport loss must not mark the worker run as failed",
    );
    assert.match(pollingSource, /Lost the status connection/);
  });

  it("refreshes Pipeline data after a successful async discovery terminal status", () => {
    const pollingStart = statusHandoffJs.indexOf(
      "async function startDiscoveryStatusPolling(",
    );
    assert.notEqual(pollingStart, -1, "polling loop must exist");
    const pollingEnd = statusHandoffJs.indexOf(
      "\n}\n\n/** Stop any active polling loop",
      pollingStart,
    );
    assert.notEqual(pollingEnd, -1, "polling body must be readable");
    const pollingSource = statusHandoffJs.slice(pollingStart, pollingEnd);

    const refreshStart = statusHandoffJs.indexOf(
      "async function refreshPipelineAfterDiscoveryRun(",
    );
    assert.notEqual(refreshStart, -1, "post-discovery refresh helper must exist");
    const refreshEnd = statusHandoffJs.indexOf(
      "\n}\n\nconst PRE_FILTER_REASON_LABELS",
      refreshStart,
    );
    assert.notEqual(refreshEnd, -1, "post-discovery refresh helper must be readable");
    const refreshSource = statusHandoffJs.slice(refreshStart, refreshEnd);

    assert.match(pollingSource, /await refreshPipelineAfterDiscoveryRun\(updated\)/);
    assert.match(refreshSource, /shouldRefreshPipelineAfterDiscoveryRun\(state\)/);
    assert.match(refreshSource, /host\(\)\.loadAllData\(\)/);
    assert.match(statusHandoffJs, /status === "completed"/);
    assert.match(statusHandoffJs, /status === "partial"/);
  });

  it("synthesizes /runs/:id for accepted async responses from known worker endpoints", () => {
    assert.match(statusHandoffJs, /function resolveAcceptedRunStatusPath\(/);
    assert.match(statusHandoffJs, /canSynthesizeRunStatusPath\(webhookUrl\)/);
    assert.match(statusHandoffJs, /"\/runs\/" \+ encodeURIComponent\(runId\)/);

    const triggerStart = appJs.indexOf("async function triggerDiscoveryRun(");
    assert.notEqual(triggerStart, -1, "triggerDiscoveryRun must exist");
    const runTriggerStart = runOrchJs.indexOf("async function triggerDiscoveryRun(");
    assert.notEqual(runTriggerStart, -1, "triggerDiscoveryRun implementation must exist");
    const triggerEnd = runOrchJs.indexOf(
      "\n}\n\n  Object.assign(runOrchestration",
      runTriggerStart,
    );
    const triggerSource = runOrchJs.slice(runTriggerStart, triggerEnd);
    assert.match(triggerSource, /statusApi\.resolveAcceptedRunStatusPath\(result, webhookUrl\)/);
    assert.match(triggerSource, /statusUnavailable:\s*!statusPath/);
    assert.match(triggerSource, /if \(statusPath\) \{\s*void statusApi\.startDiscoveryStatusPolling\(webhookUrl\);/);
  });

  it("does not synthesize tokenless hosted run status URLs when statusPath is omitted", () => {
    const resolverStart = statusHandoffJs.indexOf(
      "function resolveAcceptedRunStatusPath(",
    );
    assert.notEqual(resolverStart, -1, "accepted run resolver must exist");
    const resolverEnd = statusHandoffJs.indexOf(
      "\n}\n\nfunction isLikelyNgrokUrl",
      resolverStart,
    );
    assert.notEqual(resolverEnd, -1, "accepted run resolver body must be readable");
    const resolverSource = statusHandoffJs.slice(resolverStart, resolverEnd);

    assert.match(
      resolverSource,
      /if \(explicit\) return explicit;/,
      "the dashboard must preserve a returned statusPath exactly, including statusToken",
    );

    const synthStart = statusHandoffJs.indexOf("function canSynthesizeRunStatusPath(");
    assert.notEqual(synthStart, -1, "status-path synthesis allowlist must exist");
    const synthEnd = statusHandoffJs.indexOf(
      "\n}\n\nfunction resolveAcceptedRunStatusPath",
      synthStart,
    );
    assert.notEqual(synthEnd, -1, "status-path synthesis allowlist body must be readable");
    const synthSource = statusHandoffJs.slice(synthStart, synthEnd);

    assert.doesNotMatch(
      synthSource,
      /isLikelyCloudflareWorkerUrl/,
      "hosted Worker URLs require the returned HMAC statusPath; do not synthesize tokenless /runs/:id",
    );
    assert.doesNotMatch(
      synthSource,
      /webhook\|discovery\|discovery-profile/,
      "generic hosted webhook URLs require the returned statusPath; do not infer tokenless /runs/:id",
    );
  });

  it("retries persisted failures caused by status polling after reload", () => {
    assert.match(statusHandoffJs, /resumeFromStatusPollingFailure\(\)/);
    assert.match(statusHandoffJs, /function resumeDiscoveryStatusPollingIfNeeded\(\)/);

    const resumeStart = statusHandoffJs.indexOf(
      "function resumeDiscoveryStatusPollingIfNeeded()",
    );
    assert.notEqual(resumeStart, -1, "resume helper must exist");
    const resumeEnd = statusHandoffJs.indexOf(
      "\n}\n\n/**\n * Render current run status",
      resumeStart,
    );
    assert.notEqual(resumeEnd, -1, "resume helper body must be readable");
    const resumeSource = statusHandoffJs.slice(resumeStart, resumeEnd);

    assert.match(resumeSource, /resumeFromStatusPollingFailure\(\)/);
    assert.match(resumeSource, /runTracker\(\)\.isActive\(\)/);
    assert.match(resumeSource, /startDiscoveryStatusPolling\(/);
    assert.doesNotMatch(
      resumeSource,
      /next\.isActive\(\)/,
      "getState() returns a plain object, not tracker methods",
    );
    assert.match(
      bootstrapJs,
      /void h\("preloadDiscoveryUiState"\);\s*h\("resumeDiscoveryStatusPollingIfNeeded"\);/,
      "init must preload discovery UI state before resuming status polling after reload",
    );
  });

  it("can bypass ngrok's browser warning when a browser must poll ngrok directly", () => {
    const headersStart = statusHandoffJs.indexOf(
      "function buildDiscoveryStatusPollHeaders(",
    );
    assert.notEqual(headersStart, -1, "poll header helper must exist");
    const headersEnd = statusHandoffJs.indexOf(
      "\n}\n\n/**\n * Fetch and process",
      headersStart,
    );
    assert.notEqual(headersEnd, -1, "poll header helper body must be readable");
    const headersSource = statusHandoffJs.slice(headersStart, headersEnd);

    assert.match(headersSource, /Accept:\s*"application\/json"/);
    assert.match(headersSource, /isLikelyNgrokUrl\(statusUrl\)/);
    assert.match(headersSource, /"ngrok-skip-browser-warning":\s*"true"/);
    assert.match(
      statusHandoffJs,
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
