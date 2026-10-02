// HOLES KEEP R4: the dashboard's expired-review parser must read the exact
// notes the worker's expired-job cleanup writes. The note text comes from the
// worker's own builders, so a template change on either side turns this red.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

import {
  buildAuditLine,
  buildNeedsReviewAuditLine,
} from "../integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadReviewApi() {
  const win = {};
  vm.runInNewContext(readFileSync(join(repoRoot, "expired-review.js"), "utf8"), {
    window: win,
    console,
  });
  return win.JobBoredExpiredReview;
}

const review = loadReviewApi();
const TIMESTAMP = "2026-09-30T14:05:00.000Z";
const NOW = new Date("2026-10-01T12:00:00.000Z");

const REVIEW_CLASSIFICATIONS = [
  { source: "http_status", httpStatus: 401 },
  { source: "http_status", httpStatus: 403 },
  { source: "http_status", httpStatus: 429 },
  { source: "http_status", httpStatus: 503 },
  { source: "captcha_marker" },
  { source: "network_error" },
  { source: "timeout" },
  { source: "invalid_url" },
  { source: "ambiguous" },
].map((c) => ({ status: "needs_review", reason: "", evidence: "", confidence: "low", ...c }));

const EXPIRE_CLASSIFICATIONS = [
  { source: "http_status", httpStatus: 404 },
  { source: "http_status", httpStatus: 410 },
  { source: "html_marker" },
].map((c) => ({ status: "expired", reason: "", evidence: "", confidence: "high", ...c }));

describe("R4: expired review reads the cleanup's own notes", () => {
  for (const classification of REVIEW_CLASSIFICATIONS) {
    const label = `${classification.source}${classification.httpStatus ? ` ${classification.httpStatus}` : ""}`;
    it(`a "Please review" note (${label}) puts an active row in the review queue`, () => {
      const note = buildNeedsReviewAuditLine({ timestamp: TIMESTAMP, classification });
      const job = {
        status: "New",
        link: "https://jobs.example.com/1",
        _rawNotes: `Met the recruiter at a meetup.\n${note}`,
        dateFoundRaw: "2026-09-29",
      };
      const queue = review.getReviewJobs([job], { now: NOW });
      assert.equal(queue.length, 1, `not queued: ${note}`);
      assert.equal(queue[0].reason.kind, "cleanup-note");
      const health = review.getPostingHealth(job, { now: NOW });
      assert.equal(health.state, "needs-review", note);
      assert.equal(health.checkedAt, "2026-09-30", note);
    });
  }

  for (const classification of EXPIRE_CLASSIFICATIONS) {
    const label = `${classification.source}${classification.httpStatus ? ` ${classification.httpStatus}` : ""}`;
    it(`a "Marked Expired" note (${label}) dates the expired health`, () => {
      const note = buildAuditLine({ timestamp: TIMESTAMP, previousStatus: "New", classification });
      const health = review.getPostingHealth(
        { status: "Expired", link: "https://jobs.example.com/1", _rawNotes: note },
        { now: NOW },
      );
      assert.equal(health.state, "expired");
      assert.equal(health.checkedAt, "2026-09-30", note);
    });
  }

  it("reads the newest cleanup stamp when several checks are on file", () => {
    const older = buildNeedsReviewAuditLine({
      timestamp: "2026-09-01T00:00:00.000Z",
      classification: REVIEW_CLASSIFICATIONS[1],
    });
    const newer = buildNeedsReviewAuditLine({
      timestamp: "2026-09-28T00:00:00.000Z",
      classification: REVIEW_CLASSIFICATIONS[6],
    });
    const health = review.getPostingHealth(
      { status: "Researching", link: "https://jobs.example.com/1", _rawNotes: `${older}\n${newer}` },
      { now: NOW },
    );
    assert.equal(health.checkedAt, "2026-09-28");
  });
});
