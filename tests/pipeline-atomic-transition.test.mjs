import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(repoRoot, "tests/fixtures/pipeline-atomic-transition");

function readFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

function loadTransitions() {
  const src = readFileSync(join(repoRoot, "pipeline-transitions.js"), "utf8");
  const context = { window: {}, globalThis: {}, console };
  context.globalThis = context;
  vm.runInNewContext(src, context, { filename: "pipeline-transitions.js" });
  const api = context.JobBoredPipelineTransitions || context.window.JobBoredPipelineTransitions;
  assert.ok(api, "pipeline-transitions.js must attach JobBoredPipelineTransitions");
  return api;
}

function mockPatchApi() {
  const calls = [];
  return {
    calls,
    async applyCells(patches) {
      calls.push(Array.isArray(patches) ? patches.slice() : patches);
      return { ok: true };
    },
  };
}

function rangesOf(patches) {
  return (patches || []).map((patch) => patch.range);
}

describe("F1-A atomic opportunity transitions", () => {
  it("F1A-PIPE02-REG: Rejected/Passed/Expired/Dismissed share one registry and Expired is never written as Dismissed", () => {
    const api = loadTransitions();
    const closed = ["rejected", "passed", "expired", "dismissed"];
    for (const key of closed) {
      const stage = api.resolveStage(key);
      assert.ok(stage, `registry must include ${key}`);
      assert.equal(stage.kind, "closed", `${key} must be a closed stage`);
    }

    assert.equal(api.statusFor("expired"), "Expired");
    assert.equal(api.statusFor("rejected"), "Rejected");
    assert.equal(api.statusFor("passed"), "Passed");
    assert.notEqual(api.statusFor("expired"), "Dismissed");
    assert.notEqual(api.statusFor("dismissed"), "Expired");

    const row = readFixture("row-researching.json");
    const planned = api.planTransition({
      fromStage: "researching",
      toStage: "expired",
      row,
      now: new Date("2026-08-31T15:00:00Z"),
    });
    assert.equal(planned.ok, true);
    const statusPatch = planned.patches.find((patch) => /Pipeline!M7$/.test(patch.range));
    assert.ok(statusPatch, "expiry must patch Status (column M)");
    assert.equal(statusPatch.value, "Expired");
    assert.equal(
      planned.patches.some((patch) => patch.value === "Dismissed"),
      false,
      "writer must not silently relabel Expired as Dismissed",
    );
  });

  it("F1A-PIPE04-APPLIED: Applied writes Status + Applied Date + Follow-up in one batch, not Status-only", async () => {
    const api = loadTransitions();
    const row = readFixture("row-researching.json");
    const confirmation = readFixture("applied-confirmation.json");
    const patchApi = mockPatchApi();

    const result = await api.applyTransition(
      {
        fromStage: "researching",
        toStage: "applied",
        row,
        now: new Date("2026-08-31T15:00:00Z"),
        confirmation,
      },
      patchApi,
    );

    assert.equal(result.ok, true);
    assert.equal(patchApi.calls.length, 1, "Applied side effects must land in one atomic applyCells call");
    const patches = patchApi.calls[0];
    const byCol = Object.fromEntries(patches.map((patch) => [patch.range, patch.value]));
    assert.equal(byCol["Pipeline!M7"], "Applied");
    assert.equal(byCol["Pipeline!N7"], "2026-08-31");
    assert.equal(byCol["Pipeline!P7"], "2026-09-07");
    assert.ok(patches.length >= 3, "Applied must not be a Status-only write");
  });

  it("F1A-PIPE05-NARROW: planned patches are changed cells only, never a stale A:Y rewrite", () => {
    const api = loadTransitions();
    const row = readFixture("row-researching.json");
    const planned = api.planTransition({
      fromStage: "researching",
      toStage: "researching",
      row,
      note: "Called the recruiter",
      now: new Date("2026-08-31T15:00:00Z"),
    });
    assert.equal(planned.ok, true);
    for (const patch of planned.patches) {
      assert.match(patch.range, /^Pipeline![A-Z]+7$/);
      assert.doesNotMatch(patch.range, /Pipeline!A7:[A-Z]+7/);
    }
    assert.ok(
      planned.patches.some((patch) => patch.range === "Pipeline!O7"),
      "note append must patch Notes only",
    );
  });

  it("F1A-PIPE06-CLOSE: dismiss/restore/expiry include an audit note and a rollback handle", async () => {
    const api = loadTransitions();
    const row = readFixture("row-researching.json");
    const now = new Date("2026-08-31T15:00:00Z");
    const patchApi = mockPatchApi();

    const dismissed = await api.applyTransition(
      { action: "dismiss", row, now, note: "Not a fit" },
      patchApi,
    );
    assert.equal(dismissed.ok, true);
    assert.ok(dismissed.rollback && dismissed.rollback.handle, "dismiss must return a rollback handle");
    assert.ok(
      dismissed.patches.some((patch) => patch.range === "Pipeline!W7" && patch.value),
      "dismiss writes Dismissed At, not a Status rewrite",
    );
    assert.ok(
      dismissed.patches.some((patch) => patch.range === "Pipeline!O7" && /Not a fit/.test(patch.value)),
      "dismiss must append an audit note",
    );
    assert.equal(
      dismissed.patches.some((patch) => patch.range === "Pipeline!M7"),
      false,
      "dismiss must not clobber Status",
    );

    const restoredRow = { ...row, dismissedAt: "2026-08-31T15:00:00.000Z" };
    const restored = await api.applyTransition(
      { action: "restore", row: restoredRow, now, note: "Reopened" },
      patchApi,
    );
    assert.equal(restored.ok, true);
    assert.ok(restored.rollback && restored.rollback.handle, "restore must return a rollback handle");
    assert.ok(
      restored.patches.some((patch) => patch.range === "Pipeline!W7" && patch.value === ""),
      "restore clears Dismissed At",
    );
    assert.ok(
      restored.patches.some((patch) => patch.range === "Pipeline!O7" && /Reopened/.test(patch.value)),
      "restore must append an audit note",
    );

    const expired = await api.applyTransition(
      { action: "expire", fromStage: "researching", toStage: "expired", row, now },
      patchApi,
    );
    assert.equal(expired.ok, true);
    assert.ok(expired.rollback && expired.rollback.handle, "expiry must return a rollback handle");
    assert.equal(
      expired.patches.find((patch) => patch.range === "Pipeline!M7").value,
      "Expired",
    );
    assert.ok(
      expired.patches.some((patch) => patch.range === "Pipeline!O7"),
      "expiry must append an audit note",
    );

    const undoApi = mockPatchApi();
    const undone = await api.applyUndo(dismissed.rollback, undoApi);
    assert.equal(undone.ok, true);
    assert.equal(undoApi.calls.length, 1);
    assert.deepEqual(rangesOf(undoApi.calls[0]).sort(), rangesOf(dismissed.rollback.patches).sort());
  });

  it("F1A-APPLY01-CONFIRM: product Applied requires an explicit submission confirmation payload; drag-only is insufficient", async () => {
    const api = loadTransitions();
    const row = readFixture("row-researching.json");
    const patchApi = mockPatchApi();

    const dragOnly = await api.applyTransition(
      {
        fromStage: "researching",
        toStage: "applied",
        row,
        now: new Date("2026-08-31T15:00:00Z"),
        source: "drag",
      },
      patchApi,
    );
    assert.equal(dragOnly.ok, false);
    assert.equal(dragOnly.code, "confirmation_required");
    assert.equal(patchApi.calls.length, 0, "unconfirmed Applied must not mutate");

    const missingSource = await api.applyTransition(
      {
        fromStage: "researching",
        toStage: "applied",
        row,
        now: new Date("2026-08-31T15:00:00Z"),
        confirmation: { submitted: true, date: "2026-08-31" },
      },
      patchApi,
    );
    assert.equal(missingSource.ok, false);
    assert.equal(missingSource.code, "confirmation_required");
    assert.equal(patchApi.calls.length, 0);

    const confirmed = await api.applyTransition(
      {
        fromStage: "researching",
        toStage: "applied",
        row,
        now: new Date("2026-08-31T15:00:00Z"),
        confirmation: readFixture("applied-confirmation.json"),
      },
      patchApi,
    );
    assert.equal(confirmed.ok, true);
    assert.equal(patchApi.calls.length, 1);
  });
});
