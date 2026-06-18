import test from "node:test";
import assert from "node:assert/strict";

import { createPipelinePatcher } from "../../src/sheets/pipeline-patcher.ts";
import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";

const runtimeConfig = { googleAccessToken: "test-token" } as never;

type Call = { url: string; method: string; body?: string };

function mockFetch(existingRows: string[][]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init: { method?: string; body?: string } = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    if (method === "GET" && /\/values\//.test(url)) {
      return { ok: true, status: 200, json: async () => ({ values: existingRows }), text: async () => "" };
    }
    if (method === "POST" && /values:batchUpdate/.test(url)) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  }) as never;
  return { fetchImpl, calls };
}

function rowFor(opts: { url?: string; company?: string; title?: string; status?: string; notes?: string }): string[] {
  const row = new Array(PIPELINE_HEADER_ROW.length).fill("");
  row[1] = opts.title ?? "";
  row[2] = opts.company ?? "";
  row[4] = opts.url ?? "";
  row[12] = opts.status ?? "Applied";
  row[14] = opts.notes ?? "";
  return row;
}

test("patch updates status and appends a dated note, matched by url", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  const result = await patcher.patch("sheet_1234567890", {
    job: { url: "https://acme.com/jobs/1" },
    fields: { stage: "Interviewing", note: "recruiter replied" },
  });

  assert.equal(result.matched, true);
  assert.equal(result.matchedBy, "url");
  assert.equal(result.rowNumber, 2);

  const update = calls.find((c) => /values:batchUpdate/.test(c.url));
  assert.ok(update, "expected a batchUpdate call");
  const body = JSON.parse(update.body as string);
  const written: string[] = body.data[0].values[0];
  assert.equal(written[12], "Interviewing");
  assert.equal(written[14], "[2026-06-18] recruiter replied");
  assert.match(body.data[0].range, /^Pipeline!A2:[A-Z]+2$/);
});

test("re-posting the same note is idempotent", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", notes: "[2026-06-18] recruiter replied" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  await patcher.patch("sheet_1234567890", { job: { url: "https://acme.com/jobs/1" }, fields: { note: "recruiter replied" } });

  const update = calls.find((c) => /values:batchUpdate/.test(c.url));
  const written: string[] = JSON.parse((update as Call).body as string).data[0].values[0];
  assert.equal(written[14], "[2026-06-18] recruiter replied");
});

test("returns matched:false and writes nothing when no row matches", async () => {
  const existing = [rowFor({ url: "https://other.com/x", company: "Other", title: "Eng" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl });

  const result = await patcher.patch("sheet_1234567890", { job: { url: "https://acme.com/jobs/1" }, fields: { stage: "Offer" } });

  assert.equal(result.matched, false);
  assert.equal(calls.some((c) => /values:batchUpdate/.test(c.url)), false);
});

test("matches by company+title when url is absent", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM" })];
  const { fetchImpl } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl });

  const result = await patcher.patch("sheet_1234567890", { job: { company: "acme", title: "pm" }, fields: { stage: "Offer" } });

  assert.equal(result.matched, true);
  assert.equal(result.matchedBy, "company-title");
});
