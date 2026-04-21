import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAshbyJob,
  fetchGreenhouseJob,
  fetchLeverJob,
} from "../../src/sources/ats-public-fetchers.ts";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return async () =>
    ({
      ok: status < 400,
      status,
      json: async () => body,
    }) as Response;
}

test("fetchGreenhouseJob maps public API payload to RawListing", async () => {
  const result = await fetchGreenhouseJob(
    { slug: "plaid", jobId: "4728292004" },
    {
      fetchImpl: fetchReturning({
        id: 4728292004,
        title: "Senior Product Manager",
        absolute_url: "https://boards.greenhouse.io/plaid/jobs/4728292004",
        company_name: "Plaid",
        location: { name: "Remote (US)" },
        content: "<p>Build important products.</p>",
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "greenhouse");
  assert.equal(result.rawListing.sourceLabel, "Greenhouse (URL paste)");
  assert.equal(result.rawListing.providerType, "greenhouse");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(
    result.rawListing.url,
    "https://boards.greenhouse.io/plaid/jobs/4728292004",
  );
  assert.equal(result.rawListing.company, "Plaid");
  assert.equal(result.rawListing.location, "Remote (US)");
  assert.equal(result.rawListing.descriptionText, "Build important products.");
});

test("fetchLeverJob maps public API payload to RawListing", async () => {
  const result = await fetchLeverJob(
    { slug: "stripe", jobId: "abc-123" },
    {
      fetchImpl: fetchReturning({
        text: "Backend Engineer",
        hostedUrl: "https://jobs.lever.co/stripe/abc-123",
        company: "Stripe",
        categories: { location: "Remote (US)" },
        descriptionPlain: "Ship backend systems.",
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "lever");
  assert.equal(result.rawListing.sourceLabel, "Lever (URL paste)");
  assert.equal(result.rawListing.providerType, "lever");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(result.rawListing.url, "https://jobs.lever.co/stripe/abc-123");
  assert.equal(result.rawListing.company, "Stripe");
  assert.equal(result.rawListing.location, "Remote (US)");
  assert.equal(result.rawListing.descriptionText, "Ship backend systems.");
});

test("fetchAshbyJob maps public API payload to RawListing", async () => {
  const result = await fetchAshbyJob(
    { slug: "figma", jobId: "a1b2c3" },
    {
      fetchImpl: fetchReturning({
        title: "Product Marketing Manager",
        jobUrl: "https://jobs.ashbyhq.com/figma/a1b2c3",
        location: "San Francisco, CA",
        descriptionPlain: "Own product marketing launches.",
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "ashby");
  assert.equal(result.rawListing.sourceLabel, "Ashby (URL paste)");
  assert.equal(result.rawListing.providerType, "ashby");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(result.rawListing.url, "https://jobs.ashbyhq.com/figma/a1b2c3");
  assert.equal(result.rawListing.company, "figma");
  assert.equal(result.rawListing.location, "San Francisco, CA");
  assert.equal(
    result.rawListing.descriptionText,
    "Own product marketing launches.",
  );
});

test("fetchGreenhouseJob returns not_found on 404", async () => {
  const result = await fetchGreenhouseJob(
    { slug: "plaid", jobId: "missing" },
    { fetchImpl: fetchReturning({}, 404) },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_found");
  assert.equal(result.httpStatus, 404);
});

test("fetchLeverJob returns not_found on 404", async () => {
  const result = await fetchLeverJob(
    { slug: "stripe", jobId: "missing" },
    { fetchImpl: fetchReturning({}, 404) },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_found");
  assert.equal(result.httpStatus, 404);
});

test("fetchAshbyJob returns not_found on 404", async () => {
  const result = await fetchAshbyJob(
    { slug: "figma", jobId: "missing" },
    { fetchImpl: fetchReturning({}, 404) },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_found");
  assert.equal(result.httpStatus, 404);
});
