import assert from "node:assert/strict";
import test from "node:test";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";
import { HEADER, createFakeSheets, lead, pipelineRow, runtimeConfig } from "./fake-sheets.ts";

const OLD = "https://boards.greenhouse.io/acme/jobs/1";
const NEW = "https://boards.greenhouse.io/acme/jobs/2";
const NOW = new Date("2026-10-02T15:00:00Z");

for (const dismissed of ["", "2026-10-01"]) {
  test(`R3: semantic-only match appends and flags, including dismissed=${!!dismissed}`, async () => {
    const existing = pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: OLD, dismissed });
    const sheet = createFakeSheets({ Pipeline: [HEADER, existing] });
    const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => NOW, retries: 0 });
    const result = await writer.write("sheet_1", [lead({ url: NEW })]);
    assert.equal(result.appended, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.skippedDuplicates, 0);
    assert.deepEqual(result.skippedLinks, []);
    assert.deepEqual(result.writtenLinks, [NEW]);
    assert.deepEqual(sheet.tabs.get("Pipeline")![1], existing);
    assert.equal(sheet.tabs.get("Pipeline")![2][28], OLD);
  });
}

for (const url of [OLD, "https://job-boards.greenhouse.io/acme/jobs/1?gh_src=tracking"]) {
  test(`R3: dismissed exact URL/provider identity remains blocked: ${url}`, async () => {
    const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: OLD, dismissed: "2026-10-01" })] });
    const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, retries: 0 });
    const result = await writer.write("sheet_1", [lead({ url })]);
    assert.equal(result.appended, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.skippedBlacklist, 1);
  });
}

test("R16: sightings update Last Seen and offer Expired rows for reopening while preserving CRM fields", async () => {
  const existing = pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: OLD, status: "Expired", notes: "My private note", applied: "2026-09-01" });
  const sheet = createFakeSheets({ Pipeline: [HEADER, existing] });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => NOW, retries: 0 });
  await writer.write("sheet_1", [lead({ url: OLD })]);
  await writer.write("sheet_1", [lead({ url: OLD })]);
  const row = sheet.tabs.get("Pipeline")![1];
  assert.equal(row[27], "2026-10-02");
  assert.equal(row[12], "Expired", "reopening needs the user's choice");
  assert.equal(row[13], "2026-09-01");
  assert.match(row[14], /^My private note\n\[JobBored 2026-10-02\] Rediscovered expired posting/);
  assert.equal(row[14].match(/Rediscovered expired posting/g)?.length, 1);
});

test("R16: new and active sightings carry Last Seen without changing notes", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: OLD, status: "Applied", notes: "Keep this note" })] });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => NOW, retries: 0 });
  await writer.write("sheet_1", [lead({ url: OLD }), lead({ url: NEW })]);
  const rows = sheet.tabs.get("Pipeline")!;
  assert.equal(rows[1][27], "2026-10-02");
  assert.equal(rows[1][14], "Keep this note");
  assert.equal(rows[1][12], "Applied");
  assert.equal(rows[2][27], "2026-10-02");
});
