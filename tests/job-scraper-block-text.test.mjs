import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

function htmlResponse(html, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  };
}

describe("DOM description extraction keeps block structure", () => {
  it("adjacent divs do not merge words", async () => {
    const html = `<!doctype html><html><head><title>Acme — Engineer</title></head><body><div class="job-description">
      <div>About Us</div><div>We are building rockets together with a team that ships production hardware every quarter.</div>
      <ul><li>Ship weekly and reliably always</li><li>Review PRs with care and speed</li></ul>
    </div></body></html>`;
    const out = await scrapeJobPosting("https://example.com/jobs/1", {
      fetchImpl: async () => htmlResponse(html),
    });
    assert.doesNotMatch(out.description, /About UsWe/);
    assert.match(out.description, /About Us\n\nWe are building rockets together/);
    assert.match(out.description, /- Ship weekly and reliably always/);
  });

  it("JSON-LD plain descriptions get entities decoded", async () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Engineer",
      description:
        "Own the roadmap &amp; the on-call rotation. Health &ndash; dental included. " +
        "More detail here. ".repeat(20),
    })}</script></head><body><p>shell</p></body></html>`;
    const out = await scrapeJobPosting("https://example.com/jobs/2", {
      fetchImpl: async () => htmlResponse(html),
    });
    assert.match(out.description, /roadmap & the on-call/);
    assert.match(out.description, /Health – dental/);
  });
});
