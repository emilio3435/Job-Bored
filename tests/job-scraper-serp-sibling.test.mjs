import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

// E3 (DOSSIER-01, server half): the Google Jobs fallback must not return a
// DIFFERENT posting as the requested one. A title+company-only pick (no id
// or URL match) is a sibling: it must come back labeled
// matchKind:"title_company" with confidence/fetchedAt, and lineage from the
// real source host instead of hardcoded "linkedin-direct".

const THIN_HTML = new TextEncoder().encode(
  "<html><head><title>Acme</title></head><body>Enable JavaScript</body></html>",
).buffer;

function siblingFetch() {
  return async (url) => {
    const u = String(url);
    if (u.startsWith("https://serpapi.com/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobs_results: [
            {
              title: "Senior Software Engineer",
              company_name: "Acme",
              location: "Berlin, Germany",
              job_id: "SIBLING-999",
              description: "Sibling posting in Berlin. ".repeat(40),
              apply_options: [
                { link: "https://careers.acme.example/jobs/SIBLING-999" },
              ],
            },
          ],
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => THIN_HTML,
    };
  };
}

describe("E3 serpapi sibling labeling", () => {
  it("labels a title+company-only pick as a sibling, not the posting", async () => {
    const requested = "https://jobs.acme.example/posting/AUSTIN-123";
    const r = await scrapeJobPosting(requested, {
      title: "Senior Software Engineer",
      company: "Acme",
      fetchImpl: siblingFetch(),
      serpApiKey: "probe-serp",
    });

    assert.equal(r.method, "serpapi-google-jobs");
    assert.equal(r.matchKind, "title_company");
    assert.equal(typeof r.confidence, "number");
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
    assert.ok(Number.isFinite(Date.parse(r.fetchedAt)));
    assert.equal(r.scraping?.lineage?.primary, "jobs.acme.example");
    assert.equal(r.scraping?.lineage?.fallbackFrom, "jobs.acme.example");
    assert.equal(r.scraping?.lineage?.used, "serpapi-google-jobs");
    assert.match(
      (r.warnings || []).join("\n"),
      /similar posting/i,
    );
  });

  it("labels an id-matched pick exact with real-host lineage", async () => {
    const r = await scrapeJobPosting(
      "https://www.linkedin.com/jobs/view/4346168652",
      {
        title: "Sales Director US",
        company: "Smadex",
        serpApiKey: "test-serp-key",
        fetchImpl: async (url) => {
          if (/^https:\/\/www\.linkedin\.com\//.test(String(url))) {
            return {
              ok: false,
              status: 999,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jobs_results: [
                {
                  title: "Sales Director US",
                  company_name: "Smadex",
                  location: "United States",
                  description:
                    "Smadex is hiring a Sales Director US to sell programmatic advertising, mobile marketing, CTV, and performance media solutions to agencies and direct advertisers. ".repeat(
                      3,
                    ),
                  apply_options: [
                    {
                      title: "LinkedIn",
                      link: "https://www.linkedin.com/jobs/view/4346168652",
                    },
                  ],
                },
              ],
            }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      },
    );

    assert.equal(r.method, "serpapi-google-jobs");
    assert.equal(r.matchKind, "exact");
    assert.equal(r.confidence, 1);
    assert.ok(Number.isFinite(Date.parse(r.fetchedAt)));
    assert.equal(r.scraping?.lineage?.primary, "linkedin.com");
    assert.equal(r.scraping?.lineage?.fallbackFrom, "linkedin.com");
  });
});
