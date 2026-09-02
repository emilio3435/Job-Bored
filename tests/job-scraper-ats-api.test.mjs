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

  it("parses recruitee, teamtailor, and personio job URLs", () => {
    assert.deepEqual(
      parseAtsJobIdentity("https://vandebron.recruitee.com/o/sourcing-pricing-analyst"),
      { provider: "recruitee", slug: "vandebron", jobId: "sourcing-pricing-analyst" },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://career.teamtailor.com/jobs/8124573-group-financial-controller",
      ),
      { provider: "teamtailor", slug: "career", jobId: "8124573-group-financial-controller" },
    );
    const personioDe = parseAtsJobIdentity(
      "https://personio.jobs.personio.de/job/1834171?language=en",
    );
    assert.equal(personioDe.provider, "personio");
    assert.equal(personioDe.slug, "personio");
    assert.equal(personioDe.jobId, "1834171");
    assert.equal(personioDe.origin, "https://personio.jobs.personio.de");
    const personioCom = parseAtsJobIdentity(
      "https://acme.jobs.personio.com/job/99",
    );
    assert.equal(personioCom.provider, "personio");
    assert.equal(personioCom.origin, "https://acme.jobs.personio.com");
    assert.equal(personioCom.jobId, "99");
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://workwithus.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04",
      ),
      {
        provider: "pinpoint",
        slug: "workwithus",
        jobId: "ce6c9e5c-a2d3-42b0-a01e-9edeae315b04",
      },
    );
  });

  it("parses jazzhr, rippling, and bamboohr job URLs", () => {
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://ticketmanager.applytojob.com/apply/uBZC9qyhtw/Coordinator-Ticket-Operations-And-Fulfillment",
      ),
      { provider: "jazzhr", slug: "ticketmanager", jobId: "uBZC9qyhtw" },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://ats.rippling.com/rippling/jobs/84d388b6-7656-434c-8862-0312eb6b97ac",
      ),
      {
        provider: "rippling",
        slug: "rippling",
        jobId: "84d388b6-7656-434c-8862-0312eb6b97ac",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://ats.rippling.com/de-DE/swag/jobs/1718ef5e-8ed8-4de0-9893-1bced9bd1541",
      ),
      { provider: "rippling", slug: "swag", jobId: "1718ef5e-8ed8-4de0-9893-1bced9bd1541" },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://401auto.bamboohr.com/careers/560"),
      { provider: "bamboohr", slug: "401auto", jobId: "560" },
    );
    assert.equal(parseAtsJobIdentity("https://401auto.bamboohr.com/careers"), null);
    assert.deepEqual(
      parseAtsJobIdentity("https://jobs.gem.com/gem/4965519002"),
      { provider: "gem", slug: "gem", jobId: "4965519002" },
    );
  });

  it("parses dover and homerun job URLs", () => {
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://app.dover.com/apply/dover/aa378aa1-79f3-4995-8667-b78a61c12b11",
      ),
      {
        provider: "dover",
        slug: "dover",
        jobId: "aa378aa1-79f3-4995-8667-b78a61c12b11",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://app.dover.io/apply/aa378aa1-79f3-4995-8667-b78a61c12b11",
      ),
      { provider: "dover", jobId: "aa378aa1-79f3-4995-8667-b78a61c12b11" },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://app.dover.com/jobs/dover/aa378aa1-79f3-4995-8667-b78a61c12b11",
      ),
      {
        provider: "dover",
        slug: "dover",
        jobId: "aa378aa1-79f3-4995-8667-b78a61c12b11",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://app.dover.com/jobs/dover/head-of-people/AA378AA1-79F3-4995-8667-B78A61C12B11",
      ),
      {
        provider: "dover",
        slug: "dover",
        jobId: "aa378aa1-79f3-4995-8667-b78a61c12b11",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://app.dover.com/jobs/dover?job=aa378aa1-79f3-4995-8667-b78a61c12b11",
      ),
      {
        provider: "dover",
        slug: "dover",
        jobId: "aa378aa1-79f3-4995-8667-b78a61c12b11",
      },
    );
    assert.equal(parseAtsJobIdentity("https://app.dover.com/jobs/dover"), null);
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://jobs.homerun.co/junior-sales-executive-amsterdam",
      ),
      {
        provider: "homerun",
        slug: "jobs",
        jobId: "junior-sales-executive-amsterdam",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity(
        "https://jobs.homerun.co/junior-sales-executive-amsterdam/en_GB/apply",
      ),
      {
        provider: "homerun",
        slug: "jobs",
        jobId: "junior-sales-executive-amsterdam",
      },
    );
    assert.deepEqual(
      parseAtsJobIdentity("https://acme.homerun.co/staff-engineer"),
      { provider: "homerun", slug: "acme", jobId: "staff-engineer" },
    );
    assert.equal(parseAtsJobIdentity("https://www.homerun.co/pricing"), null);
    assert.equal(parseAtsJobIdentity("https://jobs.homerun.co/"), null);
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

  it("greenhouse content keeps paragraph and list structure", async () => {
    const result = await scrapeJobPosting(
      "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
      {
        fetchImpl: async (url) => {
          if (/boards-api\.greenhouse\.io/.test(url)) {
            return jsonResponse({
              title: "Account Executive, AI Native",
              company_name: "Anthropic",
              location: { name: "San Francisco" },
              content:
                "&lt;p&gt;Sell Claude to AI-native companies and own a book of business end to end.&lt;/p&gt;&lt;p&gt;Run demos and close annual contracts.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5+ years enterprise sales&lt;/li&gt;&lt;li&gt;Comfort with technical buyers&lt;/li&gt;&lt;/ul&gt;",
              absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
            });
          }
          return htmlResponse(CAREERS_LISTING_HTML);
        },
      },
    );
    assert.match(
      result.description,
      /own a book of business end to end\.\n\nRun demos and close annual contracts\.\n\n- 5\+ years enterprise sales\n- Comfort with technical buyers/,
    );
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

  it("uses the Recruitee offer JSON instead of the careers HTML shell", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://vandebron.recruitee.com/o/sourcing-pricing-analyst",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (/recruitee\.com\/api\/offers\/sourcing-pricing-analyst/.test(url)) {
            return jsonResponse({
              offer: {
                id: 2710502,
                slug: "sourcing-pricing-analyst",
                title: "Sourcing & Pricing Analyst",
                company_name: "Vandebron",
                city: "Amsterdam",
                country: "Nederland",
                description:
                  "<h3>Who we are</h3><p>Vandebron is hiring a Sourcing and Pricing Analyst to own energy procurement models, market pricing, and supplier negotiations across the Dutch renewable portfolio.</p>",
              },
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "recruitee");
    assert.equal(result.title, "Sourcing & Pricing Analyst");
    assert.equal(result.company, "Vandebron");
    assert.match(result.description, /energy procurement models/);
    assert.ok(!/</.test(result.description), "Recruitee HTML must be stripped to plain text");
    assert.ok(calls.some((url) => /recruitee\.com\/api\/offers\/sourcing-pricing-analyst/.test(url)));
    assert.ok(!calls.some((url) => /vandebron\.recruitee\.com\/o\//.test(url)));
  });

  it("matches a Recruitee posting from the board list when the single-offer URL 404s", async () => {
    const result = await scrapeJobPosting(
      "https://vandebron.recruitee.com/o/sourcing-pricing-analyst",
      {
        fetchImpl: async (url) => {
          if (/api\/offers\/sourcing-pricing-analyst/.test(url) && !/offers\/$/.test(url)) {
            return jsonResponse({}, { ok: false, status: 404 });
          }
          if (/api\/offers\/?$/.test(url) || /api\/offers\/$/.test(url)) {
            return jsonResponse({
              offers: [
                {
                  slug: "other-role",
                  title: "Other",
                  description: "<p>Wrong posting that should not match this Recruitee lookup.</p>",
                },
                {
                  slug: "sourcing-pricing-analyst",
                  title: "Sourcing & Pricing Analyst",
                  company_name: "Vandebron",
                  description:
                    "<p>Vandebron is hiring a Sourcing and Pricing Analyst to own energy procurement models, market pricing, and supplier negotiations across the Dutch renewable portfolio.</p>",
                },
              ],
            });
          }
          return htmlResponse("<html><title>Jobs</title></html>");
        },
      },
    );

    assert.equal(result.scraping.provider, "recruitee");
    assert.match(result.description, /energy procurement models/);
  });

  it("uses the Teamtailor jobs.json feed instead of the hosted SPA shell", async () => {
    const result = await scrapeJobPosting(
      "https://career.teamtailor.com/jobs/8124573-group-financial-controller",
      {
        fetchImpl: async (url) => {
          if (/teamtailor\.com\/jobs\.json/.test(url)) {
            return jsonResponse({
              version: "https://jsonfeed.org/version/1.1",
              title: "Teamtailor",
              items: [
                {
                  id: "other",
                  title: "Other role",
                  url: "https://career.teamtailor.com/jobs/111-other",
                  content_html: "<p>Wrong Teamtailor posting that should not match.</p>",
                },
                {
                  id: "3ce2c88b-cbc6-4ae9-8ecb-000466c69037",
                  title: "Group Financial Controller",
                  url: "https://career.teamtailor.com/jobs/8124573-group-financial-controller",
                  content_html:
                    "<h4>Join Teamtailor</h4><p>Teamtailor is hiring a Group Financial Controller to own group reporting, close, and forecasting across European entities. You will partner with FP&amp;A and the board.</p>",
                  _jobposting: {
                    jobLocation: [
                      {
                        "@type": "Place",
                        address: { addressLocality: "Stockholm", addressCountry: "SE" },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "teamtailor");
    assert.equal(result.title, "Group Financial Controller");
    assert.equal(result.location, "Stockholm, SE");
    assert.match(result.description, /group reporting/);
    assert.ok(!/</.test(result.description), "Teamtailor HTML must be stripped to plain text");
  });

  it("uses the Personio XML feed in English instead of the hosted career page", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://personio.jobs.personio.de/job/1834171",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (/jobs\.personio\.de\/xml/.test(url)) {
            return {
              ok: true,
              status: 200,
              headers: { get: () => "text/xml" },
              json: async () => ({}),
              arrayBuffer: async () =>
                new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>999</id>
    <name>Wrong role</name>
    <jobDescriptions>
      <jobDescription><name>About</name><value>Wrong Personio posting.</value></jobDescription>
    </jobDescriptions>
  </position>
  <position>
    <id>1834171</id>
    <subcompany>Personio SE</subcompany>
    <office>Munich</office>
    <name>Staff Software Engineer, Data Platform</name>
    <jobDescriptions>
      <jobDescription>
        <name>Your mission</name>
        <value><![CDATA[<p>Personio is hiring a Staff Software Engineer to own the data platform, warehouse reliability, and streaming pipelines used by product analytics.</p>]]></value>
      </jobDescription>
      <jobDescription>
        <name>What you will do</name>
        <value><![CDATA[<ul><li>Design lakehouse tables</li><li>Lead incident response</li></ul>]]></value>
      </jobDescription>
    </jobDescriptions>
  </position>
</workzag-jobs>`).buffer,
            };
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "personio");
    assert.equal(result.title, "Staff Software Engineer, Data Platform");
    assert.equal(result.company, "Personio SE");
    assert.match(result.description, /data platform/);
    assert.match(result.description, /lakehouse tables/);
    assert.ok(!/</.test(result.description), "Personio HTML must be stripped to plain text");
    assert.ok(calls.some((url) => /xml\?language=en/.test(url)));
  });

  it("uses the Pinpoint postings.json feed instead of the hosted SPA shell", async () => {
    const result = await scrapeJobPosting(
      "https://workwithus.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04",
      {
        fetchImpl: async (url) => {
          if (/pinpointhq\.com\/postings\.json/.test(url)) {
            return jsonResponse({
              data: [
                {
                  id: "111",
                  title: "Other role",
                  url: "https://workwithus.pinpointhq.com/en/postings/other",
                  description: "<p>Wrong Pinpoint posting that should not match.</p>",
                },
                {
                  id: "559663",
                  title: "Founding Legal Counsel",
                  url: "https://workwithus.pinpointhq.com/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04",
                  path: "/en/postings/ce6c9e5c-a2d3-42b0-a01e-9edeae315b04",
                  description:
                    "<p>Pinpoint is hiring a Founding Legal Counsel to own commercial contracting, sales legal, and privacy reviews across the HR tech product.</p>",
                  key_responsibilities: "<ul><li>Own commercial contracting end to end</li></ul>",
                  location: { name: "Remote", city: "London" },
                },
              ],
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "pinpoint");
    assert.equal(result.title, "Founding Legal Counsel");
    assert.match(result.description, /commercial contracting/);
    assert.ok(!/</.test(result.description), "Pinpoint HTML must be stripped to plain text");
  });

  it("uses the Rippling job JSON instead of the hosted SPA shell", async () => {
    const result = await scrapeJobPosting(
      "https://ats.rippling.com/rippling/jobs/84d388b6-7656-434c-8862-0312eb6b97ac",
      {
        fetchImpl: async (url) => {
          if (/ats\.rippling\.com\/api\/v2\/board\/rippling\/jobs\/84d388b6/.test(url)) {
            return jsonResponse({
              uuid: "84d388b6-7656-434c-8862-0312eb6b97ac",
              name: "Business Operations Manager",
              companyName: "Rippling",
              workLocations: ["San Francisco, CA", "New York, NY"],
              description: {
                company: "<p>Rippling is the workforce platform for IT, HR, and Finance.</p>",
                role: "<p>Rippling is hiring a Business Operations Manager to own GTM systems, forecasting, and cross-functional ops reviews with sales and finance.</p>",
              },
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "rippling");
    assert.equal(result.title, "Business Operations Manager");
    assert.equal(result.company, "Rippling");
    assert.equal(result.location, "San Francisco, CA");
    assert.match(result.description, /GTM systems/);
    assert.ok(!/</.test(result.description), "Rippling HTML must be stripped to plain text");
  });

  it("uses the BambooHR career detail JSON instead of the hosted listing page", async () => {
    const result = await scrapeJobPosting("https://401auto.bamboohr.com/careers/560", {
      fetchImpl: async (url) => {
        if (/bamboohr\.com\/careers\/560\/detail/.test(url)) {
          return jsonResponse({
            result: {
              jobOpening: {
                jobOpeningName: "Inventory Auditor",
                jobOpeningShareUrl: "https://401auto.bamboohr.com/careers/560",
                location: { city: "Kitchener", state: "Ontario" },
                description:
                  "<p>We are seeking a detail-oriented Inventory Auditor to own cycle counts, variance investigation, and warehouse accuracy across dealership lots.</p>",
              },
            },
          });
        }
        return htmlResponse("<html><title>Careers</title><div id=root></div>");
      },
    });

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "bamboohr");
    assert.equal(result.title, "Inventory Auditor");
    assert.match(result.description, /cycle counts/);
    assert.ok(!/</.test(result.description), "BambooHR HTML must be stripped to plain text");
  });

  it("uses the JazzHR XML feed instead of the hosted apply page", async () => {
    const result = await scrapeJobPosting(
      "https://ticketmanager.applytojob.com/apply/uBZC9qyhtw/Coordinator-Ticket-Operations-And-Fulfillment",
      {
        fetchImpl: async (url) => {
          if (/app\.jazz\.co\/feeds\/export\/jobs\/ticketmanager/.test(url)) {
            return {
              ok: true,
              status: 200,
              headers: { get: () => "text/xml" },
              json: async () => ({}),
              arrayBuffer: async () =>
                new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<jobs>
  <job>
    <title>Wrong role</title>
    <url>http://ticketmanager.applytojob.com/apply/other/Wrong</url>
    <description><![CDATA[<p>Wrong JazzHR posting that should not match.</p>]]></description>
  </job>
  <job>
    <title>Coordinator, Ticket Operations and Fulfillment</title>
    <url>http://ticketmanager.applytojob.com/apply/uBZC9qyhtw/Coordinator-Ticket-Operations-And-Fulfillment</url>
    <city>Mesa</city>
    <state>AZ</state>
    <description><![CDATA[<p>TicketManager is hiring a Coordinator to own live-event ticket operations, client fulfillment, and hospitality logistics across enterprise accounts.</p>]]></description>
  </job>
</jobs>`).buffer,
            };
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "jazzhr");
    assert.equal(result.title, "Coordinator, Ticket Operations and Fulfillment");
    assert.match(result.description, /ticket operations/);
    assert.ok(!/</.test(result.description), "JazzHR HTML must be stripped to plain text");
  });

  it("uses the Gem job board API instead of the hosted SPA shell", async () => {
    const result = await scrapeJobPosting("https://jobs.gem.com/gem/4965519002", {
      fetchImpl: async (url) => {
        if (/api\.gem\.com\/job_board\/v0\/gem\/job_posts/.test(url)) {
          return jsonResponse([
            {
              id: "other",
              title: "Other role",
              absolute_url: "https://jobs.gem.com/gem/other",
              content_plain: "Wrong Gem posting that should not match this lookup at all.",
            },
            {
              id: "4965519002",
              title: "Software Engineer",
              absolute_url: "https://jobs.gem.com/gem/4965519002",
              location: { name: "San Francisco, United States" },
              content_plain:
                "Gem is hiring a Software Engineer to own recruiting-platform services, candidate search, and ATS integrations. You will ship production systems with the product team.",
              content: "<p>Gem is hiring a Software Engineer to own recruiting-platform services.</p>",
            },
          ]);
        }
        return htmlResponse("<html><title>Jobs</title><div id=root></div>");
      },
    });

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "gem");
    assert.equal(result.title, "Software Engineer");
    assert.match(result.description, /recruiting-platform services/);
  });

  it("uses the Dover apply-portal JSON instead of the hosted SPA shell", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://app.dover.com/apply/dover/aa378aa1-79f3-4995-8667-b78a61c12b11",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (/inbound\/application-portal-job\/aa378aa1-79f3-4995-8667-b78a61c12b11/.test(url)) {
            return jsonResponse({
              id: "aa378aa1-79f3-4995-8667-b78a61c12b11",
              client_name: "Dover",
              title: "Head of People",
              workplace_type: "REMOTE",
              locations: [{ name: "United States", is_primary: true }],
              user_provided_description:
                "<h2>Company Overview</h2><p>Dover is hiring a Head of People to own recruiting operations, people programs, and hiring-manager coaching across the expert marketplace.</p><ul><li>Build the people function</li></ul>",
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "dover");
    assert.equal(result.title, "Head of People");
    assert.equal(result.company, "Dover");
    assert.equal(result.location, "United States");
    assert.match(result.description, /expert marketplace/);
    assert.ok(!/</.test(result.description), "Dover HTML must be stripped to plain text");
    assert.ok(
      calls.some((url) =>
        /app\.dover\.com\/api\/v1\/inbound\/application-portal-job\/aa378aa1/.test(url),
      ),
    );
    assert.ok(!calls.some((url) => /app\.dover\.com\/apply\//.test(url)));
  });

  it("uses the Homerun Atom feed instead of the hosted career page", async () => {
    const result = await scrapeJobPosting(
      "https://jobs.homerun.co/junior-sales-executive-amsterdam",
      {
        fetchImpl: async (url) => {
          if (/feed\.homerun\.co\/jobs/.test(url)) {
            return {
              ok: true,
              status: 200,
              headers: { get: () => "application/xml" },
              json: async () => ({}),
              arrayBuffer: async () =>
                new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Homerun</title>
  <entry>
    <author><name>Homerun</name></author>
    <title type="text">Open application</title>
    <link rel="alternate" type="text/html" href="https://jobs.homerun.co/open"></link>
    <id>job_other</id>
    <description type="html"><![CDATA[<p>Wrong Homerun posting that should not match this lookup.</p>]]></description>
  </entry>
  <entry>
    <author><name>Homerun</name></author>
    <title type="text">Junior Sales Executive - Amsterdam</title>
    <link rel="alternate" type="text/html" href="https://jobs.homerun.co/junior-sales-executive-amsterdam"></link>
    <id>job_ylyLXfyJ8i1qgAMttyIt</id>
    <description type="html"><![CDATA[<p>Homerun is hiring a Junior Sales Executive to own outbound outreach, discovery calls, and pipeline growth with HR teams across Europe.</p>]]></description>
    <location><name>Amsterdam</name></location>
  </entry>
</feed>`).buffer,
            };
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "homerun");
    assert.equal(result.title, "Junior Sales Executive - Amsterdam");
    assert.equal(result.company, "Homerun");
    assert.equal(result.location, "Amsterdam");
    assert.match(result.description, /outbound outreach/);
    assert.ok(!/</.test(result.description), "Homerun HTML must be stripped to plain text");
  });

  it("reads a Teamtailor-style jobs.json feed on a custom career domain", async () => {
    const result = await scrapeJobPosting(
      "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
      {
        fetchImpl: async (url) => {
          if (String(url) === "https://careers.oatly.com/jobs.json") {
            return jsonResponse({
              version: "https://jsonfeed.org/version/1.1",
              title: "Oatly AB",
              items: [
                {
                  title: "Other",
                  url: "https://careers.oatly.com/jobs/111-other",
                  content_html: "<p>Wrong custom-domain posting that should not match.</p>",
                },
                {
                  title: "Integration Developer at Oatly",
                  url: "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
                  content_html:
                    "<p>Oatly is hiring an Integration Developer to own ERP integrations, data pipelines, and partner APIs across European manufacturing sites.</p>",
                },
              ],
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "career-feed");
    assert.equal(result.title, "Integration Developer at Oatly");
    assert.equal(result.company, "Oatly AB");
    assert.match(result.description, /ERP integrations/);
  });

  it("reads a Recruitee-style offers API on a custom career domain", async () => {
    const result = await scrapeJobPosting(
      "https://werkenbij.vandebron.nl/o/sourcing-pricing-analyst",
      {
        fetchImpl: async (url) => {
          if (String(url).includes("/api/offers")) {
            return jsonResponse({
              offers: [
                {
                  slug: "sourcing-pricing-analyst",
                  title: "Sourcing & Pricing Analyst",
                  company_name: "Vandebron",
                  careers_url: "https://werkenbij.vandebron.nl/o/sourcing-pricing-analyst",
                  description:
                    "<p>Vandebron is hiring a Sourcing and Pricing Analyst to own energy procurement models, market pricing, and supplier negotiations.</p>",
                },
              ],
            });
          }
          return htmlResponse("<html><title>Jobs</title><div id=root></div>");
        },
      },
    );

    assert.equal(result.scraping.provider, "career-feed");
    assert.match(result.description, /energy procurement models/);
  });

  it("does not probe generic career feeds for LinkedIn or blog pages", async () => {
    const calls = [];
    await scrapeJobPosting("https://example.com/about/team", {
      fetchImpl: async (url) => {
        calls.push(String(url));
        return htmlResponse(ROLE_HTML);
      },
    }).catch(() => null);
    assert.ok(!calls.some((url) => /jobs\.json|postings\.json|api\/offers/.test(url)));
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
