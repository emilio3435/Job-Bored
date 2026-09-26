import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

export const W2SQ_NOW = "2026-09-25T12:00:00.000Z";

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`w2sq: network blocked (${String(input)})`);
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

export function makeStoredConfig(overrides: Record<string, unknown> = {}) {
  return {
    sheetId: "sheet_probe",
    mode: "hosted",
    timezone: "UTC",
    companies: [{ name: "Acme" }, { name: "Initech" }],
    includeKeywords: ["node"],
    excludeKeywords: [],
    targetRoles: ["Backend Engineer"],
    locations: ["Remote"],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 10,
    enabledSources: ["greenhouse"],
    schedule: { enabled: false, cron: "" },
    sourcePreset: "ats_only",
    ...overrides,
  };
}

export function makeW2sqRequest(
  discoveryProfile: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_probe",
    variationKey: "v",
    requestedAt: W2SQ_NOW,
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node",
      ...discoveryProfile,
    },
    ...extra,
  };
}

export function makeW2sqDeps(overrides: Record<string, unknown> = {}) {
  const written: Array<Record<string, unknown>> = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const stored = makeStoredConfig(
    (overrides.storedConfig as Record<string, unknown>) || {},
  );
  let seq = 0;
  const dependencies: Record<string, unknown> = {
    runtimeConfig: {
      runMode: "hosted",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      ...((overrides.runtimeConfig as Record<string, unknown>) || {}),
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
      ...((overrides.sourceAdapterRegistry as Record<string, unknown>) || {}),
    },
    pipelineWriter: {
      write: async (sheetId: string, leads: Array<Record<string, unknown>>) => {
        written.push(...leads);
        return {
          sheetId,
          appended: leads.length,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        };
      },
    },
    loadStoredWorkerConfig: async () => stored,
    mergeDiscoveryConfig,
    now: () => new Date(W2SQ_NOW),
    randomId: (prefix: string) => `${prefix}_${++seq}`,
    log: (event: string, details: Record<string, unknown>) =>
      logs.push([event, details]),
    ...(overrides.deps || {}),
  };
  return { dependencies, written, logs, stored };
}

test("B7: ATS outcomes loop back into memory with a stable intent key", async () => {
  const { mkdtempSync: mkdtemp } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDiscoveryMemoryStore } = await import(
    "../../src/state/discovery-memory-store.ts"
  );
  const { createRunDiscoveryMemoryStore } = await import(
    "../../src/state/run-discovery-memory-store.ts"
  );
  const dir = mkdtemp(join(tmpdir(), "w2sq-b7-"));
  const raw = createDiscoveryMemoryStore(join(dir, "mem.sqlite"));
  const runStore = createRunDiscoveryMemoryStore(raw);
  // Minimal mirrors of the server.ts facades (same record shapes).
  const store = {
    ...runStore,
    upsertCompanyRecords: (records: Array<Record<string, unknown>>) => {
      for (const record of records) {
        raw.upsertCompany({
          companyKey: String(record.companyKey || ""),
          displayName: String(record.displayName || ""),
          normalizedName: String(record.normalizedName || ""),
          atsHints: JSON.parse(String(record.atsHintsJson || "{}")),
          lastSeenAt: String(record.lastSeenAt || ""),
          lastSuccessAt: String(record.lastSuccessAt || ""),
          successIncrement: Number(record.successCount || 0),
        });
      }
    },
    upsertCareerSurfaces: (records: Array<Record<string, unknown>>) => {
      for (const record of records) {
        raw.upsertCareerSurface({
          companyKey: String(record.companyKey || ""),
          surfaceType: String(record.surfaceType || ""),
          providerType: String(record.providerType || ""),
          canonicalUrl: String(record.canonicalUrl || ""),
          finalUrl: String(record.finalUrl || ""),
          boardToken: String(record.boardToken || ""),
          sourceLane: String(record.sourceLane || ""),
          verifiedStatus: String(record.verifiedStatus || ""),
          lastVerifiedAt: String(record.lastVerifiedAt || ""),
          lastSuccessAt: String(record.lastSuccessAt || ""),
        });
      }
    },
    recordIntentCoverage: (record: Record<string, unknown>) => {
      raw.writeIntentCoverage({
        intentKey: String(record.intentKey || ""),
        companyKey: String(record.companyKey || ""),
        runId: String(record.runId || ""),
        sourceLane: String(record.sourceLane || ""),
        surfacesSeen: Number(record.surfacesSeen || 0),
        listingsSeen: Number(record.listingsSeen || 0),
        listingsWritten: Number(record.listingsWritten || 0),
      });
    },
  };
  const snapshots: Array<{
    intentKey: string;
    companies: number;
    surfaces: number;
    coverage: number;
  }> = [];
  const wrappedStore = {
    ...store,
    loadSnapshot: (query: { run: unknown; intentKey: string }) => {
      const snapshot = store.loadSnapshot(query as never);
      snapshots.push({
        intentKey: query.intentKey,
        companies: snapshot.companies.length,
        surfaces: snapshot.careerSurfaces.length,
        coverage: snapshot.intentCoverage.length,
      });
      return snapshot;
    },
  };

  const runOnce = () =>
    runDiscovery(
      makeW2sqRequest({ sourcePreset: "ats_only" }),
      "manual",
      makeW2sqDeps({
        storedConfig: {
          companies: [{ name: "Acme" }, { name: "Globex" }],
          enabledSources: ["greenhouse"],
          sourcePreset: "ats_only",
        },
        sourceAdapterRegistry: {
          adapters: [],
          detectBoards: async ({ company }: { company: { name: string } }) => [
            {
              matched: true,
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
              canonicalUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
              boardToken: company.name.toLowerCase(),
              confidence: 1,
              warnings: [],
            },
          ],
          collectListings: async (
            _run: unknown,
            dets: Array<{ boardUrl: string }>,
          ) =>
            dets.map((d) => {
              const slug = String(d.boardUrl.split("/").pop());
              const company = slug === "acme" ? "Acme" : "Globex";
              return {
                sourceId: "greenhouse",
                sourceLabel: "Greenhouse",
                title: `Backend Engineer ${company}`,
                company,
                location: "Remote",
                url: `${d.boardUrl}/jobs/1`,
                descriptionText: "Build node typescript services. Remote.",
                tags: ["node"],
              };
            }),
        },
        deps: { discoveryMemoryStore: wrappedStore },
      }).dependencies as never,
    );

  await runOnce();
  await runOnce();

  assert.equal(snapshots.length, 2);
  assert.ok(
    !snapshots[0].intentKey.startsWith("run:"),
    `intent key must be stable, not run-scoped (got ${snapshots[0].intentKey})`,
  );
  assert.equal(
    snapshots[0].intentKey,
    snapshots[1].intentKey,
    "identical runs must share one intent key",
  );
  assert.ok(
    snapshots[1].companies >= 1,
    `run 2 must see run 1's companies (saw ${snapshots[1].companies})`,
  );
  assert.ok(
    snapshots[1].surfaces >= 1,
    `run 2 must see run 1's surfaces (saw ${snapshots[1].surfaces})`,
  );
  assert.ok(
    snapshots[1].coverage >= 1,
    `run 2 must see run 1's intent coverage (saw ${snapshots[1].coverage})`,
  );
  const outcomes = raw.listExploitOutcomes({});
  const greenhouseOutcomes = outcomes.filter((o) => o.sourceId === "greenhouse");
  assert.ok(
    greenhouseOutcomes.length >= 2,
    `one outcome row per company (saw ${greenhouseOutcomes.length})`,
  );
  const outcomeCompanies = new Set(greenhouseOutcomes.map((o) => o.companyKey));
  assert.ok(outcomeCompanies.has("acme"), "acme outcome row present");
  assert.ok(outcomeCompanies.has("globex"), "globex outcome row present");
  raw.close();
});

test("B8: an injected listing score cache serves the second run without an LLM call", async () => {
  const { openListingScoreCache } = await import(
    "../../src/state/listing-score-cache.ts"
  );
  const example = JSON.parse(
    readFileSync(
      new URL(
        "../../../../examples/discovery-webhook-request.v1-with-profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const cache = openListingScoreCache(":memory:");
  try {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"fitScore":9,"band":"Exceptional"}' }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const listing = {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Staff Backend Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://boards.greenhouse.io/acme/jobs/5000001",
      descriptionText: "Go Postgres",
      remoteBucket: "remote",
    };
    const runOnce = async () => {
      const { dependencies, written } = makeW2sqDeps({
        storedConfig: {
          companies: [{ name: "Acme" }],
          enabledSources: ["greenhouse"],
          sourcePreset: "ats_only",
        },
        runtimeConfig: {
          geminiApiKey: "probe-key",
          geminiModel: "gemini-2.5-flash",
          llmProvider: "gemini",
        },
        sourceAdapterRegistry: {
          adapters: [],
          detectBoards: async () => [
            {
              matched: true,
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              boardUrl: "https://boards.greenhouse.io/acme",
              confidence: 1,
              warnings: [],
            },
          ],
          collectListings: async () => [{ ...listing }],
        },
        deps: { listingScoreCache: cache },
      });
      const request = {
        ...example,
        sheetId: "sheet_probe",
        companyAllowlist: [],
        companyBlocklist: [],
        discoveryProfile: {
          ...example.discoveryProfile,
          sourcePreset: "ats_only",
        },
      };
      const result = await runDiscovery(request, "manual", dependencies as never);
      return { result, written };
    };

    const first = await runOnce();
    assert.equal(first.written.length, 1);
    assert.equal(first.written[0].fitScore, 9);
    assert.equal(fetchCalls, 1, "run 1 populates the cache via one LLM call");

    const second = await runOnce();
    assert.equal(second.written.length, 1);
    assert.equal(second.written[0].fitScore, 9);
    assert.equal(
      fetchCalls,
      1,
      "run 2 must be served from the injected cache without an LLM call",
    );
  } finally {
    cache.close();
  }
});

test("B9: the deterministic pre-filter runs before the AI matcher, not after", async () => {
  const example = JSON.parse(
    readFileSync(
      new URL(
        "../../../../examples/discovery-webhook-request.v1-with-profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let evaluateCalls = 0;
  const { dependencies, written } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async () => [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          // The example profile is remote_only: the deterministic
          // pre-filter rejects this onsite listing, so the AI matcher
          // must never be consulted for it.
          title: "Staff Backend Engineer",
          company: "Acme",
          location: "New York, NY",
          url: "https://boards.greenhouse.io/acme/jobs/5000002",
          descriptionText: "Go Postgres. Onsite in Manhattan.",
          remoteBucket: "onsite",
        },
      ],
    },
    deps: {
      matchClient: {
        evaluate: async ({ baseline }: { baseline: Record<string, unknown> }) => {
          evaluateCalls += 1;
          return { ...baseline, decision: "accept" };
        },
      },
    },
  });
  const request = {
    ...example,
    sheetId: "sheet_probe",
    companyAllowlist: [],
    companyBlocklist: [],
    discoveryProfile: {
      ...example.discoveryProfile,
      sourcePreset: "ats_only",
    },
  };
  const result = await runDiscovery(request, "manual", dependencies as never);
  assert.equal(written.length, 0);
  assert.equal(
    evaluateCalls,
    0,
    "the AI matcher must not run for pre-filter-rejected listings",
  );
  const summary = result.sourceSummary.find(
    (entry: { sourceId: string }) => entry.sourceId === "greenhouse",
  );
  assert.ok(summary, "greenhouse source summary present");
  assert.equal(
    summary.rejectionSummary?.rejectionReasons?.excluded_keyword,
    1,
    `pre-filter rejection must be recorded (summary=${JSON.stringify(summary.rejectionSummary)})`,
  );
});

test("C5: provider detectSurfaces/enumerateListings honor an aborted signal", async () => {
  const { greenhouseProvider } = await import(
    "../../src/browser/providers/greenhouse.ts"
  );
  const { buildDetectionHints } = await import(
    "../../src/browser/providers/shared.ts"
  );
  const controller = new AbortController();
  controller.abort();
  const company = { name: "Acme" };
  await assert.rejects(
    greenhouseProvider.detectSurfaces(
      company,
      buildDetectionHints(company, "greenhouse"),
      undefined,
      controller.signal,
    ),
    /abort/i,
  );
  const sessionManager = {
    run: async () => ({ url: "", text: "", metadata: {} }),
  };
  await assert.rejects(
    greenhouseProvider.enumerateListings(
      {
        matched: true,
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        providerType: "greenhouse",
        surfaceType: "provider_board",
        boardUrl: "https://boards.greenhouse.io/acme",
        canonicalUrl: "https://boards.greenhouse.io/acme",
        boardToken: "acme",
        confidence: 1,
        warnings: [],
        metadata: {},
      } as never,
      sessionManager as never,
      controller.signal,
    ),
    /abort/i,
  );
});

test("C5: the ATS lane hands an AbortSignal to adapter listJobs", async () => {
  const seen: unknown[] = [];
  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          listJobs: async (
            _ctx: { boardUrl: string },
            signal?: AbortSignal,
          ) => {
            seen.push(signal);
            return [];
          },
        },
      ],
      detectBoards: async () => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
      ],
    },
  });
  await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.ok(seen.length > 0, "listJobs must be called");
  for (const signal of seen) {
    assert.ok(
      signal instanceof AbortSignal,
      `listJobs must receive an AbortSignal (got ${typeof signal})`,
    );
  }
});

test("C5: a source timeout aborts the underlying adapter work", async () => {
  let observedAbort = false;
  let finishedWithoutAbort = false;
  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          listJobs: (ctx: { boardUrl: string }, signal?: AbortSignal) =>
            new Promise<never>((resolve, reject) => {
              const timer = setTimeout(() => {
                finishedWithoutAbort = true;
                resolve([]);
              }, 200);
              signal?.addEventListener(
                "abort",
                () => {
                  observedAbort = true;
                  clearTimeout(timer);
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true },
              );
            }),
        },
      ],
      detectBoards: async () => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
      ],
    },
    deps: { sourceTimeoutMs: 25, matcherTimeoutMs: 25 },
  });
  const t0 = Date.now();
  await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.ok(
    Date.now() - t0 < 5000,
    "the run must not wait out the 200ms adapter sleep",
  );
  assert.equal(
    observedAbort,
    true,
    "the adapter must observe the source-timeout abort",
  );
  assert.equal(
    finishedWithoutAbort,
    false,
    "the adapter sleep must be cancelled, not waited out",
  );
});

test("B4: a hung profile-LLM call cannot outlive the run cap", async () => {
  const example = JSON.parse(
    readFileSync(
      new URL(
        "../../../../examples/discovery-webhook-request.v1-with-profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let sawSignal = false;
  let calls = 0;
  globalThis.fetch = ((url: unknown, init?: { signal?: AbortSignal }) => {
    calls += 1;
    if (init?.signal) {
      sawSignal = true;
      // A hung provider that honors abort: settle only when signalled.
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    }
    return new Promise(() => {});
  }) as typeof fetch;

  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    runtimeConfig: {
      geminiApiKey: "probe-key",
      geminiModel: "gemini-2.5-flash",
      llmProvider: "gemini",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async () => [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Staff Backend Engineer",
          company: "Acme",
          location: "Remote",
          url: "https://boards.greenhouse.io/acme/jobs/5000001",
          descriptionText: "Go Postgres",
          remoteBucket: "remote",
        },
      ],
    },
    deps: { maxRunDurationMs: 1500 },
  });
  const request = {
    ...example,
    sheetId: "sheet_probe",
    companyAllowlist: [],
    companyBlocklist: [],
    discoveryProfile: {
      ...example.discoveryProfile,
      sourcePreset: "ats_only",
    },
  };
  const t0 = Date.now();
  const outcome = await Promise.race([
    runDiscovery(request, "manual", dependencies as never).then(
      (r) => `returned state=${r.lifecycle.state}`,
      (e: Error) => `threw ${e?.name}: ${e?.message}`,
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve("STILL RUNNING"), 20000),
    ),
  ]);
  assert.ok(calls > 0, "the hung LLM fetch must have been attempted");
  assert.ok(sawSignal, "the LLM fetch must receive an AbortSignal");
  assert.match(
    String(outcome),
    /^returned/,
    `run must return near its cap (after ${Date.now() - t0}ms: ${outcome})`,
  );
  assert.ok(
    Date.now() - t0 < 15000,
    `run must not wait out the hung call (took ${Date.now() - t0}ms)`,
  );
});

test("B12: grounded scouts are capped by maxScoutSurfaces and ordered by memory yield", async () => {
  const N = 73;
  const names = Array.from({ length: N }, (_, i) => `C${String(i).padStart(2, "0")}`);
  const searched: string[] = [];
  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: names.map((name) => ({ name })),
      maxLeadsPerRun: 50,
      enabledSources: ["grounded_web"],
      sourcePreset: "browser_only",
    },
    deps: {
      discoveryMemoryStore: {
        loadSnapshot: () => ({
          companies: [],
          careerSurfaces: [],
          // C72 (last in config order) has the best prior yield, so the
          // cap must skip a zero-yield company instead of C72.
          intentCoverage: [
            {
              companyKey: "c72",
              intentKey: "intent:seeded",
              surfacesSeen: 4,
              listingsSeen: 4,
              listingsWritten: 4,
            },
          ],
          roleFamilies: [],
        }),
      },
      groundedSearchClient: {
        search: async (company: { name: string }) => {
          searched.push(company.name);
          const slug = String(company.name).toLowerCase();
          return {
            searchQueries: ["q"],
            candidates: [
              {
                url: `https://${slug}.example/careers/backend`,
                title: `Backend Engineer at ${company.name}`,
                pageType: "job",
                reason: "direct",
                sourceDomain: `${slug}.example`,
              },
            ],
            warnings: [],
          };
        },
      },
      browserSessionManager: {
        run: async ({ url }: { url: string }) => ({ url, text: "{}", metadata: {} }),
      },
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ sourcePreset: "browser_only" }),
    "manual",
    dependencies as never,
  );
  assert.equal(
    searched.length,
    72,
    `scouts must stop at maxScoutSurfaces=72 (searched=${searched.length})`,
  );
  assert.ok(
    searched.includes("C72"),
    "the highest-yield company must survive the cap despite config order",
  );
  assert.ok(
    result.warnings.some((warning: string) => /maxScoutSurfaces|scout budget/i.test(warning)),
    `the cap must warn (warnings=${JSON.stringify(result.warnings)})`,
  );
});

test("B3: frontier-rejected scout companies spend no exploit Gemini calls or fetches", async () => {
  const N = 20;
  const names = Array.from({ length: N }, (_, i) => `Co${String(i).padStart(2, "0")}`);
  const geminiCalls: Array<{ url: string; body: string }> = [];
  const seenHosts = new Set<string>();
  const recordingFetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    try {
      seenHosts.add(new URL(url).hostname);
    } catch {
      seenHosts.add(url);
    }
    geminiCalls.push({ url, body: String((init as { body?: unknown } | undefined)?.body || "") });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  globalThis.fetch = recordingFetch;

  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: names.map((name) => ({ name })),
      maxLeadsPerRun: 50,
      enabledSources: ["grounded_web"],
      sourcePreset: "browser_only",
    },
    runtimeConfig: { geminiApiKey: "probe-key" },
    deps: {
      groundedSearchClient: {
        search: async (company: { name: string }) => {
          const slug = String(company.name).toLowerCase();
          return {
            searchQueries: ["q"],
            // Frontier-rejected companies keep their cached rawText: without
            // the B3 fix, prose recovery (Call 1.5) fires on it during exploit.
            rawText: `Visit https://${slug}.example/careers/backend for ${company.name} openings.`,
            candidates: [
              {
                url: `https://${slug}.example/careers/backend`,
                title: `Backend Engineer at ${company.name}`,
                pageType: "job",
                reason: "direct",
                sourceDomain: `${slug}.example`,
              },
            ],
            warnings: [],
          };
        },
      },
      browserSessionManager: {
        run: async ({ url }: { url: string }) => ({ url, text: "{}", metadata: {} }),
      },
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ sourcePreset: "browser_only" }),
    "manual",
    dependencies as never,
  );
  void result;

  const gemini = geminiCalls.filter(({ url }) => url.includes("generativelanguage"));
  assert.equal(
    gemini.length,
    18,
    `only the 18 selected companies may spend exploit Gemini calls (got ${gemini.length})`,
  );
  for (const rejected of ["co18", "co19", "Co18", "Co19"]) {
    assert.ok(
      !gemini.some(({ body }) => body.includes(rejected)),
      `rejected company ${rejected} must not appear in any exploit Gemini call`,
    );
  }
});

test("B2: the exploit budget does not silently drop already-extracted ATS leads", async () => {
  const N = 25;
  const names = Array.from({ length: N }, (_, i) => `Co${String(i).padStart(2, "0")}`);
  let scoutCalls = 0;
  const { dependencies, written, logs } = makeW2sqDeps({
    storedConfig: {
      companies: names.map((name) => ({ name })),
      maxLeadsPerRun: 50,
      enabledSources: ["greenhouse", "grounded_web"],
      sourcePreset: "browser_plus_ats",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async ({ company }: { company: { name: string } }) => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: `https://boards.greenhouse.io/${String(company.name).toLowerCase()}`,
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async (
        _run: unknown,
        dets: Array<{ boardUrl: string }>,
      ) =>
        dets.map((d) => {
          const slug = String(d.boardUrl.split("/").pop());
          const n = Number(slug.replace(/\D/g, "")) || 0;
          return {
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            title: `Senior Backend Engineer ${slug}`,
            company: slug,
            location: "Remote",
            url: `${d.boardUrl}/jobs/${4000000 + n}`,
            descriptionText: "Build node typescript services. Remote.",
            tags: ["node"],
          };
        }),
    },
    deps: {
      groundedSearchClient: {
        search: async (company: { name: string }) => {
          scoutCalls += 1;
          return {
            searchQueries: ["q"],
            candidates: [
              {
                url: `https://${String(company.name).toLowerCase()}.example/careers/backend-${scoutCalls}`,
                title: `Backend Engineer at ${company.name}`,
                pageType: "job",
                reason: "direct",
                sourceDomain: `${String(company.name).toLowerCase()}.example`,
              },
            ],
            warnings: [],
          };
        },
      },
      browserSessionManager: {
        run: async ({ url }: { url: string }) => ({ url, text: "{}", metadata: {} }),
      },
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ maxLeadsPerRun: "50" }),
    "manual",
    dependencies as never,
  );
  assert.equal(scoutCalls, N);
  assert.equal(result.run.config.maxLeadsPerRun, 50);
  assert.equal(
    written.length,
    N,
    `all ${N} accepted ATS leads must reach the write set (written=${written.length})`,
  );
  const suppressionWarnings = result.warnings.filter((warning: string) =>
    /exploit budget suppressed/i.test(warning),
  );
  assert.ok(
    suppressionWarnings.length > 0,
    `exploit-budget suppression of scout candidates must warn (warnings=${JSON.stringify(result.warnings)})`,
  );
  assert.ok(
    logs.some(([event]) => event === "discovery.run.exploit_selection_completed"),
    "selection telemetry must still be logged",
  );
});

test("C4: one throwing board keeps its sibling's listings and attributes the failure", async () => {
  const det = (boardUrl: string) => ({
    matched: true,
    sourceId: "greenhouse",
    sourceLabel: "greenhouse",
    boardUrl,
    confidence: 1,
    warnings: [],
  });
  const listing = (n: number, title = "Backend Engineer") => ({
    sourceId: "greenhouse",
    sourceLabel: "greenhouse",
    title,
    company: "Acme",
    location: "Remote",
    url: `https://boards.greenhouse.io/acme/jobs/${n}`,
    tags: [],
  });
  const throwing: Record<string, unknown> = {
    adapters: [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        listJobs: async (ctx: { boardUrl: string }) => {
          if (String(ctx.boardUrl).includes("acme-eu")) {
            throw new Error("board B exploded");
          }
          return [listing(1)];
        },
      },
    ],
    detectBoards: async () => [
      det("https://boards.greenhouse.io/acme"),
      det("https://boards.greenhouse.io/acme-eu"),
    ],
  };
  const { dependencies, written } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    sourceAdapterRegistry: throwing,
  });
  const result = await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.equal(
    written.length,
    1,
    `sibling listings must survive a throwing board (written=${written.length})`,
  );
  const attributed = result.warnings.filter(
    (warning: string) =>
      warning.includes("acme-eu") && warning.includes("board B exploded"),
  );
  assert.ok(
    attributed.length > 0,
    `the failure must be attributed to its board (warnings=${JSON.stringify(result.warnings)})`,
  );

  // Control: when neither board throws, both listings are written.
  const control = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          listJobs: async (ctx: { boardUrl: string }) =>
            String(ctx.boardUrl).includes("acme-eu")
              ? [listing(2, "Platform Engineer")]
              : [listing(1)],
        },
      ],
      detectBoards: async () => [
        det("https://boards.greenhouse.io/acme"),
        det("https://boards.greenhouse.io/acme-eu"),
      ],
    },
  });
  await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    control.dependencies as never,
  );
  assert.equal(control.written.length, 2);
});

test("C3: an ats_only run with only non-GH/Lever/Ashby sources still executes the ATS lane", async () => {
  for (const enabledSources of [
    ["workday", "smartrecruiters"],
    ["greenhouse", "workday"],
  ]) {
    let detectCalls = 0;
    const { dependencies } = makeW2sqDeps({
      storedConfig: {
        companies: [{ name: "Acme" }],
        enabledSources,
        sourcePreset: "ats_only",
      },
      sourceAdapterRegistry: {
        adapters: [],
        detectBoards: async () => {
          detectCalls += 1;
          return [];
        },
        collectListings: async () => [],
      },
    });
    const result = await runDiscovery(
      makeW2sqRequest({ sourcePreset: "ats_only" }),
      "manual",
      dependencies as never,
    );
    assert.ok(
      detectCalls > 0,
      `enabled=${JSON.stringify(enabledSources)} must execute ATS detection (calls=${detectCalls})`,
    );
    assert.ok(
      result.lifecycle.detectionCount >= 0,
      "run completes with ATS lanes active",
    );
  }
});

test("B11: per-run groundedWebEnabled:false spends no Gemini ATS host search", async () => {
  const counters = { search: 0, atsHosts: 0 };
  const { dependencies } = makeW2sqDeps({
    storedConfig: {
      companies: [],
      atsCompanies: [],
      enabledSources: ["greenhouse", "grounded_web"],
      sourcePreset: "browser_plus_ats",
    },
    deps: {
      groundedSearchClient: {
        search: async () => {
          counters.search += 1;
          return { searchQueries: [], candidates: [], warnings: [] };
        },
        searchAtsHosts: async () => {
          counters.atsHosts += 1;
          return { searchQueries: [], candidates: [], warnings: [] };
        },
      },
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ groundedWebEnabled: false }),
    "manual",
    dependencies as never,
  );
  assert.ok(
    !result.run.config.effectiveSources.includes("grounded_web"),
    "grounded_web must be excluded from effective sources",
  );
  assert.equal(counters.search, 0);
  assert.equal(
    counters.atsHosts,
    0,
    "the ATS host-search fallback must not fire when grounded web is opted out",
  );
});

test("B6: a zero-lead run with only informational warnings is empty, not partial", async () => {
  const logRows: Array<Record<string, unknown>> = [];
  const { dependencies } = makeW2sqDeps({
    deps: {
      discoveryRunsLogger: {
        append: async (_sheetId: string, row: Record<string, unknown>) => {
          logRows.push(row);
          return { ok: true };
        },
      },
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.equal(result.lifecycle.normalizedLeadCount, 0);
  assert.ok(
    result.warnings.length > 0,
    "the preset exclusion warning should be present",
  );
  assert.equal(
    result.lifecycle.state,
    "empty",
    `informational warnings must not force partial (warnings=${JSON.stringify(result.warnings)})`,
  );
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].status, "success");
});

test("B6: a zero-lead run with a real degradation stays partial", async () => {
  const { dependencies } = makeW2sqDeps({
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => {
        throw new Error("board B exploded");
      },
      collectListings: async () => [],
    },
  });
  const result = await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.equal(result.lifecycle.normalizedLeadCount, 0);
  assert.equal(result.lifecycle.state, "partial");
});

test("B13: a mixed companyAllowlist surfaces its unknown entries in run warnings", async () => {
  const { dependencies } = makeW2sqDeps();
  const result = await runDiscovery(
    makeW2sqRequest({}, { companyAllowlist: ["Acme", "Globexx"] }),
    "manual",
    dependencies as never,
  );
  assert.equal(result.run.config.allowlistResolution.mode, "restricted");
  const mentions = result.warnings.filter((warning: string) =>
    warning.includes("Globexx"),
  );
  assert.ok(
    mentions.length > 0,
    `run warnings must name the dropped entry (warnings=${JSON.stringify(result.warnings)})`,
  );
  assert.match(mentions[0], /Unknown companyAllowlist entries ignored/);
});

// ─── C15: runDiscovery-level proof for helper-tested claims ───────────────
// C15: tests named for fixed claims must exercise the production run path,
// not helpers runDiscovery never calls, on the production 1–10 fit scale.

test("C15/B1: a capped production run keeps the highest-fit leads, not the alphabetical head", async () => {
  const example = JSON.parse(
    readFileSync(
      new URL(
        "../../../../examples/discovery-webhook-request.v1-with-profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // 26 ATS leads: alphabetical order inverts fit (a-co fit 1 … z-co fit 10).
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const fitFor = (letter: string) =>
    Math.min(10, 1 + Math.round(((letter.charCodeAt(0) - 97) / 25) * 9));
  let scoreCalls = 0;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    scoreCalls += 1;
    const body = String((init?.body as string) || "");
    const letter = body.match(/Staff Backend Engineer ([a-z])-co/)?.[1] || "a";
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    fitScore: fitFor(letter),
                    band: "Exceptional",
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { dependencies, written } = makeW2sqDeps({
    storedConfig: {
      companies: letters.map((letter) => ({ name: `${letter}-co` })),
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
      maxLeadsPerRun: 5,
    },
    runtimeConfig: {
      geminiApiKey: "probe-key",
      geminiModel: "gemini-2.5-flash",
      llmProvider: "gemini",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async ({ company }: { company: { name: string } }) => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: `https://boards.greenhouse.io/${company.name}`,
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async (
        _run: unknown,
        dets: Array<{ boardUrl: string }>,
      ) =>
        // collectListings runs per board, so derive the job id from the
        // slug (not the per-call index): every board reuses small
        // per-tenant ids, and this test isolates fit-ordering from the
        // B10 tenant-scoped-dedupe behavior the C15/B10 test pins.
        dets.map((d) => {
          const slug = String(d.boardUrl.split("/").pop());
          const jobId = 5000000 + slug.charCodeAt(0);
          return {
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            title: `Staff Backend Engineer ${slug}`,
            company: slug,
            location: "Remote",
            url: `https://boards.greenhouse.io/${slug}/jobs/${jobId}`,
            canonicalUrl: `https://boards.greenhouse.io/${slug}/jobs/${jobId}`,
            descriptionText: "Go Postgres. Remote backend role.",
            remoteBucket: "remote",
          };
        }),
    },
    deps: {
      matchClient: {
        evaluate: async ({ baseline }: { baseline: Record<string, unknown> }) => ({
          ...baseline,
          decision: "accept",
        }),
      },
    },
  });
  const request = {
    ...example,
    sheetId: "sheet_probe",
    companyAllowlist: [],
    companyBlocklist: [],
    discoveryProfile: {
      ...example.discoveryProfile,
      sourcePreset: "ats_only",
    },
  };
  const result = await runDiscovery(request, "manual", dependencies as never);
  assert.equal(scoreCalls, 26, "every accepted lead is LLM-scored once");
  assert.equal(written.length, 5);
  const writtenCompanies = written.map((lead) => String(lead.company)).sort();
  assert.deepEqual(writtenCompanies, ["v-co", "w-co", "x-co", "y-co", "z-co"]);
  assert.ok(
    written.every((lead) => Number(lead.fitScore) >= 9),
    `written set must be the top-fit tail (fits=${written.map((lead) => `${lead.company}:${lead.fitScore}`).join(" ")})`,
  );
  assert.ok(
    result.warnings.some((warning: string) => /maxLeadsPerRun|cap/i.test(warning)) ||
      written.length === 5,
    "cap applied",
  );
});

test("C15/B10: same tenant job id from two employers writes both leads at run level", async () => {
  const { dependencies, written } = makeW2sqDeps({
    storedConfig: {
      companies: [{ name: "Acme" }, { name: "Globex" }],
      enabledSources: ["greenhouse"],
      sourcePreset: "ats_only",
      maxLeadsPerRun: 10,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/acme",
          confidence: 1,
          warnings: [],
        },
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: "https://boards.greenhouse.io/globex",
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async () => [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Backend Engineer",
          company: "Acme",
          location: "Remote",
          url: "https://boards.greenhouse.io/acme/jobs/1",
          canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
          descriptionText: "Build node typescript services. Remote.",
          remoteBucket: "remote",
          tags: ["node"],
        },
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Backend Engineer",
          company: "Globex",
          location: "Remote",
          url: "https://boards.greenhouse.io/globex/jobs/1",
          canonicalUrl: "https://boards.greenhouse.io/globex/jobs/1",
          descriptionText: "Build node typescript services. Remote.",
          remoteBucket: "remote",
          tags: ["node"],
        },
      ],
    },
    deps: {
      matchClient: {
        evaluate: async ({ baseline }: { baseline: Record<string, unknown> }) => ({
          ...baseline,
          decision: "accept",
        }),
      },
    },
  });
  await runDiscovery(
    makeW2sqRequest({ sourcePreset: "ats_only" }),
    "manual",
    dependencies as never,
  );
  assert.equal(
    written.length,
    2,
    `distinct employers must not dedupe-collapse (written=${JSON.stringify(written.map((lead) => lead.company))})`,
  );
  assert.deepEqual(
    written.map((lead) => String(lead.company)).sort(),
    ["Acme", "Globex"],
  );
});
