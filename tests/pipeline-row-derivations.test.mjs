/**
 * Tests for the stage-age + follow-up-state derivations exposed to the
 * redesign FE lanes. Contract reference: docs/redesign/handoffs/be-data-deploy.md
 *
 * The browser copy (discovery-shared-helpers.js) and the Node copy
 * (scripts/discovery-shared-helpers.mjs) must behave identically. These
 * tests exercise the Node copy directly; the "COPIES" pact in the file
 * header requires hand-syncing any future edits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveStageAge,
  deriveFollowUpState,
  parsePipelineDate,
} from "../scripts/discovery-shared-helpers.mjs";

const NOW = new Date("2026-04-24T12:00:00Z");

test("deriveStageAge: Applied row with appliedDate uses appliedDate", () => {
  const job = {
    status: "Applied",
    appliedDate: "2026-04-20",
    dateFound: "2026-04-01",
  };
  const result = deriveStageAge(job, NOW);
  assert.equal(result.source, "appliedDate");
  assert.equal(result.days, 4);
});

test("deriveStageAge: Researching row falls back to dateFound", () => {
  const job = {
    status: "Researching",
    appliedDate: "2026-04-20",
    dateFound: "2026-04-18",
  };
  const result = deriveStageAge(job, NOW);
  assert.equal(result.source, "dateFound");
  assert.equal(result.days, 6);
});

test("deriveStageAge: Applied row with blank appliedDate falls back to dateFound", () => {
  const job = {
    status: "Applied",
    appliedDate: "",
    dateFound: "2026-04-10",
  };
  const result = deriveStageAge(job, NOW);
  assert.equal(result.source, "dateFound");
  assert.equal(result.days, 14);
});

test("deriveStageAge: unparseable dates return null source + null days", () => {
  const job = { status: "New", appliedDate: "not-a-date", dateFound: "" };
  const result = deriveStageAge(job, NOW);
  assert.deepEqual(result, { days: null, source: null });
});

test("deriveStageAge: null job returns null structure", () => {
  const result = deriveStageAge(null, NOW);
  assert.deepEqual(result, { days: null, source: null });
});

test("deriveStageAge: New status always uses dateFound even if appliedDate is set", () => {
  // Contract: pre-Applied statuses should never use appliedDate.
  const job = {
    status: "New",
    appliedDate: "2026-04-20",
    dateFound: "2026-04-15",
  };
  const result = deriveStageAge(job, NOW);
  assert.equal(result.source, "dateFound");
  assert.equal(result.days, 9);
});

test("deriveStageAge: appliedDate in the future clamps to 0", () => {
  const job = {
    status: "Applied",
    appliedDate: "2026-04-30",
    dateFound: "2026-04-01",
  };
  const result = deriveStageAge(job, NOW);
  assert.equal(result.source, "appliedDate");
  assert.equal(result.days, 0);
});

test("deriveFollowUpState: empty followUpDate returns state:none", () => {
  assert.deepEqual(deriveFollowUpState({}, NOW), { state: "none" });
  assert.deepEqual(deriveFollowUpState({ followUpDate: "" }, NOW), {
    state: "none",
  });
});

test("deriveFollowUpState: past followUpDate is overdue with daysOverdue", () => {
  const result = deriveFollowUpState(
    { followUpDate: "2026-04-20" },
    NOW,
  );
  assert.equal(result.state, "overdue");
  assert.equal(result.daysOverdue, 4);
});

test("deriveFollowUpState: today's date is due-soon", () => {
  const result = deriveFollowUpState(
    { followUpDate: "2026-04-24" },
    NOW,
  );
  assert.equal(result.state, "due-soon");
  assert.ok(result.hoursUntil >= 0 && result.hoursUntil <= 48);
});

test("deriveFollowUpState: within 48h returns due-soon with hoursUntil", () => {
  const result = deriveFollowUpState(
    { followUpDate: "2026-04-25T06:00:00Z" },
    NOW,
  );
  assert.equal(result.state, "due-soon");
  assert.equal(result.hoursUntil, 18);
});

test("deriveFollowUpState: beyond 48h returns scheduled with daysUntil", () => {
  const result = deriveFollowUpState(
    { followUpDate: "2026-05-01" },
    NOW,
  );
  assert.equal(result.state, "scheduled");
  assert.equal(result.daysUntil, 7);
});

test("deriveFollowUpState: unparseable date returns invalid", () => {
  const result = deriveFollowUpState(
    { followUpDate: "next tuesday maybe" },
    NOW,
  );
  assert.deepEqual(result, { state: "invalid" });
});

test("parsePipelineDate: handles YYYY-MM-DD and ISO; rejects junk", () => {
  assert.ok(parsePipelineDate("2026-04-24") instanceof Date);
  assert.ok(parsePipelineDate("2026-04-24T12:00:00Z") instanceof Date);
  assert.equal(parsePipelineDate(""), null);
  assert.equal(parsePipelineDate("not a date"), null);
  assert.equal(parsePipelineDate(null), null);
});
