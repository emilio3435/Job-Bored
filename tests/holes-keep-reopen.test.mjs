import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL("../expired-review.js", import.meta.url), "utf8"), context);
const api = context.window.JobBoredExpiredReview;
const job = { title: "Engineer", status: "Expired", link: "https://jobs.example.com/1", notes: "[JobBored 2026-10-02] Rediscovered expired posting — review to reopen." };

test("R16: rediscovered Expired rows are offered in the existing review queue", () => {
  const items = api.getReviewJobs([job]);
  assert.equal(items.length, 1);
  assert.equal(items[0].reason.kind, "rediscovered-expired");
  assert.match(items[0].reason.label, /reopen/i);
  assert.equal(api.getPostingHealth(job).state, "needs-review");
  assert.equal(api.getPostingHealth(job).checkedAt, "2026-10-02");
});

test("R16: ordinary Expired and dismissed rediscovered rows stay out of review", () => {
  assert.equal(api.getReviewJobs([{ ...job, notes: "Marked closed" }, { ...job, dismissedAt: "2026-10-02" }]).length, 0);
});
