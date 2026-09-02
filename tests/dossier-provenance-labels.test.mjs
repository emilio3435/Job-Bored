import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadBrowserModules() {
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
  return context.window;
}

/* The three cases that asserted these labels in the RENDERED dossier retired
   with role-brief.js: The Case has no provenance chip, no postingSummary and
   no "Fetched …" line (spec §3 cuts the AI prose block). classify() itself is
   still live — posting-enrichment.js consumes it — and is what is pinned here. */
describe("DOSSIER-01 provenance labels", () => {

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

});
