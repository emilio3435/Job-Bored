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

describe("JSON-LD posting facts", () => {
  it("surfaces posting dates and a nested annual salary range", async () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Platform Engineer",
      description: "Build reliable systems for Meridian Labs. ".repeat(20),
      datePosted: "2026-08-27T09:30:00-05:00",
      validThrough: "2026-09-30",
      baseSalary: {
        currency: "USD",
        value: { minValue: 185000, maxValue: 230000, unitText: "YEAR" },
      },
    })}</script></head><body><p>shell</p></body></html>`;

    const out = await scrapeJobPosting("https://example.com/jobs/posting-facts", {
      fetchImpl: async () => htmlResponse(html),
    });

    assert.equal(out.postedAt, "2026-08-27");
    assert.equal(out.closesAt, "2026-09-30");
    assert.equal(out.postingSalary, "$185,000–$230,000 USD/yr");
  });

  it("defaults missing closing date and salary to empty strings", async () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Product Designer",
      description: "Design thoughtful workflows for Meridian Labs. ".repeat(20),
      datePosted: "2026-08-29",
    })}</script></head><body><p>shell</p></body></html>`;

    const out = await scrapeJobPosting("https://example.com/jobs/date-only", {
      fetchImpl: async () => htmlResponse(html),
    });

    assert.equal(out.postedAt, "2026-08-29");
    assert.equal(out.closesAt, "");
    assert.equal(out.postingSalary, "");
  });

  it("formats a flat monthly EUR salary range", async () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Research Lead",
      description: "Lead practical research programs for Meridian Labs. ".repeat(20),
      baseSalary: {
        minValue: "8,500",
        maxValue: "10,250",
        currency: " EUR ",
        unitText: "\nMONTH\t",
      },
    })}</script></head><body><p>shell</p></body></html>`;

    const out = await scrapeJobPosting("https://example.com/jobs/monthly-salary", {
      fetchImpl: async () => htmlResponse(html),
    });

    assert.equal(out.postedAt, "");
    assert.equal(out.closesAt, "");
    assert.equal(out.postingSalary, "€8,500–€10,250 EUR/mo");
  });
});

describe("JSON-LD salary is never more precise than the posting", () => {
  const posting = (baseSalary, extra = {}) =>
    `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Staff Engineer",
      description: "Build reliable systems for Meridian Labs. ".repeat(20),
      baseSalary,
      ...extra,
    })}</script></head><body><p>shell</p></body></html>`;

  const salaryOf = async (baseSalary, extra) => {
    const out = await scrapeJobPosting("https://example.com/jobs/salary", {
      fetchImpl: async () => htmlResponse(posting(baseSalary, extra)),
    });
    return out.postingSalary;
  };

  it("prefixes a max-only figure with Up to", async () => {
    assert.equal(
      await salaryOf({ currency: "USD", value: { maxValue: 220000, unitText: "YEAR" } }),
      "Up to $220,000 USD/yr",
    );
  });

  it("prefixes a min-only figure with From", async () => {
    assert.equal(
      await salaryOf({ currency: "USD", value: { minValue: 180000, unitText: "YEAR" } }),
      "From $180,000 USD/yr",
    );
  });

  it("leaves an exact single value unprefixed", async () => {
    assert.equal(
      await salaryOf({ currency: "USD", value: { value: 195000, unitText: "YEAR" } }),
      "$195,000 USD/yr",
    );
  });

  it("reads the currency nested beside the amounts", async () => {
    assert.equal(
      await salaryOf({
        value: { minValue: 180000, maxValue: 220000, currency: "USD", unitText: "YEAR" },
      }),
      "$180,000–$220,000 USD/yr",
    );
  });

  it("falls back to the JobPosting-level salaryCurrency", async () => {
    assert.equal(
      await salaryOf(
        { value: { minValue: 180000, maxValue: 220000, unitText: "YEAR" } },
        { salaryCurrency: "GBP" },
      ),
      "£180,000–£220,000 GBP/yr",
    );
  });

  it("keeps the period for weekly and daily contract rates", async () => {
    assert.equal(
      await salaryOf({ currency: "USD", value: { value: 800, unitText: "DAY" } }),
      "$800 USD/day",
    );
    assert.equal(
      await salaryOf({ currency: "USD", value: { value: 4000, unitText: "WEEK" } }),
      "$4,000 USD/wk",
    );
  });

  it("spells out an unmapped unit rather than dropping it", async () => {
    assert.equal(
      await salaryOf({ currency: "USD", value: { value: 950, unitText: "SHIFT" } }),
      "$950 USD per shift",
    );
  });
});
