/* measureInPage and the fonts wait run inside the Playwright page. */
/* global document, NodeFilter */
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
  // Timeout winners must not leave `work` as an unhandledRejection when
  // setContent/pdf reject later (Node 24 treats that as fatal).
  work.catch(() => {});
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
  /** @type {() => Promise<unknown>} */
  let closeBrowser = async () => {};
  try {
    await withTimeout(
      (async () => {
        const { chromium } = await load();
        const launched = await chromium.launch({ headless: true });
        closeBrowser = () => launched.close();
        const page = await launched.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({ path: outPath, format: "Letter", printBackground: true });
      })(),
      timeoutMs,
    );
    return { skipped: false, path: outPath };
  } catch {
    return { skipped: true, note: "pdf_skipped" };
  } finally {
    try {
      await closeBrowser();
    } catch {
      // ignore
    }
  }
}

/**
 * @typedef {object} LayoutMeasurement
 * @property {boolean} fits
 * @property {number} scrollHeight
 * @property {number} clientHeight
 * @property {number} lastTextBottom px from the top of the viewport
 * @property {number} limit px: the sheet's bottom edge less the family's bottom margin
 * @property {number} blockedRequests requests the page tried to make off the machine
 */

/**
 * @typedef {object} PdfSession
 * @property {(html: string, opts?: { bottomMarginIn?: number }) => Promise<LayoutMeasurement>} measure
 * @property {(html: string, outPath: string) => Promise<{ path: string, pages: number, blockedRequests: number }>} pdf
 * @property {() => Promise<void>} close
 */

/** Count /Type /Page objects in PDF bytes. */
/** @param {Buffer} bytes */
export function pdfPageCount(bytes) {
  return (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
}

/**
 * Layout measurement, run inside the page (visual spec §9.2 rule 4): the
 * sheet must not overflow (scrollHeight equals clientHeight) and the last
 * text box must end inside the family's bottom margin. A visually hidden
 * duplicate (the ATS copy of a wordmark's name) is not a layout box.
 *
 * @param {number} bottomMarginPx
 */
function measureInPage(bottomMarginPx) {
  const sheet = document.querySelector("article.page");
  if (!sheet) return { scrollHeight: 0, clientHeight: 0, lastTextBottom: 0, limit: 0 };
  const rect = sheet.getBoundingClientRect();
  const limit = rect.top + sheet.clientHeight - bottomMarginPx;
  let last = 0;
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent || !node.textContent.trim()) continue;
    const parent = node.parentElement;
    if (parent && parent.closest(".visually-dup")) continue;
    range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      if (box.height > 0 && box.bottom > last) last = box.bottom;
    }
  }
  return { scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight, lastTextBottom: last, limit };
}

/**
 * One headless browser for a whole fit → render pass, so the fit loop can
 * measure, trim and re-measure without relaunching. Every request that is
 * not a data: or about: URL is aborted and counted: a render never touches
 * the network (rule 5). Returns null when Playwright is unavailable, and
 * callers then record the fit as unmeasured instead of guessing.
 *
 * @param {{ playwrightImport?: () => Promise<{ chromium: { launch: Function } }>, timeoutMs?: number }} [options]
 * @returns {Promise<PdfSession | null>}
 */
export async function openPdfSession(options = {}) {
  const load = options.playwrightImport || (() => import("playwright"));
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : PDF_TIMEOUT_MS;
  /** @type {{ newPage: Function, close: Function } | null} */
  let browser = null;
  try {
    const { chromium } = await withTimeout(load(), timeoutMs);
    browser = await withTimeout(Promise.resolve(chromium.launch({ headless: true })), timeoutMs);
  } catch {
    return null;
  }
  const launched = /** @type {{ newPage: Function, close: Function }} */ (browser);

  /**
   * @param {string} html
   * @returns {Promise<{ page: any, blocked: { count: number } }>}
   */
  async function openPage(html) {
    const page = await launched.newPage({ viewport: { width: 816, height: 1056 } });
    const blocked = { count: 0 };
    if (typeof page.route === "function") {
      await page.route("**/*", (/** @type {any} */ route) => {
        const url = String(route.request().url());
        if (url.startsWith("data:") || url.startsWith("about:")) return route.continue();
        blocked.count += 1;
        return route.abort();
      });
    }
    if (typeof page.emulateMedia === "function") await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    if (typeof page.evaluate === "function") {
      await page.evaluate(() => document.fonts && document.fonts.ready.then(() => true));
    }
    return { page, blocked };
  }

  return {
    async measure(html, opts = {}) {
      const bottomMarginPx = Math.round((opts.bottomMarginIn ?? 0.3) * 96);
      return withTimeout((async () => {
        const { page, blocked } = await openPage(html);
        try {
          const m = await page.evaluate(measureInPage, bottomMarginPx);
          const fits = m.scrollHeight <= m.clientHeight + 1 && m.lastTextBottom <= m.limit + 0.5;
          return { ...m, fits, blockedRequests: blocked.count };
        } finally {
          await page.close();
        }
      })(), timeoutMs);
    },
    async pdf(html, outPath) {
      return withTimeout((async () => {
        const { page, blocked } = await openPage(html);
        try {
          await page.pdf({ path: outPath, width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true });
        } finally {
          await page.close();
        }
        const { readFile } = await import("node:fs/promises");
        const pages = pdfPageCount(await readFile(outPath));
        return { path: outPath, pages, blockedRequests: blocked.count };
      })(), timeoutMs);
    },
    async close() {
      try {
        await launched.close();
      } catch {
        // ignore
      }
    },
  };
}
