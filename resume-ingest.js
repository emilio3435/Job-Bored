/* ============================================
   Resume ingestion — extract + normalize text
   Requires: pdf.js (pdfjsLib), mammoth (global)
   ============================================ */

(function () {
  const PDF_WORKER_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

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
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .filter(Boolean);
      parts.push(strings.join(" "));
    }
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
    const buf = await file.arrayBuffer();
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
