import test from "node:test";
import assert from "node:assert/strict";

import { handlePipelineUpdateWebhook } from "../../src/webhook/handle-pipeline-update.ts";

const SECRET = "shared-secret";
const runtimeConfig = { webhookSecret: SECRET } as never;

function bodyOk() {
  return JSON.stringify({
    event: "command-center.pipeline-update",
    schemaVersion: 1,
    sheetId: "sheet_1234567890",
    job: { url: "https://acme.com/jobs/1" },
    fields: { stage: "Interviewing", note: "recruiter replied" },
  });
}

function makeRequest(overrides: { method?: string; headers?: Record<string, string>; bodyText?: string } = {}) {
  return {
    method: overrides.method ?? "POST",
    headers: { "content-type": "application/json", "x-discovery-secret": SECRET, ...(overrides.headers || {}) },
    bodyText: overrides.bodyText ?? bodyOk(),
  };
}

function makeDeps(patchResult: { matched: boolean; matchedBy?: string; rowNumber?: number } = { matched: true, matchedBy: "url", rowNumber: 2 }) {
  const calls: Array<{ sheetId: string; input: unknown }> = [];
  return {
    deps: {
      runtimeConfig,
      patchPipeline: async (sheetId: string, input: unknown) => {
        calls.push({ sheetId, input });
        return patchResult as never;
      },
    } as never,
    calls,
  };
}

test("rejects non-POST with 405", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ method: "GET" }), deps);
  assert.equal(res.status, 405);
});

test("rejects bad secret with 401", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ headers: { "x-discovery-secret": "wrong" } }), deps);
  assert.equal(res.status, 401);
});

test("rejects invalid JSON with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest({ bodyText: "not-json" }), deps);
  assert.equal(res.status, 400);
  assert.match(res.body, /valid JSON/);
});

test("rejects missing sheetId with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ job: { url: "x" }, fields: { stage: "Offer" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
  assert.match(res.body, /sheetId/);
});

test("rejects invalid stage with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ sheetId: "sheet_1234567890", job: { url: "x" }, fields: { stage: "Chatting" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
  assert.match(res.body, /stage must be one of/);
});

test("rejects missing identity with 400", async () => {
  const { deps } = makeDeps();
  const res = await handlePipelineUpdateWebhook(
    makeRequest({ bodyText: JSON.stringify({ sheetId: "sheet_1234567890", job: {}, fields: { stage: "Offer" } }) }),
    deps,
  );
  assert.equal(res.status, 400);
});

test("happy path returns 200 and calls patchPipeline once", async () => {
  const { deps, calls } = makeDeps();
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.updated, true);
  assert.equal(body.row, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sheetId, "sheet_1234567890");
});

test("returns 404 when no row matches", async () => {
  const { deps } = makeDeps({ matched: false });
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 404);
});

test("returns 502 when the patch throws", async () => {
  const deps = {
    runtimeConfig,
    patchPipeline: async () => {
      throw new Error("sheets down");
    },
  } as never;
  const res = await handlePipelineUpdateWebhook(makeRequest(), deps);
  assert.equal(res.status, 502);
});
