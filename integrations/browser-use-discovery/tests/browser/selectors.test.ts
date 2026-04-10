import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAshbyJobsUrl,
  buildGreenhouseBoardInfoUrl,
  buildLeverJobsUrl,
  compactCompanyTokens,
  extractTokenFromBoardHint,
  looksLikeCompensation,
  sanitizeCompensationText,
  slugifyCompanyName,
  stripHtml,
  toPlainText,
} from "../../src/browser/selectors/index.ts";

test("selector helpers normalize company tokens and board URLs", () => {
  assert.equal(slugifyCompanyName("Acme, Inc."), "acme-inc");
  assert.deepEqual(compactCompanyTokens("Acme, Inc.").sort(), [
    "acme",
    "acme-inc",
    "acmeinc",
  ]);
  assert.equal(extractTokenFromBoardHint("https://jobs.lever.co/acme"), "acme");
  assert.equal(
    buildGreenhouseBoardInfoUrl("acme"),
    "https://boards-api.greenhouse.io/v1/boards/acme",
  );
  assert.equal(
    buildLeverJobsUrl("acme"),
    "https://api.lever.co/v0/postings/acme?mode=json",
  );
  assert.equal(
    buildAshbyJobsUrl("acme"),
    "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
  );
});

test("stripHtml removes tags and decodes all HTML entities", () => {
  assert.equal(
    stripHtml("<h2><strong>About</strong></h2><p>Role details.</p>"),
    "About Role details.",
  );
  assert.equal(
    stripHtml("&lt;h2&gt;&lt;strong&gt;About&lt;/strong&gt;&lt;/h2&gt;"),
    "About",
  );
  assert.equal(
    stripHtml("<script>alert('xss')</script>Safe text"),
    "Safe text",
  );
  assert.equal(stripHtml("<style>.x{color:red}</style>Visible"), "Visible");
  assert.equal(
    stripHtml("&amp; &quot;quoted&quot; &#39;apos&#39;"),
    "& \"quoted\" 'apos'",
  );
  assert.equal(stripHtml("&#60;b&#62;bold&#60;/b&#62;"), "bold");
  assert.equal(stripHtml("&#x3c;em&#x3e;italic&#x3c;/em&#x3e;"), "italic");
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml("plain text no html"), "plain text no html");
});

test("toPlainText normalizes whitespace after stripping HTML", () => {
  assert.equal(toPlainText("  <p>  Spaced   out  </p>  "), "Spaced out");
  assert.equal(
    toPlainText("&lt;div&gt;entity tags&lt;/div&gt;"),
    "entity tags",
  );
});

test("looksLikeCompensation matches valid compensation formats", () => {
  assert.ok(looksLikeCompensation("$150,000 - $200,000"));
  assert.ok(looksLikeCompensation("150k-200k"));
  assert.ok(looksLikeCompensation("€120k"));
  assert.ok(looksLikeCompensation("£80,000 - £100,000"));
  assert.ok(looksLikeCompensation("¥15,000,000"));
  assert.ok(looksLikeCompensation("₹25,00,000"));
  assert.ok(looksLikeCompensation("₩80,000,000"));
  assert.ok(looksLikeCompensation("CHF 120k"));
  assert.ok(looksLikeCompensation("AUD 150,000 - 200,000"));
  assert.ok(looksLikeCompensation("OTE $300k"));
  assert.ok(looksLikeCompensation("Base salary: competitive"));
  assert.ok(looksLikeCompensation("Compensation: $180k"));
  assert.ok(looksLikeCompensation("$50/hour"));
  assert.ok(looksLikeCompensation("$120k per year"));
  assert.ok(looksLikeCompensation("equity grant vesting over 4 years"));
});

test("looksLikeCompensation rejects non-compensation text", () => {
  assert.ok(!looksLikeCompensation("Build services in Node.js"));
  assert.ok(!looksLikeCompensation("About the role"));
  assert.ok(!looksLikeCompensation("DOE"));
  assert.ok(!looksLikeCompensation("Competitive"));
  assert.ok(!looksLikeCompensation(""));
});

test("sanitizeCompensationText strips HTML and rejects non-comp content", () => {
  assert.equal(sanitizeCompensationText("$180k-$220k"), "$180k-$220k");
  assert.equal(
    sanitizeCompensationText("<p>$150,000 - $200,000 USD</p>"),
    "$150,000 - $200,000 USD",
  );
  assert.equal(
    sanitizeCompensationText(
      "&lt;h2&gt;About the role&lt;/h2&gt;&lt;p&gt;Lead marketing.&lt;/p&gt;",
    ),
    "",
  );
  assert.equal(sanitizeCompensationText("Build services"), "");
  assert.equal(sanitizeCompensationText("$" + "1".repeat(200)), "");
  assert.equal(sanitizeCompensationText(""), "");
});
