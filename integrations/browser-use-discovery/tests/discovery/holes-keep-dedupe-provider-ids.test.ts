// HOLES KEEP R8: in-run dedupe never merges two listings that carry different
// job ids from the same provider, and an id that is only unique per site is
// never compared across employers.
import assert from "node:assert/strict";
import test from "node:test";

import { dedupeFingerprintListings } from "../../src/discovery/listing-fingerprint.ts";

function listing(overrides: Record<string, unknown>) {
  return {
    sourceId: "greenhouse",
    title: "Account Executive",
    company: "Acme AI",
    location: "New York, NY",
    url: "https://boards.greenhouse.io/acmeai/jobs/111",
    descriptionText: "Sell the Acme platform to mid-market accounts.",
    ...overrides,
  };
}

function keptUrls(items: Array<Record<string, unknown>>) {
  return dedupeFingerprintListings(items).uniqueItems.map((item) => String(item.url));
}

test("R8: two Greenhouse reqs with the same title, company and location stay two leads", () => {
  const urls = keptUrls([
    listing({}),
    listing({ url: "https://boards.greenhouse.io/acmeai/jobs/222" }),
  ]);
  assert.equal(urls.length, 2);
});

test("R8: two requisition ids on one career site stay two leads", () => {
  const urls = keptUrls([
    listing({
      sourceId: "grounded_web",
      url: "https://careers.acme.example/openings/account-executive-ny",
      metadata: { requisitionId: "R-100" },
    }),
    listing({
      sourceId: "grounded_web",
      url: "https://careers.acme.example/openings/account-executive-new-york",
      metadata: { requisitionId: "R-200" },
    }),
  ]);
  assert.equal(urls.length, 2);
});

test("R8: two employers' identical site-local ids never collide", () => {
  const urls = keptUrls([
    listing({
      sourceId: "grounded_web",
      title: "Backend Engineer",
      company: "Acme",
      url: "https://careers.acme.example/jobs?id=100",
      metadata: { requisitionId: "100" },
    }),
    listing({
      sourceId: "grounded_web",
      title: "Marketing Manager",
      company: "Globex",
      url: "https://careers.globex.example/jobs?id=100",
      metadata: { requisitionId: "100" },
    }),
  ]);
  assert.equal(urls.length, 2);
});

test("R8: a listing that matches both distinct reqs by text never joins them", () => {
  const items = [
    listing({}),
    listing({ sourceId: "grounded_web", url: "https://acmeai.example/careers/account-executive" }),
    listing({ url: "https://boards.greenhouse.io/acmeai/jobs/222" }),
  ];
  const result = dedupeFingerprintListings(items);
  const reqUrls = new Set([
    "https://boards.greenhouse.io/acmeai/jobs/111",
    "https://boards.greenhouse.io/acmeai/jobs/222",
  ]);
  for (const group of result.duplicateGroups) {
    const urls = [group.keptIndex, ...group.droppedIndices].map((i) => String(items[i]?.url ?? ""));
    assert.ok(urls.filter((url) => reqUrls.has(url)).length <= 1, `merged distinct reqs: ${urls.join(" ")}`);
  }
});

test("R8: the same req seen twice still dedupes (host move, tracking params)", () => {
  const urls = keptUrls([
    listing({}),
    listing({ url: "https://job-boards.greenhouse.io/acmeai/jobs/111?gh_src=abc" }),
  ]);
  assert.equal(urls.length, 1);
});

test("R8: an id-less copy of one posting still dedupes by text", () => {
  const urls = keptUrls([
    listing({}),
    listing({ sourceId: "grounded_web", url: "https://acmeai.example/careers/account-executive" }),
  ]);
  assert.equal(urls.length, 1);
});
