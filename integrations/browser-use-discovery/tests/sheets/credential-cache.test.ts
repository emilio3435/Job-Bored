// BEAUDIT A8/D16: token and /health readiness caching (probe p11).
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { validateSheetsCredentialReadiness } from "../../src/sheets/credential-readiness.ts";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";
import { HEADER, createFakeSheets, lead } from "./fake-sheets.ts";

function serviceAccount(email = "probe-sa@probe.invalid"): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  return JSON.stringify({
    client_email: email,
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

const SA_A = serviceAccount("a@probe.invalid");
const SA_B = serviceAccount("b@probe.invalid");

function count(sheet: ReturnType<typeof createFakeSheets>, kind: string): number {
  return sheet.calls.filter((c) => c.kind === kind).length;
}

test("D16: a service-account token is exchanged once per hour, not once per write", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const runtimeConfig = { googleServiceAccountJson: SA_A, googleAccessToken: "" } as never;
  let clock = new Date("2026-09-25T10:00:00Z");
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => clock, retryBaseMs: 1 });
  await writer.write("fake-sheet", [lead({ url: "https://a.example/jobs/1" })]);
  await writer.write("fake-sheet", [lead({ url: "https://b.example/jobs/2" })]);
  assert.equal(count(sheet, "token"), 1);
  clock = new Date("2026-09-25T11:00:00Z");
  await writer.write("fake-sheet", [lead({ url: "https://c.example/jobs/3" })]);
  assert.equal(count(sheet, "token"), 2, "an expired token is exchanged again");
});

test("D16: a changed credential gets its own token", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const now = () => new Date("2026-09-25T10:00:00Z");
  await createPipelineWriter({ googleServiceAccountJson: SA_A } as never, { fetchImpl: sheet.fetchImpl, now }).write("fake-sheet", [lead({})]);
  await createPipelineWriter({ googleServiceAccountJson: SA_B } as never, { fetchImpl: sheet.fetchImpl, now }).write("fake-sheet", [lead({})]);
  assert.equal(count(sheet, "token"), 2);
});

test("A8: /health readiness is cached for the TTL and keyed by credential and Sheet", async () => {
  const sheet = createFakeSheets({});
  let clock = new Date("2026-09-25T10:00:00Z");
  const opts = { fetchImpl: sheet.fetchImpl, now: () => clock, sheetId: "sheet-a", cacheTtlMs: 60_000 };
  const config = { googleServiceAccountJson: SA_A } as never;
  const first = await validateSheetsCredentialReadiness(config, opts);
  const second = await validateSheetsCredentialReadiness(config, opts);
  assert.deepEqual(second, first);
  assert.equal(count(sheet, "spreadsheets.get"), 1, "one Google access check per minute");

  await validateSheetsCredentialReadiness(config, { ...opts, sheetId: "sheet-b" });
  assert.equal(count(sheet, "spreadsheets.get"), 2, "another Sheet is another key");

  await validateSheetsCredentialReadiness({ googleServiceAccountJson: SA_B } as never, opts);
  assert.equal(count(sheet, "spreadsheets.get"), 3, "a changed credential invalidates");

  clock = new Date("2026-09-25T10:01:01Z");
  await validateSheetsCredentialReadiness(config, opts);
  assert.equal(count(sheet, "spreadsheets.get"), 4, "the TTL expires");
});

test("A8: without cacheTtlMs every call checks live (webhook preflight)", async () => {
  const sheet = createFakeSheets({});
  const opts = { fetchImpl: sheet.fetchImpl, now: () => new Date("2026-09-25T10:00:00Z"), sheetId: "sheet-a" };
  const config = { googleServiceAccountJson: SA_A } as never;
  await validateSheetsCredentialReadiness(config, opts);
  await validateSheetsCredentialReadiness(config, opts);
  assert.equal(count(sheet, "spreadsheets.get"), 2);
});
