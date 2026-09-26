// BEAUDIT A18: /ingest-url, /cleanup-expired and the /runs/:id payload have
// v1 schemas and examples, and the worker's real outputs validate against them.
// BEAUDIT E7: every error body the worker emits validates against api-error.v1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import {
  buildAcceptedRunStatus,
  buildCompletedRunStatus,
  buildFailedRunStatus,
  buildRunningRunStatus,
} from "../../src/state/run-status-store.ts";
import { withApiErrorEnvelope } from "../../src/webhook/api-error.ts";
import { handleCleanupExpiredWebhook } from "../../src/webhook/handle-cleanup-webhook.ts";
import { handleIngestUrlWebhook } from "../../src/webhook/handle-ingest-url.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const load = (rel: string) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
(addFormatsModule as unknown as { default: (a: unknown) => void }).default(ajv);
for (const name of [
  "api-error.v1",
  "run-status.v1",
  "ingest-url-request.v1",
  "ingest-url-response.v1",
  "cleanup-expired-request.v1",
  "cleanup-expired-response.v1",
]) {
  ajv.addSchema(load(`schemas/${name}.schema.json`), name);
}
function check(schemaName: string, value: unknown, label = schemaName) {
  const validate = ajv.getSchema(schemaName);
  assert.ok(validate, `schema ${schemaName} is registered`);
  assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)} ${JSON.stringify(value).slice(0, 400)}`);
}

const SECRET = "contract-secret";

test("A18: every new example validates against its schema", () => {
  check("api-error.v1", load("examples/api-error.v1.json"));
  check("run-status.v1", load("examples/run-status.v1.json"));
  check("ingest-url-request.v1", load("examples/ingest-url-request.v1.json"));
  check("ingest-url-response.v1", load("examples/ingest-url-response.v1.json"));
  check("cleanup-expired-request.v1", load("examples/cleanup-expired-request.v1.json"));
  check("cleanup-expired-response.v1", load("examples/cleanup-expired-response.v1.json"));
});

test("A18: run statuses built by the store helpers validate as run-status.v1", () => {
  const accepted = buildAcceptedRunStatus({
    runId: "run_contract",
    trigger: "manual",
    request: { sheetId: "sheet", variationKey: "var", requestedAt: "2026-09-25T10:00:00.000Z" },
    acceptedAt: "2026-09-25T10:00:00.000Z",
  });
  const running = buildRunningRunStatus(accepted, "2026-09-25T10:00:01.000Z");
  const failed = buildFailedRunStatus(running, new Error("Cancelled by user."), "2026-09-25T10:00:02.000Z");
  const completed = buildCompletedRunStatus(
    {
      run: {
        runId: "run_contract",
        trigger: "manual",
        request: { sheetId: "sheet", variationKey: "var", requestedAt: "2026-09-25T10:00:00.000Z" },
        config: { sheetId: "sheet" },
      },
      lifecycle: {
        state: "completed",
        companyCount: 1,
        listingCount: 1,
        normalizedLeadCount: 1,
        completedAt: "2026-09-25T10:03:00.000Z",
        startedAt: "2026-09-25T10:00:01.000Z",
      },
      writeResult: { sheetId: "sheet", appended: 1, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] },
      warnings: [],
      sourceSummary: [],
    } as never,
    { acceptedAt: accepted.acceptedAt, startedAt: "2026-09-25T10:00:01.000Z" },
  );
  for (const [label, status] of Object.entries({ accepted, running, failed, completed })) {
    check("run-status.v1", { ok: true, ...status }, label);
  }
});

function ingestRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    headers: { "x-discovery-secret": SECRET },
    bodyText: JSON.stringify(body),
  };
}

const ingestDeps = (overrides: Record<string, unknown> = {}) =>
  ({
    runtimeConfig: { webhookSecret: SECRET, runMode: "local" },
    pipelineWriter: {
      write: async () => ({ appended: 1, updated: 0, skippedDuplicates: 0 }),
    },
    checkSheetsCredential: async () => ({ configured: true, source: "access_token" }),
    fetchGreenhouseJob: async () => ({
      ok: true,
      rawListing: {
        sourceId: "greenhouse",
        title: "Staff Engineer",
        company: "Acme",
        url: "https://boards.greenhouse.io/acme/jobs/123",
        descriptionText: "Build reliable systems for customers. ".repeat(30),
      },
    }),
    ...overrides,
  }) as never;

test("A18: the example /ingest-url request is accepted, and every answer shape validates", async () => {
  const puts: unknown[] = [];
  const asyncAck = await handleIngestUrlWebhook(
    ingestRequest(load("examples/ingest-url-request.v1.json")),
    ingestDeps({
      runStatusStore: { put: (p: unknown) => puts.push(p), get: () => null, close() {} },
    }),
  );
  assert.equal(asyncAck.status, 202);
  check("ingest-url-response.v1", JSON.parse(asyncAck.body), "accepted_async");

  const success = await handleIngestUrlWebhook(
    ingestRequest({ event: "ingest.url.request", schemaVersion: 1, url: "https://boards.greenhouse.io/acme/jobs/123", sheetId: "sheet" }),
    ingestDeps(),
  );
  assert.equal(success.status, 200);
  check("ingest-url-response.v1", JSON.parse(success.body), "success");

  const invalid = await handleIngestUrlWebhook(
    ingestRequest({ event: "ingest.url.request", schemaVersion: 1, url: "not a url", sheetId: "sheet" }),
    ingestDeps(),
  );
  const invalidBody = JSON.parse(invalid.body);
  check("ingest-url-response.v1", invalidBody, "invalid_url");
  check("api-error.v1", withApiErrorEnvelope(invalid.status, invalidBody), "invalid_url envelope");

  const noCredential = await handleIngestUrlWebhook(
    ingestRequest({ event: "ingest.url.request", schemaVersion: 1, url: "https://boards.greenhouse.io/acme/jobs/123", sheetId: "sheet" }),
    ingestDeps({ checkSheetsCredential: async () => ({ configured: false, source: null, message: "No credential." }) }),
  );
  assert.equal(noCredential.status, 409);
  const noCredentialBody = JSON.parse(noCredential.body);
  check("ingest-url-response.v1", noCredentialBody, "sheets_credential_missing");
  check("api-error.v1", withApiErrorEnvelope(409, noCredentialBody), "409 envelope");
});

test("A18: /cleanup-expired accepts the example request and its answer validates", async () => {
  const exampleResult = load("examples/cleanup-expired-response.v1.json");
  const response = await handleCleanupExpiredWebhook(
    ingestRequest(load("examples/cleanup-expired-request.v1.json")),
    {
      runtimeConfig: { webhookSecret: SECRET } as never,
      runCleanup: (async () => ({ ...exampleResult, wouldUpdate: 1 })) as never,
    },
  );
  assert.equal(response.status, 200);
  check("cleanup-expired-response.v1", JSON.parse(response.body));

  const missingSheet = await handleCleanupExpiredWebhook(ingestRequest({}), {
    runtimeConfig: { webhookSecret: SECRET } as never,
  });
  assert.equal(missingSheet.status, 400);
  check("api-error.v1", withApiErrorEnvelope(400, JSON.parse(missingSheet.body)), "400 envelope");
});
