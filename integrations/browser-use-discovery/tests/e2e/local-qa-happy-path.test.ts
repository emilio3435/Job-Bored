import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMockLocalWorker } from "../mocks/mock-local-worker.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mocksDir = join(__dirname, "..", "mocks");

async function readJson(name: string) {
  return JSON.parse(await readFile(join(mocksDir, name), "utf8"));
}

test("mock local worker path accepts discovery payloads and serves /health", async () => {
  const fixtures = {
    health: await readJson("health-response.ok.v1.json"),
    ack: await readJson("discovery-webhook-ack.accepted_async.v1.json"),
    expectedRequest: await readJson("discovery-webhook-request.v1.json"),
  };
  const bootstrap = await readJson("local-bootstrap-state.v1.json");
  assert.match(String(bootstrap.localWebhookUrl), /^http:\/\/127\.0\.0\.1:/);
  assert.match(String(bootstrap.localHealthUrl), /\/health$/);
  assert.match(String(bootstrap.publicTargetUrl), /^https:\/\//);
  assert.match(String(bootstrap.tunnelPublicUrl), /^https:\/\//);

  const worker = createMockLocalWorker(fixtures);

  const healthResponse = worker.healthResponse();
  assert.equal(healthResponse.status, 200);
  assert.equal(
    healthResponse.headers.get("access-control-allow-origin"),
    "http://localhost:8080",
  );
  const healthBody = await healthResponse.json();
  assert.deepEqual(healthBody, fixtures.health);

  const discoveryResponse = await worker.acceptDiscovery(fixtures.expectedRequest);
  assert.equal(discoveryResponse.status, 202);
  const ackBody = await discoveryResponse.json();
  assert.deepEqual(ackBody, fixtures.ack);
});
