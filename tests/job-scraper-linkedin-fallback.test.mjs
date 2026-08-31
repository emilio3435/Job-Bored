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
    const html = `<!doctype html><html><head><title>Careers | LinkedIn</title></head>
      <body><main class="job-description"><h1>Open roles</h1>
      <p>${"Browse openings on this careers host. Apply through LinkedIn when you are ready. ".repeat(10)}</p>
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
  });
});
