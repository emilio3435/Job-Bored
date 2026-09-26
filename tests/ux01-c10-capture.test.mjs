import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   UX01 C10 — the JSON-LD capture bookmarklet (MP-02).

   Pins the whole handoff with no server: a JobPosting on a third-party
   page → `#capture=` → manual add opened with the fields prefilled.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(repoRoot, "capture-bookmarklet.js"), "utf8");

function load(winExtras = {}) {
  const win = { ...winExtras };
  const ctx = {
    window: win,
    globalThis: win,
    console,
    setTimeout,
    JSON,
    Buffer,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "capture-bookmarklet.js" });
  return win.JobBoredCapture;
}

const POSTING = {
  url: "https://jobs.example.com/123",
  title: "Senior Product Designer",
  company: "Tidewater Health",
  location: "Austin, TX",
  description: "Design the thing.",
};

describe("C10 · #capture= round-trips a posting", () => {
  it("encodes and parses back the same fields", () => {
    const api = load();
    const capture = api.parseCaptureHash(`#capture=${api.encodeCapture(POSTING)}`);
    assert.equal(capture.title, POSTING.title);
    assert.equal(capture.company, POSTING.company);
    assert.equal(capture.location, POSTING.location);
    assert.equal(capture.url, POSTING.url);
  });

  it("round-trips non-ASCII text", () => {
    const api = load();
    const capture = api.parseCaptureHash(
      `#capture=${api.encodeCapture({ ...POSTING, company: "Café Zürich — 東京" })}`,
    );
    assert.equal(capture.company, "Café Zürich — 東京");
  });

  it("rejects garbage, other hashes, and non-http URLs", () => {
    const api = load();
    assert.equal(api.parseCaptureHash("#pipeline"), null);
    assert.equal(api.parseCaptureHash("#capture=%%%"), null);
    const js = api.parseCaptureHash(
      `#capture=${api.encodeCapture({ title: "x", url: "javascript:alert(1)" })}`,
    );
    assert.equal(js.url, "", "a javascript: URL is never kept");
  });

  it("caps every field", () => {
    const api = load();
    const capture = api.sanitizeCapture({ title: "t".repeat(5000) });
    assert.equal(capture.title.length, api.LIMITS.title);
  });
});

describe("C10 · the hash opens manual add prefilled", () => {
  it("hands the capture to JobBoredIngest.openManual (lane D)", () => {
    const calls = [];
    const api = load({
      JobBoredIngest: { openManual: (opts) => calls.push(opts) },
    });
    const capture = api.sanitizeCapture(POSTING);
    assert.equal(api.openManualWithCapture(capture), "ingest");
    assert.equal(calls[0].source, "capture_bookmarklet");
    assert.equal(calls[0].url, POSTING.url);
    assert.equal(calls[0].prefill.title, POSTING.title);
    assert.equal(calls[0].prefill.company, POSTING.company);
  });

  it("falls back to the legacy manual modal and fills its fields", () => {
    const fields = new Map(
      ["ingestManualTitle", "ingestManualCompany", "ingestManualLocation", "ingestManualDescription"].map(
        (id) => [id, { value: "" }],
      ),
    );
    const opened = [];
    const api = load({
      JobBored: { openIngestManualFallback: (url) => opened.push(url) },
      document: { getElementById: (id) => fields.get(id) || null },
    });
    assert.equal(api.openManualWithCapture(api.sanitizeCapture(POSTING)), "legacy");
    assert.deepEqual(opened, [POSTING.url]);
    assert.equal(fields.get("ingestManualTitle").value, POSTING.title);
    assert.equal(fields.get("ingestManualCompany").value, POSTING.company);
  });

  it("consumes the hash once and clears it", () => {
    const calls = [];
    const replaced = [];
    const api = load({
      JobBoredIngest: { openManual: (opts) => calls.push(opts) },
      history: { replaceState: (...a) => replaced.push(a) },
    });
    const win = { JobBoredIngest: null };
    void win;
    // consumeCaptureHash reads root.location — give the loaded root one.
    const root = load({
      JobBoredIngest: { openManual: (opts) => calls.push(opts) },
      history: { replaceState: (...a) => replaced.push(a) },
      location: {
        hash: `#capture=${api.encodeCapture(POSTING)}`,
        pathname: "/",
        search: "",
      },
    });
    const capture = root.consumeCaptureHash({ attempts: 1 });
    assert.equal(capture.title, POSTING.title);
    assert.equal(calls.length, 1);
    assert.equal(replaced.length, 1, "the hash is cleared so a reload does not reopen");
  });
});

describe("C10 · the page-side extractor reads JobPosting JSON-LD", () => {
  function fakeDoc(jsonLd, title = "Page title") {
    return {
      title,
      querySelectorAll: () => jsonLd.map((j) => ({ textContent: JSON.stringify(j) })),
      getSelection: () => "",
    };
  }

  it("finds a JobPosting inside an @graph", () => {
    const api = load();
    const out = api.extractJobPosting(
      fakeDoc([
        { "@context": "https://schema.org", "@type": "Organization", name: "X" },
        {
          "@graph": [
            {
              "@type": "JobPosting",
              title: "Design Engineer",
              hiringOrganization: { "@type": "Organization", name: "Acme" },
              jobLocation: {
                "@type": "Place",
                address: { addressLocality: "Berlin", addressCountry: "DE" },
              },
              description: "Build <b>things</b>",
            },
          ],
        },
      ]),
      { href: "https://jobs.example.com/9" },
    );
    assert.equal(out.title, "Design Engineer");
    assert.equal(out.company, "Acme");
    assert.equal(out.location, "Berlin, DE");
    assert.match(out.description, /Build\s+things/);
  });

  it("falls back to the page title with no structured data", () => {
    const api = load();
    const out = api.extractJobPosting(fakeDoc([], "Staff Engineer — Acme"), {
      href: "https://example.com/j",
    });
    assert.equal(out.title, "Staff Engineer — Acme");
    assert.equal(out.url, "https://example.com/j");
  });

  it("builds a javascript: bookmarklet that opens this install", () => {
    const api = load();
    const href = api.buildBookmarkletHref("http://localhost:8080/#pipeline");
    assert.match(href, /^javascript:/);
    const body = decodeURIComponent(href.slice("javascript:".length));
    assert.match(body, /http:\/\/localhost:8080\/"\+'#capture='/);
    assert.doesNotMatch(body, /fetch\(|XMLHttpRequest/, "no network call from the page");
  });
});
