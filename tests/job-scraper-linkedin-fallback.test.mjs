import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}

describe("job scraper LinkedIn fallback", () => {
  it("uses SerpApi Google Jobs for a LinkedIn URL when title/company context is available", async () => {
    const fetchCalls = [];
    const result = await scrapeJobPosting(
      "https://www.linkedin.com/jobs/view/4346168652?trackingId=x",
      {
        title: "Sales Director US",
        company: "Entravision (Smadex)",
        serpApiKey: "test-serp-key",
        fetchImpl: async (url) => {
          fetchCalls.push(url);
          if (/^https:\/\/www\.linkedin\.com\//.test(url)) {
            return jsonResponse({}, { ok: false, status: 999 });
          }
          assert.match(url, /^https:\/\/serpapi\.com\/search\.json\?/);
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get("engine"), "google_jobs");
          assert.match(parsed.searchParams.get("q"), /Sales Director US/);
          assert.match(parsed.searchParams.get("q"), /Entravision/);
          assert.equal(parsed.searchParams.get("api_key"), "test-serp-key");
          return jsonResponse({
            jobs_results: [
              {
                title: "Account Executive",
                company_name: "Other Co",
                description: "Short miss that should not match this LinkedIn posting.",
              },
              {
                title: "Sales Director US",
                company_name: "Smadex",
                location: "United States",
                description:
                  "Smadex is hiring a Sales Director US to sell programmatic advertising, mobile marketing, CTV, and performance media solutions to agencies and direct advertisers. The role owns prospecting, consultative presentations, negotiations, campaign launch coordination, client growth, and revenue targets across the US market.",
                apply_options: [
                  {
                    title: "LinkedIn",
                    link: "https://www.linkedin.com/jobs/view/4346168652",
                  },
                ],
              },
            ],
          });
        },
      },
    );

    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[0], /^https:\/\/www\.linkedin\.com\/jobs\/view\/4346168652/);
    assert.match(fetchCalls[1], /^https:\/\/serpapi\.com\/search\.json\?/);
    assert.equal(result.source, "serpapi-google-jobs");
    assert.equal(result.method, "serpapi-google-jobs");
    assert.equal(result.title, "Sales Director US");
    assert.equal(result.company, "Smadex");
    assert.match(result.description, /programmatic advertising/);
    assert.ok(result.skills.includes("CTV"));
    assert.equal(result.scraping.provider, "serpapi_google_jobs");
    assert.equal(result.scraping.originalUrl, "https://www.linkedin.com/jobs/view/4346168652?trackingId=x");
  });

  it("uses SerpApi Google Jobs for copied LinkedIn URL variants with a numeric job id", async () => {
    const cases = [
      "https://www.linkedin.com/jobs/search-results/?currentJobId=4346168652&keywords=sales",
      "https://www.linkedin.com/jobs/search-results/#currentJobId=4346168652&keywords=sales",
      "https://www.linkedin.com/comm/jobs/view/4346168652?trk=public_jobs_topcard-title",
      "https://www.linkedin.com/jobs/view/sales-director-us-at-smadex-4346168652/?trackingId=x",
      "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4346168652?trk=public_jobs_jserp-result_search-card",
    ];

    for (const url of cases) {
      const fetchCalls = [];
      const result = await scrapeJobPosting(url, {
        title: "Sales Director US",
        company: "Entravision (Smadex)",
        serpApiKey: "test-serp-key",
        fetchImpl: async (requestUrl) => {
          fetchCalls.push(requestUrl);
          if (/^https:\/\/www\.linkedin\.com\//.test(requestUrl)) {
            return jsonResponse({}, { ok: false, status: 999 });
          }
          assert.match(requestUrl, /^https:\/\/serpapi\.com\/search\.json\?/);
          return jsonResponse({
            jobs_results: [
              {
                title: "Sales Director US",
                company_name: "Smadex",
                location: "United States",
                description:
                  "Smadex is hiring a Sales Director US to sell programmatic advertising, mobile marketing, CTV, and performance media solutions to agencies and direct advertisers. The role owns prospecting, consultative presentations, negotiations, campaign launch coordination, client growth, and revenue targets across the US market.",
                apply_options: [
                  {
                    title: "LinkedIn",
                    link: "https://www.linkedin.com/jobs/view/4346168652",
                  },
                ],
              },
            ],
          });
        },
      });

      assert.equal(fetchCalls.length, 2, url);
      assert.equal(fetchCalls[0], url);
      assert.match(fetchCalls[1], /^https:\/\/serpapi\.com\/search\.json\?/, url);
      assert.equal(result.source, "serpapi-google-jobs", url);
      assert.equal(result.title, "Sales Director US", url);
      assert.equal(result.company, "Smadex", url);
      assert.equal(result.scraping.provider, "serpapi_google_jobs", url);
      assert.equal(result.scraping.originalUrl, url);
    }
  });

  it("uses SerpApi Google Jobs when LinkedIn returns thin HTML", async () => {
    const fetchCalls = [];
    const url = "https://www.linkedin.com/jobs/view/sales-director-us-at-smadex-4346168652/";
    const result = await scrapeJobPosting(url, {
      title: "Sales Director US",
      company: "Entravision (Smadex)",
      serpApiKey: "test-serp-key",
      fetchImpl: async (requestUrl) => {
        fetchCalls.push(requestUrl);
        if (/^https:\/\/www\.linkedin\.com\//.test(requestUrl)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () =>
              new TextEncoder().encode(
                "<!doctype html><title>LinkedIn</title><main>Sign in to view this job.</main>",
              ).buffer,
          };
        }
        assert.match(requestUrl, /^https:\/\/serpapi\.com\/search\.json\?/);
        return jsonResponse({
          jobs_results: [
            {
              title: "Sales Director US",
              company_name: "Smadex",
              location: "United States",
              description:
                "Smadex is hiring a Sales Director US to sell programmatic advertising, mobile marketing, CTV, and performance media solutions to agencies and direct advertisers. The role owns prospecting, consultative presentations, negotiations, campaign launch coordination, client growth, and revenue targets across the US market.",
              apply_options: [
                {
                  title: "LinkedIn",
                  link: "https://www.linkedin.com/jobs/view/4346168652",
                },
              ],
            },
          ],
        });
      },
    });

    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0], url);
    assert.match(fetchCalls[1], /^https:\/\/serpapi\.com\/search\.json\?/);
    assert.equal(result.source, "serpapi-google-jobs");
    assert.equal(result.company, "Smadex");
    assert.match(result.description, /programmatic advertising/);
  });

  it("falls back to direct scraping when LinkedIn context is missing", async () => {
    const fetchCalls = [];
    await assert.rejects(
      () =>
        scrapeJobPosting("https://www.linkedin.com/jobs/view/4346168652", {
          serpApiKey: "test-serp-key",
          fetchImpl: async (url) => {
            fetchCalls.push(url);
            return jsonResponse({}, { ok: false, status: 999 });
          },
        }),
      /HTTP 999/,
    );

    assert.match(fetchCalls[0], /^https:\/\/www\.linkedin\.com\/jobs\/view\/4346168652/);
    assert.ok(
      fetchCalls.some((url) => /serpapi\.com/.test(url)),
      "configured SerpApi fallback context must still be attempted using the LinkedIn job id",
    );
  });

  it("F1D-INGEST01-STRUCT keeps JSON-LD company and location on scraper output", async () => {
    const html = `<!doctype html><html><head>
      <title>Staff Platform Engineer</title>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Staff Platform Engineer",
        description:
          "<p>Acme Labs is hiring a Staff Platform Engineer to own browser automation, TypeScript services, and job-pipeline reliability across the platform team. The role covers architecture, on-call, and hiring-loop support for a distributed engineering org.</p>",
        hiringOrganization: { "@type": "Organization", name: "Acme Labs" },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Austin",
            addressRegion: "TX",
            addressCountry: "US",
          },
        },
      })}</script>
    </head><body><main><h1>Staff Platform Engineer</h1></main></body></html>`;

    const result = await scrapeJobPosting(
      "https://jobs.example.com/staff-platform-engineer",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          arrayBuffer: async () => new TextEncoder().encode(html).buffer,
        }),
      },
    );

    assert.equal(result.company, "Acme Labs");
    assert.match(String(result.location || ""), /Austin/);
    assert.equal(result.source, "json-ld");
    assert.equal(result.scraping?.lineage?.used, "json-ld");
    assert.equal(result.scraping?.lineage?.primary, "json-ld");
  });

  it("F1D-INGEST01-STRUCT labels DOM fallback lineage when JSON-LD is noise", async () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Hire on Built In",
        description:
          "Hire on Built In. Post a job. Job application tracker for employers browsing salaries and companies.",
      })}</script>
    </head><body>
      <main class="job-description">
        <h1>Backend Engineer</h1>
        <p>${"Build APIs, data pipelines, and hiring-loop tooling for the platform org. ".repeat(12)}</p>
      </main>
    </body></html>`;

    const result = await scrapeJobPosting("https://jobs.example.com/backend", {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      }),
    });

    assert.match(String(result.method || ""), /dom/);
    assert.equal(result.scraping?.lineage?.used, "dom");
    assert.equal(result.scraping?.lineage?.fallbackFrom, "json-ld");
    assert.ok(result.scraping?.lineage?.reason);
  });

  it("F1D-INGEST01-STRUCT passes LinkedIn SerpApi fallback context when only the API key is configured", async () => {
    const fetchCalls = [];
    const result = await scrapeJobPosting(
      "https://www.linkedin.com/jobs/view/4346168652",
      {
        serpApiKey: "test-serp-key",
        fetchImpl: async (url) => {
          fetchCalls.push(url);
          if (/^https:\/\/www\.linkedin\.com\//.test(url)) {
            return jsonResponse({}, { ok: false, status: 999 });
          }
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get("engine"), "google_jobs");
          assert.equal(parsed.searchParams.get("api_key"), "test-serp-key");
          assert.match(parsed.searchParams.get("q") || "", /4346168652/);
          return jsonResponse({
            jobs_results: [
              {
                title: "Sales Director US",
                company_name: "Smadex",
                location: "United States",
                description:
                  "Smadex is hiring a Sales Director US to sell programmatic advertising, mobile marketing, CTV, and performance media solutions to agencies and direct advertisers. The role owns prospecting, consultative presentations, negotiations, campaign launch coordination, client growth, and revenue targets across the US market.",
                apply_options: [
                  {
                    title: "LinkedIn",
                    link: "https://www.linkedin.com/jobs/view/4346168652",
                  },
                ],
              },
            ],
          });
        },
      },
    );

    assert.ok(fetchCalls.some((url) => /serpapi\.com/.test(url)));
    assert.equal(result.source, "serpapi-google-jobs");
    assert.equal(result.company, "Smadex");
    assert.equal(result.location, "United States");
    assert.equal(result.scraping?.lineage?.used, "serpapi-google-jobs");
    assert.equal(result.scraping?.lineage?.fallbackFrom, "linkedin-direct");
  });

  it("F1D-INGEST04-HOST omits Careers/Linkedin host placeholders instead of saving them as the employer", async () => {
    const html = `<!doctype html><html><head>
      <title>Sales Director US</title>
      <meta property="og:site_name" content="LinkedIn">
      </head>
      <body><main class="job-description"><h1>Sales Director US</h1>
      <p>${"Own enterprise pipeline, run consultative sales cycles, and close agency and advertiser deals across the US market. ".repeat(8)}</p>
      </main></body></html>`;

    const result = await scrapeJobPosting(
      "https://careers.linkedin.com/jobs/open-roles",
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          arrayBuffer: async () => new TextEncoder().encode(html).buffer,
        }),
      },
    );

    const company = String(result.company || "").trim();
    assert.notEqual(company.toLowerCase(), "careers");
    assert.notEqual(company.toLowerCase(), "linkedin");
    assert.match(String(result.description || ""), /enterprise pipeline/);
  });
});

describe("job scraper Google Jobs fallback for blocked ATS pages", () => {
  function serpJobsResponse() {
    return jsonResponse({
      jobs_results: [
        {
          title: "Product Designer",
          company_name: "Figma",
          location: "San Francisco, CA",
          description:
            "Figma is hiring a Product Designer to own multiplayer design workflows, design systems, prototyping, and accessibility. You will partner with engineering and research, ship production UI, and mentor designers across the product org.",
          apply_options: [
            {
              title: "Greenhouse",
              link: "https://job-boards.greenhouse.io/figma/jobs/5998147004",
            },
          ],
        },
      ],
    });
  }

  it("uses SerpApi Google Jobs for a Greenhouse 403 when title and company are present", async () => {
    const url = "https://job-boards.greenhouse.io/figma/jobs/5998147004";
    const fetchCalls = [];
    const result = await scrapeJobPosting(url, {
      title: "Product Designer",
      company: "Figma",
      serpApiKey: "test-serp-key",
      fetchImpl: async (requestUrl) => {
        fetchCalls.push(requestUrl);
        if (/greenhouse\.io/.test(requestUrl)) {
          return jsonResponse({}, { ok: false, status: 403 });
        }
        assert.match(requestUrl, /^https:\/\/serpapi\.com\/search\.json\?/);
        return serpJobsResponse();
      },
    });

    assert.ok(
      fetchCalls.some((requestUrl) => /boards-api\.greenhouse\.io/.test(requestUrl)),
      "Greenhouse URLs must probe the public job API before HTML",
    );
    assert.ok(fetchCalls.includes(url), "blocked HTML scrape is still attempted after API miss");
    assert.ok(fetchCalls.some((requestUrl) => /serpapi\.com/.test(requestUrl)));
    assert.equal(result.source, "serpapi-google-jobs");
    assert.equal(result.title, "Product Designer");
    assert.equal(result.company, "Figma");
    assert.match(result.description, /multiplayer design workflows/);
    assert.equal(result.scraping.originalUrl, url);
  });

  it("uses SerpApi Google Jobs when an ATS page returns thin SPA HTML", async () => {
    const url = "https://jobs.ashbyhq.com/figma/abc-123";
    const result = await scrapeJobPosting(url, {
      title: "Product Designer",
      company: "Figma",
      serpApiKey: "test-serp-key",
      fetchImpl: async (requestUrl) => {
        if (/ashbyhq\.com/.test(requestUrl)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () =>
              new TextEncoder().encode(
                "<!doctype html><title>Jobs</title><div id=root></div>",
              ).buffer,
          };
        }
        return serpJobsResponse();
      },
    });

    assert.equal(result.source, "serpapi-google-jobs");
    assert.match(result.description, /multiplayer design workflows/);
  });

  it("still throws when a blocked ATS page has no title/company for SerpApi", async () => {
    await assert.rejects(
      () =>
        scrapeJobPosting("https://www.indeed.com/viewjob?jk=abc", {
          serpApiKey: "test-serp-key",
          fetchImpl: async () => jsonResponse({}, { ok: false, status: 401 }),
        }),
      /HTTP 401/,
    );
  });

  it("does not accept a Google Jobs hit whose company does not match", async () => {
    await assert.rejects(
      () =>
        scrapeJobPosting("https://jobs.lever.co/notion", {
          title: "Engineer",
          company: "Test",
          serpApiKey: "test-serp-key",
          fetchImpl: async (requestUrl) => {
            if (/lever\.co/.test(requestUrl)) {
              return jsonResponse({}, { ok: false, status: 404 });
            }
            return jsonResponse({
              jobs_results: [
                {
                  title: "Remote Software Engineer II, Backend (Test Infra)",
                  company_name: "Affirm",
                  description:
                    "Affirm is hiring a backend engineer to own test infrastructure, CI pipelines, and developer tooling across payments services. You will write services in Kotlin, improve flaky tests, and partner with platform teams.",
                  apply_options: [
                    {
                      title: "Lever",
                      link: "https://jobs.lever.co/affirm/abc",
                    },
                  ],
                },
              ],
            });
          },
        }),
      /HTTP 404/,
    );
  });
});
