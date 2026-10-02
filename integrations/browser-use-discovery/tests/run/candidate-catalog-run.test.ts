// DISCAT C1: a run catalogs every unique listing it sees with its fate, and
// the next run fills unused write slots from fresh backlog.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { selectBacklogPromotions } from "../../src/run/candidate-catalog.ts";
import { normalizeLeadUrl } from "../../src/normalize/lead-normalizer.ts";
import { SheetWriteError } from "../../src/sheets/pipeline-writer.ts";
import { isRunCancelledError, RunCancelledError } from "../../src/run/run-abort.ts";
import { createDiscoveryMemoryStore } from "../../src/state/discovery-memory-store.ts";
import { createRunDiscoveryMemoryStore } from "../../src/state/run-discovery-memory-store.ts";

const NOW = "2026-09-25T12:00:00.000Z";

// Hermetic: never score against the developer's ~/.jobbored/profile.json.
const originalProfilePath = process.env.JOBBORED_PROFILE_PATH;
const NO_PROFILE_PATH = join(tmpdir(), "discat-no-profile", "absent.json");
process.env.JOBBORED_PROFILE_PATH = NO_PROFILE_PATH;
test.after(() => {
  if (originalProfilePath === undefined) delete process.env.JOBBORED_PROFILE_PATH;
  else process.env.JOBBORED_PROFILE_PATH = originalProfilePath;
});

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`discat: network blocked (${String(input)})`);
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

type Listing = {
  company: string;
  title: string;
  url: string;
  descriptionText?: string;
};

const COMPANIES = ["Acme", "Globex", "Initech", "Hooli", "Umbrella"];

function listing(company: string, title: string, id: string, description?: string): Listing {
  return {
    company,
    title,
    url: `https://boards.greenhouse.io/${company.toLowerCase()}/jobs/${id}`,
    descriptionText:
      description ||
      `Build node typescript services for AI marketing and adtech sales at ${company}. Remote.`,
  };
}

type WriteFn = (
  sheetId: string,
  leads: Array<Record<string, unknown>>,
) => Promise<Record<string, unknown>>;

function makeRun(options: {
  listings: Listing[];
  store: unknown;
  maxLeadsPerRun?: number;
  excludeKeywords?: string[];
  write?: WriteFn;
  /** Extra webhook request fields (e.g. mergedUserProfile). */
  request?: Record<string, unknown>;
  /** Overrides for the stored worker config. */
  storedConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  /** Called after the boards are listed, before the listings are scored. */
  onCollected?: () => void;
}) {
  const written: Array<Record<string, unknown>> = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  let seq = 0;
  const dependencies = {
    runtimeConfig: {
      runMode: "hosted",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
      ...(options.runtimeConfig || {}),
    },
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
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
      collectListings: async (_run: unknown, dets: Array<{ boardUrl: string }>) =>
        dets.flatMap((d) => {
          const slug = String(d.boardUrl.split("/").pop());
          options.onCollected?.();
          return options.listings
            .filter((entry) => entry.company.toLowerCase() === slug)
            .map((entry) => ({
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              location: "Remote",
              // With the AI/adtech description this scores fit 6.2, above
              // the backlog promotion floor.
              compensationText: "$180k-$220k",
              tags: ["node"],
              ...entry,
            }));
        }),
    },
    pipelineWriter: {
      write: async (sheetId: string, leads: Array<Record<string, unknown>>) => {
        written.push(...leads);
        if (options.write) return options.write(sheetId, leads);
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
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_catalog",
      mode: "hosted",
      timezone: "UTC",
      companies: COMPANIES.map((name) => ({ name })),
      includeKeywords: ["node"],
      excludeKeywords: options.excludeKeywords ?? ["php"],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: options.maxLeadsPerRun ?? 2,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      sourcePreset: "ats_only",
      ...(options.storedConfig || {}),
    }),
    mergeDiscoveryConfig,
    now: () => new Date(NOW),
    randomId: (prefix: string) => `${prefix}_${++seq}`,
    log: (event: string, details: Record<string, unknown>) =>
      logs.push([event, details]),
    discoveryMemoryStore: options.store,
  };
  const request = {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_catalog",
    variationKey: "v",
    requestedAt: NOW,
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node",
      sourcePreset: "ats_only",
    },
    ...(options.request || {}),
  };
  return {
    run: () => runDiscovery(request as never, "manual", dependencies as never),
    written,
    logs,
  };
}

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "discat-run-"));
  const raw = createDiscoveryMemoryStore(join(dir, "worker-state.sqlite"));
  return {
    raw,
    store: createRunDiscoveryMemoryStore(raw),
    close: () => {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const QUALIFIED = [
  listing("Acme", "Backend Engineer", "1"),
  listing("Globex", "Senior Backend Engineer", "2"),
  listing("Initech", "Backend Engineer II", "3"),
  listing("Hooli", "Staff Backend Engineer", "4"),
  listing("Umbrella", "Backend Engineer, Platform", "5"),
];
const REJECTED = [
  listing("Acme", "PHP Backend Engineer", "90", "Build php services. Remote."),
  listing("Globex", "Senior PHP Developer", "91", "Maintain php monolith. Remote."),
];
// Same job as Acme #1 under a second URL: collapsed by semantic dedupe.
// HOLES R8: the copy carries no Greenhouse job id (the employer's own page);
// a second Greenhouse id would be a second opening and is kept.
const DUPLICATE = {
  ...listing("Acme", "Backend Engineer", "1"),
  url: "https://careers.acme.example/backend-engineer",
};

test("should catalog rejected, duplicate, capped and written leads with their statuses", async () => {
  const { raw, store, close } = openStore();
  try {
    const harness = makeRun({
      listings: [...QUALIFIED, ...REJECTED, DUPLICATE],
      store,
    });
    await harness.run();
    assert.equal(harness.written.length, 2, "cap of 2 applies");

    const catalog = raw.listCandidates({ limit: 100 });
    const byStatus = (status: string) =>
      catalog.rows.filter((row) => row.status === status);
    assert.equal(byStatus("written").length, 2, JSON.stringify(catalog.counts));
    assert.equal(byStatus("backlog").length, 3, JSON.stringify(catalog.counts));
    const rejectReasons = byStatus("rejected").map((row) => row.rejectReason).sort();
    assert.ok(rejectReasons.includes("excluded_keyword"), rejectReasons.join(","));
    assert.equal(byStatus("rejected").length, 2, rejectReasons.join(","));
    assert.equal(byStatus("duplicate").length, 1, JSON.stringify(catalog.counts));
    for (const row of byStatus("backlog")) {
      assert.ok(row.leadPayload, "backlog rows carry the lead payload");
      assert.equal(row.sheetId, "sheet_catalog");
      assert.equal(row.lastRunId.length > 0, true);
    }
    // 8 catalog rows; listing_fingerprints folds the semantic duplicate into
    // its kept twin, so 7 fingerprint rows.
    assert.ok(
      raw.getCounts().listingFingerprints >= 7,
      `listing_fingerprints populated (saw ${raw.getCounts().listingFingerprints})`,
    );
  } finally {
    close();
  }
});

test("should promote fresh backlog into unused write slots on the following run", async () => {
  const { raw, store, close } = openStore();
  try {
    await makeRun({ listings: [...QUALIFIED, ...REJECTED], store }).run();
    const backlogBefore = raw.listCandidates({ status: "backlog", limit: 100 }).rows;
    assert.equal(backlogBefore.length, 3);

    // Run 2 sees only rejected listings, so both write slots are free.
    const second = makeRun({ listings: REJECTED, store });
    await second.run();
    assert.equal(second.written.length, 2, "two backlog leads fill the free slots");
    const promotedLog = second.logs.find(
      ([event]) => event === "discovery.run.backlog_promoted",
    );
    assert.ok(promotedLog, "backlog_promoted is logged");
    assert.equal(promotedLog[1].count, 2);

    const promoted = raw.listCandidates({ status: "promoted", limit: 100 }).rows;
    assert.equal(promoted.length, 2);
    const writtenUrls = second.written.map((lead) => String(lead.url)).sort();
    assert.deepEqual(promoted.map((row) => row.url).sort(), writtenUrls);
    assert.equal(raw.listCandidates({ status: "backlog", limit: 100 }).rows.length, 1);
  } finally {
    close();
  }
});

test("should finish the run and log catalog_failed when the catalog throws", async () => {
  const { store, close } = openStore();
  try {
    const broken = {
      ...store,
      recordCandidateCatalog: () => {
        throw new Error("disk full");
      },
      listBacklogCandidates: () => {
        throw new Error("disk full");
      },
    };
    const harness = makeRun({ listings: [...QUALIFIED, ...REJECTED], store: broken });
    const result = await harness.run();
    assert.ok(result, "run resolves");
    assert.equal(harness.written.length, 2, "leads are still written");
    const failures = harness.logs.filter(
      ([event]) => event === "discovery.run.catalog_failed",
    );
    assert.ok(failures.length >= 1, "catalog_failed is logged");
    assert.match(String(failures[0][1].error), /disk full/);
  } finally {
    close();
  }
});

// --- DISCAT C1 fix-pass: the catalog follows what the Sheet actually holds.

function linkOf(lead: Record<string, unknown>): string {
  return normalizeLeadUrl(String(lead.url || ""));
}

/** A writer stub that reports per-lead fate by company. */
function writerByCompany(
  fates: Record<string, "written" | "blacklisted" | "duplicate" | "identity_collision" | "lost">,
): WriteFn {
  return async (sheetId, leads) => {
    const writtenLinks: string[] = [];
    const skippedLinks: Array<{ url: string; reason: string }> = [];
    for (const lead of leads) {
      const fate = fates[String(lead.company)] || "written";
      if (fate === "written") writtenLinks.push(linkOf(lead));
      else if (fate !== "lost") skippedLinks.push({ url: linkOf(lead), reason: fate });
    }
    return {
      sheetId,
      appended: writtenLinks.length,
      updated: 0,
      skippedDuplicates: skippedLinks.filter((s) => s.reason !== "blacklisted").length,
      skippedBlacklist: skippedLinks.filter((s) => s.reason === "blacklisted").length,
      warnings: [],
      writtenLinks,
      skippedLinks,
    };
  };
}

test("should mark only leads the sheet appended or updated as written", async () => {
  const { raw, store, close } = openStore();
  try {
    await makeRun({
      listings: QUALIFIED,
      store,
      maxLeadsPerRun: 5,
      write: writerByCompany({
        Globex: "blacklisted",
        Initech: "identity_collision",
        Hooli: "lost",
      }),
    }).run();
    const rows = raw.listCandidates({ limit: 100 }).rows;
    const statusOf = (company: string) =>
      rows.find((row) => row.companyKey === company.toLowerCase());
    assert.equal(statusOf("Acme")?.status, "written");
    assert.equal(statusOf("Umbrella")?.status, "written");
    assert.equal(statusOf("Globex")?.status, "rejected");
    assert.equal(statusOf("Globex")?.rejectReason, "sheet_blacklisted");
    assert.equal(statusOf("Initech")?.status, "duplicate");
    // Neither written nor skipped: stays backlog so a later run retries it.
    assert.equal(statusOf("Hooli")?.status, "backlog");
    assert.ok(statusOf("Hooli")?.leadPayload, "the unwritten lead keeps its payload");
  } finally {
    close();
  }
});

test("should mark a promoted backlog lead promoted only when the sheet wrote it", async () => {
  const { raw, store, close } = openStore();
  try {
    await makeRun({ listings: [...QUALIFIED, ...REJECTED], store }).run();
    const backlog = raw.listCandidates({ status: "backlog", limit: 100 }).rows;
    assert.equal(backlog.length, 3);

    const second = makeRun({
      listings: REJECTED,
      store,
      write: async (sheetId, leads) => {
        const [first, ...rest] = leads;
        return writerByCompany({ [String(first.company)]: "blacklisted" })(sheetId, [
          first,
          ...rest,
        ]);
      },
    });
    await second.run();
    assert.equal(second.written.length, 2, "two backlog leads were offered to the sheet");
    const blocked = String(second.written[0].company).toLowerCase();

    const rows = raw.listCandidates({ limit: 100 }).rows;
    const promoted = rows.filter((row) => row.status === "promoted");
    assert.equal(promoted.length, 1, JSON.stringify(rows.map((r) => [r.companyKey, r.status])));
    const blockedRow = rows.find(
      (row) => row.companyKey === blocked && row.rejectReason === "sheet_blacklisted",
    );
    assert.ok(blockedRow, "the blacklisted promotion is rejected with sheet_blacklisted");
    assert.equal(blockedRow.status, "rejected");
    assert.equal(raw.listCandidates({ status: "backlog", limit: 100 }).rows.length, 1);
  } finally {
    close();
  }
});

test("should keep every selected lead in backlog when the sheet write fails without per-lead fate", async () => {
  const { raw, store, close } = openStore();
  try {
    await makeRun({
      listings: QUALIFIED,
      store,
      maxLeadsPerRun: 5,
      write: async () => {
        throw new SheetWriteError({
          phase: "append",
          message: "HTTP 500",
          sheetId: "sheet_catalog",
          httpStatus: 500,
        });
      },
    }).run();
    const counts = raw.listCandidates({ limit: 100 }).counts;
    assert.equal(counts.written || 0, 0, JSON.stringify(counts));
    assert.equal(counts.backlog, 5, JSON.stringify(counts));
  } finally {
    close();
  }
});

test("should not promote backlog saved under a different intent", async () => {
  const { raw, store, close } = openStore();
  try {
    await makeRun({ listings: [...QUALIFIED, ...REJECTED], store }).run();
    assert.equal(raw.listCandidates({ status: "backlog", limit: 100 }).rows.length, 3);

    // The user added an exclude keyword: the intent changed.
    const second = makeRun({
      listings: REJECTED,
      store,
      excludeKeywords: ["php", "golang"],
    });
    await second.run();
    assert.equal(second.written.length, 0, "stale backlog is not written under new filters");
    assert.equal(
      second.logs.some(([event]) => event === "discovery.run.backlog_promoted"),
      false,
    );
  } finally {
    close();
  }
});

test("should skip a backlog lead whose title matches a current exclude keyword", async () => {
  const lead = (title: string, id: string) => ({
    title,
    company: "Acme",
    url: `https://boards.greenhouse.io/acme/jobs/${id}`,
    sourceId: "greenhouse",
    metadata: {},
  });
  const queries: Array<Record<string, unknown>> = [];
  const store = {
    listBacklogCandidates: async (query: Record<string, unknown>) => {
      queries.push(query);
      return [
        { fingerprintKey: "k1", leadPayload: lead("Senior PHP Engineer", "1") },
        { fingerprintKey: "k2", leadPayload: lead("Backend Engineer", "2") },
      ];
    },
  };
  const promotion = await selectBacklogPromotions({
    store: store as never,
    runId: "run_x",
    sheetId: "sheet_catalog",
    intentKey: "intent:current",
    now: NOW,
    slots: 2,
    excludeFingerprintKeys: [],
    excludeKeywordsFor: () => ["php"],
  });
  assert.deepEqual(promotion.fingerprintKeys, ["k2"]);
  assert.equal(queries[0].intentKey, "intent:current");
});

// --- DISCAT Fix-A (C1) -----------------------------------------------------

function backlogLead(
  title: string,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    title,
    company: "Acme",
    location: "Remote",
    url: `https://boards.greenhouse.io/acme/jobs/${id}`,
    sourceId: "greenhouse",
    compensationText: "",
    fitScore: null,
    matchScore: null,
    priority: "—",
    tags: [],
    metadata: { remoteBucket: "remote" },
    ...overrides,
  };
}

test("should rank backlog promotions with the fresh-selection comparator and skip low fit", async () => {
  const rows = [
    { fingerprintKey: "hw", leadPayload: backlogLead("Hardware Engineer", "1", { fitScore: 1, matchScore: 9, priority: "↓" }) },
    { fingerprintKey: "unk", leadPayload: backlogLead("Unscored Role", "2", { matchScore: 10 }) },
    { fingerprintKey: "sales", leadPayload: backlogLead("Digital Sales Director", "3", { fitScore: 9, matchScore: 6, priority: "🔥" }) },
    { fingerprintKey: "mid", leadPayload: backlogLead("Head of Digital Strategy", "4", { fitScore: 6, matchScore: 1 }) },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const promotion = await selectBacklogPromotions({
    store: {
      listBacklogCandidates: async (query: Record<string, unknown>) => {
        queries.push(query);
        return rows;
      },
    } as never,
    runId: "run_x",
    sheetId: "sheet_catalog",
    intentKey: "intent:current",
    now: NOW,
    slots: 3,
    excludeFingerprintKeys: [],
  });
  assert.deepEqual(promotion.fingerprintKeys, ["sales", "mid", "unk"]);
  assert.equal(queries[0].minFitScore, 5, "the fit floor is applied in the query too");
});

test("should revalidate backlog against the current profile prefilter and the dead-link cache", async () => {
  const rows = [
    { fingerprintKey: "skip", leadPayload: backlogLead("Director of Sales Engineering", "1", { fitScore: 8 }) },
    { fingerprintKey: "onsite", leadPayload: backlogLead("Director of AI Solutions", "2", { fitScore: 8, location: "Austin, TX", metadata: { remoteBucket: "onsite" } }) },
    { fingerprintKey: "lowpay", leadPayload: backlogLead("Director of Digital Sales", "3", { fitScore: 8, compensationText: "$90k" }) },
    { fingerprintKey: "dead", leadPayload: backlogLead("Head of Digital Strategy", "4", { fitScore: 8 }) },
    { fingerprintKey: "ok", leadPayload: backlogLead("Head of Digital Sales", "5", { fitScore: 7 }) },
  ];
  const deadChecks: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const promotion = await selectBacklogPromotions({
    store: {
      listBacklogCandidates: async () => rows,
      isDeadLinkCoolingDown: async (url: string) => {
        deadChecks.push(url);
        return url.endsWith("/4");
      },
    } as never,
    runId: "run_x",
    sheetId: "sheet_catalog",
    intentKey: "intent:current",
    now: NOW,
    slots: 5,
    excludeFingerprintKeys: [],
    userProfile: {
      version: 1,
      identity: { targetRoles: ["Director of Digital Sales"], targetSeniority: "director", primaryNarrative: "x" },
      strengths: [{ name: "sales", rank: 1 }],
      hardConstraints: {
        workMode: "remote_only",
        skipTitles: ["Sales Engineering"],
        salaryFloor: 150000,
      },
    } as never,
    log: (event, details) => logs.push([event, details]),
  });
  assert.deepEqual(promotion.fingerprintKeys, ["ok"]);
  assert.ok(deadChecks.length >= 1, "the dead-link cache is consulted");
  const revalidation = logs.find(([event]) => event === "discovery.run.backlog_revalidated");
  assert.ok(revalidation, "revalidation skips are logged");
  assert.deepEqual(revalidation[1].skipped, {
    skip_title_match: 1,
    work_mode_mismatch: 1,
    salary_below_floor: 1,
    dead_link: 1,
  });
});

test("should write novel leads before re-sighted written ones so backlog drains", async () => {
  const { raw, store, close } = openStore();
  try {
    const writes: string[][] = [];
    for (let index = 0; index < 3; index += 1) {
      const harness = makeRun({ listings: QUALIFIED, store });
      await harness.run();
      writes.push(harness.written.map((lead) => String(lead.company)).sort());
      if (index === 2) {
        const novelty = harness.logs.find(
          ([event]) => event === "discovery.run.write_selection_novelty",
        );
        assert.ok(novelty, "novelty counts are logged");
        assert.equal(novelty[1].novel, 1);
        assert.equal(novelty[1].reseenWritten, 4);
        assert.equal(novelty[1].reseenSelected, 1);
      }
    }
    // Run 1 writes two; run 2 must reach two different listings; run 3 the
    // last novel one plus one re-sighting in the spare slot.
    assert.notDeepEqual(writes[1], writes[0], JSON.stringify(writes));
    const everWritten = new Set(writes.flat());
    assert.equal(everWritten.size, 5, JSON.stringify(writes));
    assert.equal(writes[2].length, 2, "a spare slot still updates a re-sighted row");
    const counts = raw.listCandidates({ limit: 100 }).counts;
    assert.equal(counts.backlog || 0, 0, JSON.stringify(counts));
  } finally {
    close();
  }
});

test("should revalidate promoted backlog with the run's current user profile", async () => {
  // The disk profile (JOBBORED_PROFILE_PATH) is not merged into the run
  // config, so the intent key stays the same and only revalidation differs.
  const dir = mkdtempSync(join(tmpdir(), "discat-profile-"));
  const profilePath = join(dir, "profile.json");
  const writeProfile = (skipTitles: string[]) =>
    writeFileSync(
      profilePath,
      JSON.stringify({
        version: 1,
        identity: {
          targetRoles: ["Backend Engineer"],
          targetSeniority: "ic_senior",
          primaryNarrative: "I build backend services in node and typescript.",
        },
        strengths: [{ name: "backend", rank: 1 }],
        hardConstraints: { workMode: "any", skipTitles },
      }),
    );
  const secondRun = async (skipTitles: string[]) => {
    const { raw, store, close } = openStore();
    try {
      process.env.JOBBORED_PROFILE_PATH = NO_PROFILE_PATH;
      await makeRun({ listings: [...QUALIFIED, ...REJECTED], store }).run();
      assert.equal(raw.listCandidates({ status: "backlog", limit: 100 }).rows.length, 3);
      writeProfile(skipTitles);
      process.env.JOBBORED_PROFILE_PATH = profilePath;
      const second = makeRun({ listings: REJECTED, store, maxLeadsPerRun: 3 });
      await second.run();
      return second.written.map((lead) => String(lead.title));
    } finally {
      close();
    }
  };
  try {
    const control = await secondRun([]);
    assert.equal(control.length, 3, `control: the profile alone blocks nothing (${control})`);
    const skipped = await secondRun(["Platform"]);
    assert.equal(skipped.length, 2, `a now-skipped title is not promoted (${skipped})`);
    assert.equal(skipped.some((title) => title.includes("Platform")), false);
  } finally {
    process.env.JOBBORED_PROFILE_PATH = NO_PROFILE_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should catalog SerpApi non-extractable URLs as rejected non_extractable", async () => {
  const { raw, store, close } = openStore();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("serpapi.com")) {
      return new Response(
        JSON.stringify({
          jobs_results: [
            {
              title: "Director of Digital Sales",
              company_name: "Acme",
              location: "Remote",
              description: "Lead digital sales.",
              apply_options: [
                { title: "Apply on LinkedIn", link: "https://www.linkedin.com/jobs/view/4242" },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`discat: network blocked (${url})`);
  }) as typeof fetch;
  try {
    const harness = makeRun({
      listings: [],
      store,
      runtimeConfig: { serpApiKey: "test-serpapi-key" },
      storedConfig: {
        enabledSources: ["serpapi_google_jobs"],
        sourcePreset: "browser_only",
      },
      request: {
        discoveryProfile: {
          targetRoles: "Director of Digital Sales",
          sourcePreset: "browser_only",
        },
      },
    });
    await harness.run();
    assert.ok(
      harness.logs.some(([event]) => event === "discovery.run.serpapi_non_extractable_skipped"),
      "the SerpApi lane saw the non-extractable URL",
    );
    const rejected = raw
      .listCandidates({ status: "rejected", limit: 100 })
      .rows.filter((row) => row.rejectReason === "non_extractable");
    assert.equal(rejected.length, 1, JSON.stringify(raw.listCandidates({ limit: 100 }).rows));
    assert.equal(rejected[0].sourceId, "serpapi_google_jobs");
  } finally {
    globalThis.fetch = previousFetch;
    close();
  }
});

test("should keep the run's catalog when the run fails after scouting", async () => {
  const { raw, store, close } = openStore();
  try {
    const harness = makeRun({
      listings: [...QUALIFIED, ...REJECTED],
      store,
      write: async () => {
        throw new Error("writer crashed");
      },
    });
    // A failed Sheet write no longer throws: the run resolves as write_failed,
    // keeps the selected leads for Retry write, and carries the original error.
    const result = await harness.run();
    assert.match(String(result.writeResult?.writeError?.message || ""), /writer crashed/, "the original error surfaces");
    const counts = raw.listCandidates({ limit: 100 }).counts;
    assert.equal(counts.rejected, 2, JSON.stringify(counts));
    assert.ok((counts.backlog || 0) >= 3, JSON.stringify(counts));
    assert.equal(counts.written || 0, 0, "an unconfirmed write is never cataloged as written");
  } finally {
    close();
  }
});

test("should keep the run's catalog when the run is cancelled mid-run", async () => {
  const { raw, store, close } = openStore();
  try {
    const controller = new AbortController();
    let collected = 0;
    const harness = makeRun({
      listings: [...QUALIFIED, ...REJECTED],
      store,
      abortSignal: controller.signal,
      // Cancel once the last board has been listed: every listing is scored,
      // then the run stops before its write.
      onCollected: () => {
        collected += 1;
        if (collected === COMPANIES.length) controller.abort(new RunCancelledError());
      },
    });
    await assert.rejects(harness.run(), (error: unknown) => isRunCancelledError(error));
    assert.equal(harness.written.length, 0, "the cancelled run wrote nothing");
    const counts = raw.listCandidates({ limit: 100 }).counts;
    assert.ok((counts.rejected || 0) + (counts.backlog || 0) > 0, JSON.stringify(counts));
    assert.equal(counts.written || 0, 0, JSON.stringify(counts));
  } finally {
    close();
  }
});

// --- DISCAT round 3 (C1) ---------------------------------------------------

const SPONSOR_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Backend Engineer"],
    targetSeniority: "ic_senior",
    primaryNarrative: "I build backend services in node and typescript.",
  },
  strengths: [{ name: "backend", rank: 1 }],
  hardConstraints: { workMode: "any", workAuth: "needs_sponsorship" },
};

test("should store a bounded description with backlog and not promote a no-sponsorship posting to a sponsorship-needing profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discat-sponsor-"));
  const profilePath = join(dir, "profile.json");
  writeFileSync(profilePath, JSON.stringify(SPONSOR_PROFILE));
  const { raw, store, close } = openStore();
  try {
    process.env.JOBBORED_PROFILE_PATH = NO_PROFILE_PATH;
    const longTail = " filler".repeat(1000);
    const listings = [
      listing("Acme", "Backend Engineer", "1"),
      listing("Globex", "Senior Backend Engineer", "2"),
      listing(
        "Initech",
        "Backend Engineer II",
        "3",
        `Build node typescript services for AI marketing and adtech sales at Initech. Remote. No visa sponsorship is available.${longTail}`,
      ),
    ];
    await makeRun({ listings, store }).run();
    const backlog = raw.listCandidates({ status: "backlog", limit: 100 }).rows;
    assert.equal(backlog.length, 1, JSON.stringify(backlog.map((row) => row.companyKey)));
    const stored = String(
      (backlog[0].leadPayload as Record<string, unknown>).descriptionText || "",
    );
    assert.match(stored, /no visa sponsorship/i, "the backlog payload keeps the description");
    assert.ok(stored.length <= 4000, `the stored description is bounded (${stored.length})`);

    process.env.JOBBORED_PROFILE_PATH = profilePath;
    const second = makeRun({ listings: REJECTED, store });
    await second.run();
    assert.equal(
      second.written.some((lead) => String(lead.company) === "Initech"),
      false,
      "the no-sponsorship backlog lead is not promoted",
    );
    for (const lead of second.written) {
      assert.equal("descriptionText" in lead, false, "promoted leads reach the sheet without the stored description");
    }
  } finally {
    process.env.JOBBORED_PROFILE_PATH = NO_PROFILE_PATH;
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("should not promote an old backlog row without a description when the profile needs sponsorship", async () => {
  const rows = [
    { fingerprintKey: "old", leadPayload: backlogLead("Backend Engineer", "1", { fitScore: 8 }) },
    {
      fingerprintKey: "new",
      leadPayload: backlogLead("Backend Engineer II", "2", {
        fitScore: 7,
        descriptionText: "Build node services. Sponsorship available.",
      }),
    },
  ];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const select = (profile: unknown) =>
    selectBacklogPromotions({
      store: { listBacklogCandidates: async () => rows } as never,
      runId: "run_x",
      sheetId: "sheet_catalog",
      intentKey: "intent:current",
      now: NOW,
      slots: 2,
      excludeFingerprintKeys: [],
      userProfile: profile as never,
      log: (event, details) => logs.push([event, details]),
    });
  const blocked = await select(SPONSOR_PROFILE);
  assert.deepEqual(blocked.fingerprintKeys, ["new"]);
  assert.equal("descriptionText" in blocked.leads[0], false, "the stored description is stripped");
  const revalidation = logs.find(([event]) => event === "discovery.run.backlog_revalidated");
  assert.deepEqual(revalidation?.[1].skipped, { work_auth_unverifiable: 1 });
  const open = await select({
    ...SPONSOR_PROFILE,
    hardConstraints: { workMode: "any", workAuth: "us_authorized" },
  });
  assert.deepEqual(open.fingerprintKeys.sort(), ["new", "old"]);
});

/** A backlog store that honors limit and exclusion the way the SQLite store does. */
function pagedBacklogStore(rows: Array<{ fingerprintKey: string; leadPayload: unknown }>) {
  const queries: Array<{ limit: number; excluded: number }> = [];
  let examined = 0;
  return {
    queries,
    examined: () => examined,
    store: {
      listBacklogCandidates: async (query: { limit: number; excludeFingerprintKeys?: string[] }) => {
        const excluded = new Set(query.excludeFingerprintKeys || []);
        queries.push({ limit: query.limit, excluded: excluded.size });
        const page = rows.filter((row) => !excluded.has(row.fingerprintKey)).slice(0, query.limit);
        examined += page.length;
        return page;
      },
    } as never,
  };
}

test("should page through the backlog until the slots fill when the first page is all ineligible", async () => {
  const rows = [
    ...Array.from({ length: 50 }, (_, index) => ({
      fingerprintKey: `php${index}`,
      leadPayload: backlogLead(`PHP Engineer ${index}`, `p${index}`, { fitScore: 9 }),
    })),
    { fingerprintKey: "ok1", leadPayload: backlogLead("Backend Engineer", "ok1", { fitScore: 6 }) },
    { fingerprintKey: "ok2", leadPayload: backlogLead("Backend Engineer II", "ok2", { fitScore: 6 }) },
    { fingerprintKey: "ok3", leadPayload: backlogLead("Backend Engineer III", "ok3", { fitScore: 6 }) },
  ];
  const paged = pagedBacklogStore(rows);
  const promotion = await selectBacklogPromotions({
    store: paged.store,
    runId: "run_x",
    sheetId: "sheet_catalog",
    intentKey: "intent:current",
    now: NOW,
    slots: 2,
    excludeFingerprintKeys: [],
    excludeKeywordsFor: () => ["php"],
  });
  assert.deepEqual(promotion.fingerprintKeys, ["ok1", "ok2"]);
  assert.ok(paged.queries.length > 1, "more than one page was read");
});

test("should examine at most 500 backlog rows in one run", async () => {
  const rows = [
    ...Array.from({ length: 700 }, (_, index) => ({
      fingerprintKey: `php${index}`,
      leadPayload: backlogLead(`PHP Engineer ${index}`, `p${index}`, { fitScore: 9 }),
    })),
    { fingerprintKey: "late", leadPayload: backlogLead("Backend Engineer", "late", { fitScore: 6 }) },
  ];
  const paged = pagedBacklogStore(rows);
  const promotion = await selectBacklogPromotions({
    store: paged.store,
    runId: "run_x",
    sheetId: "sheet_catalog",
    intentKey: "intent:current",
    now: NOW,
    slots: 5,
    excludeFingerprintKeys: [],
    excludeKeywordsFor: () => ["php"],
  });
  assert.deepEqual(promotion.fingerprintKeys, []);
  assert.ok(paged.examined() <= 500, `examined ${paged.examined()} rows`);
  assert.ok(paged.examined() >= 500 - 15, `paging reached the cap (${paged.examined()})`);
});

test("should keep written fates when the run fails after the sheet write", async () => {
  const { raw, store, close } = openStore();
  try {
    const failing = {
      ...store,
      learnRoleFamilyFromLead: () => {
        throw new Error("role family learning broke");
      },
    };
    const harness = makeRun({ listings: [...QUALIFIED, ...REJECTED], store: failing });
    await assert.rejects(harness.run(), /role family learning broke/, "the original error surfaces");
    assert.equal(harness.written.length, 2);
    const counts = raw.listCandidates({ limit: 100 }).counts;
    assert.equal(counts.written, 2, JSON.stringify(counts));
    assert.equal(counts.backlog, 3, JSON.stringify(counts));
    assert.equal(counts.rejected, 2, JSON.stringify(counts));
  } finally {
    close();
  }
});
