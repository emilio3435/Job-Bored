// BEAUDIT lane S: pipeline-update v2 (spec §7) and the api-error envelope
// fields {error, code, detail, nextStep, retryable}.
import assert from "node:assert/strict";
import test from "node:test";

import { handlePipelineUpdateWebhook } from "../../src/webhook/handle-pipeline-update.ts";
import { PipelineAmbiguousMatchError } from "../../src/sheets/pipeline-patcher.ts";
import { PipelineHeaderMismatchError } from "../../src/sheets/sheets-client.ts";

const SECRET = "shared-secret";
const runtimeConfig = { webhookSecret: SECRET } as never;

function request(body: Record<string, unknown>) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: "command-center.pipeline-update",
      sheetId: "sheet_1234567890",
      job: { url: "https://boards.greenhouse.io/acme/jobs/1" },
      ...body,
    }),
  };
}

function deps(patch: (sheetId: string, input: unknown) => Promise<unknown>) {
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      runtimeConfig,
      patchPipeline: async (sheetId: string, input: unknown) => {
        calls.push(input);
        return patch(sheetId, input);
      },
    } as never,
  };
}

const matched = async () => ({ matched: true, matchedBy: "url", rowNumber: 2 });

function assertEnvelope(body: Record<string, unknown>, code: string, retryable: boolean) {
  assert.equal(body.ok, false);
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  assert.equal(typeof body.nextStep, "string");
  assert.equal(body.retryable, retryable);
}

test("v2: Applied with appliedDate and source is accepted and forwarded", async () => {
  const { deps: d, calls } = deps(matched);
  const res = await handlePipelineUpdateWebhook(
    request({ schemaVersion: 2, fields: { stage: "Applied", appliedDate: "2026-09-25", source: "Company portal", note: "Receipt R-17" } }),
    d,
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.matched, true);
  assert.equal(body.rowNumber, 2);
  assert.deepEqual((calls[0] as { fields: unknown }).fields, {
    stage: "Applied",
    appliedDate: "2026-09-25",
    source: "Company portal",
    note: "Receipt R-17",
  });
});

test("v2: Applied without appliedDate or source is a 400 before any write", async () => {
  for (const fields of [
    { stage: "Applied", source: "Company portal" },
    { stage: "Applied", appliedDate: "2026-09-25" },
    { stage: "Applied", appliedDate: "2026-09-25", source: "  " },
  ]) {
    const { deps: d, calls } = deps(matched);
    const res = await handlePipelineUpdateWebhook(request({ schemaVersion: 2, fields }), d);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assertEnvelope(JSON.parse(res.body), "invalid_request", false);
    assert.equal(calls.length, 0);
  }
});

test("D7: dates must be YYYY-MM-DD", async () => {
  for (const schemaVersion of [1, 2]) {
    for (const fields of [{ appliedDate: "next tuesday" }, { lastContact: "2026-13-01" }, { appliedDate: "=NOW()" }]) {
      const { deps: d, calls } = deps(matched);
      const res = await handlePipelineUpdateWebhook(request({ schemaVersion, fields }), d);
      assert.equal(res.status, 400, `v${schemaVersion} ${JSON.stringify(fields)}`);
      assert.equal(calls.length, 0);
    }
  }
});

test("v2: source is a v2-only field", async () => {
  const { deps: d } = deps(matched);
  const res = await handlePipelineUpdateWebhook(
    request({ schemaVersion: 1, fields: { stage: "Interviewing", source: "email" } }),
    d,
  );
  assert.equal(res.status, 400);
});

test("v1 stays accepted for non-Applied updates", async () => {
  const { deps: d } = deps(matched);
  const res = await handlePipelineUpdateWebhook(
    request({ schemaVersion: 1, fields: { stage: "Interviewing", note: "recruiter replied" } }),
    d,
  );
  assert.equal(res.status, 200);
});

test("D6: a drifted header answers 409 header_mismatch", async () => {
  const { deps: d } = deps(async () => {
    throw new PipelineHeaderMismatchError({ column: "M", expected: "Status", found: "Contact", sheetName: "Pipeline" });
  });
  const res = await handlePipelineUpdateWebhook(request({ schemaVersion: 2, fields: { stage: "Interviewing" } }), d);
  assert.equal(res.status, 409);
  const body = JSON.parse(res.body);
  assertEnvelope(body, "header_mismatch", false);
  assert.equal(body.detail, "Column M is 'Contact'; expected 'Status'.");
});

test("v2: a job on two rows answers 409 ambiguous_match", async () => {
  const { deps: d } = deps(async () => {
    throw new PipelineAmbiguousMatchError([2, 7], "url");
  });
  const res = await handlePipelineUpdateWebhook(request({ schemaVersion: 2, fields: { stage: "Offer" } }), d);
  assert.equal(res.status, 409);
  const body = JSON.parse(res.body);
  assertEnvelope(body, "ambiguous_match", false);
  assert.match(body.detail, /2, 7/);
});

test("a Sheets failure answers 502 with retryable true", async () => {
  const { deps: d } = deps(async () => {
    throw new Error("Sheet write failed during narrow update: HTTP 503");
  });
  const res = await handlePipelineUpdateWebhook(request({ schemaVersion: 2, fields: { stage: "Offer" } }), d);
  assert.equal(res.status, 502);
  assertEnvelope(JSON.parse(res.body), "sheet_write_failed", true);
});

test("an unmatched job answers 404 not_found", async () => {
  const { deps: d } = deps(async () => ({ matched: false }));
  const res = await handlePipelineUpdateWebhook(request({ schemaVersion: 2, fields: { stage: "Offer" } }), d);
  assert.equal(res.status, 404);
  assertEnvelope(JSON.parse(res.body), "not_found", false);
});
