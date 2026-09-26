import assert from "node:assert/strict";
import test from "node:test";

import type { AtsProvider, ProviderSurface } from "../../src/browser/providers/types.ts";
import { icimsProvider } from "../../src/browser/providers/icims.ts";
import { jobviteProvider } from "../../src/browser/providers/jobvite.ts";
import { taleoProvider } from "../../src/browser/providers/taleo.ts";
import { successFactorsProvider } from "../../src/browser/providers/successfactors.ts";
import { workableProvider } from "../../src/browser/providers/workable.ts";
import { breezyProvider } from "../../src/browser/providers/breezy.ts";
import { recruiteeProvider } from "../../src/browser/providers/recruitee.ts";
import { teamtailorProvider } from "../../src/browser/providers/teamtailor.ts";
import { personioProvider } from "../../src/browser/providers/personio.ts";
import { workdayProvider } from "../../src/browser/providers/workday.ts";
import { smartrecruitersProvider } from "../../src/browser/providers/smartrecruiters.ts";

// C17: every worker ATS provider gets an enumerate-listings fixture test.
// Probes 404 (recorded), so enumerate falls through to the browser session,
// which returns the recorded payload; the provider must parse ≥1 listing.

type Fixture = {
  provider: AtsProvider;
  boardUrl: string;
  companyName: string;
  /** Recorded browser-session payload (served as session text). */
  payload: unknown;
  expect: { title: string; url: string; location: string; jobId: string };
};

function makeSurface(fixture: Fixture): ProviderSurface {
  return {
    matched: true,
    sourceId: fixture.provider.id,
    sourceLabel: fixture.provider.label,
    boardUrl: fixture.boardUrl,
    boardToken: fixture.boardUrl,
    canonicalUrl: fixture.boardUrl,
    finalUrl: fixture.boardUrl,
    providerType: fixture.provider.id,
    surfaceType: "provider_board",
    confidence: 1,
    warnings: [],
    metadata: { companyName: fixture.companyName },
  } as ProviderSurface;
}

const FIXTURES: Fixture[] = [
  {
    provider: icimsProvider,
    boardUrl: "https://acme.icims.com/jobs/search",
    companyName: "Acme",
    payload: {
      jobs: [
        {
          title: "Backend Engineer",
          url: "https://acme.icims.com/jobs/1234/job",
          location: "Remote",
          reqId: "1234",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.icims.com/jobs/1234/job",
      location: "Remote",
      jobId: "1234",
    },
  },
  {
    provider: jobviteProvider,
    boardUrl: "https://jobs.jobvite.com/acme",
    companyName: "Acme",
    payload: {
      jobs: [
        {
          title: "Backend Engineer",
          url: "https://jobs.jobvite.com/acme/job/oXyZ123",
          location: "Remote",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://jobs.jobvite.com/acme/job/oXyZ123",
      location: "Remote",
      jobId: "oXyZ123",
    },
  },
  {
    provider: taleoProvider,
    boardUrl: "https://acme.taleo.net/careersection/2/jobsearch.ftl",
    companyName: "Acme",
    payload: {
      jobs: [
        {
          title: "Backend Engineer",
          url: "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345",
          location: "Austin, TX",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345",
      location: "Austin, TX",
      jobId: "12345",
    },
  },
  {
    provider: successFactorsProvider,
    boardUrl: "https://acme.successfactors.com/career?company=acme",
    companyName: "Acme",
    payload: {
      jobs: [
        {
          title: "Backend Engineer",
          url: "https://acme.successfactors.com/career?company=acme&career_job_req_id=987",
          location: "Berlin",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.successfactors.com/career?company=acme&career_job_req_id=987",
      location: "Berlin",
      jobId: "987",
    },
  },
  {
    provider: workableProvider,
    boardUrl: "https://apply.workable.com/acme",
    companyName: "Acme",
    payload: {
      results: [
        {
          title: "Backend Engineer",
          shortlink: "https://apply.workable.com/acme/j/ABC123/",
          shortcode: "ABC123",
          location: { city: "Amsterdam", country: "Netherlands" },
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://apply.workable.com/acme/j/ABC123",
      location: "Amsterdam, Netherlands",
      jobId: "ABC123",
    },
  },
  {
    provider: breezyProvider,
    boardUrl: "https://acme.breezy.hr",
    companyName: "Acme",
    payload: {
      positions: [
        {
          name: "Backend Engineer",
          url: "https://acme.breezy.hr/p/abc123def",
          location: "Remote",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.breezy.hr/p/abc123def",
      location: "Remote",
      jobId: "abc123def",
    },
  },
  {
    provider: recruiteeProvider,
    boardUrl: "https://acme.recruitee.com",
    companyName: "Acme",
    payload: {
      offers: [
        {
          title: "Backend Engineer",
          careers_url: "https://acme.recruitee.com/o/backend-engineer",
          location: "Remote",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.recruitee.com/o/backend-engineer",
      location: "Remote",
      jobId: "backend-engineer",
    },
  },
  {
    provider: teamtailorProvider,
    boardUrl: "https://acme.teamtailor.com",
    companyName: "Acme",
    payload: {
      jobs: [
        {
          title: "Backend Engineer",
          url: "https://acme.teamtailor.com/jobs/8124573-backend-engineer",
          location: "Stockholm",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.teamtailor.com/jobs/8124573-backend-engineer",
      location: "Stockholm",
      jobId: "8124573",
    },
  },
  {
    provider: personioProvider,
    boardUrl: "https://acme.jobs.personio.de",
    companyName: "Acme",
    payload: {
      positions: [
        {
          name: "Backend Engineer",
          jobUrl: "https://acme.jobs.personio.de/job/1834171",
          office: "Munich",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.jobs.personio.de/job/1834171",
      location: "Munich",
      jobId: "1834171",
    },
  },
  {
    provider: workdayProvider,
    boardUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
    companyName: "Acme",
    payload: {
      jobPostings: [
        {
          title: "Backend Engineer",
          externalUrl:
            "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Backend-Engineer_R-100",
          locationsText: "Remote",
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Backend-Engineer_R-100",
      location: "Remote",
      jobId: "R-100",
    },
  },
  {
    provider: smartrecruitersProvider,
    boardUrl: "https://jobs.smartrecruiters.com/Acme",
    companyName: "Acme",
    payload: {
      content: [
        {
          name: "Backend Engineer",
          ref: "100",
          location: { city: "Berlin", country: "Germany" },
        },
      ],
    },
    expect: {
      title: "Backend Engineer",
      url: "https://jobs.smartrecruiters.com/Acme/100-backend-engineer",
      location: "Berlin, Germany",
      jobId: "100",
    },
  },
];

for (const fixture of FIXTURES) {
  test(`C17: ${fixture.provider.id} enumerateListings parses its recorded payload`, async () => {
    const fetched: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fetched.push(String(input));
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      let sessionCalls = 0;
      const sessionManager = {
        run: async ({ url }: { url: string }) => {
          sessionCalls += 1;
          return { url, text: JSON.stringify(fixture.payload), metadata: {} };
        },
      };
      const listings = await fixture.provider.enumerateListings(
        makeSurface(fixture),
        sessionManager as never,
      );
      assert.ok(
        fetched.length > 0,
        `${fixture.provider.id}: public probes must fire before the session fallback`,
      );
      assert.equal(sessionCalls, 1, `${fixture.provider.id}: session fallback runs`);
      assert.ok(
        listings.length >= 1,
        `${fixture.provider.id}: must parse ≥1 listing (got ${listings.length})`,
      );
      const [first] = listings;
      assert.equal(first.title, fixture.expect.title);
      assert.equal(first.company, fixture.companyName);
      assert.equal(first.url, fixture.expect.url);
      assert.equal(first.location, fixture.expect.location);
      assert.equal(
        String(first.externalJobId || ""),
        fixture.expect.jobId,
        `${fixture.provider.id}: external job id`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
