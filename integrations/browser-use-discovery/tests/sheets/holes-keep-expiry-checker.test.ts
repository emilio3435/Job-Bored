// HOLES KEEP R14: a closed phrase somewhere on a live posting must not expire
// it, and a Link that now redirects away from the posting is never "open".
import assert from "node:assert/strict";
import test from "node:test";

import {
  checkJobPostingUrl,
  classifyJobPostingAvailability,
  describeAvailabilityReason,
} from "../../src/cleanup/expired-job-cleanup.ts";

const LIVE_POSTING_WITH_STRAY_CLOSED_PHRASE = `
  <h1>Senior Platform Engineer</h1>
  <script type="application/ld+json">{"@type": "JobPosting", "title": "Senior Platform Engineer"}</script>
  <p>We are hiring a platform engineer to own our build tooling.</p>
  <button>Apply for this job</button>
  <aside><h2>Similar roles</h2><p>Staff Engineer — position filled</p></aside>`;

test("R14: a closed phrase beside live apply signals goes to review, not Expired", () => {
  const result = classifyJobPostingAvailability({
    url: "https://boards.greenhouse.io/acme/jobs/4012345",
    httpStatus: 200,
    body: LIVE_POSTING_WITH_STRAY_CLOSED_PHRASE,
    finalUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.source, "ambiguous");
});

test("R14: a closed page with no apply signal still expires", () => {
  const result = classifyJobPostingAvailability({
    url: "https://jobs.lever.co/acme/2b6f0c1e-1111-4222-8333-944455556666",
    httpStatus: 200,
    body: "<h1>Sorry, this job posting has expired</h1>",
    finalUrl: "https://jobs.lever.co/acme/2b6f0c1e-1111-4222-8333-944455556666",
  });
  assert.equal(result.status, "expired");
  assert.equal(result.source, "html_marker");
});

test("R14: a Link that redirects to the careers index is not certified open", () => {
  const result = classifyJobPostingAvailability({
    url: "https://careers.example.com/jobs/88231-senior-analyst",
    httpStatus: 200,
    body: "<h1>Open roles</h1><a>Apply now</a><a>Apply now</a>",
    finalUrl: "https://careers.example.com/jobs",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.source, "redirect");
  assert.match(result.evidence, /careers\.example\.com\/jobs/);
});

test("R14: Greenhouse's closed-job redirect (board root with error=true) expires the row", () => {
  const result = classifyJobPostingAvailability({
    url: "https://boards.greenhouse.io/acme/jobs/4012345",
    httpStatus: 200,
    body: "<h1>Current openings at Acme</h1><a>Apply now</a>",
    finalUrl: "https://boards.greenhouse.io/acme?error=true",
  });
  assert.equal(result.status, "expired");
  assert.equal(result.source, "redirect");
  assert.equal(result.confidence, "high");
});

test("R14: a redirect away that lands on a closed notice expires the row", () => {
  const result = classifyJobPostingAvailability({
    url: "https://careers.example.com/jobs/88231-senior-analyst",
    httpStatus: 200,
    body: "<p>The job you are looking for is no longer open.</p><a>Apply now</a>",
    finalUrl: "https://careers.example.com/jobs",
  });
  assert.equal(result.status, "expired");
  assert.equal(result.source, "redirect");
});

test("R14: redirects that keep the posting (https, tracking, host move) stay open", () => {
  for (const [url, finalUrl] of [
    ["http://jobs.example.com/jobs/88231", "https://jobs.example.com/jobs/88231"],
    ["https://www.linkedin.com/jobs/view/3901234567", "https://www.linkedin.com/jobs/view/3901234567/?trk=public"],
    ["https://boards.greenhouse.io/acme/jobs/4012345", "https://job-boards.greenhouse.io/acme/jobs/4012345"],
    ["https://acme.com/careers?gh_jid=4012345", "https://acme.com/careers/apply?gh_jid=4012345&src=x"],
  ]) {
    const result = classifyJobPostingAvailability({
      url,
      httpStatus: 200,
      body: "<button>Apply now</button>",
      finalUrl,
    });
    assert.equal(result.status, "open", `${url} -> ${finalUrl}`);
  }
});

test("R14: checkJobPostingUrl follows the redirect and reports where the Link went", async () => {
  const result = await checkJobPostingUrl("https://careers.example.com/jobs/88231-senior-analyst", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/jobs/88231-senior-analyst")) {
        return new Response(null, { status: 302, headers: { location: "/jobs" } });
      }
      return new Response("<h1>Open roles</h1><a>Apply now</a>", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.source, "redirect");
  assert.equal(result.finalUrl, "https://careers.example.com/jobs");
});

test("R14: the redirect reason reads plainly in the Sheet note", () => {
  const review = describeAvailabilityReason({
    status: "unknown",
    reason: "",
    evidence: "",
    confidence: "none",
    source: "redirect",
    finalUrl: "https://careers.example.com/jobs",
  });
  assert.match(review, /redirects/);
  const expired = describeAvailabilityReason({
    status: "expired",
    reason: "",
    evidence: "",
    confidence: "high",
    source: "redirect",
    finalUrl: "https://boards.greenhouse.io/acme?error=true",
  });
  assert.match(expired, /redirects/);
  assert.notEqual(review, expired);
});
