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

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /^https:\/\/www\.linkedin\.com\/jobs\/view\/4346168652/);
  });
});
