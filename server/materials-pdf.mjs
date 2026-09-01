const PDF_TIMEOUT_MS = 30_000;

/**
 * @param {Promise<T>} work
 * @param {number} ms
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(work, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("pdf_timeout"));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Optional Playwright PDF render. Missing Playwright, a launch/render
 * failure, or a timeout returns `{ skipped: true, note: "pdf_skipped" }`
 * and never throws.
 *
 * @param {string} html
 * @param {string} outPath
 * @param {{
 *   playwrightImport?: () => Promise<{ chromium: { launch: Function } }>,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<{ skipped: boolean, path?: string, note?: string }>}
 */
export async function renderPdfIfPossible(html, outPath, options = {}) {
  const load = options.playwrightImport || (() => import("playwright"));
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : PDF_TIMEOUT_MS;
  /** @type {{ close?: () => Promise<unknown> } | null} */
  let browser = null;
  try {
    await withTimeout(
      (async () => {
        const { chromium } = await load();
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({ path: outPath, format: "Letter", printBackground: true });
      })(),
      timeoutMs,
    );
    return { skipped: false, path: outPath };
  } catch {
    return { skipped: true, note: "pdf_skipped" };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}
