import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  scrapeJobPosting,
  toScrapeFailureResponse,
} from "../server/shared/job-scraper-core.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () =>
      new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)).buffer,
  };
}

function loadDrawer() {
  const context = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(context);
  vm.runInContext(drawerJs, context, { filename: "discovery-drawer.js" });
  return context.window.JobBoredDiscovery.drawer;
}

const ROLE_HTML = `<!doctype html><html><head><title>Product Designer at Figma</title></head>
<body><main><h1>Product Designer</h1>
<p>Figma is hiring a Product Designer to own multiplayer design workflows, design systems, prototyping, and accessibility across the product organization. You will partner with engineering and research, ship production user interfaces, and mentor designers across several product teams.</p>
<ul><li>Five years of product design experience</li><li>A portfolio of shipped multiplayer tools</li></ul>
</main></body></html>`;

describe("job scrape failure contract", () => {
  it("rejects a Wellfound company jobs index before fetching and explains how to fix the input", async () => {
    const url = "https://wellfound.com/company/thresh-consulting/jobs";
    let fetchCalls = 0;
    let thrown;

    try {
      await scrapeJobPosting(url, {
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("company indexes must not be fetched as one posting");
        },
      });
    } catch (error) {
      thrown = error;
    }

    assert.equal(fetchCalls, 0);
    const failure = toScrapeFailureResponse(thrown, url);
    assert.equal(failure.status, 422);
    assert.equal(failure.body.code, "job_detail_url_required");
    assert.equal(failure.body.error, "Choose a specific job posting first.");
    assert.match(failure.body.detail, /company jobs page/i);
    assert.match(failure.body.nextStep, /open one role/i);
    assert.equal(failure.body.sourceHost, "wellfound.com");
    assert.equal(failure.body.retryable, false);
  });

  it("reports a permanent upstream block without retrying and preserves fallback diagnostics", async () => {
    const url = "https://wellfound.com/jobs/123-product-designer";
    let fetchCalls = 0;
    let thrown;

    try {
      await scrapeJobPosting(url, {
        serpApiKey: "test-serp-key",
        fetchImpl: async () => {
          fetchCalls += 1;
          return response("blocked", { ok: false, status: 403 });
        },
      });
    } catch (error) {
      thrown = error;
    }

    assert.equal(fetchCalls, 1, "a permanent 403 must not be retried");
    const failure = toScrapeFailureResponse(thrown, url);
    assert.equal(failure.status, 502);
    assert.equal(failure.body.code, "source_blocked");
    assert.equal(failure.body.upstreamStatus, 403);
    assert.match(failure.body.detail, /wellfound\.com returned HTTP 403/i);
    assert.deepEqual(failure.body.fallback, {
      attempted: false,
      reason:
        "A job title and company were not supplied, so JobBored could not safely match an alternate result.",
    });
  });

  it("retries one transient page failure and succeeds on the second attempt", async () => {
    let fetchCalls = 0;
    const result = await scrapeJobPosting("https://jobs.example.com/roles/designer", {
      fetchImpl: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return response("temporarily unavailable", { ok: false, status: 503 });
        }
        return response(ROLE_HTML);
      },
    });

    assert.equal(fetchCalls, 2);
    assert.equal(result.title, "Product Designer at Figma");
    assert.match(result.description, /multiplayer design workflows/);
  });

  it("recovers a company index through an exact Google Jobs match when context is available", async () => {
    const url = "https://wellfound.com/company/figma/jobs";
    const fetchCalls = [];
    const result = await scrapeJobPosting(url, {
      title: "Product Designer",
      company: "Figma",
      serpApiKey: "test-serp-key",
      fetchImpl: async (requestUrl) => {
        fetchCalls.push(requestUrl);
        assert.match(requestUrl, /^https:\/\/serpapi\.com\/search\.json\?/);
        return response({
          jobs_results: [
            {
              title: "Product Designer",
              company_name: "Figma",
              location: "San Francisco, CA",
              description:
                "Figma is hiring a Product Designer to lead multiplayer design workflows, prototyping, and accessibility. You will partner with engineering and research, ship production user interfaces, and mentor designers across the product organization.",
              apply_options: [
                {
                  title: "Wellfound",
                  link: "https://wellfound.com/jobs/123-product-designer",
                },
              ],
            },
          ],
        });
      },
    });

    assert.equal(fetchCalls.length, 1, "known company indexes should skip a doomed HTML request");
    assert.equal(result.source, "serpapi-google-jobs");
    assert.equal(result.title, "Product Designer");
    assert.match(result.description, /multiplayer design workflows/);
  });
});

describe("discovery drawer scrape failure copy", () => {
  it("shows the cause, next step, and safe technical details from a structured failure", () => {
    const drawer = loadDrawer();
    const message = drawer.formatScrapeFailure(
      {
        error: "The job site blocked automated access.",
        code: "source_blocked",
        detail: "wellfound.com returned HTTP 403 before JobBored could read the posting.",
        nextStep:
          "Open one specific job and paste its direct posting URL. You can also continue without scraped context.",
        sourceHost: "wellfound.com",
        upstreamStatus: 403,
        fallback: {
          attempted: false,
          reason:
            "A job title and company were not supplied, so JobBored could not safely match an alternate result.",
        },
      },
      502,
    );

    assert.match(message, /^The job site blocked automated access\./);
    assert.match(message, /Why: wellfound\.com returned HTTP 403/);
    assert.match(message, /Next: Open one specific job/);
    assert.match(message, /Details: wellfound\.com · HTTP 403\./);
    assert.match(message, /Fallback: A job title and company were not supplied/);
    assert.doesNotMatch(message, /Scrape failed:/);
  });
});
