/* ============================================
   Resume ingestion — extract + normalize text
   Requires: pdf.js (pdfjsLib), mammoth (global)
   ============================================ */

(function () {
  // Vendored locally — the worker is fetched lazily at FIRST PARSE, so a CDN
  // here meant every cold cache paid a 1MB third-party download mid-upload
  // ("Reading…" hangs on filtered/slow networks). Local = disk-fast, offline-
  // safe, and honest about the step's "Stays in your browser" promise.
  const PDF_WORKER_SRC = "vendor/pdf.worker.min.js";

  // Lazy-load pdf.js + mammoth on first PDF/DOCX upload. They used to live in
  // index.html (963 KB combined on every cold start), which dominated LCP on
  // Fast-3G connections for users who never opened a resume. We now inject
  // them at first parse — already covered by the watchdog in
  // extractTextFromFile, so a flaky CDN/network surfaces as the same
  // actionable error users see today.
  const RESUME_READER_SCRIPTS = [
    "vendor/pdf.min.js",
    "vendor/mammoth.browser.min.js",
  ];
  let resumeReadersPromise = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (typeof document === "undefined" || !document.head) {
        reject(new Error("Cannot load " + src + ": no document.head"));
        return;
      }
      const existing = document.querySelector(
        'script[src="' + src + '"]',
      );
      if (existing && existing.dataset.resumeReader === "loaded") {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = false; // preserve order across the two vendors
      s.dataset.resumeReader = "loading";
      s.onload = function () {
        s.dataset.resumeReader = "loaded";
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      document.head.appendChild(s);
    });
  }
  function loadResumeReaders() {
    // No-op when at least one vendor already lives on the page — covers two
    // real cases: (a) the user already uploaded once this session and the
    // promise cached; (b) test harnesses pre-stub pdfjsLib / mammoth in a
    // VM context with no document.head — injecting a <script> there would
    // throw before the watchdog can take over.
    const hasPdf =
      typeof window !== "undefined" &&
      (window.pdfjsLib || typeof pdfjsLib !== "undefined");
    const hasMammoth =
      typeof window !== "undefined" &&
      (window.mammoth || typeof mammoth !== "undefined");
    if (hasPdf && hasMammoth) return Promise.resolve();
    // If we're outside a real DOM (e.g., VM-harness tests that pre-stub one
    // vendor but not both), don't try to inject; the dispatch step will fall
    // back to its own typeof-guard error.
    if (typeof document === "undefined" || !document.head) {
      return Promise.resolve();
    }
    if (resumeReadersPromise) return resumeReadersPromise;
    resumeReadersPromise = Promise.all(
      RESUME_READER_SCRIPTS.map(loadScript),
    )
      .then(function () {
        if (typeof window !== "undefined") {
          window.__resumeReadersLoaded = true;
        }
      })
      .catch(function (err) {
        // Reset so the next upload can retry instead of latching forever.
        resumeReadersPromise = null;
        throw err;
      });
    return resumeReadersPromise;
  }

  function ensurePdfWorker() {
    const pdfjs =
      typeof pdfjsLib !== "undefined"
        ? pdfjsLib
        : typeof window !== "undefined"
          ? window.pdfjsLib
          : undefined;
    if (!pdfjs) return;
    // ALWAYS force the vendored path — the old only-if-unset guard let a
    // stale CDN workerSrc (set lazily by pre-vendoring code in a long-lived
    // tab) survive forever, so every parse fetched the 1MB worker from a
    // filtered CDN and timed out while the same file parsed instantly in a
    // clean browser. The vendored worker is the only correct value here.
    if (pdfjs.GlobalWorkerOptions.workerSrc !== PDF_WORKER_SRC) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }
  }

  // Last parse phase, read by the watchdog so a timeout names WHERE it
  // stalled (one parse at a time in practice).
  let lastParsePhase = "start";

  /**
   * Collapse whitespace; trim repeated blank lines.
   * @param {string} text
   * @returns {string}
   */
  function normalizeExtractedText(text) {
    if (!text || typeof text !== "string") return "";
    let s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.replace(/[\t\f\v]+/g, " ");
    s = s.replace(/ +/g, " ");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  // Bullet glyphs PDF and Word exports use, including Symbol/Wingdings
  // private-use code points; each becomes a plain "- " marker.
  const BULLET_GLYPH_RE =
    /^[\u2022\u2023\u2043\u2219\u25aa\u25ab\u25cf\u25e6\u25a0\u25a1\u27a2\u2756\uf0a7\uf0b7\uf0d8\uf076]\s*/;

  /** @param {string} line */
  function normalizeBulletLine(line) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    return BULLET_GLYPH_RE.test(trimmed)
      ? "- " + trimmed.replace(BULLET_GLYPH_RE, "")
      : trimmed;
  }

  /**
   * Rebuild text lines from pdf.js text items. A line ends where pdf.js
   * marks hasEOL or where the baseline (transform[5]) moves; runs on one
   * line join with a space only when there is a visible gap between them.
   * Joining every run with " " flattened a whole resume into one line.
   * @param {Array<{str?: string, hasEOL?: boolean, transform?: number[], width?: number, height?: number}>} items
   * @returns {string[]}
   */
  function linesFromPdfTextItems(items) {
    const lines = [];
    let line = "";
    let lastY = null;
    let lastEndX = null;
    const flush = () => {
      const text = normalizeBulletLine(line);
      if (text && text !== "-") lines.push(text);
      line = "";
      lastEndX = null;
    };
    for (const it of items || []) {
      if (!it || typeof it.str !== "string") continue;
      const t = Array.isArray(it.transform) ? it.transform : [];
      const x = typeof t[4] === "number" ? t[4] : null;
      const y = typeof t[5] === "number" ? t[5] : null;
      const h = typeof it.height === "number" && it.height > 0 ? it.height : 0;
      if (line && lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(2, h * 0.5)) {
        flush();
      }
      if (it.str) {
        if (
          line &&
          lastEndX !== null &&
          x !== null &&
          x - lastEndX > 0.5 &&
          !/\s$/.test(line) &&
          !/^\s/.test(it.str)
        ) {
          line += " ";
        }
        line += it.str;
        if (y !== null) lastY = y;
        lastEndX =
          x !== null && typeof it.width === "number" ? x + it.width : null;
      }
      if (it.hasEOL) flush();
    }
    flush();
    return lines;
  }

  const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
  const PDF_MIME = "application/pdf";
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const INVALID_RESUME_FILE_MESSAGE =
    "That file doesn't match a supported PDF or DOCX. Choose a valid file or paste the text instead.";
  // Compatibility for the older Settings profile tab: this cache is populated
  // only after bytes were sniffed, so metadata never chooses a document type.
  const sniffedMimeByFile = new WeakMap();

  function assertResumeFileSize(file) {
    const size = Number(file && file.size);
    if (Number.isFinite(size) && size > MAX_RESUME_FILE_BYTES) {
      throw new Error("This file is over the 10 MB limit. Choose a smaller file or paste the text instead.");
    }
  }

  /**
   * Word HTML (from mammoth.convertToHtml) to plain lines: each list item
   * becomes a "- " line, each paragraph, heading and table row its own
   * line. Pure string work so it runs without a DOM.
   * @param {string} html
   * @returns {string}
   */
  function textFromDocxHtml(html) {
    const text = String(html || "")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:p|li|h[1-6]|tr|ul|ol|table|div)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
        if (code[0] === "#") {
          const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, code.toLowerCase())
          ? HTML_ENTITIES[code.toLowerCase()]
          : m;
      });
    return text
      .split("\n")
      .map((l) => normalizeBulletLine(l.replace(/^-\s+(?=-\s)/, "")))
      .filter((l) => l && l !== "-")
      .join("\n");
  }

  // Timing trace for "why is this PDF slow?" — the two usual suspects are
  // the worker boot (first parse spins up the pdf.js worker) and per-page
  // text extraction on large/scanned documents.
  function nowMs() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  async function extractTextFromPdf(arrayBuffer) {
    ensurePdfWorker();
    const pdfjs =
      typeof pdfjsLib !== "undefined"
        ? pdfjsLib
        : typeof window !== "undefined"
          ? window.pdfjsLib
          : undefined;
    if (!pdfjs) {
      throw new Error("PDF.js not loaded");
    }
    const tDoc = nowMs();
    lastParsePhase = "booting the PDF reader (worker + document structure)";
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    // Without an onPassword handler, pdf.js leaves loadingTask.promise
    // pending FOREVER on encrypted PDFs — the exact "Reading…" infinite
    // spinner users hit. Name the problem instead of hanging.
    let rejectPassword = null;
    const passwordGuard = new Promise((_, reject) => {
      rejectPassword = reject;
    });
    passwordGuard.catch(() => {}); // observed via race; avoid a stray rejection
    try {
      loadingTask.onPassword = () => {
        try {
          if (typeof loadingTask.destroy === "function") loadingTask.destroy();
        } catch (_) {}
        rejectPassword(
          new Error(
            "This PDF is password-protected. Remove the password (print-to-PDF works), or paste the resume text below instead.",
          ),
        );
      };
    } catch (_) {}
    const pdf = await Promise.race([loadingTask.promise, passwordGuard]);
    console.info(
      `[JobBored] resume parse: document ready in ${Math.round(nowMs() - tDoc)}ms ` +
        `(worker boot + structure parse, ${pdf.numPages} page(s), worker: ${PDF_WORKER_SRC})`,
    );
    const tPages = nowMs();
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tPage = nowMs();
      lastParsePhase = `extracting text (page ${i}/${pdf.numPages})`;
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lines = linesFromPdfTextItems(content.items);
      parts.push(lines.join("\n"));
      console.info(
        `[JobBored] resume parse: page ${i}/${pdf.numPages} in ${Math.round(nowMs() - tPage)}ms (${content.items.length} text runs, ${lines.length} lines)`,
      );
    }
    console.info(
      `[JobBored] resume parse: all pages extracted in ${Math.round(nowMs() - tPages)}ms`,
    );
    return normalizeExtractedText(parts.join("\n"));
  }

  async function extractTextFromDocx(arrayBuffer) {
    const mammothLib =
      typeof mammoth !== "undefined"
        ? mammoth
        : typeof window !== "undefined"
          ? window.mammoth
          : undefined;
    if (!mammothLib) {
      throw new Error("Mammoth not loaded");
    }
    // convertToHtml keeps Word's list structure, so bullets survive as
    // "- " lines; extractRawText dropped them and the ledger found no claims.
    if (typeof mammothLib.convertToHtml === "function") {
      const html = await mammothLib.convertToHtml({ arrayBuffer });
      return normalizeExtractedText(textFromDocxHtml(html.value || ""));
    }
    const result = await mammothLib.extractRawText({ arrayBuffer });
    return normalizeExtractedText(result.value || "");
  }

  function sniffDocumentMime(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (
      bytes.length >= 5 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2d
    ) return PDF_MIME;
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return DOCX_MIME;
    }
    return null;
  }

  function guessMime(file) {
    return file && typeof file === "object" ? sniffedMimeByFile.get(file) || "text/plain" : "text/plain";
  }

  function metadataClaimsDocument(file) {
    const name = String(file && file.name || "").toLowerCase();
    const type = String(file && file.type || "").toLowerCase();
    return /\.pdf$|\.docx?$/.test(name) || /pdf|wordprocessingml|msword/.test(type);
  }

  function decodePlainText(file, buffer) {
    if (metadataClaimsDocument(file)) throw new Error(INVALID_RESUME_FILE_MESSAGE);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("Unsupported file type. Use PDF, DOCX, or plain text (.txt / .md).");
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      throw new Error("Unsupported file type. Use PDF, DOCX, or plain text (.txt / .md).");
    }
    return normalizeExtractedText(text);
  }

  async function dispatchExtraction(file, buf, mime) {
    if (mime === PDF_MIME) return extractTextFromPdf(buf);
    if (mime === DOCX_MIME) return extractTextFromDocx(buf);
    return decodePlainText(file, buf);
  }

  /**
   * @param {File} file
   * @param {{timeoutMs?: number}} [options] — watchdog deadline (default 20s)
   * @returns {Promise<string>}
   */
  async function extractTextFromFile(file, options = {}) {
    assertResumeFileSize(file);
    const tRead = nowMs();
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_RESUME_FILE_BYTES) {
      throw new Error("This file is over the 10 MB limit. Choose a smaller file or paste the text instead.");
    }
    console.info(
      `[JobBored] resume parse: file read in ${Math.round(nowMs() - tRead)}ms ` +
        `(${buf.byteLength}B)`,
    );
    const mime = sniffDocumentMime(buf);
    if (file && typeof file === "object") {
      if (mime) sniffedMimeByFile.set(file, mime);
      else sniffedMimeByFile.delete(file);
    }
    if (!mime && metadataClaimsDocument(file)) throw new Error(INVALID_RESUME_FILE_MESSAGE);
    // Pull pdf.js + mammoth on demand only after size and signature checks.
    // After the first call they're cached; subsequent uploads pay nothing here.
    if (mime) await loadResumeReaders();
    // Watchdog: parsing must never out-wait the user. pdf.js (and a wedged
    // worker) can stall without rejecting; after the deadline we surface an
    // actionable error — the paste fallback is right there on the step.
    const timeoutMs =
      Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000;
    lastParsePhase = "start";
    let timeoutId = null;
    const watchdog = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Still couldn't read “${file.name || "that file"}” after ${Math.round(timeoutMs / 1000)}s (stalled at: ${lastParsePhase}). Paste the resume text below instead.`,
          ),
        );
      }, timeoutMs);
    });
    watchdog.catch(() => {}); // observed via race; avoid a stray rejection
    try {
      return await Promise.race([dispatchExtraction(file, buf, mime), watchdog]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  /**
   * Return a request-only base64 document for supported model file inputs.
   * Text-only formats continue through the extracted-text path.
   * @param {File} file
   */
  async function documentForModel(file) {
    assertResumeFileSize(file);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_RESUME_FILE_BYTES) {
      throw new Error("This file is over the 10 MB limit. Choose a smaller file or paste the text instead.");
    }
    const mimeType = sniffDocumentMime(buffer);
    if (file && typeof file === "object") {
      if (mimeType) sniffedMimeByFile.set(file, mimeType);
      else sniffedMimeByFile.delete(file);
    }
    if (!mimeType) {
      if (metadataClaimsDocument(file)) throw new Error(INVALID_RESUME_FILE_MESSAGE);
      return null;
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.length);
      for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]);
    }
    const encode = typeof btoa === "function" ? btoa : window.btoa.bind(window);
    return {
      mimeType,
      filename: String(file.name || (mimeType === PDF_MIME ? "resume.pdf" : "resume.docx")).replace(/[\r\n]/g, " ").slice(0, 180),
      data: encode(binary),
    };
  }

  // ---------------------------------------------------------------
  // RESJ K3: garbled text. A PDF whose text layer splits words and
  // figures ("S ummary", "$ 10 M +", "top -3") reads back broken, and
  // drafts built from it lose the name line and print split figures.
  // Same scoring as detectGarbledResume in server/materials-resume-
  // source.mjs (tests/resj-garbled-ingest.test.mjs pins them equal).
  // ---------------------------------------------------------------

  const NICKNAME_RE = /\s*(?:“[^”\n]{1,24}”|"[^"\n]{1,24}"|‘[^’\n]{1,24}’|\([^)\n]{1,24}\))\s*/gu;

  /** @param {string} text */
  function candidateNameFromText(text) {
    const first = String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!first) return "";
    if (first.length > 60 || /[@\d:/]/.test(first)) return "";
    if (first.split(/\s+/).length > 6) return "";
    return first.replace(NICKNAME_RE, " ").replace(/\s+/g, " ").trim();
  }

  /** @param {string} text @param {RegExp} re */
  function countMatches(text, re) {
    return (text.match(re) || []).length;
  }

  /* Resume words a PDF splits after their capital; mirrors
   * SPLIT_JOINED_WORDS in server/materials-resume-source.mjs. */
  /* Section headings: two split ones are decisive (RESJ K3-LEN). */
  const SPLIT_HEADING_WORDS = new Set(
    "summary experience skills education profile projects certifications certificates languages awards objective employment leadership achievements accomplishments professional technical competencies volunteer publications interests references contact highlights career history training tools qualifications expertise responsibilities strengths selected work core key about honors activities affiliations memberships courses coursework portfolio overview background research teaching speaking patents".split(" "),
  );
  const SPLIT_JOINED_WORDS = new Set([
    ...SPLIT_HEADING_WORDS,
    ..."managed led built grew drove launched created developed designed owned delivered increased reduced improved implemented directed established executed generated negotiated oversaw partnered produced scaled shipped spearheaded streamlined supervised trained wrote analyzed coordinated mentored optimized senior director manager marketing product engineer engineering analyst specialist consultant president present company university college bachelor master associate performance growth strategy sales operations".split(" "),
  ]);

  /** Capitals split off their word; see countSplitWords on the server. */
  function countSplitWords(text) {
    let words = 0;
    let headings = 0;
    /* A and I too ("A wards", "I nterests"); "Type A", "A/B" and
     * "I managed" never join into a listed word (RESJ K3-AI). */
    for (const m of text.matchAll(/(?<![\p{L}\p{N}])([A-Z]) ([a-z]{2,})/gu)) {
      const joined = (m[1] + m[2]).toLowerCase();
      if (!SPLIT_JOINED_WORDS.has(joined)) continue;
      words += 1;
      if (SPLIT_HEADING_WORDS.has(joined)) headings += 1;
    }
    return { words, headings };
  }

  /**
   * @param {string} text
   * @returns {{ garbled: boolean, score: number, words: number, nameLine: boolean,
   *   signals: { splitWords: number, spacedPunctuation: number, spacedMetrics: number, orphanLetters: number } }}
   */
  function detectGarbledText(text) {
    const t = String(text || "");
    const words = t.split(/\s+/).filter(Boolean).length;
    const split = countSplitWords(t);
    const signals = {
      splitWords: split.words,
      spacedPunctuation:
        countMatches(t, /[\p{L}\p{N}] [,;:)](?=\s|$)/gu) +
        countMatches(t, /[\p{L}\p{N}] \.(?=\s|$)/gu) +
        countMatches(t, /\( [\p{L}\p{N}]/gu),
      spacedMetrics: countMatches(t, /\$ \d|\d [KMB](?![\w&])|\btop -\d|\d \+(?=\s|$)|\d %|# \d/g),
      orphanLetters: countMatches(t, /(?<=\s)[b-hj-z](?=\s)/g),
    };
    const score =
      signals.splitWords * 3 + signals.spacedPunctuation + signals.spacedMetrics * 3 + signals.orphanLetters;
    const nameLine = Boolean(candidateNameFromText(t));
    const density = words ? (score / words) * 100 : 0;
    /* Two split section headings are damage at any length (RESJ K3-LEN). */
    const garbled = split.headings >= 2 || (score >= 12 && density >= 2) || (score >= 6 && !nameLine);
    return { garbled, score, words, nameLine, signals };
  }

  window.CommandCenterResumeIngest = {
    detectGarbledText,
    normalizeExtractedText,
    guessMime,
    extractTextFromFile,
    documentForModel,
    extractTextFromPdf,
    extractTextFromDocx,
    linesFromPdfTextItems,
    textFromDocxHtml,
    loadResumeReaders,
  };
})();
