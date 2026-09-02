import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

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

const LISTING_HTML = `<!doctype html><html><head><title>Careers at Acme</title></head>
<body><main>
<h1>Careers at Acme</h1>
<p>See open positions</p>
<ul>
<li>Account Executive</li><li>Software Engineer</li><li>Product Designer</li>
<li>Data Scientist</li><li>Recruiter</li><li>Solutions Consultant</li>
<li>Engineering Manager</li><li>Support Engineer</li><li>Brand Designer</li>
<li>Technical Account Manager</li><li>Sales Director</li><li>IT Engineer</li>
</ul>
</main></body></html>`;

const GEMINI_EXTRACT =
  "## About\n**Bold** claim\r\n\r\n\r\n* item one\n\n" +
  "Acme is hiring a Staff Backend Engineer to own payments services, Kafka pipelines, and PostgreSQL reliability. You will mentor engineers, lead incident response, and ship production APIs used by millions of customers.";

describe("job scraper Gemini URL Context last lane", () => {
  it("uses Gemini URL Context after a careers listing when SerpApi is unavailable", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://jobs.example.com/roles/staff-backend",
      {
        geminiApiKey: "test-gemini-key",
        fetchImpl: async (url, init = {}) => {
          calls.push({ url: String(url), method: init.method || "GET" });
          if (/generativelanguage\.googleapis\.com/.test(url)) {
            const body = JSON.parse(String(init.body || "{}"));
            assert.deepEqual(body.tools, [{ url_context: {} }]);
            assert.equal(body.generationConfig.temperature, 0.1);
            assert.ok(body.generationConfig.maxOutputTokens >= 4000);
            assert.equal(init.headers["x-goog-api-key"], "test-gemini-key");
            assert.match(JSON.stringify(body.contents), /jobs\.example\.com\/roles\/staff-backend/);
            return jsonResponse({
              candidates: [
                {
                  content: { parts: [{ text: GEMINI_EXTRACT }] },
                  url_context_metadata: {
                    url_metadata: [
                      {
                        retrieved_url: "https://jobs.example.com/roles/staff-backend",
                        url_retrieval_status: "URL_RETRIEVAL_STATUS_SUCCESS",
                      },
                    ],
                  },
                },
              ],
            });
          }
          return htmlResponse(LISTING_HTML);
        },
      },
    );

    assert.equal(result.method, "gemini-url-context");
    assert.equal(result.scraping.provider, "gemini-url-context");
    assert.doesNotMatch(result.description, /\*\*/);
    assert.match(result.description, /Bold claim/);
    assert.doesNotMatch(result.description, /\n{3,}/);
    assert.match(result.description, /## About/);
    assert.match(result.description, /Kafka pipelines/);
    assert.ok(calls.some((call) => /generativelanguage\.googleapis\.com/.test(call.url)));
    assert.ok(!calls.some((call) => /serpapi\.com/.test(call.url)));
  });

  it("skips Gemini when URL Context retrieval did not succeed", async () => {
    await assert.rejects(
      () =>
        scrapeJobPosting("https://jobs.example.com/roles/closed", {
          geminiApiKey: "test-gemini-key",
          fetchImpl: async (url) => {
            if (/generativelanguage\.googleapis\.com/.test(url)) {
              return jsonResponse({
                candidates: [
                  {
                    content: { parts: [{ text: GEMINI_EXTRACT }] },
                    url_context_metadata: {
                      url_metadata: [
                        {
                          retrieved_url: "https://jobs.example.com/roles/closed",
                          url_retrieval_status: "URL_RETRIEVAL_STATUS_UNSAFE",
                        },
                      ],
                    },
                  },
                ],
              });
            }
            return htmlResponse(LISTING_HTML);
          },
        }),
      /careers listing/i,
    );
  });
});
