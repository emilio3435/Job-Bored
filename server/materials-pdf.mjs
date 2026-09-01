/**
 * Optional Playwright PDF render. Missing Playwright or a launch/render
 * failure returns `{ skipped: true, note: "pdf_skipped" }` and never throws.
 *
 * @param {string} html
 * @param {string} outPath
 * @param {{ playwrightImport?: () => Promise<{ chromium: { launch: Function } }> }} [options]
 * @returns {Promise<{ skipped: boolean, path?: string, note?: string }>}
 */
export async function renderPdfIfPossible(html, outPath, options = {}) {
  const load = options.playwrightImport || (() => import("playwright"));
  try {
    const { chromium } = await load();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({ path: outPath, format: "Letter", printBackground: true });
    } finally {
      await browser.close();
    }
    return { skipped: false, path: outPath };
  } catch {
    return { skipped: true, note: "pdf_skipped" };
  }
}
