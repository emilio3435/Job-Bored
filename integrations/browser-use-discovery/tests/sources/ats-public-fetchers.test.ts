import assert from "node:assert/strict";
import test from "node:test";

import { ATS_SOURCE_IDS } from "../../src/contracts.ts";
import { createAtsProviderRegistry } from "../../src/browser/providers/index.ts";
import {
  fetchAshbyJob,
  fetchAtsJobByRegistry,
  fetchGreenhouseJob,
  fetchLeverJob,
  resolveAtsPublicExecution,
  selectRegisteredAtsSources,
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
        departments: [{ name: "Product" }],
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "greenhouse");
  assert.equal(result.rawListing.sourceLabel, "Greenhouse");
  assert.equal(result.rawListing.providerType, "greenhouse");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(
    result.rawListing.url,
    "https://boards.greenhouse.io/plaid/jobs/4728292004",
  );
  assert.equal(result.rawListing.company, "Plaid");
  assert.equal(result.rawListing.location, "Remote (US)");
  assert.equal(result.rawListing.descriptionText, "Build important products.");
  assert.deepEqual(result.rawListing.tags, ["Senior", "Product"]);
});

test("fetchLeverJob maps public API payload to RawListing", async () => {
  const result = await fetchLeverJob(
    { slug: "stripe", jobId: "abc-123" },
    {
      fetchImpl: fetchReturning({
        text: "Backend Engineer",
        hostedUrl: "https://jobs.lever.co/stripe/abc-123",
        company: "Stripe",
        categories: {
          location: "Remote (US)",
          team: "Engineering",
          department: "Infrastructure",
          commitment: "Full-time",
        },
        descriptionPlain: "Ship backend systems.",
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "lever");
  assert.equal(result.rawListing.sourceLabel, "Lever");
  assert.equal(result.rawListing.providerType, "lever");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(result.rawListing.url, "https://jobs.lever.co/stripe/abc-123");
  assert.equal(result.rawListing.company, "Stripe");
  assert.equal(result.rawListing.location, "Remote (US)");
  assert.equal(result.rawListing.descriptionText, "Ship backend systems.");
  assert.deepEqual(result.rawListing.tags, [
    "Engineering",
    "Infrastructure",
    "Full-time",
  ]);
});

test("fetchAshbyJob maps public API payload to RawListing", async () => {
  const result = await fetchAshbyJob(
    { slug: "figma", jobId: "a1b2c3" },
    {
      fetchImpl: fetchReturning({
        title: "Product Marketing Manager",
        jobUrl: "https://jobs.ashbyhq.com/figma/a1b2c3",
        location: "San Francisco, CA",
        department: "Marketing",
        employmentType: "Full-time",
        descriptionPlain: "Own product marketing launches.",
      }),
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rawListing.sourceId, "ashby");
  assert.equal(result.rawListing.sourceLabel, "Ashby");
  assert.equal(result.rawListing.providerType, "ashby");
  assert.equal(result.rawListing.sourceLane, "company_surface");
  assert.equal(result.rawListing.url, "https://jobs.ashbyhq.com/figma/a1b2c3");
  assert.equal(result.rawListing.company, "figma");
  assert.equal(result.rawListing.location, "San Francisco, CA");
  assert.equal(
    result.rawListing.descriptionText,
    "Own product marketing launches.",
  );
  assert.deepEqual(result.rawListing.tags, ["Marketing", "Full-time"]);
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

test("F4A-RUN07-REG: production gating uses the 14-provider registry, not Greenhouse/Lever/Ashby only", () => {
  const registry = createAtsProviderRegistry();
  assert.deepEqual(
    registry.providers.map((provider) => provider.id),
    [...ATS_SOURCE_IDS],
  );

  const selected = selectRegisteredAtsSources(
    ["workday", "greenhouse", "personio", "not_a_board", "grounded_web"],
    registry,
  );
  assert.deepEqual(selected.selected.sort(), ["greenhouse", "personio", "workday"]);
  assert.ok(
    selected.selected.includes("workday"),
    "Workday is a registered ATS source and must be selected, not gated to GH/Lever/Ashby",
  );
  assert.deepEqual(
    selected.unknown.sort(),
    ["grounded_web", "not_a_board"],
  );

  const allRequested = selectRegisteredAtsSources([...ATS_SOURCE_IDS], registry);
  assert.deepEqual(allRequested.selected.sort(), [...ATS_SOURCE_IDS].sort());
  assert.equal(allRequested.unknown.length, 0);
  assert.equal(allRequested.selected.length, 14);
});

test("F4A-RUN07-REG: public fetchers execute GH/Lever/Ashby and mark other registry providers unsupported", async () => {
  const greenhouse = resolveAtsPublicExecution("greenhouse");
  assert.equal(greenhouse.status, "executable");
  assert.equal(greenhouse.sourceId, "greenhouse");

  const workday = resolveAtsPublicExecution("workday");
  assert.equal(workday.status, "unsupported");
  if (workday.status !== "unsupported") return;
  assert.equal(workday.sourceId, "workday");
  assert.match(workday.reason, /unsupported|no public/i);

  const unknown = resolveAtsPublicExecution("not_a_board");
  assert.equal(unknown.status, "unknown");
  if (unknown.status !== "unknown") return;
  assert.match(unknown.reason, /not a registered/i);

  for (const sourceId of ATS_SOURCE_IDS) {
    const resolved = resolveAtsPublicExecution(sourceId);
    assert.notEqual(
      resolved.status,
      "unknown",
      `${sourceId} is in the 14-provider registry and must not be unknown`,
    );
  }

  const fetched = await fetchAtsJobByRegistry(
    { provider: "workday", slug: "acme", jobId: "JR-1" },
    { fetchImpl: fetchReturning({}) },
  );
  assert.equal(fetched.ok, false);
  if (fetched.ok) return;
  assert.equal(fetched.reason, "unsupported");
  assert.match(fetched.message, /workday/i);
});
