import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  deriveCompanyDomain,
  normalizeLead,
  normalizeLeadWithDiagnostics,
  normalizeLeadUrl,
} from "../../src/normalize/lead-normalizer.ts";

function makeRun(overrides = {}) {
  return {
    runId: "run_test_1",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme", includeKeywords: ["TypeScript"] }],
      includeKeywords: ["Node", "browser automation"],
      excludeKeywords: ["wordpress"],
      targetRoles: ["Platform Engineer", "Backend Engineer"],
      locations: ["Remote", "Austin"],
      remotePolicy: "remote-first",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
      ...overrides,
    },
  };
}

test("normalizeLeadUrl removes tracking params and trailing slashes", () => {
  assert.equal(
    normalizeLeadUrl(
      "https://jobs.example.com/backend-engineer/?utm_source=linkedin&jobId=123#section",
    ),
    "https://jobs.example.com/backend-engineer?jobId=123",
  );
});

test("normalizeLead returns a scored normalized lead with stable defaults", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Platform Engineer",
      company: "Acme",
      location: "Austin, TX Remote-first",
      url: "https://jobs.example.com/backend-engineer/?utm_source=linkedin&jobId=123",
      compensationText: "$180k-$210k",
      contact: "Ada Lovelace",
      descriptionText:
        "Build browser automation systems in Node and TypeScript for a senior backend platform team.",
      tags: ["automation"],
      metadata: {
        sourceQuery: "Acme platform engineer",
      },
    },
    run,
  );

  assert.ok(lead);
  assert.equal(
    lead?.url,
    "https://jobs.example.com/backend-engineer?jobId=123",
  );
  assert.equal(lead?.status, "New");
  assert.equal(lead?.metadata.runId, "run_test_1");
  assert.equal(lead?.metadata.variationKey, "var_123");
  assert.equal(lead?.metadata.sourceQuery, "Acme platform engineer");
  assert.ok((lead?.fitScore || 0) >= 8);
  assert.ok(["⚡", "🔥"].includes(lead?.priority || ""));
  assert.ok(lead?.tags.includes("automation"));
  assert.ok(lead?.tags.includes("Platform Engineer"));
  assert.match(lead?.fitAssessment || "", /Role match/i);
  assert.match(lead?.logoUrl || "", /google\.com\/s2\/favicons/);
});

test("normalizeLead filters out excluded-keyword matches", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "lever",
      sourceLabel: "Lever",
      title: "Senior WordPress Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/wordpress",
      descriptionText: "WordPress platform role",
    },
    run,
  );

  assert.equal(lead, null);
});

test("normalizeLeadWithDiagnostics explains excluded-keyword rejections", () => {
  const run = makeRun();
  const result = normalizeLeadWithDiagnostics(
    {
      sourceId: "lever",
      sourceLabel: "Lever",
      title: "Senior WordPress Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/wordpress",
      descriptionText: "WordPress platform role",
    },
    run,
  );

  assert.equal(result.lead, null);
  assert.equal(result.rejection?.reason, "excluded_keyword");
  assert.match(result.rejection?.detail || "", /wordpress/i);
});

test("normalizeLead rejects jobs that only match generic keywords in the description", () => {
  const run = makeRun({
    companies: [{ name: "Stripe" }],
    includeKeywords: ["AI", "product", "operations"],
    targetRoles: ["Growth Marketing", "Product Manager"],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "",
  });
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Android Engineer",
      company: "Stripe",
      location: "Remote in United States",
      url: "https://jobs.example.com/android-engineer",
      descriptionText:
        "Work with product and AI-adjacent platform operations across teams.",
      tags: ["Engineering"],
    },
    run,
  );

  assert.equal(lead, null);
});

test("normalizeLead does not treat single-letter keywords as arbitrary substring matches", () => {
  const run = makeRun({
    companies: [{ name: "Acme" }],
    includeKeywords: ["R"],
    targetRoles: [],
    locations: ["Remote"],
    remotePolicy: "",
    seniority: "",
  });
  const result = normalizeLeadWithDiagnostics(
    {
      sourceId: "grounded_web",
      sourceLabel: "Grounded Web",
      title: "Customer Success Manager",
      company: "Acme",
      location: "Remote in United States",
      url: "https://jobs.example.com/customer-success-manager",
      descriptionText: "Support customers and resolve issues.",
      tags: ["Customer Success"],
    },
    run,
  );

  assert.equal(result.lead, null);
  assert.equal(result.rejection?.reason, "headline_mismatch");
});

test("normalizeLeadWithDiagnostics explains headline-only mismatch rejections", () => {
  const run = makeRun({
    companies: [{ name: "Stripe" }],
    includeKeywords: ["AI", "product", "operations"],
    targetRoles: ["Growth Marketing", "Product Manager"],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "",
  });
  const result = normalizeLeadWithDiagnostics(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Android Engineer",
      company: "Stripe",
      location: "Remote in United States",
      url: "https://jobs.example.com/android-engineer",
      descriptionText:
        "Work with product and AI-adjacent platform operations across teams.",
      tags: ["Engineering"],
    },
    run,
  );

  assert.equal(result.lead, null);
  assert.equal(result.rejection?.reason, "headline_mismatch");
  assert.match(result.rejection?.detail || "", /title\/company\/location\/tags/i);
  assert.match(result.rejection?.detail || "", /Growth Marketing/i);
});

test("normalizeLeadWithDiagnostics rejects roles whose structured location misses the configured markets", () => {
  const result = normalizeLeadWithDiagnostics(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Product Manager of AI Applications",
      company: "Scale AI",
      location: "Riyadh, Saudi Arabia",
      url: "https://jobs.example.com/scale-ai-applications",
      descriptionText:
        "Support public sector stakeholders across the United States.",
      tags: ["AI", "Product"],
    },
    makeRun({
      companies: [{ name: "Scale AI" }],
      includeKeywords: ["AI", "product"],
      targetRoles: ["Product Manager"],
      locations: ["United States", "Remote"],
      remotePolicy: "",
      seniority: "",
    }),
  );

  assert.equal(result.lead, null);
  assert.equal(result.rejection?.reason, "location_mismatch");
  assert.match(result.rejection?.detail || "", /Riyadh, Saudi Arabia/);
});

test("normalizeLeadWithDiagnostics rejects roles that do not satisfy remotePolicy in the location field", () => {
  const result = normalizeLeadWithDiagnostics(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Growth Marketing Manager",
      company: "Stripe",
      location: "Chicago, IL",
      url: "https://jobs.example.com/stripe-growth-marketing-manager",
      descriptionText: "Join a remote-first team working across growth programs.",
      tags: ["Marketing"],
    },
    makeRun({
      companies: [{ name: "Stripe" }],
      includeKeywords: ["growth", "marketing"],
      targetRoles: ["Growth Marketing"],
      locations: ["Chicago", "Remote"],
      remotePolicy: "remote",
      seniority: "",
    }),
  );

  assert.equal(result.lead, null);
  assert.equal(result.rejection?.reason, "remote_policy_mismatch");
  assert.match(result.rejection?.detail || "", /remotePolicy="remote"/);
});

test("normalizeLead uses the matching company keyword set instead of the first company", () => {
  const run = makeRun({
    companies: [
      { name: "Scale AI", includeKeywords: ["automation"] },
      { name: "Stripe", includeKeywords: ["marketing"] },
    ],
    includeKeywords: [],
    targetRoles: [],
    remotePolicy: "",
    seniority: "",
    locations: [],
  });
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Partner Marketing Lead",
      company: "Stripe",
      location: "Remote",
      url: "https://jobs.example.com/partner-marketing-lead",
      descriptionText: "Lead partnerships and campaigns.",
    },
    run,
  );

  assert.ok(lead);
  assert.ok(lead?.tags.includes("marketing"));
});

test("deriveCompanyDomain extracts company slug from ATS board URLs", () => {
  assert.equal(
    deriveCompanyDomain(
      "https://boards.greenhouse.io/stripe/jobs/1234",
      "Stripe",
    ),
    "stripe.com",
  );
  assert.equal(
    deriveCompanyDomain("https://jobs.lever.co/openai/abc-123", "OpenAI"),
    "openai.com",
  );
  assert.equal(
    deriveCompanyDomain("https://jobs.ashbyhq.com/notion/xyz", "Notion"),
    "notion.com",
  );
});

test("deriveCompanyDomain uses host directly for non-ATS, non-aggregator URLs", () => {
  assert.equal(
    deriveCompanyDomain("https://careers.google.com/jobs/123", "Google"),
    "careers.google.com",
  );
});

test("deriveCompanyDomain skips aggregator hosts and uses company name", () => {
  assert.equal(
    deriveCompanyDomain(
      "https://www.builtincolorado.com/job/marketing-ops/123",
      "Scale AI",
    ),
    "scale.com",
  );
  assert.equal(
    deriveCompanyDomain("https://www.indeed.com/viewjob?jk=abc", "Checkmarx"),
    "checkmarx.com",
  );
});

test("deriveCompanyDomain strips corporate suffixes from company name", () => {
  assert.equal(deriveCompanyDomain("", "MariaDB Corporation"), "mariadb.com");
  assert.equal(deriveCompanyDomain("", "Acme Inc."), "acme.com");
  assert.equal(deriveCompanyDomain("", ""), "");
});

test("normalizeLead strips HTML from compensationText", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Platform Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/eng-1",
      compensationText:
        "&lt;h2&gt;&lt;strong&gt;About the role&lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;Lead product marketing.&lt;/p&gt;",
      descriptionText: "Build browser automation in Node and TypeScript.",
      tags: ["automation"],
    },
    run,
  );

  assert.ok(lead);
  assert.equal(lead?.compensationText, "");
});

test("normalizeLead strips HTML from title, company, location, and contact", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior <em>Platform</em> Engineer",
      company: "Acme &amp; Co",
      location: "Austin, TX &mdash; Remote",
      url: "https://jobs.example.com/eng-2",
      contact: "<b>Ada</b> Lovelace",
      compensationText: "$180k-$210k",
      descriptionText: "Build browser automation in Node and TypeScript.",
      tags: ["automation"],
    },
    run,
  );

  assert.ok(lead);
  assert.ok(!(lead?.title || "").includes("<"));
  assert.ok(!(lead?.company || "").includes("&amp;"));
  assert.ok(!(lead?.contact || "").includes("<"));
  assert.equal(lead?.compensationText, "$180k-$210k");
});

test("normalizeLead strips HTML from fitAssessment fallback", () => {
  const run = makeRun({
    includeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
  });
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Marketing Lead",
      company: "Stripe",
      location: "Remote",
      url: "https://jobs.example.com/mktg-1",
      descriptionText:
        "<p>Build <strong>campaigns</strong> across channels.</p> We need a creative leader.",
    },
    run,
  );

  assert.ok(lead);
  assert.ok(!(lead?.fitAssessment || "").includes("<"));
  assert.ok((lead?.fitAssessment || "").includes("campaigns"));
});
