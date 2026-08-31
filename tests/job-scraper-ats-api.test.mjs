import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";
import { parseAtsJobIdentity } from "../server/shared/ats-job-fetchers.mjs";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}

function htmlResponse(html, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  };
}

const ROLE_HTML = `<!doctype html><html><head><title>Product Designer at Figma</title></head>
<body><main><h1>Product Designer</h1>
<p>Figma is hiring a Product Designer to own multiplayer design workflows, design systems, prototyping, and accessibility across the product org. You will partner with engineering and research, ship production UI, and mentor designers.</p>
<ul><li>5+ years of product design experience</li><li>Portfolio of shipped multiplayer tools</li></ul>
</main></body></html>`;

const CAREERS_LISTING_HTML = `<!doctype html><html><head><title>Careers at Figma</title></head>
<body><main id="main">
<h1>Careers at Figma</h1>
<p>See open positions</p>
<ul>
<li>Account Executive</li><li>Software Engineer</li><li>Product Designer</li>
<li>Data Scientist</li><li>Recruiter</li><li>Solutions Consultant</li>
<li>Engineering Manager</li><li>Support Engineer</li><li>Brand Designer</li>
<li>Technical Account Manager</li><li>Sales Director</li><li>IT Engineer</li>
</ul>
</main></body></html>`;

describe("parseAtsJobIdentity", () => {
  it("parses greenhouse board, job-boards, and embed URLs", () => {
    assert.deepEqual(
      parseAtsJobIdentity("https://boards.greenhouse.io/anthropic/jobs/4461450008"),
      { provider: "greenhouse", slug: "anthropic", jobId: "4461450008" },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://job-boards.greenhouse.io/figma/jobs/5998147004?gh_jid=5998147004"),
      { provider: "greenhouse", slug: "figma", jobId: "5998147004" },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://boards.greenhouse.io/embed/job_app?for=anthropic&token=4461450008"),
      { provider: "greenhouse", slug: "anthropic", jobId: "4461450008" },
    );
  });

  it("parses lever, ashby, smartrecruiters, and workday job URLs", () => {
    assert.deepEqual(
      parseAtsJobIdentity("https://jobs.lever.co/netflix/abc-123"),
      { provider: "lever", slug: "netflix", jobId: "abc-123" },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3"),
      { provider: "ashby", slug: "openai", jobId: "8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3" },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://jobs.smartrecruiters.com/Uber/3743990000051828-foo"),
      { provider: "smartrecruiters", slug: "Uber", jobId: "3743990000051828" },
    );
    const workday = parseAtsJobIdentity(
      "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/job/San-Jose/Counsel_R171220",
    );
    assert.equal(workday.provider, "workday");
    assert.equal(workday.tenant, "adobe");
    assert.equal(workday.site, "external_experienced");
    assert.match(workday.jobPath, /\/job\/San-Jose\/Counsel_R171220/);
  });

  it("returns null for generic https pages", () => {
    assert.equal(parseAtsJobIdentity("https://example.com/careers/eng"), null);
  });
});

describe("job scraper ATS public JSON lanes", () => {
  it("uses the Greenhouse job API instead of the careers HTML shell", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
      {
        fetchImpl: async (url) => {
          calls.push(url);
          if (/boards-api\.greenhouse\.io/.test(url)) {
            return jsonResponse({
              title: "Account Executive, AI Native",
              company_name: "Anthropic",
              location: { name: "San Francisco" },
              content:
                "&lt;h2&gt;About the role&lt;/h2&gt;&lt;p&gt;Sell Claude to AI-native companies. You will own a book of business, run demos, and close annual contracts with technical buyers.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5+ years enterprise software sales&lt;/li&gt;&lt;/ul&gt;",
              absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
            });
          }
          return htmlResponse(CAREERS_LISTING_HTML);
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "greenhouse");
    assert.equal(result.title, "Account Executive, AI Native");
    assert.equal(result.company, "Anthropic");
    assert.match(result.description, /Sell Claude/);
    assert.ok(!/</.test(result.description), "Greenhouse entity-encoded HTML must be stripped to plain text");
    assert.ok(calls.some((url) => /boards-api\.greenhouse\.io\/v1\/boards\/anthropic\/jobs\/4461450008/.test(url)));
    assert.ok(!calls.some((url) => /job-boards\.greenhouse\.io/.test(url)));
  });

  it("uses the Ashby board payload to recover a posting the HTML SPA left empty", async () => {
    const result = await scrapeJobPosting(
      "https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3",
      {
        fetchImpl: async (url) => {
          if (/api\.ashbyhq\.com/.test(url)) {
            return jsonResponse({
              jobs: [
                {
                  id: "other",
                  title: "Other role",
                  descriptionPlain: "Wrong posting that should not match.",
                },
                {
                  id: "8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3",
                  title: "Technical Program Manager, Compute Infrastructure",
                  companyName: "OpenAI",
                  location: "San Francisco",
                  descriptionPlain:
                    "OpenAI is hiring a TPM to own compute infrastructure programs, capacity planning, and cross-functional delivery with research and engineering. You will run program reviews, unblock hardware ramps, and report status to leadership.",
                },
              ],
            });
          }
          return htmlResponse("<!doctype html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.scraping.provider, "ashby");
    assert.equal(result.title, "Technical Program Manager, Compute Infrastructure");
    assert.match(result.description, /capacity planning/);
  });

  it("uses Lever, SmartRecruiters, and Workday JSON when the hosted page is a shell", async () => {
    const lever = await scrapeJobPosting("https://jobs.lever.co/acme/job-uuid-1", {
      fetchImpl: async (url) => {
        if (/api\.lever\.co/.test(url)) {
          return jsonResponse({
            text: "Staff Backend Engineer",
            company: "Acme",
            categories: { location: "Remote" },
            descriptionPlain:
              "Acme is hiring a Staff Backend Engineer to own payments services, Kafka pipelines, and PostgreSQL reliability. You will mentor engineers and lead incident response.",
            hostedUrl: "https://jobs.lever.co/acme/job-uuid-1",
          });
        }
        return htmlResponse("<html><title>Lever</title></html>");
      },
    });
    assert.equal(lever.scraping.provider, "lever");
    assert.match(lever.description, /Kafka pipelines/);

    const sr = await scrapeJobPosting("https://jobs.smartrecruiters.com/Uber/3743990000051828", {
      fetchImpl: async (url) => {
        if (/api\.smartrecruiters\.com/.test(url)) {
          return jsonResponse({
            name: "Software Engineer II",
            company: { name: "Uber", identifier: "Uber" },
            location: { city: "San Francisco" },
            jobAd: {
              sections: {
                jobDescription: {
                  text: "Uber is hiring a Software Engineer II to build marketplace matching, pricing, and dispatch services used by millions of trips a day.",
                },
                qualifications: {
                  text: "3+ years of backend experience in Go or Java.",
                },
              },
            },
          });
        }
        return htmlResponse("<html><title>Uber</title></html>");
      },
    });
    assert.equal(sr.scraping.provider, "smartrecruiters");
    assert.match(sr.description, /marketplace matching/);

    const workday = await scrapeJobPosting(
      "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/job/San-Jose/Counsel_R171220",
      {
        fetchImpl: async (url) => {
          if (/wday\/cxs\//.test(url)) {
            return jsonResponse({
              jobPostingInfo: {
                title: "Associate General Counsel",
                jobDescription:
                  "<p>Adobe is hiring counsel to advise corporate legal, securities filings, and M&amp;A. You will partner with finance and the board on public-company matters.</p>",
                location: "San Jose, CA",
              },
            });
          }
          return htmlResponse("<html><title>Adobe</title><div id=root></div>");
        },
      },
    );
    assert.equal(workday.scraping.provider, "workday");
    assert.equal(workday.title, "Associate General Counsel");
    assert.match(workday.description, /securities filings/);
  });

  it("rejects a Greenhouse careers listing HTML shell and uses Google Jobs instead", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://job-boards.greenhouse.io/figma/jobs/5998147004",
      {
        title: "Product Designer",
        company: "Figma",
        serpApiKey: "test-serp-key",
        fetchImpl: async (url) => {
          calls.push(url);
          if (/boards-api\.greenhouse\.io/.test(url)) {
            return jsonResponse({}, { ok: false, status: 404 });
          }
          if (/serpapi\.com/.test(url)) {
            return jsonResponse({
              jobs_results: [
                {
                  title: "Product Designer",
                  company_name: "Figma",
                  description:
                    "Figma is hiring a Product Designer to own multiplayer design workflows, design systems, prototyping, and accessibility. You will partner with engineering and research and ship production UI.",
                  apply_options: [
                    { title: "Greenhouse", link: "https://job-boards.greenhouse.io/figma/jobs/5998147004" },
                  ],
                },
              ],
            });
          }
          return htmlResponse(CAREERS_LISTING_HTML);
        },
      },
    );

    assert.equal(result.source, "serpapi-google-jobs");
    assert.match(result.description, /multiplayer design workflows/);
    assert.ok(calls.some((url) => /serpapi\.com/.test(url)));
  });

  it("refuses to return a careers listing as the job description", async () => {
    await assert.rejects(
      () =>
        scrapeJobPosting("https://job-boards.greenhouse.io/figma/jobs/5998147004", {
          fetchImpl: async (url) => {
            if (/boards-api\.greenhouse\.io/.test(url)) {
              return jsonResponse({}, { ok: false, status: 404 });
            }
            return htmlResponse(CAREERS_LISTING_HTML);
          },
        }),
      /careers listing/i,
    );
  });

  it("still scrapes a real hosted HTML posting when no ATS API exists", async () => {
    const result = await scrapeJobPosting("https://jobs.example.com/roles/designer", {
      fetchImpl: async () => htmlResponse(ROLE_HTML),
    });
    assert.equal(result.method, "dom");
    assert.match(result.description, /multiplayer design workflows/);
  });
});
