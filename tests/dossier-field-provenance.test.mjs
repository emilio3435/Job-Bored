/* ============================================================
   dossier-field-provenance.test.mjs
   ------------------------------------------------------------
   Named claim F3A-DOSSIER01-PROV (audit DOSSIER-01):

   Title/company-only inference is currently shown as
   "grounded in the posting"; the enrichment cache has no TTL
   and no visible freshness. Unknown fields are not retained
   as unknown.

   Why this matters: a job hunter deciding whether to apply
   must be able to tell posting-grounded evidence from a
   model guessing from a title. Labeling inference as
   posting-grounded is a trust defect, not a copy nit.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(repoRoot, "tests/fixtures/dossier-evidence");
const titleCompanyOnly = JSON.parse(
  readFileSync(join(fixturesDir, "title-company-only.json"), "utf8"),
);
const postingGrounded = JSON.parse(
  readFileSync(join(fixturesDir, "posting-grounded.json"), "utf8"),
);
const unknownFields = JSON.parse(
  readFileSync(join(fixturesDir, "unknown-fields.json"), "utf8"),
);

const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
const postingEnrichmentJs = readFileSync(
  join(repoRoot, "posting-enrichment.js"),
  "utf8",
);

const GROUNDED_LABEL = "grounded in the posting";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

function makeBus() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn.call(this, event);
      return true;
    },
  };
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
  };
}

function makeMount() {
  const attributes = {};
  return {
    classList: makeClassList(),
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v == null ? "" : v); },
    querySelector() { return null; },
  };
}

function makeDocument() {
  const bus = makeBus();
  return Object.assign(bus, {
    body: { classList: makeClassList(["jb-v2"]) },
    readyState: "complete",
    querySelector() { return null; },
  });
}

function loadScripts(extraSources = []) {
  const documentEl = makeDocument();
  const windowEl = makeBus();
  windowEl.document = documentEl;
  windowEl.matchMedia = () => ({ matches: false });
  windowEl.CustomEvent = TestCustomEvent;
  windowEl.JobBoredFlowing = {};
  const context = vm.createContext({
    CustomEvent: TestCustomEvent,
    document: documentEl,
    window: windowEl,
    globalThis: undefined,
    console: { error() {}, warn() {}, log() {} },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
    setTimeout,
    clearTimeout,
  });
  context.globalThis = context;
  for (const { src, filename } of extraSources) {
    vm.runInContext(src, context, { filename });
  }
  vm.runInContext(briefSource, context, { filename: "role-brief.js" });
  return { context, windowEl, documentEl };
}

function tryLoadProvenanceHelper() {
  const src = readFileSync(
    join(repoRoot, "dossier-field-provenance.js"),
    "utf8",
  );
  const ctx = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInContext(src, ctx, { filename: "dossier-field-provenance.js" });
  return ctx.JobBoredDossierProvenance || ctx.window.JobBoredDossierProvenance;
}

function loadPostingEnrichment() {
  const jobs = [];
  const storage = new Map();
  const host = {
    getJobPostingScrapeUrl: () => "",
    isScraperUrlBlockedOnThisPage: () => false,
    getUserContent: () => null,
    refreshDrawerIfOpen() {},
    renderPipeline() {},
    showToast() {},
  };
  const window = {
    JobBoredApp: { core: { getPipelineData: () => jobs, host } },
    CommandCenterJobPostingInsights: {
      canEnrichWithLLM: () => true,
      fetchViaGeminiUrlContext: async () => null,
      enrichFromScrape: async () => ({}),
    },
    addEventListener() {},
    dispatchEvent() {},
  };
  const ctx = {
    window,
    document: { dispatchEvent() {} },
    navigator: { onLine: true },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    AbortController,
    URL,
    clearTimeout,
    setTimeout,
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(postingEnrichmentJs, ctx, { filename: "posting-enrichment.js" });
  return window.JobBoredApp.postingEnrichment;
}

function renderBrief(enrichment, extraJob = {}) {
  const { context } = loadScripts();
  const mount = makeMount();
  context.window.JobBoredDossierBrief.renderBrief(mount, {
    job: {
      jobKey: "L1",
      role: extraJob.role || extraJob.title || "Role",
      company: extraJob.company || "Company",
      enrichment,
    },
  });
  return mount.innerHTML;
}

describe("F3A-DOSSIER01-PROV — title/company inference is not posting-grounded", () => {
  it("does not label title/company-only inference as grounded in the posting", () => {
    const html = renderBrief(titleCompanyOnly.enrichment, titleCompanyOnly.job);
    assert.match(
      html,
      /brief__lede/,
      "inferred summary still renders so the hunter can read it",
    );
    assert.doesNotMatch(
      html,
      /grounded in the posting/,
      titleCompanyOnly.why,
    );
    assert.match(
      html,
      /inferred from title and company/i,
      "the lede tag must say the claim was inferred from title and company",
    );
  });

  it("may label a Cheerio-scraped posting summary as grounded in the posting", () => {
    const html = renderBrief(postingGrounded.enrichment, postingGrounded.job);
    assert.match(html, new RegExp(GROUNDED_LABEL));
    assert.doesNotMatch(html, /inferred from title and company/i);
  });

  it("does not claim posting-grounded when enrichment has no source lineage", () => {
    const html = renderBrief({
      postingSummary: "A model wrote this without saying where from.",
      status: "ready",
    });
    assert.doesNotMatch(
      html,
      /grounded in the posting/,
      "missing source is unverified, not posting-grounded",
    );
  });
});

describe("F3A-DOSSIER01-PROV — cache TTL and visible freshness", () => {
  it("rejects cache hits older than the enrichment TTL", () => {
    const api = loadPostingEnrichment();
    assert.ok(
      api && typeof api.isUsableCachedEnrichment === "function",
      "cache predicate must stay centralized on postingEnrichment",
    );
    const now = 1_800_000_000_000;
    const fresh = {
      scrapedAt: now - 60 * 60 * 1000,
      postingSummary: "still fresh",
    };
    const stale = {
      scrapedAt: now - FOUR_DAYS_MS,
      postingSummary: "too old",
    };
    assert.equal(
      api.isUsableCachedEnrichment(fresh, now),
      true,
      "an hour-old scrape is still usable",
    );
    assert.equal(
      api.isUsableCachedEnrichment(stale, now),
      false,
      "DOSSIER-01: cache must have a TTL so a 4-day-old inference is not treated as current",
    );
    assert.ok(
      Number(api.ENRICHMENT_CACHE_TTL_MS) > 0,
      "TTL must be a named positive constant so freshness can be shown",
    );
    assert.ok(
      Number(api.ENRICHMENT_CACHE_TTL_MS) <= THREE_DAYS_MS,
      "posting cache TTL must be at most 3 days; job ads change faster than a week",
    );
  });

  it("exposes a freshness label the Brief can render", () => {
    const api = tryLoadProvenanceHelper();
    assert.ok(api, "dossier-field-provenance.js must expose JobBoredDossierProvenance");
    const now = 1_800_000_000_000;
    const stamped = api.stampProvenance(titleCompanyOnly.enrichment, {
      nowMs: now,
      profileExcerpt: "",
    });
    assert.ok(stamped.provenance, "stampProvenance must attach a provenance block");
    assert.equal(stamped.provenance.grounding, "inferred");
    assert.equal(stamped.provenance.source, "title-and-company");
    assert.ok(
      stamped.provenance.freshness && stamped.provenance.freshness.label,
      "freshness.label must be visible to the Brief",
    );
    assert.equal(typeof stamped.provenance.freshness.ageMs, "number");
    assert.equal(typeof stamped.provenance.freshness.ttlMs, "number");
    assert.equal(
      stamped.provenance.freshness.stale,
      true,
      "fixture scrapedAt 1710000000000 is far older than TTL relative to nowMs",
    );
  });

  it("renders cache freshness next to the AI summary so age is not hidden", () => {
    const api = tryLoadProvenanceHelper();
    const now = 1_800_360_000_000; // one hour after scrapedAt=1800000000000
    const stamped = api.stampProvenance(
      {
        ...postingGrounded.enrichment,
        scrapedAt: 1_800_000_000_000,
      },
      { nowMs: now, profileExcerpt: "I shipped activation at Stripe." },
    );
    const { context } = loadScripts([
      {
        src: readFileSync(join(repoRoot, "dossier-field-provenance.js"), "utf8"),
        filename: "dossier-field-provenance.js",
      },
    ]);
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, {
      job: {
        jobKey: "L1",
        role: "Growth Designer",
        company: "Linear",
        enrichment: stamped,
      },
    });
    assert.match(
      mount.innerHTML,
      /brief__freshness|fetched /i,
      "DOSSIER-01: cache age/source must be visible in the Brief, not only in memory",
    );
  });
});

describe("F3A-DOSSIER01-PROV — unknown retained; profile revision stamped", () => {
  it("keeps empty inferred fields empty and marks them unknown", () => {
    const api = tryLoadProvenanceHelper();
    const stamped = api.stampProvenance(unknownFields.enrichment, {
      nowMs: 1_800_000_000_000,
      profileExcerpt: "",
    });
    assert.equal(stamped.inferredTitle, "", unknownFields.why);
    assert.equal(stamped.inferredCompany, "");
    assert.equal(stamped.postingSummary, "");
    assert.deepEqual(stamped.mustHaves, []);
    assert.equal(stamped.provenance.fields.inferredTitle.unknown, true);
    assert.equal(stamped.provenance.fields.mustHaves.unknown, true);
    assert.equal(stamped.provenance.fields.postingSummary.unknown, true);
    assert.equal(stamped.provenance.profileRevision, "");
  });

  it("fingerprints a supplied profile excerpt so later Briefs can see which revision scored the role", () => {
    const api = tryLoadProvenanceHelper();
    const excerpt = "Staff PM. Shipped Atlas activation. SQL, Mixpanel.";
    const stamped = api.stampProvenance(postingGrounded.enrichment, {
      nowMs: postingGrounded.enrichment.scrapedAt,
      profileExcerpt: excerpt,
    });
    assert.ok(
      stamped.provenance.profileRevision,
      "a non-empty excerpt must produce a profileRevision fingerprint",
    );
    assert.match(stamped.provenance.profileRevision, /^excerpt:/);
    const again = api.stampProvenance(postingGrounded.enrichment, {
      nowMs: postingGrounded.enrichment.scrapedAt,
      profileExcerpt: excerpt,
    });
    assert.equal(
      again.provenance.profileRevision,
      stamped.provenance.profileRevision,
      "same excerpt must be stable",
    );
    const other = api.stampProvenance(postingGrounded.enrichment, {
      nowMs: postingGrounded.enrichment.scrapedAt,
      profileExcerpt: excerpt + "\nAlso led a marketplace.",
    });
    assert.notEqual(
      other.provenance.profileRevision,
      stamped.provenance.profileRevision,
      "a different profile excerpt must change the revision",
    );
  });

  it("never upgrades inferred field grounding to posting", () => {
    const api = tryLoadProvenanceHelper();
    const stamped = api.stampProvenance(titleCompanyOnly.enrichment, {
      nowMs: titleCompanyOnly.enrichment.scrapedAt,
      profileExcerpt: "",
    });
    for (const [name, field] of Object.entries(stamped.provenance.fields)) {
      assert.notEqual(
        field.grounding,
        "posting",
        `${name} inferred from title/company must not be posting-grounded`,
      );
    }
  });
});
