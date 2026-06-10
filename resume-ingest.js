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
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }
  }

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
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    console.info(
      `[JobBored] resume parse: document ready in ${Math.round(nowMs() - tDoc)}ms ` +
        `(worker boot + structure parse, ${pdf.numPages} page(s), worker: ${PDF_WORKER_SRC})`,
    );
    const tPages = nowMs();
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tPage = nowMs();
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

  /**
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function extractTextFromFile(file) {
    const tRead = nowMs();
    const buf = await file.arrayBuffer();
    console.info(
      `[JobBored] resume parse: file read in ${Math.round(nowMs() - tRead)}ms ` +
        `(${buf.byteLength}B, "${file.name || "unnamed"}")`,
    );
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

  window.CommandCenterResumeIngest = {
    normalizeExtractedText,
    extractTextFromFile,
    extractTextFromPdf,
    extractTextFromDocx,
    guessMime,
  };
})();
