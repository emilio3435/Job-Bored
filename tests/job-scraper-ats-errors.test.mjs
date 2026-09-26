import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchAtsJobPosting,
  parseAtsJobIdentity,
} from "../server/shared/ats-job-fetchers.mjs";

// C17: one 404 case and one malformed-payload case per shared ATS provider,
// plus the first fetchWorkableJob coverage (previously 0 tests). A dead
// board or garbage payload must yield null, never a throw or a phantom
// posting.

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode("not found").buffer,
  };
}

function malformedResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
    arrayBuffer: async () =>
      new TextEncoder().encode("<<< definitely not xml or json >>>").buffer,
  };
}

/** [provider, identity URL, expected API host fragment] */
const PROVIDERS = [
  ["greenhouse", "https://boards.greenhouse.io/acme/jobs/123", "boards-api.greenhouse.io"],
  ["lever", "https://jobs.lever.co/acme/abc-123", "api.lever.co"],
  ["ashby", "https://jobs.ashbyhq.com/acme/abc-123", "api.ashbyhq.com"],
  ["smartrecruiters", "https://jobs.smartrecruiters.com/Acme/12345678", "api.smartrecruiters.com"],
  ["workday", "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Backend_R-100", "wd5.myworkdayjobs.com"],
  ["workable", "https://apply.workable.com/acme/j/ABC123", "apply.workable.com/api/"],
  ["recruitee", "https://acme.recruitee.com/o/abc123", "acme.recruitee.com/api/offers"],
  ["teamtailor", "https://acme.teamtailor.com/jobs/8124573-x", "acme.teamtailor.com/jobs.json"],
  ["personio", "https://acme.jobs.personio.de/job/1834171", "acme.jobs.personio.de/xml"],
  ["pinpoint", "https://acme.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04", "acme.pinpointhq.com/postings.json"],
  ["rippling", "https://ats.rippling.com/acme/jobs/123", "rippling.com"],
  ["bamboohr", "https://acme.bamboohr.com/careers/123", "acme.bamboohr.com/careers/"],
  ["jazzhr", "https://acme.applytojob.com/apply/xyz", "app.jazz.co/feeds/"],
  ["gem", "https://jobs.gem.com/acme/abc123", "api.gem.com/job_board/"],
  ["dover", "https://app.dover.com/apply/123e4567-e89b-12d3-a456-426614174000", "app.dover.com/api/"],
  ["homerun", "https://acme.homerun.co/abc123", "feed.homerun.co"],
];

describe("C17 shared ATS error paths", () => {
  for (const [provider, url, apiHost] of PROVIDERS) {
    it(`${provider}: 404 and malformed payloads yield null`, async () => {
      assert.equal(parseAtsJobIdentity(url)?.provider, provider, "fixture identity");

      const notFoundCalls = [];
      const notFound = await fetchAtsJobPosting(url, {
        fetchImpl: async (requestUrl) => {
          notFoundCalls.push(String(requestUrl));
          return notFoundResponse();
        },
      });
      assert.equal(notFound, null, `${provider}: 404 must yield null`);
      assert.ok(
        notFoundCalls.some((called) => called.includes(apiHost)),
        `${provider}: must attempt its API (calls=${notFoundCalls.join(", ")})`,
      );

      const malformed = await fetchAtsJobPosting(url, {
        fetchImpl: async () => malformedResponse(),
      });
      assert.equal(malformed, null, `${provider}: malformed payload must yield null`);
    });
  }

  it("workable: fetches a posting from the public API", async () => {
    const calls = [];
    const result = await fetchAtsJobPosting("https://apply.workable.com/acme/j/ABC123", {
      fetchImpl: async (requestUrl) => {
        calls.push(String(requestUrl));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: "Backend Engineer",
            shortcode: "ABC123",
            description:
              "<p>Acme is hiring a Backend Engineer to own billing services, ledger accuracy, and dunning pipelines across European entities.</p>",
            location: { city: "Amsterdam", country: "Netherlands" },
          }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });
    assert.ok(calls.some((called) => called.includes("apply.workable.com/api/")));
    assert.equal(result?.provider, "workable");
    assert.equal(result?.title, "Backend Engineer");
    assert.equal(result?.location, "Amsterdam, Netherlands");
    assert.match(result?.description || "", /billing services/);
    assert.ok(!/</.test(result?.description || ""), "HTML must be stripped");
  });
});
