const MIN_USABLE_WORDS = 80;
const FIT_BLURB_RE = /^\s*(low|high|medium)\s+fit\b/i;
const SCORE_OUT_OF_TEN_RE = /\b\d+(?:\.\d+)?\s*\/\s*10\b/;

/**
 * @typedef {{ text: string, source: "cache" | "scrape" }} UsableJobDescription
 * @typedef {{ error: "jd_unusable" }} UnusableJobDescription
 * @typedef {UsableJobDescription | UnusableJobDescription} ResolveJobDescriptionResult
 * @typedef {{ description?: unknown }} ScrapeJobResult
 * @typedef {(url: string) => Promise<ScrapeJobResult>} ScrapeJobFn
 */

/** @param {unknown} text */
function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Cached/scraped JD is unusable when it is too short, a Low/High/Medium-fit
 * blurb, or a short body whose whole content is an X/10 score.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isUsableJobDescription(text) {
  if (typeof text !== "string") return false;
  const words = countWords(text);
  const tooShort = words < MIN_USABLE_WORDS;
  const fitBlurb = FIT_BLURB_RE.test(text);
  const scoreAsShortBody = tooShort && SCORE_OUT_OF_TEN_RE.test(text);
  return !(tooShort || fitBlurb || scoreAsShortBody);
}

/**
 * Prefer a usable cached JD. Otherwise scrape `jobUrl` via the injected
 * `scrapeJob` (tests pass a stub; production passes `scrapeJobPosting`).
 *
 * @param {object} [params]
 * @param {unknown} [params.cachedText]
 * @param {unknown} [params.jobUrl]
 * @param {ScrapeJobFn} [params.scrapeJob]
 * @returns {Promise<ResolveJobDescriptionResult>}
 */
export async function resolveJobDescription({
  cachedText,
  jobUrl,
  scrapeJob,
} = {}) {
  if (isUsableJobDescription(cachedText)) {
    return { text: /** @type {string} */ (cachedText), source: "cache" };
  }

  const url = typeof jobUrl === "string" ? jobUrl.trim() : "";
  if (!url || typeof scrapeJob !== "function") {
    return { error: "jd_unusable" };
  }

  try {
    const scraped = await scrapeJob(url);
    const description =
      scraped && typeof scraped.description === "string"
        ? scraped.description
        : "";
    if (isUsableJobDescription(description)) {
      return { text: description, source: "scrape" };
    }
  } catch {
    // blocked, timeout, or otherwise unusable scrape
  }

  return { error: "jd_unusable" };
}
