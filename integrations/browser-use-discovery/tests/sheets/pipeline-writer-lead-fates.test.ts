// DISCAT C1 fix: the Pipeline writer reports each lead's fate (written,
// or skipped with a reason) so the candidate catalog records what the Sheet
// actually holds instead of assuming every selected lead landed.
import assert from "node:assert/strict";
import test from "node:test";

import {
  SheetWriteError,
  createPipelineWriter,
} from "../../src/sheets/pipeline-writer.ts";
import {
  HEADER,
  createFakeSheets,
  lead,
  pipelineRow,
  runtimeConfig,
} from "./fake-sheets.ts";

const FAST = { retryBaseMs: 1 };

function isPipelineDataRead(range: string): boolean {
  return range.startsWith("Pipeline!") && !/^Pipeline!A1:/.test(range);
}

test("should report appended and updated links as written and blacklisted links as skipped", async () => {
  const existing = "https://acme.example/jobs/1";
  const fresh = "https://beta.example/jobs/2";
  const blocked = "https://gamma.example/jobs/3";
  const dismissed = "https://delta.example/jobs/4";
  const sheet = createFakeSheets({
    Pipeline: [
      HEADER,
      pipelineRow({ title: "Engineer", company: "Acme", link: existing }),
      pipelineRow({
        title: "Designer",
        company: "Delta",
        link: dismissed,
        dismissed: "2026-09-01T00:00:00Z",
      }),
    ],
    Blacklist: [["URL"], [blocked]],
  });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [
    lead({ title: "Engineer", company: "Acme", url: existing, fitScore: 9 }),
    lead({ title: "New role", company: "Beta", url: fresh }),
    lead({ title: "Blocked role", company: "Gamma", url: blocked }),
    lead({ title: "Designer", company: "Delta", url: dismissed }),
  ]);
  assert.equal(result.appended, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual([...(result.writtenLinks || [])].sort(), [existing, fresh].sort());
  assert.deepEqual(
    [...(result.skippedLinks || [])].sort((a, b) => a.url.localeCompare(b.url)),
    [
      { url: dismissed, reason: "blacklisted" },
      { url: blocked, reason: "blacklisted" },
    ].sort((a, b) => a.url.localeCompare(b.url)),
  );
});

test("should report a lead another writer appended after the snapshot as a skipped duplicate", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  let injected = false;
  sheet.hooks.onRead = (range) => {
    if (injected || !isPipelineDataRead(range)) return;
    injected = true;
    sheet.tabs.get("Pipeline")!.push(pipelineRow({ title: "Engineer", company: "Acme", link: url }));
  };
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [lead({ url })]);
  assert.equal(result.appended, 0);
  assert.deepEqual(result.writtenLinks, []);
  assert.deepEqual(result.skippedLinks, [{ url, reason: "duplicate" }]);
});

test("should report a semantic identity collision as a skipped identity_collision", async () => {
  const sheet = createFakeSheets({
    Pipeline: [
      HEADER,
      pipelineRow({
        title: "Backend Engineer",
        company: "Acme",
        location: "Remote",
        link: "https://acme.example/careers/backend-engineer",
      }),
    ],
  });
  const incoming = "https://jobs.lever.co/acme/7f3a";
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [
    lead({ title: "Backend Engineer", company: "Acme", location: "Remote", url: incoming }),
  ]);
  assert.equal(result.appended, 0);
  assert.equal(result.updated, 0);
  assert.deepEqual(result.writtenLinks, []);
  assert.deepEqual(result.skippedLinks, [{ url: incoming, reason: "identity_collision" }]);
});

test("should carry only the appended links as written when the update phase fails", async () => {
  const sheet = createFakeSheets({
    Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", link: "https://acme.example/jobs/1" })],
  });
  for (let i = 0; i < 5; i += 1) {
    sheet.hooks.failNext.push({ kind: "values.batchUpdate", status: 503, body: "backendError" });
  }
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await assert.rejects(
    w.write("fake-sheet", [
      lead({ title: "Engineer", company: "Acme", url: "https://acme.example/jobs/1", fitScore: 9 }),
      lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" }),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof SheetWriteError);
      assert.deepEqual(error.partialResult?.writtenLinks, ["https://beta.example/jobs/2"]);
      return true;
    },
  );
});
