/**
 * SCRAPE-E2E-1 — hermetic `POST /api/scrape-job` fixture bodies.
 *
 * The point of the claim is that the drawer is proven against what the REAL
 * scraper returns, so nothing here is hand-typed. Both bodies are produced by
 * driving the production module `server/shared/job-scraper-core.mjs`:
 *
 *   · success — `scrapeJobPosting()` over the JSON-LD fixture in this folder,
 *     fed through a stub `fetchImpl` so no socket is ever opened;
 *   · 422 — `toScrapeFailureResponse()` over the error the same function
 *     throws for a company-jobs INDEX url (`isKnownCompanyJobsIndex`), which
 *     rejects before any fetch at all.
 *
 * `server/index.mjs` is deliberately NOT imported: it calls `app.listen()` at
 * module scope. All its route adds around the two calls above is one line each
 * — `res.json(result)` and `res.status(failure.status).json(failure.body)` —
 * which is exactly the `{ status, body }` pair this table stores.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scrapeJobPosting,
  toScrapeFailureResponse,
} from "../../server/shared/job-scraper-core.mjs";

/** A direct posting url: the scraper reads it and extracts JSON-LD. */
export const SCRAPE_POSTING_URL = "https://jobs.acme.test/platform-engineer";

/**
 * A company-jobs INDEX url. `isKnownCompanyJobsIndex` rejects this shape with
 * `job_detail_url_required` (HTTP 422) before any network call — the honest
 * "Wellfound-like" failure. A login wall would be a 502 `source_blocked`.
 */
export const SCRAPE_COMPANY_INDEX_URL = "https://wellfound.com/company/acme/jobs";

const POSTING_HTML = readFileSync(
  join(import.meta.dirname, "job-posting-json-ld.html"),
  "utf8",
);

/** A `fetch`-shaped stub that always answers with the local fixture page. */
function fixturePageFetch() {
  const bytes = new TextEncoder().encode(POSTING_HTML);
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "content-type" ? "text/html" : null,
    },
    arrayBuffer: async () => bytes.buffer,
    text: async () => POSTING_HTML,
    json: async () => ({}),
  });
}

/** A `fetch`-shaped stub that proves a code path never reaches the network. */
function forbiddenFetch(url) {
  return async () => {
    throw new Error(`the scraper must not fetch ${url}`);
  };
}

/**
 * Run the production scraper against a url that must be rejected, and convert
 * the thrown error with the production failure mapper.
 * @param {string} url
 */
async function captureScrapeFailure(url) {
  let thrown = null;
  let resolved = false;
  try {
    await scrapeJobPosting(url, { fetchImpl: forbiddenFetch(url) });
    resolved = true;
  } catch (error) {
    thrown = error;
  }
  if (resolved) {
    throw new Error(`expected the scraper to reject ${url}`);
  }
  return toScrapeFailureResponse(thrown, url);
}

let fixturesPromise = null;

/**
 * The fixture table, keyed by the url the drawer posts. Computed once per
 * process and memoized so every test in a file sees byte-identical bodies.
 * @returns {Promise<Map<string, { status: number, body: Record<string, unknown> }>>}
 */
export function buildScrapeJobFixtures() {
  if (!fixturesPromise) {
    fixturesPromise = (async () => {
      const success = await scrapeJobPosting(SCRAPE_POSTING_URL, {
        fetchImpl: fixturePageFetch(),
      });
      const failure = await captureScrapeFailure(SCRAPE_COMPANY_INDEX_URL);
      return new Map([
        [SCRAPE_POSTING_URL, { status: 200, body: success }],
        [SCRAPE_COMPANY_INDEX_URL, { status: failure.status, body: failure.body }],
      ]);
    })();
  }
  return fixturesPromise;
}

/**
 * Resolve one fixture, or null when the posted url has no staged answer.
 * @param {string} url
 */
export async function resolveScrapeJobFixture(url) {
  const fixtures = await buildScrapeJobFixtures();
  return fixtures.get(url) || null;
}

/**
 * The url the drawer put in its JSON body, or "" when the body is not the
 * production `{ url: string }` shape.
 * @param {string | null} postData
 */
export function readScrapeTargetUrl(postData) {
  if (!postData) return "";
  try {
    const parsed = JSON.parse(postData);
    if (!parsed || typeof parsed !== "object") return "";
    const url = /** @type {Record<string, unknown>} */ (parsed).url;
    return typeof url === "string" ? url : "";
  } catch {
    return "";
  }
}
