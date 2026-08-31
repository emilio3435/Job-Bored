import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");

function makeMount() {
  return {
    innerHTML: "",
    querySelector() { return null; },
  };
}

function loadBrowserModules({ loadBrief = false } = {}) {
  const window = { JobBoredFlowing: {} };
  const context = vm.createContext({
    window,
    document: {
      body: { classList: { contains: (name) => name === "jb-v2" } },
    },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  const provenanceSource = readFileSync(
    join(repoRoot, "dossier-field-provenance.js"),
    "utf8",
  );
  vm.runInContext(provenanceSource, context, { filename: "dossier-field-provenance.js" });
  if (loadBrief) {
    vm.runInContext(briefSource, context, { filename: "role-brief.js" });
  }
  return context.window;
}

function renderBrief(enrichment, extraJob = {}) {
  const window = loadBrowserModules({ loadBrief: true });
  const mount = makeMount();
  window.JobBoredDossierBrief.renderBrief(mount, {
    job: {
      role: "Senior Systems Engineer",
      company: "Acme",
      jdSections: [],
      enrichment,
      ...extraJob,
    },
  });
  return mount.innerHTML;
}

describe("DOSSIER-01 provenance labels", () => {
  it("DOSSIER-01a does not call title-and-company inference grounded in the posting", () => {
    const html = renderBrief({
      postingSummary: "Lead systems work across the platform.",
      source: "title-and-company",
      scrapeBlocked: true,
      enrichedAt: "2026-08-30T12:00:00.000Z",
      parseMode: "schema",
    });

    assert.doesNotMatch(html, /grounded in the posting/i);
    assert.match(html, /inferred/i);
  });

  it("DOSSIER-01a labels posting-derived schema output as posting-grounded", () => {
    const provenance = loadBrowserModules().JobBoredDossierProvenance;
    assert.deepEqual(
      JSON.parse(JSON.stringify(provenance.classify({
        source: "cheerio",
        enrichedAt: "2026-08-30T12:00:00.000Z",
        parseMode: "schema",
      }, "", "postingSummary"))),
      {
        label: "posting-grounded",
        source: "cheerio",
        fetchedAt: "2026-08-30T12:00:00.000Z",
      },
    );
  });

  it("DOSSIER-01c lets the persisted edit lock override source provenance", () => {
    const provenance = loadBrowserModules().JobBoredDossierProvenance;
    assert.deepEqual(
      JSON.parse(JSON.stringify(provenance.classify({
        source: "cheerio",
        enrichedAt: "2026-08-30T12:00:00.000Z",
        parseMode: "schema",
      }, "title,salary", "title"))),
      {
        label: "user-provided",
        source: "edit-lock",
        fetchedAt: null,
      },
    );
  });

  it("defaults every missing or pre-metadata input shape to unknown", () => {
    const provenance = loadBrowserModules().JobBoredDossierProvenance;
    const shapes = [undefined, null, {}, { source: "" }, { scrapedAt: 0 }];
    for (const shape of shapes) {
      const result = provenance.classify(shape, "", "postingSummary");
      assert.equal(result.label, "unknown");
      assert.equal(result.source, "unknown");
      assert.equal(result.fetchedAt, null);
    }
  });

  /* Re-points the one T0 enrichment-cache-ttl case worth keeping ("visible
     fetched time beside AI claims") at the merged renderer. The rest of that
     suite required surfacing >30-day-old cache hits, which contradicts the
     repair 3-day cache TTL that rejects them outright; the stronger rule is
     kept and pinned by tests/dossier-field-provenance.test.mjs. There is no
     second 30-day display flag — the fetched-time line carries the age. */
  it("shows the sheet-persisted fetch time and its age beside the AI claims", () => {
    const html = renderBrief({
      postingSummary: "Lead growth design for Linear.",
      mustHaves: ["5 years growth design"],
      source: "cheerio",
      enrichedAt: "2026-08-30T12:00:00.000Z",
      parseMode: "schema",
    });

    assert.match(
      html,
      /Fetched Aug 30, 2026 · /,
      "cache age must be visible in the Brief, not only in memory",
    );
    assert.doesNotMatch(
      html,
      /stale/i,
      "there is no separate 30-day display-stale flag; only the 3-day TTL says stale",
    );
  });

  it("escapes model-controlled fallback provenance before rendering", () => {
    const html = renderBrief({
      postingSummary: "Conservative role summary.",
      source: "title-and-company",
      fallbackReason: '<img src=x onerror="alert(1)">',
      enrichedAt: "2026-08-30T12:00:00.000Z",
      parseMode: "schema",
    });

    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });
});
