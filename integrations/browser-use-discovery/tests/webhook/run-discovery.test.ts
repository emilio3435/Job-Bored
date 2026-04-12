import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

function makeRequest() {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_123",
    variationKey: "var_123",
    requestedAt: "2026-04-09T12:00:00.000Z",
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node,typescript",
      maxLeadsPerRun: "2",
    },
  };
}

test("runDiscovery composes config, adapters, normalizer, and writer", async () => {
  const calls = {
    loadStoredWorkerConfig: 0,
    mergeDiscoveryConfig: 0,
    detectBoards: 0,
    listJobs: 0,
    write: 0,
  };
  const logs = [];

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 6,
      groundedSearchMaxPagesPerCompany: 4,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => {
            calls.listJobs += 1;
            return [
              {
                sourceId: "greenhouse",
                sourceLabel: "Greenhouse",
                title: "Senior Backend Engineer",
                company: "Acme",
                location: "Remote",
                url: "https://jobs.example.com/backend-engineer?utm_source=linkedin",
                compensationText: "$180k-$210k",
                contact: "",
                descriptionText:
                  "Build node services in TypeScript for a remote-first team.",
                tags: ["node", "typescript"],
                metadata: {
                  sourceQuery: "board",
                },
              },
            ];
          },
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, _effectiveSources) => {
        calls.detectBoards += 1;
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId, leads) => {
        calls.write += 1;
        assert.equal(sheetId, "sheet_123");
        assert.equal(leads.length, 1);
        assert.equal(
          leads[0].url,
          "https://jobs.example.com/backend-engineer",
        );
        return {
          sheetId,
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: ["writer warning"],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => {
      calls.loadStoredWorkerConfig += 1;
      assert.equal(sheetId, "sheet_123");
      return {
        sheetId: "stored_sheet_999",
        mode: "hosted",
        timezone: "UTC",
        companies: [{ name: "Acme" }],
        includeKeywords: ["TypeScript"],
        excludeKeywords: [],
        targetRoles: [],
        locations: [],
        remotePolicy: "remote-first",
        seniority: "senior",
        maxLeadsPerRun: 5,
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      };
    },
    mergeDiscoveryConfig: (stored, request) => {
      calls.mergeDiscoveryConfig += 1;
      return {
        ...stored,
        sheetId: request.sheetId,
        variationKey: request.variationKey,
        requestedAt: request.requestedAt,
        targetRoles: ["Backend Engineer"],
        includeKeywords: ["node", "typescript"],
        excludeKeywords: [],
        locations: ["Remote"],
        remotePolicy: "remote-first",
        seniority: "senior",
        maxLeadsPerRun: 2,
        sourcePreset: "ats_only",
        effectiveSources: ["greenhouse"],
      };
    },
    log: (event, details) => {
      logs.push({ event, details });
    },
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_abc123`,
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(calls.loadStoredWorkerConfig, 1);
  assert.equal(calls.mergeDiscoveryConfig, 1);
  assert.equal(calls.detectBoards, 1);
  assert.equal(calls.listJobs, 1);
  assert.equal(calls.write, 1);
  assert.equal(result.run.runId, "run_abc123");
  assert.equal(result.run.trigger, "manual");
  assert.equal(result.run.config.variationKey, "var_123");
  assert.equal(result.run.config.requestedAt, "2026-04-09T12:00:00.000Z");
  assert.equal(result.lifecycle.state, "partial");
  assert.equal(result.lifecycle.normalizedLeadCount, 1);
  assert.equal(result.writeResult.appended, 1);
  assert.match(result.warnings.join(" | "), /writer warning/);
  assert.deepEqual(
    logs.find((entry) => entry.event === "discovery.run.config_resolved")?.details,
    {
      runId: "run_abc123",
      trigger: "manual",
      requestedSheetId: "sheet_123",
      storedSheetId: "stored_sheet_999",
      resolvedSheetId: "sheet_123",
      variationKey: "var_123",
      companies: ["Acme"],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse"],
      maxLeadsPerRun: 2,
    },
  );
  assert.deepEqual(
    logs.find((entry) => entry.event === "discovery.run.write_completed")?.details,
    {
      runId: "run_abc123",
      sheetId: "sheet_123",
      appended: 1,
      updated: 0,
      skippedDuplicates: 0,
      warningCount: 1,
      sourceSummary: [
        {
          sourceId: "greenhouse",
          pagesVisited: 1,
          leadsSeen: 1,
          leadsAccepted: 1,
          leadsRejected: 0,
          warningCount: 0,
        },
      ],
    },
  );
});

test("runDiscovery logs aggregated rejection reasons without per-listing spam", async () => {
  const logs = [];
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 6,
      groundedSearchMaxPagesPerCompany: 4,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async (_companyContext, _effectiveSources) => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId, leads) => ({
        sheetId,
        appended: leads.length,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: ["node", "typescript"],
      excludeKeywords: ["wordpress"],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote-first",
      seniority: "",
      maxLeadsPerRun: 5,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse"],
    }),
    log: (event, details) => {
      logs.push({ event, details });
    },
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_rejections`,
  };

  dependencies.sourceAdapterRegistry.adapters[0].listJobs = async () => [
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Backend Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/backend-engineer",
      descriptionText: "Build node services in TypeScript for a remote-first team.",
      tags: ["node", "typescript"],
    },
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior WordPress Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/wordpress",
      descriptionText: "WordPress platform role",
    },
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Android Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/android-engineer",
      descriptionText:
        "Work with node and product-adjacent operations in the background.",
      tags: ["Engineering"],
    },
  ];

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(result.writeResult.appended, 1);
  assert.equal(result.lifecycle.normalizedLeadCount, 1);
  const writeCompleted = logs.find(
    (entry) => entry.event === "discovery.run.write_completed",
  )?.details;
  assert.ok(writeCompleted);
  assert.equal(writeCompleted.runId, "run_rejections");
  assert.equal(writeCompleted.sheetId, "sheet_123");
  assert.equal(writeCompleted.appended, 1);
  assert.equal(writeCompleted.warningCount, 0);
  assert.equal(writeCompleted.sourceSummary.length, 1);
  assert.equal(writeCompleted.sourceSummary[0].sourceId, "greenhouse");
  assert.equal(writeCompleted.sourceSummary[0].leadsSeen, 3);
  assert.equal(writeCompleted.sourceSummary[0].leadsAccepted, 1);
  assert.equal(writeCompleted.sourceSummary[0].leadsRejected, 2);
  assert.deepEqual(
    writeCompleted.sourceSummary[0].rejectionSummary.rejectionReasons,
    {
      excluded_keyword: 1,
      headline_mismatch: 1,
    },
  );
  assert.equal(
    writeCompleted.sourceSummary[0].rejectionSummary.rejectionSamples[0].reason,
    "excluded_keyword",
  );
  assert.match(
    writeCompleted.sourceSummary[0].rejectionSummary.rejectionSamples[0].detail,
    /wordpress/i,
  );
  assert.equal(
    writeCompleted.sourceSummary[0].rejectionSummary.rejectionSamples[1].reason,
    "headline_mismatch",
  );
  assert.match(
    writeCompleted.sourceSummary[0].rejectionSummary.rejectionSamples[1].detail,
    /Android Engineer|Structured match/i,
  );
});

test("runDiscovery ranks and diversifies leads before truncating", async () => {
  const writtenLeads = [];
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 6,
      groundedSearchMaxPagesPerCompany: 4,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, _effectiveSources) => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId, leads) => {
        writtenLeads.push(...leads);
        return {
          sheetId,
          appended: leads.length,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => ({
      sheetId,
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Scale AI" }, { name: "Stripe" }],
      includeKeywords: ["marketing"],
      excludeKeywords: [],
      targetRoles: [],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 2,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_ranked`,
  };

  dependencies.sourceAdapterRegistry.adapters[0].listJobs = async (boardContext) => {
    if (boardContext.company.name === "Scale AI") {
      return [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Lifecycle Marketing Manager",
          company: "Scale AI",
          location: "Remote",
          url: "https://jobs.example.com/scale-lifecycle-marketing-manager",
          descriptionText: "Own lifecycle marketing programs.",
          tags: ["Marketing"],
        },
      ];
    }
    return [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Partner Marketing Lead",
        company: "Stripe",
        location: "Remote",
        url: "https://jobs.example.com/stripe-partner-marketing-lead",
        descriptionText: "Lead partner marketing.",
        tags: ["Marketing"],
      },
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Product Marketing Manager",
        company: "Stripe",
        location: "Remote",
        url: "https://jobs.example.com/stripe-product-marketing-manager",
        descriptionText: "Lead product marketing.",
        tags: ["Marketing"],
      },
    ];
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(result.lifecycle.normalizedLeadCount, 2);
  assert.equal(writtenLeads.length, 2);
  assert.deepEqual(
    writtenLeads.map((lead) => lead.company).sort(),
    ["Scale AI", "Stripe"],
  );
});

test("runDiscovery applies company, source, and similar-title caps before writing", async () => {
  const writtenLeads = [];
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 6,
      groundedSearchMaxPagesPerCompany: 4,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
        {
          sourceId: "ashby",
          sourceLabel: "Ashby",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, _effectiveSources) => {
        if (company.name === "Notion") {
          return [
            {
              matched: true,
              sourceId: "ashby",
              sourceLabel: "Ashby",
              boardUrl: "https://jobs.ashbyhq.com/notion",
              confidence: 1,
              warnings: [],
            },
          ];
        }
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase().replace(/\s+/g, "")}`,
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId, leads) => {
        writtenLeads.push(...leads);
        return {
          sheetId,
          appended: leads.length,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => ({
      sheetId,
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Scale AI" }, { name: "Stripe" }, { name: "Notion" }],
      includeKeywords: ["marketing", "product", "operations", "community"],
      excludeKeywords: [],
      targetRoles: [],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      enabledSources: ["greenhouse", "ashby"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse", "ashby"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_capped`,
  };

  const greenhouseAdapter = dependencies.sourceAdapterRegistry.adapters.find(
    (adapter) => adapter.sourceId === "greenhouse",
  );
  const ashbyAdapter = dependencies.sourceAdapterRegistry.adapters.find(
    (adapter) => adapter.sourceId === "ashby",
  );

  greenhouseAdapter.listJobs = async (boardContext) => {
    if (boardContext.company.name === "Scale AI") {
      return [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Growth Marketing Manager",
          company: "Scale AI",
          location: "Remote in United States",
          url: "https://jobs.example.com/scale-growth-marketing-manager",
          descriptionText: "Own growth programs.",
          tags: ["Marketing"],
        },
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "AI Product Manager",
          company: "Scale AI",
          location: "Remote in United States",
          url: "https://jobs.example.com/scale-ai-product-manager",
          descriptionText: "Lead AI product work.",
          tags: ["Product"],
        },
      ];
    }
    return [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Product Marketing Manager",
        company: "Stripe",
        location: "Remote in United States",
        url: "https://jobs.example.com/stripe-product-marketing-manager",
        descriptionText: "Lead product marketing.",
        tags: ["Marketing"],
      },
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Product Marketing Manager, Billing",
        company: "Stripe",
        location: "Remote in United States",
        url: "https://jobs.example.com/stripe-product-marketing-manager-billing",
        descriptionText: "Lead product marketing for billing.",
        tags: ["Marketing"],
      },
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Product Marketing Manager, Payments",
        company: "Stripe",
        location: "Remote in United States",
        url: "https://jobs.example.com/stripe-product-marketing-manager-payments",
        descriptionText: "Lead product marketing for payments.",
        tags: ["Marketing"],
      },
    ];
  };

  ashbyAdapter.listJobs = async () => [
    {
      sourceId: "ashby",
      sourceLabel: "Ashby",
      title: "Community Lead",
      company: "Notion",
      location: "Remote in United States",
      url: "https://jobs.example.com/notion-community-lead",
      descriptionText: "Lead community programs.",
      tags: ["Community"],
    },
    {
      sourceId: "ashby",
      sourceLabel: "Ashby",
      title: "Product Operations Manager",
      company: "Notion",
      location: "Remote in United States",
      url: "https://jobs.example.com/notion-product-operations-manager",
      descriptionText: "Lead product operations.",
      tags: ["Operations"],
    },
  ];

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(result.lifecycle.normalizedLeadCount, 5);
  assert.equal(writtenLeads.length, 5);
  assert.equal(
    writtenLeads.filter((lead) => lead.company === "Stripe").length,
    1,
  );
  assert.equal(
    writtenLeads.filter((lead) => lead.sourceId === "greenhouse").length,
    3,
  );
  assert.deepEqual(
    writtenLeads
      .map((lead) => `${lead.company}:${lead.title}`)
      .sort(),
    [
      "Notion:Community Lead",
      "Notion:Product Operations Manager",
      "Scale AI:AI Product Manager",
      "Scale AI:Growth Marketing Manager",
      "Stripe:Product Marketing Manager",
    ],
  );
});

test("runDiscovery expands grounded web links through Browser Use and writes normalized leads", async () => {
  const writtenLeads = [];
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "browser-use",
      geminiApiKey: "placeholder-api-value-abc123",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async (_companyContext, _effectiveSources) => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.notion.so/careers",
            title: "Notion careers",
            pageType: "careers",
            reason: "Direct careers page",
            sourceDomain: "www.notion.so",
          },
        ],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Product Marketing Manager",
              company: "Notion",
              location: "Remote in United States",
              url: "https://www.notion.so/careers/product-marketing-manager",
              descriptionText:
                "Lead product marketing and messaging for remote-first launches.",
              compensationText: "$170k-$210k",
              tags: ["marketing", "product"],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async (sheetId, leads) => {
        writtenLeads.push(...leads);
        return {
          sheetId,
          appended: leads.length,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => ({
      sheetId,
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Notion" }],
      includeKeywords: ["marketing"],
      excludeKeywords: [],
      targetRoles: ["Product Marketing Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_grounded`,
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(result.lifecycle.state, "completed");
  assert.equal(result.lifecycle.normalizedLeadCount, 1);
  assert.equal(result.lifecycle.listingCount, 1);
  assert.equal(writtenLeads.length, 1);
  assert.equal(writtenLeads[0].sourceId, "grounded_web");
  assert.equal(writtenLeads[0].sourceLabel, "Grounded Search");
  assert.match(writtenLeads[0].metadata.sourceQuery, /Notion product marketing manager/);
  assert.deepEqual(
    result.extractionResults.map((entry) => entry.sourceId),
    ["grounded_web"],
  );
});

test("runDiscovery marks grounded source readiness problems as partial outcomes with explicit warnings", async () => {
  let writeCalls = 0;
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: true,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async (_companyContext, _effectiveSources) => [],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async () => {
        writeCalls += 1;
        return {
          sheetId: "sheet_123",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async (sheetId) => ({
      sheetId,
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Notion" }],
      includeKeywords: ["marketing"],
      excludeKeywords: [],
      targetRoles: ["Product Marketing Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_grounded_warning`,
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.equal(writeCalls, 0);
  assert.equal(result.lifecycle.state, "partial");
  assert.equal(result.lifecycle.normalizedLeadCount, 0);
  assert.equal(result.sourceSummary.length, 1);
  assert.equal(result.sourceSummary[0].sourceId, "grounded_web");
  assert.match(
    result.sourceSummary[0].warnings.join(" | "),
    /GEMINI_API_KEY is not configured/i,
  );
  assert.match(
    result.warnings.join(" | "),
    /Grounded web source is enabled/i,
  );
});

test("runDiscovery captures write error with update phase and returns partial status (VAL-DATA-003, VAL-DATA-005)", async () => {
  let writeCalls = 0;
  let writeLog: Record<string, unknown> | null = null;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "browser-use",
      geminiApiKey: "test-key",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: ["http://localhost:8080"],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    browserSessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Senior Backend Engineer",
              company: "Acme Corp",
              location: "Remote - US",
              url: "https://acme.com/careers/backend-engineer",
              descriptionText: "We are looking for a senior backend engineer",
              compensationText: "$150k - $200k",
              tags: ["backend"],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Backend Engineer at Acme Corp"],
        candidates: [
          {
            url: "https://acme.com/careers",
            title: "Acme Corp careers",
            pageType: "careers",
            reason: "Direct careers page",
            sourceDomain: "acme.com",
          },
        ],
        warnings: [],
      }),
    },
    matchClient: undefined,
    pipelineWriter: {
      async write(
        sheetId: string,
        leads: any[],
      ): Promise<any> {
        writeCalls++;
        // Simulate a write error during update phase
        const { SheetWriteError } = await import(
          "../../src/sheets/pipeline-writer.ts"
        );
        throw new SheetWriteError({
          phase: "update",
          message: "Sheet write failed during update phase: HTTP 500",
          sheetId,
          httpStatus: 500,
          detail: "Internal server error",
        });
      },
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "stored_sheet",
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      enabledSources: [],
      maxLeadsPerRun: 0,
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: any, request: any) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      companies: request.companies || [],
    }),
    log: (event: string, details: Record<string, unknown>) => {
      // Capture log for verification
      if (event === "discovery.run.write_failed") {
        writeLog = details;
      }
    },
    runId: "test_run_write_error",
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix: string) => `${prefix}_write_error`,
  };

  const makeRequest = () => ({
    variationKey: "write_error_test",
    requestedAt: new Date("2026-04-09T12:00:00.000Z").toISOString(),
    sheetId: "test_sheet_write_error",
    companies: [{ name: "Acme Corp" }],
    enabledSources: ["grounded_web"],
    discoveryProfile: {
      sourcePreset: "browser_only",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme Corp" }],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      schedule: { enabled: false, cron: "" },
    },
  });

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // Verify write was attempted
  assert.equal(writeCalls, 1, "pipelineWriter.write should be called once");

  // Verify the lifecycle state is "partial" due to write error warning
  assert.equal(result.lifecycle.state, "partial", "Lifecycle should be partial due to write error");

  // Verify the writeResult contains the error info
  assert.ok(result.writeResult, "writeResult should exist");
  assert.ok(result.writeResult.writeError, "writeError should be present in writeResult");
  assert.equal(result.writeResult.writeError.phase, "update", "Error phase should be 'update'");
  assert.equal(result.writeResult.writeError.httpStatus, 500, "HTTP status should be 500");
  assert.match(result.writeResult.writeError.message, /update phase/);

  // Verify a warning was added about the write failure
  assert.ok(
    result.warnings.some((w) => w.includes("update phase")),
    "Warning about write failure should be present",
  );

  // Verify the log event was captured
  assert.ok(writeLog, "Write failure should be logged");
  assert.equal(writeLog.phase, "update", "Log should include phase");
  assert.equal(writeLog.httpStatus, 500, "Log should include HTTP status");
});

test("runDiscovery captures write error with append phase and returns partial status (VAL-DATA-003, VAL-DATA-005)", async () => {
  let writeCalls = 0;
  let writeLog: Record<string, unknown> | null = null;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "browser-use",
      geminiApiKey: "test-key",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: ["http://localhost:8080"],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    browserSessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Frontend Developer",
              company: "WebCo",
              location: "Remote - US",
              url: "https://webco.com/careers/frontend-dev",
              descriptionText: "We need a frontend developer",
              compensationText: "$120k - $160k",
              tags: ["frontend"],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Frontend Engineer at WebCo"],
        candidates: [
          {
            url: "https://webco.com/careers",
            title: "WebCo careers",
            pageType: "careers",
            reason: "Direct careers page",
            sourceDomain: "webco.com",
          },
        ],
        warnings: [],
      }),
    },
    matchClient: undefined,
    pipelineWriter: {
      async write(
        sheetId: string,
        leads: any[],
      ): Promise<any> {
        writeCalls++;
        // Simulate a write error during append phase
        const { SheetWriteError } = await import(
          "../../src/sheets/pipeline-writer.ts"
        );
        throw new SheetWriteError({
          phase: "append",
          message: "Sheet write failed during append phase: HTTP 403",
          sheetId,
          httpStatus: 403,
          detail: "Permission denied",
        });
      },
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "stored_sheet",
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      enabledSources: [],
      maxLeadsPerRun: 0,
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: any, request: any) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      companies: request.companies || [],
    }),
    log: (event: string, details: Record<string, unknown>) => {
      if (event === "discovery.run.write_failed") {
        writeLog = details;
      }
    },
    runId: "test_run_append_error",
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix: string) => `${prefix}_append_error`,
  };

  const makeRequest = () => ({
    variationKey: "append_error_test",
    requestedAt: new Date("2026-04-09T12:00:00.000Z").toISOString(),
    sheetId: "test_sheet_append_error",
    companies: [{ name: "WebCo" }],
    enabledSources: ["grounded_web"],
    discoveryProfile: {
      sourcePreset: "browser_only",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "WebCo" }],
      includeKeywords: ["frontend"],
      excludeKeywords: [],
      targetRoles: ["Frontend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      schedule: { enabled: false, cron: "" },
    },
  });

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // Verify write was attempted
  assert.equal(writeCalls, 1, "pipelineWriter.write should be called once");

  // Verify the lifecycle state is "partial" due to write error warning
  assert.equal(result.lifecycle.state, "partial", "Lifecycle should be partial due to write error");

  // Verify the writeResult contains the error info
  assert.ok(result.writeResult, "writeResult should exist");
  assert.ok(result.writeResult.writeError, "writeError should be present in writeResult");
  assert.equal(result.writeResult.writeError.phase, "append", "Error phase should be 'append'");
  assert.equal(result.writeResult.writeError.httpStatus, 403, "HTTP status should be 403");
  assert.match(result.writeResult.writeError.message, /append phase/);

  // Verify a warning was added about the write failure
  assert.ok(
    result.warnings.some((w) => w.includes("append phase")),
    "Warning about write failure should be present",
  );

  // Verify the log event was captured
  assert.ok(writeLog, "Write failure should be logged");
  assert.equal(writeLog.phase, "append", "Log should include phase");
  assert.equal(writeLog.httpStatus, 403, "Log should include HTTP status");
});

test("runDiscovery write error provides actionable details in writeError (VAL-DATA-003)", async () => {
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "browser-use",
      geminiApiKey: "test-key",
      geminiModel: "gemini-2.5-flash",
      groundedSearchMaxResultsPerCompany: 5,
      groundedSearchMaxPagesPerCompany: 2,
      googleServiceAccountJson: "",
      googleServiceAccountFile: "",
      googleAccessToken: "",
      googleOAuthTokenJson: "",
      googleOAuthTokenFile: "",
      webhookSecret: "",
      allowedOrigins: ["http://localhost:8080"],
      port: 0,
      host: "127.0.0.1",
      runMode: "hosted",
      asyncAckByDefault: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    browserSessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Senior DevOps Engineer",
              company: "CloudCo",
              location: "Remote - US",
              url: "https://cloudco.com/careers/devops",
              descriptionText: "Looking for senior DevOps",
              compensationText: "$160k - $210k",
              tags: ["devops"],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["DevOps Engineer at CloudCo"],
        candidates: [
          {
            url: "https://cloudco.com/careers",
            title: "CloudCo careers",
            pageType: "careers",
            reason: "Direct careers page",
            sourceDomain: "cloudco.com",
          },
        ],
        warnings: [],
      }),
    },
    matchClient: undefined,
    pipelineWriter: {
      async write(
        sheetId: string,
        leads: any[],
      ): Promise<any> {
        const { SheetWriteError } = await import(
          "../../src/sheets/pipeline-writer.ts"
        );
        throw new SheetWriteError({
          phase: "update",
          message: "Quota exceeded for spreadsheet",
          sheetId,
          httpStatus: 429,
          detail: "User has exceeded write quota",
        });
      },
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "stored_sheet",
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      enabledSources: [],
      maxLeadsPerRun: 0,
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: any, request: any) => ({
      ...stored,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      companies: request.companies || [],
    }),
    log: () => {},
    runId: "test_actionable_error",
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix: string) => `${prefix}_actionable`,
  };

  const makeRequest = () => ({
    variationKey: "actionable_error_test",
    requestedAt: new Date("2026-04-09T12:00:00.000Z").toISOString(),
    sheetId: "test_sheet_actionable",
    companies: [{ name: "CloudCo" }],
    enabledSources: ["grounded_web"],
    discoveryProfile: {
      sourcePreset: "browser_only",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "CloudCo" }],
      includeKeywords: ["devops"],
      excludeKeywords: [],
      targetRoles: ["DevOps Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 5,
      schedule: { enabled: false, cron: "" },
    },
  });

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // Verify writeError contains actionable details
  assert.ok(result.writeResult.writeError, "writeError should be present");
  assert.equal(result.writeResult.writeError.phase, "update", "Phase attribution present");
  assert.equal(result.writeResult.writeError.httpStatus, 429, "HTTP status provides context");
  assert.ok(result.writeResult.writeError.detail, "Detail field provides actionable info");
  assert.match(
    result.warnings[0],
    /Sheet write failed.*update.*Quota exceeded/i,
    "Warning message should be actionable",
  );
});
