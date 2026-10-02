/**
 * HOLES lane SHEETS · A9 — Notes merge; a stale copy never overwrites them.
 *
 * The notes editor, the Applied evidence note and the board's planner all
 * built the new Notes text from the copy loaded minutes ago and wrote it
 * whole, so a line the worker, another tab or the person (in the Sheet)
 * added since the load was silently lost. The write now re-reads the cell
 * and keeps every line added since the load.
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

const LINK = "https://jobs.lever.co/globex/notes-1";

function setup(notes = "Old note") {
  const fake = createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({ title: "Platform Engineer", company: "Globex", link: LINK, status: "Researching", notes }),
    ],
  });
  const env = loadWriteback(fake);
  env.load();
  const setSheetNotes = (text) => {
    rowByLink(fake, LINK)[COL.notes] = text;
  };
  const sheetNotes = () => rowByLink(fake, LINK)[COL.notes];
  return { fake, env, setSheetNotes, sheetNotes, idx: env.indexOf(LINK) };
}

describe("A9 · notes re-read the cell and merge", () => {
  it("keeps a line added in the Sheet since the load when the person saves", async () => {
    const t = setup();
    t.setSheetNotes("Old note\nRecruiter replied 9/30");
    await t.env.sw.updateJobNotes(t.idx, "Old note\nCalled the hiring manager");
    assert.equal(t.sheetNotes(), "Old note\nCalled the hiring manager\nRecruiter replied 9/30");
    const job = t.env.state.data[t.idx];
    assert.equal(job.notes, t.sheetNotes(), "the board shows what the Sheet holds");
    assert.ok(t.env.toasts.some((x) => /newer lines/i.test(x.message)));
  });

  it("keeps a prepended, dated entry on top", async () => {
    const t = setup();
    t.setSheetNotes("[2026-10-01] Applied via Company portal\nOld note");
    await t.env.sw.updateJobNotes(t.idx, "Old note\nPrep: system design");
    assert.equal(
      t.sheetNotes(),
      "[2026-10-01] Applied via Company portal\nOld note\nPrep: system design",
    );
  });

  it("writes the typed text exactly when nobody else touched the cell", async () => {
    const t = setup();
    await t.env.sw.updateJobNotes(t.idx, "Rewritten from scratch");
    assert.equal(t.sheetNotes(), "Rewritten from scratch");
    assert.ok(t.env.toasts.some((x) => x.message === "Notes saved"));
  });

  it("a cleared note still keeps someone else's newer line", async () => {
    const t = setup();
    t.setSheetNotes("Old note\nOffer call Friday");
    await t.env.sw.updateJobNotes(t.idx, "");
    assert.equal(t.sheetNotes(), "Offer call Friday");
  });

  it("the Applied evidence note merges with the cell as it is now", async () => {
    const t = setup();
    t.setSheetNotes("Old note\nReferral from Dana");
    const ok = await t.env.sw.updateJobStatus(t.idx, "Applied", null, {
      appliedDate: "2026-10-02",
      source: "Company portal",
    });
    assert.equal(ok, true);
    const notes = t.sheetNotes().split("\n");
    assert.equal(notes[0], "[" + t.env.sw.todayStr() + "] Applied via Company portal");
    assert.ok(notes.includes("Old note"));
    assert.ok(notes.includes("Referral from Dana"), "the newer line survived");
    assert.equal(t.env.state.data[t.idx].notes, t.sheetNotes());
  });

  it("planner notes (applyCells) merge too, and the patch carries what was written", async () => {
    const t = setup();
    const row = t.env.sw.getSheetRow(t.idx);
    t.setSheetNotes("Old note\nWorker: salary band updated");
    const patches = [
      { range: `Pipeline!W${row}`, column: "W", value: "2026-10-02T10:00:00.000Z" },
      { range: `Pipeline!O${row}`, column: "O", value: "[2026-10-02] Dismissed\nOld note" },
    ];
    assert.equal(await t.env.sw.applyCells(patches), true);
    assert.equal(
      t.sheetNotes(),
      "[2026-10-02] Dismissed\nOld note\nWorker: salary band updated",
    );
    assert.equal(patches[1].value, t.sheetNotes());
  });

  it("an Undo right after a planner write restores the exact previous text", async () => {
    const t = setup();
    const row = t.env.sw.getSheetRow(t.idx);
    await t.env.sw.applyCells([
      { range: `Pipeline!O${row}`, column: "O", value: "[2026-10-02] Dismissed\nOld note" },
    ]);
    // The adapter's local sync sets job.notes from the patch.
    t.env.state.data[t.idx].notes = "[2026-10-02] Dismissed\nOld note";
    await t.env.sw.applyCells([{ range: `Pipeline!O${row}`, column: "O", value: "Old note" }]);
    assert.equal(t.sheetNotes(), "Old note");
  });
});
