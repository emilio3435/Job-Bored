/* ============================================
   Cold-start perf contract — pinned source shape
   ============================================

   Round-2 quality sweep (2026-06-11) cut the dashboard's Fast-3G LCP from
   24.3s → target < 16s by:

     1. Adding `defer` to every end-of-body classic <script> so parsing
        and execution stop blocking the first paint.
     2. Dropping the unused letter.css <link> from the critical path
        (letter.js was removed from the dashboard 2026-05-27; the file
        still ships on disk for the letter-* test surface).
     3. Lazy-loading vendor/pdf.min.js + vendor/mammoth.browser.min.js
        on first PDF/DOCX upload via resume-ingest.js#loadResumeReaders,
        instead of paying ~963 KB on every cold cache.

   This file pins those shape changes. If a future edit re-adds either
   vendor to the cold path, drops `defer`, or re-includes letter.css,
   we want a loud test failure right next to the diff that did it.
*/

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
const resumeIngestJs = readFileSync(
  join(repoRoot, "resume-ingest.js"),
  "utf8",
);

// Find every <script src="..."> in the end-of-body block (after the
// `<!-- Toast Container -->` marker and before `</body>`). These are the
// classic-global scripts whose execution timing dominates LCP.
function endOfBodyScriptTags(html) {
  const startIdx = html.indexOf("<!-- Toast Container -->");
  const endIdx = html.indexOf("</body>");
  assert.ok(startIdx >= 0 && endIdx > startIdx, "could not find body block");
  const block = html.slice(startIdx, endIdx);
  const re = /<script\s+src="([^"]+)"([^>]*)><\/script>/g;
  const tags = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    tags.push({ src: m[1], attrs: m[2] });
  }
  return tags;
}

describe("index.html cold-start perf contract", () => {
  it("defers every end-of-body classic <script src> tag", () => {
    const tags = endOfBodyScriptTags(indexHtml);
    assert.ok(
      tags.length >= 60,
      `expected many end-of-body scripts, saw ${tags.length}`,
    );
    const undeferred = tags.filter((t) => !/\bdefer\b/.test(t.attrs));
    assert.deepEqual(
      undeferred,
      [],
      "every end-of-body <script src> must use `defer` so it stops blocking " +
        "the first paint. Offenders: " +
        undeferred.map((t) => t.src).join(", "),
    );
  });

  it("does not eager-load the resume-reader vendors from cold start", () => {
    const tags = endOfBodyScriptTags(indexHtml);
    const eager = tags.filter(
      (t) =>
        t.src === "vendor/pdf.min.js" ||
        t.src === "vendor/mammoth.browser.min.js",
    );
    assert.deepEqual(
      eager,
      [],
      "vendor/pdf.min.js + vendor/mammoth.browser.min.js (963 KB combined) " +
        "must stay out of the cold-start critical path. They are injected " +
        "on first upload by resume-ingest.js#loadResumeReaders.",
    );
  });

  it("does not include letter.css as a render-blocking stylesheet", () => {
    // letter.js was removed from the dashboard 2026-05-27; the linked CSS
    // is dead weight in the critical path. The file stays on disk because
    // tests/letter-*.test.mjs still pin its contents.
    assert.equal(
      /<link\s+rel="stylesheet"\s+href="letter\.css"/.test(indexHtml),
      false,
      "letter.css must not appear as a <link rel='stylesheet'> — its only " +
        "consumer (letter.js) was removed from index.html 2026-05-27.",
    );
  });
});

describe("resume-ingest.js lazy reader contract", () => {
  it("exposes a loadResumeReaders function on the public surface", () => {
    assert.match(
      resumeIngestJs,
      /function loadResumeReaders\s*\(/,
      "resume-ingest.js must define loadResumeReaders()",
    );
    assert.match(
      resumeIngestJs,
      /loadResumeReaders\s*,/,
      "loadResumeReaders must be re-exported on " +
        "window.CommandCenterResumeIngest so callers (and tests) can warm it",
    );
  });

  it("injects pdf.min.js and mammoth.browser.min.js on demand", () => {
    assert.match(
      resumeIngestJs,
      /"vendor\/pdf\.min\.js"/,
      "loadResumeReaders must reference vendor/pdf.min.js",
    );
    assert.match(
      resumeIngestJs,
      /"vendor\/mammoth\.browser\.min\.js"/,
      "loadResumeReaders must reference vendor/mammoth.browser.min.js",
    );
  });

  it("awaits the lazy loader before parsing in the public entry", () => {
    // The public entry point (extractTextFromFile) must call the loader
    // before touching pdfjsLib / mammoth, otherwise the first upload races
    // a still-unloaded vendor and hits the watchdog.
    const entryIdx = resumeIngestJs.indexOf(
      "async function extractTextFromFile",
    );
    assert.ok(
      entryIdx > -1,
      "extractTextFromFile entry function must still exist",
    );
    const entryBody = resumeIngestJs.slice(entryIdx, entryIdx + 400);
    assert.match(
      entryBody,
      /await loadResumeReaders\(\)/,
      "extractTextFromFile must `await loadResumeReaders()` before parsing",
    );
  });
});
