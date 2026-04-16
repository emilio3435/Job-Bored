import assert from "node:assert/strict";
import test from "node:test";

import {
  computeListingContentHash,
  computeListingFingerprint,
  computeListingFingerprintKey,
  computeListingPrimaryFingerprintKeys,
  computeListingProviderJobId,
  computeListingRemoteBucket,
  computeListingSemanticKey,
  dedupeFingerprintListings,
  inferListingProviderType,
} from "../../src/discovery/listing-fingerprint.ts";

test("computeListingProviderJobId prefers metadata and normalizes stable ids", () => {
  assert.equal(
    computeListingProviderJobId({
      sourceId: "greenhouse",
      url: "https://boards.greenhouse.io/acme/jobs/99999?utm_source=linkedin",
      metadata: {
        jobId: "GH-12345 ",
      },
    }),
    "gh-12345",
  );
});

test("computeListingProviderJobId extracts provider ids from known ATS urls", () => {
  assert.equal(
    computeListingProviderJobId({
      sourceId: "grounded_web",
      url: "https://jobs.lever.co/acme/product-designer-2f4d1234?lever-source=LinkedIn",
    }),
    "product-designer-2f4d1234",
  );
  assert.equal(
    computeListingProviderJobId({
      sourceId: "grounded_web",
      url: "https://career5.successfactors.eu/career?career_ns=job_listing&company=acme&career_job_req_id=987654",
    }),
    "987654",
  );
  assert.equal(
    computeListingProviderJobId({
      sourceId: "workday",
      url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Chicago-IL/Senior-Platform-Engineer_JR-24680",
    }),
    "jr-24680",
  );
});

test("inferListingProviderType recognizes ATS hosts even from grounded_web", () => {
  assert.equal(
    inferListingProviderType({
      sourceId: "grounded_web",
      url: "https://jobs.ashbyhq.com/acme/abc123",
    }),
    "ashby",
  );
});

test("computeListingRemoteBucket classifies remote, hybrid, onsite, and unknown", () => {
  assert.equal(
    computeListingRemoteBucket({
      location: "Remote - United States",
      descriptionText: "",
      title: "Backend Engineer",
      tags: [],
    }),
    "remote",
  );
  assert.equal(
    computeListingRemoteBucket({
      location: "San Francisco, CA",
      descriptionText: "Hybrid schedule with 3 days in office.",
      title: "Backend Engineer",
      tags: [],
    }),
    "hybrid",
  );
  assert.equal(
    computeListingRemoteBucket({
      location: "Chicago, IL",
      descriptionText: "Onsite in our Chicago office.",
      title: "Backend Engineer",
      tags: [],
    }),
    "onsite",
  );
  assert.equal(
    computeListingRemoteBucket({
      location: "Austin, TX",
      descriptionText: "",
      title: "Backend Engineer",
      tags: [],
    }),
    "unknown",
  );
});

test("computeListingSemanticKey includes normalized location and remote bucket", () => {
  const austin = computeListingSemanticKey({
    company: "Acme AI",
    title: "Senior Platform Engineer",
    location: "Austin, TX",
    descriptionText: "",
    tags: [],
  });
  const newYork = computeListingSemanticKey({
    company: "Acme AI",
    title: "Senior Platform Engineer",
    location: "New York, NY",
    descriptionText: "",
    tags: [],
  });

  assert.notEqual(austin, newYork);
  assert.match(austin, /austin tx/);
  assert.match(newYork, /new york ny/);
});

test("computeListingPrimaryFingerprintKeys normalizes canonical urls and emits provider keys", () => {
  const keys = computeListingPrimaryFingerprintKeys({
    sourceId: "greenhouse",
    url: "https://boards.greenhouse.io/acme/jobs/12345/?utm_source=linkedin&gh_src=foo",
    metadata: {
      jobId: 12345,
    },
  });

  assert.deepEqual(keys, [
    "url:https://boards.greenhouse.io/acme/jobs/12345",
    "provider:greenhouse:12345",
  ]);
});

test("computeListingFingerprint exposes layered keys and stable fallback fingerprintKey", () => {
  const fingerprint = computeListingFingerprint({
    sourceId: "grounded_web",
    title: "Senior Platform Engineer",
    company: "Acme AI",
    location: "Remote - United States",
    url: "https://jobs.lever.co/acme/senior-platform-engineer?lever-source=LinkedIn",
    descriptionText: "Build distributed systems.",
    tags: ["Platform", "Remote"],
  });

  assert.equal(fingerprint.providerType, "lever");
  assert.equal(
    fingerprint.canonicalUrl,
    "https://jobs.lever.co/acme/senior-platform-engineer",
  );
  assert.equal(
    fingerprint.providerJobKey,
    "provider:lever:senior-platform-engineer",
  );
  assert.equal(fingerprint.remoteBucket, "remote");
  assert.equal(
    computeListingFingerprintKey({
      sourceId: "grounded_web",
      title: "Senior Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/senior-platform-engineer?lever-source=LinkedIn",
      descriptionText: "Build distributed systems.",
      tags: ["Platform", "Remote"],
    }),
    "url:https://jobs.lever.co/acme/senior-platform-engineer",
  );
});

test("computeListingContentHash is stable for equivalent normalized content", () => {
  const left = computeListingContentHash({
    company: "Acme AI",
    title: "Senior Platform Engineer",
    location: "Remote - USA",
    descriptionText: "Build distributed systems",
    compensationText: "$200k-$240k",
    contact: "Ada Lovelace",
    tags: ["Platform", "Remote"],
  });
  const right = computeListingContentHash({
    company: "acme ai",
    title: "Senior Platform Engineer",
    location: "Remote United States",
    descriptionText: "Build distributed systems",
    compensationText: "$200k-$240k",
    contact: "Ada Lovelace",
    tags: ["remote", "platform"],
  });

  assert.equal(left, right);
});

test("dedupeFingerprintListings prefers richer leads across primary and semantic matches", () => {
  const listings = [
    {
      sourceId: "grounded_web",
      title: "Senior Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/senior-platform-engineer?lever-source=LinkedIn",
      descriptionText: "Build services.",
      tags: ["Platform"],
      fitScore: 6,
    },
    {
      sourceId: "lever",
      title: "Senior Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/senior-platform-engineer",
      descriptionText:
        "Build distributed systems for the platform team across a remote-first company.",
      compensationText: "$210k-$240k",
      contact: "Ada Lovelace",
      tags: ["Platform", "Infrastructure", "Remote"],
      metadata: {
        postingId: "LEV-42",
        sourceQuery: "Acme remote platform",
      },
      fitScore: 9,
      priority: "🔥",
    },
    {
      sourceId: "lever",
      title: "Senior Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/lev-42?utm_source=indeed",
      descriptionText: "Short duplicate with same provider id.",
      metadata: {
        postingId: "LEV-42",
      },
    },
  ];

  const result = dedupeFingerprintListings(listings);

  assert.equal(result.uniqueItems.length, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.uniqueItems[0].fitScore, 9);
  assert.equal(result.uniqueItems[0].compensationText, "$210k-$240k");
  assert.deepEqual(result.duplicateGroups, [
    {
      keptIndex: 1,
      droppedIndices: [0, 2],
      matchedOn: ["primary", "semantic"],
    },
  ]);
});

test("dedupeFingerprintListings preserves same company and title across different locations", () => {
  const result = dedupeFingerprintListings([
    {
      sourceId: "greenhouse",
      title: "Account Executive",
      company: "Acme AI",
      location: "Austin, TX",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      metadata: { jobId: 123 },
    },
    {
      sourceId: "greenhouse",
      title: "Account Executive",
      company: "Acme AI",
      location: "New York, NY",
      url: "https://boards.greenhouse.io/acme/jobs/456",
      metadata: { jobId: 456 },
    },
  ]);

  assert.equal(result.uniqueItems.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test("dedupeFingerprintListings merges transitive duplicate groups across layered keys", () => {
  const result = dedupeFingerprintListings([
    {
      sourceId: "lever",
      title: "Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/platform-engineer",
      metadata: { postingId: "PLAT-1" },
      descriptionText: "Short description",
      fitScore: 4,
    },
    {
      sourceId: "grounded_web",
      title: "Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://jobs.lever.co/acme/platform-engineer?lever-source=LinkedIn",
      descriptionText: "A richer description that bridges primary and semantic signals.",
      fitScore: 7,
    },
    {
      sourceId: "grounded_web",
      title: "Platform Engineer",
      company: "Acme AI",
      location: "Remote - United States",
      url: "https://careers.acme.com/jobs/platform-engineer",
      descriptionText:
        "A richer description that bridges primary and semantic signals.",
      fitScore: 8,
      priority: "🔥",
    },
  ]);

  assert.equal(result.uniqueItems.length, 1);
  assert.equal(
    result.uniqueItems[0].url,
    "https://jobs.lever.co/acme/platform-engineer?lever-source=LinkedIn",
  );
  assert.deepEqual(result.duplicateGroups, [
    {
      keptIndex: 1,
      droppedIndices: [0, 2],
      matchedOn: ["primary", "semantic", "content"],
    },
  ]);
});
