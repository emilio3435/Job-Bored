/**
 * HOLES lane SHEETS · A4 + A15 — a Sheet write lands on the job it names.
 *
 * The board maps a job to its Sheet row once, at load. A person who sorts
 * the Sheet, or deletes a row, between that load and a write used to have
 * the write land on whichever job now sits on the old row number. Every
 * writer now re-reads the target row and checks its Link (Title + Company
 * for a link-less row) right before writing; a moved row is found again by
 * that key, and a row that is gone or now appears twice is refused with a
 * visible error instead of guessed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COL,
  HEADERS,
  createFakeSheets,
  loadWriteback,
  pipelineRow,
  rowByLink,
} from "./holes-sheets-fake.mjs";

const A = "https://boards.greenhouse.io/acme/jobs/101";
const B = "https://jobs.lever.co/globex/b-202";
const C = "https://jobs.ashbyhq.com/initech/c-303";
const D = "https://example.com/careers/d-404";

function seed() {
  return createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({ title: "Alpha Engineer", company: "Acme", link: A, status: "New" }),
      pipelineRow({ title: "Beta Engineer", company: "Globex", link: B, status: "New" }),
      pipelineRow({ title: "Gamma Engineer", company: "Initech", link: C, status: "New", notes: "Old note" }),
      pipelineRow({ title: "Delta Engineer", company: "Hooli", link: D, status: "New" }),
      pipelineRow({ title: "Manual role", company: "Self", status: "Researching" }),
    ],
    Blacklist: [["URL", "Dismissed At", "Title", "Company", "Reason"]],
  });
}

/** Load, then delete Beta and sort the Sheet so EVERY job changes row:
 *  Alpha 2→4, Gamma 4→5, Delta 5→2, Manual 6→3. */
const RESHUFFLE = { "Delta Engineer": 0, "Manual role": 1, "Alpha Engineer": 2, "Gamma Engineer": 3 };

function loadThenReshuffle() {
  const fake = seed();
  const env = loadWriteback(fake);
  env.load();
  fake.deletePipelineRow((row) => row[COL.link] === B);
  fake.sortPipeline((row) => RESHUFFLE[row[COL.title]]);
  return { fake, env };
}

function snapshotOthers(fake, link) {
  return fake
    .rows("Pipeline")
    .filter((row, i) => i > 0 && row[COL.link] !== link)
    .map((row) => row.join("|"));
}

function manualRow(fake) {
  return fake.rows("Pipeline").find((row) => row[COL.title] === "Manual role");
}

describe("A4 · every write re-checks the row's Link right before writing", () => {
  it("status lands on the moved job, and only there", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, A);
    const ok = await env.sw.updateJobStatus(env.indexOf(A), "Interviewing");
    assert.equal(ok, true);
    assert.equal(rowByLink(fake, A)[COL.status], "Interviewing");
    assert.deepEqual(snapshotOthers(fake, A), others, "no other job's row changed");
  });

  it("notes land on the moved job", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, C);
    await env.sw.updateJobNotes(env.indexOf(C), "Called the recruiter");
    assert.equal(rowByLink(fake, C)[COL.notes], "Called the recruiter");
    assert.deepEqual(snapshotOthers(fake, C), others);
  });

  it("favorite lands on the moved job", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, D);
    await env.sw.toggleFavorite(env.indexOf(D));
    assert.equal(rowByLink(fake, D)[COL.favorite], "★");
    assert.deepEqual(snapshotOthers(fake, D), others);
  });

  it("an identity edit and its Edit Lock land on the moved job", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, A);
    await env.sw.editJobField(env.indexOf(A), "title", "Staff Alpha Engineer");
    assert.equal(rowByLink(fake, A)[COL.title], "Staff Alpha Engineer");
    assert.equal(rowByLink(fake, A)[COL.editLock], "title");
    assert.deepEqual(snapshotOthers(fake, A), others);
  });

  it("dismiss lands on the moved job", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, D);
    await env.sw.dismissJob(env.indexOf(D));
    assert.match(rowByLink(fake, D)[COL.dismissedAt], /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(snapshotOthers(fake, D), others);
  });

  it("follow-up, last contact and reply flag land on the moved job", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, C);
    await env.sw.updateFollowUpDate(env.indexOf(C), "2026-10-09");
    await env.sw.updateLastHeardFrom(env.indexOf(C), "2026-10-01");
    await env.sw.updateJobResponseFlag(env.indexOf(C), "Yes");
    const row = rowByLink(fake, C);
    assert.equal(row[COL.followUpDate], "2026-10-09");
    assert.equal(row[COL.lastHeardFrom], "2026-10-01");
    assert.equal(row[COL.responseFlag], "Yes");
    assert.deepEqual(snapshotOthers(fake, C), others);
  });

  it("a link-less row is checked by Title + Company", async () => {
    const { fake, env } = loadThenReshuffle();
    const idx = env.state.data.findIndex((j) => j.title === "Manual role");
    await env.sw.markStatusExpired(idx);
    assert.equal(manualRow(fake)[COL.status], "Expired");
    const expiredRows = fake.rows("Pipeline").filter((r) => r[COL.status] === "Expired");
    assert.equal(expiredRows.length, 1);
  });

  it("planner patches (applyCells) are re-pointed at the moved job's row", async () => {
    const { fake, env } = loadThenReshuffle();
    const others = snapshotOthers(fake, A);
    const staleRow = env.sw.getSheetRow(env.indexOf(A));
    const ok = await env.sw.applyCells([
      { range: `Pipeline!M${staleRow}`, column: "M", value: "Offer" },
      { range: `Pipeline!P${staleRow}`, column: "P", value: "" },
    ]);
    assert.equal(ok, true);
    assert.equal(rowByLink(fake, A)[COL.status], "Offer");
    assert.deepEqual(snapshotOthers(fake, A), others);
  });

  it("a deleted job's write is refused with a visible error, and nothing is written", async () => {
    const { fake, env } = loadThenReshuffle();
    const before = fake.writes().length;
    const sheetBefore = fake.rows("Pipeline").map((r) => r.join("|"));
    const ok = await env.sw.updateJobStatus(env.indexOf(B), "Applied");
    assert.equal(ok, false);
    assert.equal(fake.writes().length, before, "no write request went out");
    assert.deepEqual(fake.rows("Pipeline").map((r) => r.join("|")), sheetBefore);
    const toast = env.toasts.find((t) => t.type === "error" && /moved or was removed/i.test(t.message));
    assert.ok(toast, "the person is told the role moved or was removed");
  });

  it("a Link that now appears on two rows is refused, never guessed", async () => {
    const fake = seed();
    const env = loadWriteback(fake);
    env.load();
    fake.sortPipeline((row) => String(row[COL.title]).split("").reverse().join(""));
    fake.rows("Pipeline").push(pipelineRow({ title: "Alpha copy", company: "Acme", link: A }));
    const before = fake.writes().length;
    const ok = await env.sw.updateJobStatus(env.indexOf(A), "Offer");
    assert.equal(ok, false);
    assert.equal(fake.writes().length, before);
    assert.ok(env.toasts.find((t) => t.type === "error" && /more than once/i.test(t.message)));
  });

  it("an unmoved row costs one identity read, not a column scan", async () => {
    const fake = seed();
    const env = loadWriteback(fake);
    env.load();
    await env.sw.updateJobStatus(env.indexOf(C), "Researching");
    const reads = fake.requests.filter((r) => r.method === "GET");
    assert.equal(reads.length, 1);
    assert.equal(rowByLink(fake, C)[COL.status], "Researching");
  });
});

describe("A15 · a write that finishes after a reload finds its job by key, not index", () => {
  it("applies local updates to the job in the NEW array, not whatever sits at the old index", async () => {
    const fake = seed();
    const env = loadWriteback(fake);
    env.load();
    const idx = env.indexOf(A);
    // The person sorts the Sheet; a poll then lands while the write is in
    // flight and replaces the array with the sorted order.
    fake.sortPipeline((row) => String(row[COL.title]).split("").reverse().join(""));
    let release;
    const gate = new Promise((r) => (release = r));
    let swapped = false;
    fake.intercept(async (req) => {
      if (req.method === "POST" && !swapped) {
        swapped = true;
        env.load();
        await gate;
      }
      return null;
    });
    const pending = env.sw.updateJobStatus(idx, "Phone Screen");
    await new Promise((r) => setTimeout(r, 5));
    release();
    assert.equal(await pending, true);
    const live = env.state.data.find((j) => j.link === A);
    assert.equal(live.status, "Phone Screen", "the reloaded copy of the job got the update");
    const squatter = env.state.data[idx];
    assert.notEqual(squatter.link, A, "the sort moved the job off its old index");
    assert.notEqual(squatter.status, "Phone Screen", "the job now at the old index is untouched");
    assert.equal(rowByLink(fake, A)[COL.status], "Phone Screen");
  });

  it("emits jb:write:succeeded with the job's index in the current array", async () => {
    const fake = seed();
    const env = loadWriteback(fake);
    env.load();
    const idx = env.indexOf(D);
    fake.intercept(async (req) => {
      if (req.method === "POST") {
        // A reload mid-write hands back the same rows in another order.
        env.load();
        env.state.data.reverse();
      }
      return null;
    });
    await env.sw.updateJobStatus(idx, "Researching");
    const ev = env.events.find((e) => e.type === "jb:write:succeeded");
    assert.ok(ev);
    assert.equal(env.state.data[ev.detail.jobKey].link, D);
  });
});
