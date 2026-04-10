import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(__dirname, "..", "..");

async function readText(relativePath: string) {
  return readFile(join(workerRoot, relativePath), "utf8");
}

test("worker QA docs and env example expose the local prerequisites", async () => {
  const [envExample, qaDoc, bootstrapFixture, workerConfig] = await Promise.all([
    readText(".env.example"),
    readText("docs/QA.md"),
    readText("tests/mocks/local-bootstrap-state.v1.json"),
    readText("state/worker-config.json"),
  ]);

  for (const expected of [
    "BROWSER_USE_DISCOVERY_RUN_MODE",
    "BROWSER_USE_DISCOVERY_HOST",
    "BROWSER_USE_DISCOVERY_PORT",
    "BROWSER_USE_DISCOVERY_CONFIG_PATH",
    "BROWSER_USE_DISCOVERY_STATE_DB_PATH",
    "BROWSER_USE_DISCOVERY_GEMINI_API_KEY",
    "BROWSER_USE_DISCOVERY_GROUNDED_SEARCH_MAX_RESULTS_PER_COMPANY",
    "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS",
    "BROWSER_USE_DISCOVERY_ASYNC_ACK",
  ]) {
    assert.match(envExample, new RegExp(expected));
  }

  for (const expected of [
    "npm run discovery:bootstrap-local",
    "/health",
    "ngrok",
    "Cloudflare Worker",
    "workers.dev",
    "202 Accepted",
    "Browser Use",
  ]) {
    assert.match(qaDoc, new RegExp(expected, "i"));
  }

  const bootstrap = JSON.parse(bootstrapFixture);
  assert.equal(bootstrap.status, "ready");
  assert.equal(bootstrap.diagnostics.gatewayHealthy, true);
  assert.equal(bootstrap.diagnostics.ngrokRunning, true);
  assert.equal(bootstrap.wizard.nextStepId, "local_health");
  assert.match(
    String(bootstrap.cloudflareDeployCommand),
    /cloudflare-relay:deploy/,
  );
  assert.match(workerConfig, /"grounded_web"/);
});
