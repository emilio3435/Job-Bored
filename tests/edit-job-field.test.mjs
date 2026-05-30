/* ============================================================
   edit-job-field.test.mjs
   ------------------------------------------------------------
   Locks down the user-facing contract for editing a job's
   identity fields (title / company / location / salary) from
   the jb-v2 role dossier masthead:

     "Renaming a job's title (or company / location / salary)
      must persist to the Sheet AND mark that field as
      user-locked in the SAME write, so the next discovery run
      cannot silently re-clobber the rename. A failed write must
      cleanly revert BOTH the field and the lock — the user never
      loses data and never ends up half-locked."

   These are runtime tests: editJobField + its unionLock helper
   are sliced out of app.js and executed in a sandbox whose
   module-level dependencies (pipelineData, accessToken,
   getSheetRow, updateMultipleCells, renderPipeline, showToast,
   showSheetAccessGate) are injected as stubs. This mirrors the
   slice-and-run pattern used by draft-generation-stability.test.mjs
   and keeps the test independent of the FE lane's surrounding code.

   WHY the lock is a granular CSV, not a boolean: editing ONLY the
   title must not freeze company/location/salary against future
   discovery. So the lock unions field ids into column Y and the
   write of value (B/C/D/G) + lock (Y) is one atomic batch.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

/* Column map mirrors STARTER_PIPELINE_HEADERS (app.js ~line 861):
   Title=B, Company=C, Location=D, Salary=G. Edit Lock=Y. */
const FIELD_COLUMN = { title: "B", company: "C", location: "D", salary: "G" };

/* Slice the contiguous edit-field block: the EDIT_FIELD_COLUMN /
   EDIT_LOCK_COLUMN constants, the unionLock helper, and editJobField,
   up to (but not including) the next top-level declaration. This captures
   every module-level binding editJobField depends on so the sandbox can run
   it standalone. */
function sliceEditFieldBlock() {
  const opener = "const EDIT_FIELD_COLUMN";
  const start = appJs.indexOf(opener);
  assert.ok(start >= 0, "EDIT_FIELD_COLUMN constant must exist in app.js");
  assert.ok(
    appJs.indexOf("async function editJobField", start) > start,
    "editJobField must follow the EDIT_FIELD_COLUMN constant in source order",
  );
  // Walk forward from the end of editJobField to the next top-level decl.
  const fnStart = appJs.indexOf("async function editJobField", start);
  const after = fnStart + "async function editJobField".length;
  const nextFn = appJs.slice(after).search(/\n(?:async function|function|const|let) [A-Za-z_]/);
  assert.ok(nextFn >= 0, "could not find the end of editJobField");
  return appJs.slice(start, after + nextFn);
}

/* Build a fresh sandbox for each test. The sandbox exposes editJobField
   over a stub surface so we can observe what it calls and mutates. */
function makeHarness({ jobs, accessToken = "test-token", writeOk = true } = {}) {
  const updateCalls = [];
  const renderCalls = [];
  const toasts = [];
  const gateCalls = [];

  const editFieldBlock = sliceEditFieldBlock();

  // getSheetRow mirrors app.js: null for a job with _rawIndex == null
  // (a locally-added row not yet in the Sheet), else _rawIndex + 2.
  const getSheetRow = (idx) => {
    const job = jobs[idx];
    if (!job || job._rawIndex == null) return null;
    return job._rawIndex + 2;
  };

  const factory = new Function(
    "pipelineData",
    "accessToken",
    "getSheetRow",
    "updateMultipleCells",
    "renderPipeline",
    "showToast",
    "showSheetAccessGate",
    "console",
    `${editFieldBlock}\nreturn editJobField;`,
  );

  const editJobField = factory(
    jobs,
    accessToken,
    getSheetRow,
    async (updates) => {
      updateCalls.push(updates);
      return writeOk;
    },
    () => {
      renderCalls.push(true);
    },
    (msg, kind) => {
      toasts.push({ msg, kind });
    },
    (mode) => {
      gateCalls.push(mode);
    },
    { error() {}, warn() {}, log() {} },
  );

  return { editJobField, jobs, updateCalls, renderCalls, toasts, gateCalls };
}

describe("editJobField — atomic value + Edit-Lock persistence", () => {
  it("writes the value (col B) and Edit Lock (col Y) atomically in ONE batch", async () => {
    const jobs = [{ _rawIndex: 5, title: "Old Title", _editLock: "" }];
    const h = makeHarness({ jobs });

    await h.editJobField(0, "title", "New Title");

    // The optimistic in-memory mutation took effect.
    assert.equal(h.jobs[0].title, "New Title");

    // updateMultipleCells was called exactly once, carrying BOTH cells.
    assert.equal(
      h.updateCalls.length,
      1,
      "value + lock must persist in a single batch so there is no window " +
        "where the rename is saved but the lock is not (next discovery would " +
        "re-clobber it)",
    );
    const batch = h.updateCalls[0];
    const sheetRow = jobs[0]._rawIndex + 2; // 7
    const byRange = Object.fromEntries(batch.map((u) => [u.range, u.value]));
    assert.equal(byRange[`Pipeline!${FIELD_COLUMN.title}${sheetRow}`], "New Title");
    assert.ok(
      "value" in byRange === false
        ? byRange[`Pipeline!Y${sheetRow}`] !== undefined
        : true,
      "the batch must include the Edit Lock (Y) cell",
    );
    assert.ok(
      String(byRange[`Pipeline!Y${sheetRow}`])
        .split(",")
        .map((x) => x.trim())
        .includes("title"),
      "the Y cell value must contain the edited field id 'title'",
    );

    // The optimistic render happened (commit-on-blur shows the change at once).
    assert.ok(h.renderCalls.length >= 1, "expected an optimistic renderPipeline");
  });

  it("reverts BOTH the field and _editLock and toasts on write failure", async () => {
    const jobs = [{ _rawIndex: 3, company: "Old", _editLock: "" }];
    const h = makeHarness({ jobs, writeOk: false });

    await h.editJobField(0, "company", "New");

    // Clean rollback: the field AND the lock are restored to their prior
    // values — a failed save must never leave the user half-locked.
    assert.equal(h.jobs[0].company, "Old", "field must revert on failure");
    assert.equal(h.jobs[0]._editLock, "", "_editLock must revert on failure");

    // Two renders: the optimistic one, then the revert.
    assert.equal(
      h.renderCalls.length,
      2,
      "expected exactly two renderPipeline calls (optimistic + revert)",
    );

    // An error toast tells the user the save did not stick.
    assert.ok(
      h.toasts.some((t) => t.kind === "error"),
      "a failed save must surface an error toast",
    );
  });

  it("no-ops on an exactly-unchanged value (no needless write/relock)", async () => {
    // Same value -> nothing to do. Re-writing would needlessly re-lock the
    // column and burn a Sheet write.
    const jobs = [{ _rawIndex: 1, title: "Same", _editLock: "" }];
    const h = makeHarness({ jobs });

    await h.editJobField(0, "title", "Same");

    assert.equal(h.updateCalls.length, 0, "an unchanged edit must not write");
    assert.equal(h.jobs[0]._editLock, "", "an unchanged edit must not lock");
  });

  it("no-ops on a whitespace-only change (spec: compare TRIMMED values)", async () => {
    // The spec's editJobField trims the incoming value before the no-op check
    // (frontendChanges: `const next = String(value).trim(); if (next === ...)`).
    // The commit-side (role.js) already trims, but a defensive trim here keeps
    // a stray "  Same  " from burning a write + relocking the column. This
    // encodes WHY the no-op exists: a non-edit must never touch the Sheet.
    const jobs = [{ _rawIndex: 1, title: "Same", _editLock: "" }];
    const h = makeHarness({ jobs });

    await h.editJobField(0, "title", "  Same  ");

    assert.equal(
      h.updateCalls.length,
      0,
      "a whitespace-only change must be treated as a no-op (compare trimmed)",
    );
    assert.equal(h.jobs[0]._editLock, "", "a whitespace-only change must not lock");
  });

  it("no-ops on a locally-added job with no sheet row (never builds Pipeline!B<null>)", async () => {
    // _rawIndex == null => getSheetRow returns null => there is no row to
    // write. The handler must bail rather than construct a bogus range.
    const jobs = [{ _rawIndex: null, location: "Old", _editLock: "" }];
    const h = makeHarness({ jobs });

    await h.editJobField(0, "location", "Remote");

    assert.equal(
      h.updateCalls.length,
      0,
      "a job with no sheet row must not trigger a write",
    );
    // No range string was ever built against a null row.
    assert.ok(
      !h.updateCalls.flat().some((u) => /Pipeline![A-Z]null/.test(u.range)),
      "must never construct a Pipeline!<col><null> range",
    );
  });

  it("unions the edited field into an existing Edit-Lock CSV without duplicating", async () => {
    // The row already has the title locked. Editing salary should produce a
    // set-equal 'title,salary' (order-insensitive, no dupes). Editing title
    // again should keep the set unchanged.
    const jobs = [{ _rawIndex: 0, title: "T", salary: "$1", _editLock: "title" }];
    const h = makeHarness({ jobs });

    await h.editJobField(0, "salary", "$2");

    const sheetRow = 2;
    const firstBatch = h.updateCalls.at(-1);
    const firstByRange = Object.fromEntries(firstBatch.map((u) => [u.range, u.value]));
    const lockSet1 = new Set(
      String(firstByRange[`Pipeline!Y${sheetRow}`])
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    assert.deepEqual(
      [...lockSet1].sort(),
      ["salary", "title"],
      "locking salary must UNION into the existing 'title' lock (set-equal, no dupes)",
    );

    // Editing title again (already locked) keeps the set the same — no dup.
    h.jobs[0]._editLock = "title,salary";
    await h.editJobField(0, "title", "T2");
    const secondBatch = h.updateCalls.at(-1);
    const secondByRange = Object.fromEntries(secondBatch.map((u) => [u.range, u.value]));
    const lockSet2 = new Set(
      String(secondByRange[`Pipeline!Y${sheetRow}`])
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    assert.deepEqual(
      [...lockSet2].sort(),
      ["salary", "title"],
      "re-locking an already-locked field must not duplicate it in the CSV",
    );
  });
});
