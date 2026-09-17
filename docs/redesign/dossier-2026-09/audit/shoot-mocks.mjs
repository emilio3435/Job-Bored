/* ============================================================
   shoot-mocks.mjs — screenshots of the redesign mocks, and the same
   overflow audit run against them.
   ------------------------------------------------------------
   The mocks have to pass the check the shipped layout fails, or they
   are just prettier pictures. Every shot is preceded by the same
   measurement: no element inside .dossier may overflow its own box
   without a scroller, and no track may fall below the floor its
   contents are designed for.

   Run:  node docs/redesign/dossier-2026-09/audit/shoot-mocks.mjs
   Out:  docs/redesign/dossier-2026-09/screenshots/after-*.png
         docs/redesign/dossier-2026-09/audit/MOCK-AUDIT.json
   ============================================================ */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKS = resolve(HERE, "..", "mocks");
const SHOTS = resolve(HERE, "..", "screenshots");

const SHOTS_TO_TAKE = [
  { out: "after-default-1440", page: "01-default.html", width: 1560, target: '[data-mount="wide"] .dossier' },
  { out: "after-default-1440-annotated", page: "01-default.html?annotate=1", width: 1560, target: '[data-mount="wide"] .dossier' },
  { out: "after-default-1280", page: "01-default.html", width: 1400, target: '[data-mount="narrow-laptop"] .dossier' },
  { out: "after-scrolled-1440", page: "02-scrolled.html?y=980", width: 1560, viewportShot: true, height: 900 },
  { out: "after-materials-drafting", page: "03-materials-request.html", width: 1560, target: '[data-mount="drafting"] .dossier' },
  { out: "after-materials-failed", page: "03-materials-request.html", width: 1560, target: '[data-mount="failed"] .dossier' },
  { out: "after-materials-rows", page: "03-materials-request.html", width: 1560, target: '[data-mount="rows"]' },
  { out: "after-narrow-900", page: "04-narrow.html", width: 1000, target: '[data-mount="w900"] .dossier' },
  { out: "after-narrow-390", page: "04-narrow.html", width: 470, target: '[data-mount="w390"] .dossier' },
  { out: "after-states", page: "05-states.html", width: 1560, target: ".mock-grid" },
  { out: "after-annotation-legend", page: "01-default.html?annotate=1", width: 1400, target: ".mock-legend" },
];

/* Widths the audit measures the full dossier at. The mock pages pin
   their own frames, so the audit drives the viewport instead and reads
   the frame that matches. */
const AUDIT = [
  { page: "01-default.html", mount: "wide", widths: [1560, 1400] },
  { page: "03-materials-request.html", mount: "drafting", widths: [1560, 1400] },
  { page: "03-materials-request.html", mount: "failed", widths: [1560, 1400] },
  { page: "04-narrow.html", mount: "w900", widths: [1000] },
  { page: "04-narrow.html", mount: "w720", widths: [800] },
  { page: "04-narrow.html", mount: "w390", widths: [470] },
];

const collect = (mount) => {
  const round = (n) => Math.round(n * 10) / 10;
  const root = document.querySelector(`[data-mount="${mount}"] .dossier`);
  if (!root) return { error: `no .dossier under ${mount}` };

  const trim = (s) => {
    const t = (s || "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  };
  const label = (el) => (el.className || "").toString().split(/\s+/)
    .find((c) => c.startsWith("dossier__")) || el.tagName.toLowerCase();

  const overflow = [];
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue;
    if (el.classList.contains("dossier__vh")) continue;
    const cs = getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowX)) continue;
    /* The ::after hit-target expanders on the chips and the segmented
       control are inset a few px, same benign artifact the before-audit
       filters out. */
    const excess = el.scrollWidth - el.clientWidth;
    const expander = el.classList.contains("dossier__doc-btn") || el.classList.contains("dossier__seg-b");
    if (excess > 1 && !(expander && excess <= 6)) {
      overflow.push({ el: label(el), overflowPx: round(excess), boxPx: round(el.clientWidth), text: trim(el.textContent) });
    }
  }

  /* Mid-word breaks are the tell that a track went below its floor.
     A label of N characters rendered over more lines than
     ceil(N / charsPerLine) means the text broke inside a word. */
  const shredded = [];
  for (const el of root.querySelectorAll(".dossier__doc-name, .dossier__title, .dossier__row dd, .dossier__event-t")) {
    const r = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const lines = Math.round(r.height / lh);
    const chars = (el.textContent || "").trim().length;
    if (lines >= 3 && chars / lines < 6) {
      shredded.push({ el: label(el), lines, chars, widthPx: round(r.width), text: trim(el.textContent) });
    }
  }

  const body = root.querySelector(".dossier__body");
  const canvas = root.querySelector(".dossier__canvas");
  const ledger = root.querySelector(".dossier__ledger");
  const docket = root.querySelector(".dossier__docket");

  return {
    frameWidth: round(root.getBoundingClientRect().width),
    columns: body ? getComputedStyle(body).gridTemplateColumns : null,
    canvasWidth: canvas ? round(canvas.getBoundingClientRect().width) : 0,
    ledgerWidth: ledger ? round(ledger.getBoundingClientRect().width) : 0,
    docketPosition: docket ? getComputedStyle(docket).position : null,
    /* The frame must not be a scroll container, or the docket cannot
       stick — the single most consequential property in the redesign. */
    frameOverflowX: getComputedStyle(root).overflowX,
    docNameCols: [...root.querySelectorAll(".dossier__doc-name")]
      .map((el) => round(el.getBoundingClientRect().width)),
    overflow,
    shredded,
  };
};

const run = async () => {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const audit = { generatedAt: new Date().toISOString(), runs: [] };

  for (const spec of AUDIT) {
    for (const width of spec.widths) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.goto(`file://${resolve(MOCKS, spec.page)}`);
      await page.waitForSelector(".dossier__body");
      await page.evaluate(() => document.fonts.ready);
      audit.runs.push({ page: spec.page, mount: spec.mount, viewport: width, ...(await page.evaluate(collect, spec.mount)) });
      await page.close();
    }
  }

  for (const s of SHOTS_TO_TAKE) {
    const page = await browser.newPage({
      viewport: { width: s.width, height: s.height || 1000 },
      deviceScaleFactor: 2,
    });
    await page.goto(`file://${resolve(MOCKS, s.page)}`);
    await page.waitForSelector(".dossier, .mock-shelf");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const out = resolve(SHOTS, `${s.out}.png`);
    if (s.viewportShot) await page.screenshot({ path: out });
    else await (await page.$(s.target)).screenshot({ path: out });
    await page.close();
    console.log(`shot  ${s.out}.png`);
  }

  await browser.close();
  await writeFile(resolve(HERE, "MOCK-AUDIT.json"), `${JSON.stringify(audit, null, 2)}\n`);

  let bad = 0;
  for (const r of audit.runs) {
    const flags = (r.overflow?.length || 0) + (r.shredded?.length || 0);
    bad += flags;
    console.log(
      `${r.page.padEnd(26)} ${r.mount.padEnd(9)} ${String(r.viewport).padStart(5)}px  `
      + `frame=${r.frameWidth} canvas=${r.canvasWidth} ledger=${r.ledgerWidth}  `
      + `overflow=${r.overflow?.length ?? "?"} shredded=${r.shredded?.length ?? "?"}`
      + (flags ? "  <-- FAILS" : ""),
    );
    for (const o of r.overflow || []) console.log(`    overflow  ${o.el} +${o.overflowPx}px of ${o.boxPx}px | ${o.text}`);
    for (const s of r.shredded || []) console.log(`    shredded  ${s.el} ${s.lines} lines / ${s.chars} chars @ ${s.widthPx}px | ${s.text}`);
  }
  console.log(bad ? `\n${bad} finding(s) — the mock does not yet pass its own check.` : "\nClean at every audited width.");
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
