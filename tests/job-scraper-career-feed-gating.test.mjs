import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";
import { looksLikeSpaShellHtml } from "../server/shared/ats-job-fetchers.mjs";

// C18: fetchGenericCareerFeed must not fire 4 speculative feed GETs for
// every non-ATS career URL before the page itself is fetched. The page is
// fetched first; feeds are probed only when the HTML looks like an SPA shell.

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => "application/json" },
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

const SUBSTANTIAL_ROLE_HTML = `<!doctype html><html><head><title>Integration Developer at Oatly</title></head>
<body><main><h1>Integration Developer at Oatly</h1>
<p>Oatly is hiring an Integration Developer to own ERP integrations, data pipelines, and partner APIs across European manufacturing sites. You will design event-driven sync jobs, harden warehouse loads, and pair with logistics engineers on telemetry.</p>
<ul><li>5+ years of backend engineering experience</li><li>Production Kafka or event-driven systems</li></ul>
</main></body></html>`;

const SPA_SHELL_HTML = "<html><head><title>Jobs</title></head><body><div id=root></div><script src=\"/assets/index-abc123.js\"></script></body></html>";

function feedResponse() {
  return jsonResponse({
    version: "https://jsonfeed.org/version/1.1",
    title: "Oatly AB",
    items: [
      {
        title: "Integration Developer at Oatly",
        url: "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
        content_html:
          "<p>Oatly is hiring an Integration Developer to own ERP integrations, data pipelines, and partner APIs across European manufacturing sites.</p>",
      },
    ],
  });
}

function isFeedProbe(url) {
  return /jobs\.json|postings\.json|api\/offers/.test(String(url));
}

describe("C18 generic career feed gating", () => {
  it("recognizes SPA shells vs substantial pages", () => {
    assert.equal(looksLikeSpaShellHtml(SPA_SHELL_HTML), true);
    assert.equal(looksLikeSpaShellHtml(SUBSTANTIAL_ROLE_HTML), false);
    assert.equal(looksLikeSpaShellHtml(""), false);
  });

  it("does not probe feeds for a substantial non-ATS career page", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (isFeedProbe(url)) return feedResponse();
          return htmlResponse(SUBSTANTIAL_ROLE_HTML);
        },
      },
    );

    assert.ok(
      !calls.some(isFeedProbe),
      `no speculative feed GETs expected, got: ${calls.join(", ")}`,
    );
    assert.match(result.method, /dom|json-ld/);
    assert.match(result.description, /ERP integrations/);
  });

  it("fetches the page first, then probes feeds for an SPA shell", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url) === "https://careers.oatly.com/jobs.json") {
            return feedResponse();
          }
          if (isFeedProbe(url)) return jsonResponse(null, { ok: false, status: 404 });
          return htmlResponse(SPA_SHELL_HTML);
        },
      },
    );

    const pageIndex = calls.findIndex(
      (url) => url === "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
    );
    const feedIndex = calls.findIndex(isFeedProbe);
    assert.ok(pageIndex >= 0, "page itself must be fetched");
    assert.ok(feedIndex >= 0, "shell must trigger feed probes");
    assert.ok(
      pageIndex < feedIndex,
      `page (index ${pageIndex}) must precede feed probes (index ${feedIndex}): ${calls.join(", ")}`,
    );
    assert.equal(result.method, "ats-api");
    assert.equal(result.scraping.provider, "career-feed");
    assert.match(result.description, /ERP integrations/);
  });

  it("falls through gracefully when an SPA shell has no feed", async () => {
    const calls = [];
    const result = await scrapeJobPosting(
      "https://careers.oatly.com/jobs/8049977-integration-developer-at-oatly",
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (isFeedProbe(url)) return jsonResponse(null, { ok: false, status: 404 });
          return htmlResponse(SPA_SHELL_HTML);
        },
      },
    ).catch((error) => error);

    assert.ok(calls.some(isFeedProbe), "shell must trigger feed probes");
    // No feed + thin shell: the DOM lanes run and report thin content
    // instead of throwing an unexpected error shape.
    if (result instanceof Error) {
      assert.match(
        String(result.message),
        /thin|short|description|details|careers listing|job posting/i,
      );
    } else {
      assert.match(result.method, /dom/);
    }
  });
});
