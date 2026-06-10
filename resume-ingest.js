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
      const strings = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .filter(Boolean);
      parts.push(strings.join(" "));
      console.info(
        `[JobBored] resume parse: page ${i}/${pdf.numPages} in ${Math.round(nowMs() - tPage)}ms (${strings.length} text runs)`,
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
    const result = await mammothLib.extractRawText({ arrayBuffer });
    return normalizeExtractedText(result.value || "");
  }

  function guessMime(file) {
    const n = (file.name || "").toLowerCase();
    const t = file.type || "";
    if (t.includes("pdf") || n.endsWith(".pdf")) return "application/pdf";
    if (
      t.includes("wordprocessingml") ||
      t.includes("msword") ||
      n.endsWith(".docx")
    ) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (n.endsWith(".doc")) return "application/msword";
    if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain";
    return t || "application/octet-stream";
  }

  async function dispatchExtraction(file, buf) {
    const mime = guessMime(file);
    const name = (file.name || "").toLowerCase();

    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      return extractTextFromPdf(buf);
    }
    if (mime.includes("wordprocessingml") || name.endsWith(".docx")) {
      return extractTextFromDocx(buf);
    }
    if (
      mime.startsWith("text/") ||
      name.endsWith(".txt") ||
      name.endsWith(".md")
    ) {
      const dec = new TextDecoder("utf-8", { fatal: false });
      return normalizeExtractedText(dec.decode(buf));
    }

    throw new Error(
      "Unsupported file type. Use PDF, DOCX, or plain text (.txt / .md).",
    );
  }

  /**
   * @param {File} file
   * @param {{timeoutMs?: number}} [options] — watchdog deadline (default 20s)
   * @returns {Promise<string>}
   */
  async function extractTextFromFile(file, options = {}) {
    const tRead = nowMs();
    const buf = await file.arrayBuffer();
    console.info(
      `[JobBored] resume parse: file read in ${Math.round(nowMs() - tRead)}ms ` +
        `(${buf.byteLength}B, "${file.name || "unnamed"}")`,
    );
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
      return await Promise.race([dispatchExtraction(file, buf), watchdog]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  window.CommandCenterResumeIngest = {
    normalizeExtractedText,
    extractTextFromFile,
    extractTextFromPdf,
    extractTextFromDocx,
    guessMime,
  };
})();
