import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAshbyJobsUrl,
  buildGreenhouseBoardInfoUrl,
  buildLeverJobsUrl,
  compactCompanyTokens,
  extractTokenFromBoardHint,
  slugifyCompanyName,
} from "../../src/browser/selectors/index.ts";

test("selector helpers normalize company tokens and board URLs", () => {
  assert.equal(slugifyCompanyName("Acme, Inc."), "acme-inc");
  assert.deepEqual(compactCompanyTokens("Acme, Inc.").sort(), [
    "acme",
    "acme-inc",
    "acmeinc",
  ]);
  assert.equal(extractTokenFromBoardHint("https://jobs.lever.co/acme"), "acme");
  assert.equal(
    buildGreenhouseBoardInfoUrl("acme"),
    "https://boards-api.greenhouse.io/v1/boards/acme",
  );
  assert.equal(
    buildLeverJobsUrl("acme"),
    "https://api.lever.co/v0/postings/acme?mode=json",
  );
  assert.equal(
    buildAshbyJobsUrl("acme"),
    "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
  );
});
