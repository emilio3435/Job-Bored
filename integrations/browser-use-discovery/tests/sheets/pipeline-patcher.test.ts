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
  const byRange = Object.fromEntries(
    (body.data as Array<{ range: string; values: string[][] }>).map((entry) => [
      entry.range,
      entry.values[0][0],
    ]),
  );
  assert.equal(byRange["Pipeline!M2"], "Interviewing");
  assert.equal(byRange["Pipeline!O2"], "[2026-06-18] recruiter replied");
  assert.equal(
    (body.data as Array<{ range: string }>).some((entry) => /^Pipeline!A2:[A-Z]+2$/.test(entry.range)),
    false,
  );
});

test("re-posting the same note is idempotent", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", notes: "[2026-06-18] recruiter replied" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  const result = await patcher.patch("sheet_1234567890", {
    job: { url: "https://acme.com/jobs/1" },
    fields: { note: "recruiter replied" },
  });

  assert.equal(result.matched, true);
  assert.equal(
    calls.some((c) => /values:batchUpdate/.test(c.url)),
    false,
    "identical note must not rewrite the row",
  );
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

test("F1A-PIPE05-NARROW: inbound updates patch changed cells, not stale A:Y", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM", notes: "keep me" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl, now: () => new Date("2026-06-18T10:00:00Z") });

  await patcher.patch("sheet_1234567890", {
    job: { url: "https://acme.com/jobs/1" },
    fields: { stage: "Interviewing", note: "recruiter replied" },
  });

  const update = calls.find((c) => /values:batchUpdate/.test(c.url));
  assert.ok(update, "expected a batchUpdate call");
  const body = JSON.parse(update.body as string);
  const ranges = body.data.map((entry: { range: string }) => entry.range);
  assert.equal(ranges.some((range: string) => /^Pipeline!A2:[A-Z]+2$/.test(range)), false);
  assert.ok(ranges.includes("Pipeline!M2"), "status must be a narrow M cell patch");
  assert.ok(ranges.includes("Pipeline!O2"), "note must be a narrow O cell patch");
  assert.equal(ranges.includes("Pipeline!B2"), false, "must not rewrite Title");
  assert.equal(ranges.includes("Pipeline!E2"), false, "must not rewrite Link");
});

test("F1A-P2-VALIDATE: unknown patch fields fail closed and write nothing", async () => {
  const existing = [rowFor({ url: "https://acme.com/jobs/1", company: "Acme", title: "PM" })];
  const { fetchImpl, calls } = mockFetch(existing);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl });

  await assert.rejects(
    () =>
      patcher.patch("sheet_1234567890", {
        job: { url: "https://acme.com/jobs/1" },
        fields: { stage: "Offer", mysteryColumn: "nope" } as never,
      }),
    /unknown/i,
  );
  assert.equal(calls.some((c) => /values:batchUpdate/.test(c.url)), false);
});

