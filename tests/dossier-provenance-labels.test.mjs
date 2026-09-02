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

/* The three rendered-label cases retired with role-brief.js and are restored
   here against The Case (L7 gap 4): same intent, same payloads, new selectors.
   The Case has no AI-prose block, so the labels moved — an `inferred` source
   tag on the rail, a `recovered parse · review` tag over the requirements, and
   the freshness stamp under the one-line quote. classify() itself is still
   pinned below unchanged. */

/* Trap 2: jb-text.js and the provenance classifier must both evaluate BEFORE
   the Case model/renderer, or the model throws inside a try and paints empty
   — an absence-only assertion would then pass on nothing. */
const CASE_STAGES = ["new", "researching", "applied", "rejected"];
const caseStages = {
  pairs: () => CASE_STAGES.map((k) => ({ key: k, label: k })),
  toKey: (v) => (CASE_STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v),
  isClosed: (v) => v === "rejected",
};

function loadCase() {
  const sandbox = { window: { JobBoredStages: caseStages } };
  for (const file of ["jb-text.js", "dossier-field-provenance.js", "role-case-model.js", "role-case.js"]) {
    vm.runInNewContext(readFileSync(join(repoRoot, file), "utf8"), sandbox, { filename: file });
  }
  assert.equal(typeof sandbox.window.JobBoredText.escapeHtml, "function", "jb-text must load first");
  assert.equal(typeof sandbox.window.JobBoredDossierProvenance.classify, "function", "the classifier must load");
  return sandbox.window.JobBoredCase;
}

const CASE_NOW = Date.parse("2026-08-30T18:00:00.000Z");

/** Render The Case for one enrichment payload; returns [html, model]. */
function renderCase(enrichment, { job = {}, nowMs = CASE_NOW } = {}) {
  const Case = loadCase();
  const model = Case.model.buildCaseModel("prov-1", {
    vm: { job: { jobKey: "prov-1", role: "Senior Systems Engineer", company: "Acme", stage: "applied", enrichment, ...job } },
    keywords: null, scorecard: null, manifest: null, health: null,
    stages: caseStages, providerLabel: "", nowMs,
    parseDate: (v) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : null; },
  });
  const mount = { innerHTML: "" };
  Case.render(mount, model);
  return [mount.innerHTML, model];
}

describe("DOSSIER-01 provenance labels", () => {
  it("DOSSIER-01a does not call title-and-company inference grounded in the posting", () => {
    const [html] = renderCase({
      postingSummary: "Lead systems work across the platform.",
      roleInOneLine: "Lead systems work across the platform.",
      mustHaves: ["Distributed systems"],
      source: "title-and-company",
      scrapeBlocked: true,
      enrichedAt: "2026-08-30T12:00:00.000Z",
      parseMode: "schema",
    });

    assert.match(html, /class="case__rail"/, "the dossier actually rendered");
    assert.match(
      html,
      /class="case__meta">[\s\S]*?<span class="case__src case__src--inferred" aria-hidden="true">inferred<\/span>/,
      "the rail must say the identity was inferred, not scraped",
    );
    assert.doesNotMatch(html, /grounded in the posting/i);
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
     second 30-day display flag — the freshness stamp carries the age. */
  it("shows the sheet-persisted fetch time and its age beside the AI claims", () => {
    const [html] = renderCase({
      postingSummary: "Lead growth design for Linear.",
      roleInOneLine: "Lead growth design for Linear.",
      mustHaves: ["5 years growth design"],
      source: "cheerio",
      enrichedAt: "2026-08-30T12:00:00.000Z",
      parseMode: "schema",
    });

    assert.match(
      html,
      /<div class="case__stamp case__stamp--fresh">fetched 6h ago<\/div>/,
      "cache age must be visible in the Case, not only in memory",
    );
    assert.doesNotMatch(
      html,
      /stale/i,
      "there is no separate 30-day display-stale flag; only the 3-day TTL says stale",
    );
  });

  /* The Case never interpolates the model's own provenance strings — parse
     mode, review reason, polluted field names — into markup. This payload
     carries the injection in all three at once and still has to render the
     two tags that DO surface, so the guard cannot pass on an empty render. */
  it("escapes model-controlled fallback provenance before rendering", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const [html, model] = renderCase({
      postingSummary: "Conservative role summary.",
      roleInOneLine: "Conservative role summary.",
      mustHaves: ["Paid media strategy"],
      source: "title-and-company",
      scrapeBlocked: true,
      parseMode: evil,
      fallbackReason: evil,
      reviewState: { status: "needs_review", reason: evil, pollutedFields: [evil] },
      enrichedAt: "2026-08-30T12:00:00.000Z",
    });

    assert.match(html, /class="case__src case__src--review" aria-hidden="true">unverified<\/span>/,
      "an unrecognized parse mode is a recovered parse, and the reader is told");
    assert.match(html, /class="case__src case__src--inferred" aria-hidden="true">inferred<\/span>/);
    assert.equal(model.provenance.reviewState.status, "needs_review");
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /onerror=/);
  });
});
