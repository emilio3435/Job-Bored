// BEAUDIT lane S: expired-cleanup integrity. Promotes probes p03 (stale
// overwrite) and p04 (all-or-nothing flush), plus D9 concurrency and the
// recent-check skip, and the D10 worker cell set (M, P cleared, O audit).
import assert from "node:assert/strict";
import test from "node:test";

import { runExpiredJobCleanup } from "../../src/cleanup/expired-job-cleanup.ts";
import { HEADER, createFakeSheets, pipelineRow, runtimeConfig } from "./fake-sheets.ts";

const NOW = () => new Date("2026-09-25T10:00:00Z");

function postingFetch(
  sheet: ReturnType<typeof createFakeSheets>,
  onPosting: (url: URL) => Promise<Response> | Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.hostname.endsWith(".example")) return onPosting(u);
    return sheet.fetchImpl(input, init);
  }) as typeof fetch;
}

const expiredPage = () => new Response("<html>This job has expired</html>", { status: 200 });

test("D3: a row moved to Applied during the pass is not reverted to Expired (p03)", async () => {
  const X = pipelineRow({ title: "X", company: "Xco", link: "https://x.example/jobs/1", status: "New", notes: "old note", followUp: "2026-10-01" });
  const Y = pipelineRow({ title: "Y", company: "Yco", link: "https://y.example/jobs/2", status: "New", followUp: "2026-10-03" });
  const sheet = createFakeSheets({ Pipeline: [HEADER, X, Y] });
  const fetchImpl = postingFetch(sheet, () => {
    const rows = sheet.tabs.get("Pipeline")!;
    rows[1][12] = "Applied";
    rows[1][14] = "old note\nuser: applied today, ref #123";
    return expiredPage();
  });
  const res = await runExpiredJobCleanup({
    sheetId: "fake-sheet",
    runtimeConfig,
    options: { fetchImpl, dryRun: false, now: NOW, concurrency: 1 },
  });
  const [x, y] = sheet.tabs.get("Pipeline")!.slice(1);
  assert.equal(x[12], "Applied");
  assert.match(x[14], /ref #123/);
  assert.equal(x[15], "2026-10-01");
  assert.equal(y[12], "Expired");
  assert.equal(res.updated, 1);
  const xResult = res.results.find((r) => r.link === "https://x.example/jobs/1")!;
  assert.equal(xResult.action, "skipped");
  assert.equal(xResult.reason, "status_changed");
});

test("D10: an expired row gets Status, a cleared Follow-up and an appended audit line", async () => {
  const sheet = createFakeSheets({
    Pipeline: [HEADER, pipelineRow({ title: "Y", company: "Yco", link: "https://y.example/jobs/2", status: "Researching", notes: "mine", followUp: "2026-10-03" })],
  });
  await runExpiredJobCleanup({
    sheetId: "fake-sheet",
    runtimeConfig,
    options: { fetchImpl: postingFetch(sheet, expiredPage), dryRun: false, now: NOW },
  });
  const y = sheet.tabs.get("Pipeline")![1];
  assert.equal(y[12], "Expired");
  assert.equal(y[15], "");
  assert.match(y[14], /^mine\n\[JobBored 2026-09-25\] Marked Expired because the job page says the role is closed\. Was: Researching\.$/);
});

test("D2: a row deleted during the pass does not shift the write onto its neighbour", async () => {
  const A = pipelineRow({ title: "A", company: "Aco", link: "https://a.example/jobs/1", status: "Applied" });
  const B = pipelineRow({ title: "B", company: "Bco", link: "https://b.example/jobs/2", status: "New" });
  const C = pipelineRow({ title: "C", company: "Cco", link: "https://c.example/jobs/3", status: "Interviewing" });
  const sheet = createFakeSheets({ Pipeline: [HEADER, A, B, C] });
  const fetchImpl = postingFetch(sheet, () => {
    const rows = sheet.tabs.get("Pipeline")!;
    if (rows[1][4] === "https://a.example/jobs/1") rows.splice(1, 1);
    return expiredPage();
  });
  await runExpiredJobCleanup({ sheetId: "fake-sheet", runtimeConfig, options: { fetchImpl, dryRun: false, now: NOW } });
  const rows = sheet.tabs.get("Pipeline")!.slice(1);
  assert.deepEqual(rows.map((r) => [r[1], r[12]]), [["B", "Expired"], ["C", "Interviewing"]]);
});

test("D9: writes are flushed every 25 rows, so a killed pass keeps its progress (p04)", async () => {
  const rows = [HEADER];
  for (let i = 0; i < 30; i += 1) rows.push(pipelineRow({ title: `R${i}`, company: `C${i}`, link: `https://r${i}.example/jobs/${i}`, status: "New" }));
  const sheet = createFakeSheets({ Pipeline: rows });
  const writesSeen: number[] = [];
  const fetchImpl = postingFetch(sheet, () => {
    writesSeen.push(sheet.calls.filter((c) => c.kind === "values.batchUpdate").length);
    return expiredPage();
  });
  const res = await runExpiredJobCleanup({
    sheetId: "fake-sheet",
    runtimeConfig,
    options: { fetchImpl, dryRun: false, now: NOW, concurrency: 1 },
  });
  assert.equal(res.updated, 30);
  assert.equal(writesSeen[24], 0);
  assert.equal(writesSeen[25], 1, "the first 25 rows are in the Sheet before row 26 is fetched");
  assert.equal(sheet.calls.filter((c) => c.kind === "values.batchUpdate").length, 2);
  assert.ok(sheet.tabs.get("Pipeline")!.slice(1).every((r) => r[12] === "Expired"));
});

test("D9: posting checks run four at a time", async () => {
  const rows = [HEADER];
  for (let i = 0; i < 10; i += 1) rows.push(pipelineRow({ title: `R${i}`, company: `C${i}`, link: `https://r${i}.example/jobs/${i}`, status: "New" }));
  const sheet = createFakeSheets({ Pipeline: rows });
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = postingFetch(sheet, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return new Response("Apply now", { status: 200 });
  });
  const res = await runExpiredJobCleanup({ sheetId: "fake-sheet", runtimeConfig, options: { fetchImpl, dryRun: true, now: NOW } });
  assert.equal(res.open, 10);
  assert.equal(peak, 4);
  assert.deepEqual(res.results.map((r) => r.rowNumber), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("D9: a row checked in the last 7 days is skipped without a fetch", async () => {
  const sheet = createFakeSheets({
    Pipeline: [
      HEADER,
      pipelineRow({ title: "Recent", company: "R", link: "https://recent.example/jobs/1", status: "New", notes: "[JobBored 2026-09-22] Please review this job — the page took too long to load." }),
      pipelineRow({ title: "Old", company: "O", link: "https://old.example/jobs/2", status: "New", notes: "[JobBored 2026-09-10] Please review this job — the page took too long to load." }),
    ],
  });
  const fetched: string[] = [];
  const fetchImpl = postingFetch(sheet, (u) => {
    fetched.push(u.hostname);
    return new Response("Apply now", { status: 200 });
  });
  const res = await runExpiredJobCleanup({ sheetId: "fake-sheet", runtimeConfig, options: { fetchImpl, dryRun: true, now: NOW } });
  assert.deepEqual(fetched, ["old.example"]);
  assert.equal(res.results[0].action, "skipped");
  assert.equal(res.results[0].reason, "recently_checked");
});

test("D5: cleanup notes that start like a formula are written as text", async () => {
  const sheet = createFakeSheets({
    Pipeline: [HEADER, pipelineRow({ title: "Y", company: "Yco", link: "https://y.example/jobs/2", status: "New", notes: "=HYPERLINK(\"https://attacker.invalid\")" })],
  });
  await runExpiredJobCleanup({
    sheetId: "fake-sheet",
    runtimeConfig,
    options: { fetchImpl: postingFetch(sheet, expiredPage), dryRun: false, now: NOW },
  });
  const update = sheet.calls.find((c) => c.kind === "values.batchUpdate")!;
  const notes = JSON.parse(update.body).data.find((d: { range: string }) => d.range === "Pipeline!O2");
  assert.match(notes.values[0][0], /^'=HYPERLINK/);
});
