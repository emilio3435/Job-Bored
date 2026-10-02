/* measureInPage, the fonts wait and rasterize run inside the Playwright page. */
/* global document, NodeFilter, Image */
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

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
 * HOLES S9: the full `playwright` package (a repo-root dev dependency) keeps
 * local dev on its own browser builds; the server image has only its own
 * playwright-core, so fall back to that.
 * @param {(name: string) => Promise<any>} [importImpl]
 * @returns {Promise<{ chromium: { launch: Function } }>}
 */
export async function importPlaywright(importImpl = (name) => import(name)) {
  try {
    return await importImpl("playwright");
  } catch {
    return importImpl("playwright-core");
  }
}

/**
 * HOLES S9: JOBBORED_CHROMIUM_PATH points Playwright at a system Chromium
 * (the Alpine image has no Playwright browser build).
 */
function launchOptions() {
  const executablePath = String(process.env.JOBBORED_CHROMIUM_PATH || "").trim();
  return executablePath ? { headless: true, executablePath } : { headless: true };
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
  const load = options.playwrightImport || (() => importPlaywright());
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
        const launched = await chromium.launch(launchOptions());
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
 * @property {(html: string, outPath: string) => Promise<{ path: string, pages: number, blockedRequests: number, type3Fonts?: number }>} pdf
 * @property {(src: string) => Promise<string>} rasterize an SVG data: URI as a PNG data: URI
 * @property {() => Promise<void>} close
 */

/**
 * Count Type3 fonts in PDF bytes. Chromium falls back to Type3 for a font it
 * cannot embed (every variable font), and Type3 text extracts with words
 * split apart, so a materials PDF should have none.
 * @param {Buffer} bytes
 */
export function pdfType3FontCount(bytes) {
  return (bytes.toString("latin1").match(/\/Subtype\s*\/Type3\b/g) || []).length;
}

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
 * Playwright keeps its browsers under the user's home cache. A process
 * that runs with HOME pointed elsewhere (a sandboxed or copied profile)
 * would look in the wrong place and find no browser. When HOME is not the
 * account's real home and PLAYWRIGHT_BROWSERS_PATH is unset, point it at
 * the real cache if one exists.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function ensureBrowsersPath(env = process.env) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  let realHome = "";
  try {
    realHome = userInfo().homedir;
  } catch {
    return "";
  }
  if (!realHome || realHome === homedir()) return "";
  const candidates = [
    join(realHome, "Library", "Caches", "ms-playwright"),
    join(realHome, ".cache", "ms-playwright"),
    join(realHome, "AppData", "Local", "ms-playwright"),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found) env.PLAYWRIGHT_BROWSERS_PATH = found;
  return found || "";
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
  ensureBrowsersPath();
  const load = options.playwrightImport || (() => importPlaywright());
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : PDF_TIMEOUT_MS;
  /** @type {{ newPage: Function, close: Function } | null} */
  let browser = null;
  try {
    const { chromium } = await withTimeout(load(), timeoutMs);
    browser = await withTimeout(Promise.resolve(chromium.launch(launchOptions())), timeoutMs);
  } catch {
    return null;
  }
  const launched = /** @type {{ newPage: Function, close: Function }} */ (browser);
  /** @type {Map<string, string>} */
  const rasterCache = new Map();

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
        const bytes = await readFile(outPath);
        return { path: outPath, pages: pdfPageCount(bytes), blockedRequests: blocked.count, type3Fonts: pdfType3FontCount(bytes) };
      })(), timeoutMs);
    },
    /* Chrome prints an SVG <img> as vectors, <text> included, so a
       generated monogram or wordmark would put its letters into the PDF
       text layer beside the employer's real name. Logos contribute no text:
       an SVG mark is drawn to a canvas at 4x its largest print size and
       embedded as a PNG, same pixels, no glyphs. */
    async rasterize(src) {
      if (!/^data:image\/svg\+xml/i.test(src)) return src;
      const cached = rasterCache.get(src);
      if (cached) return cached;
      const page = await launched.newPage();
      try {
        const png = await withTimeout(page.evaluate(async (/** @type {string} */ svg) => {
          const img = new Image();
          img.src = svg;
          await img.decode();
          const w = img.naturalWidth || 300;
          const h = img.naturalHeight || 150;
          const scale = 384 / h;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = 384;
          const ctx = canvas.getContext("2d");
          if (!ctx) return svg;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/png");
        }, src), timeoutMs);
        rasterCache.set(src, png);
        return png;
      } finally {
        await page.close();
      }
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
