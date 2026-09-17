/* ============================================================
   measure.mjs — overflow audit for the shipped 3-column dossier.
   ------------------------------------------------------------
   Loads docs/redesign/dossier-2026-09/audit/current-3col-probe.html (which
   loads production CSS and the production renderer), then reports, per
   element inside .case:

     escapes        the element's ink crosses the .case content box, so
                    `overflow: hidden` on .case clips it
     self-overflow  scrollWidth > clientWidth: content wider than its own
                    padding box, with no scroller to reach it
     column-bleed   the element's right edge crosses the right edge of the
                    .case__lane it lives in, so it paints over its neighbour

   Run:  node docs/redesign/dossier-2026-09/audit/measure.mjs
   Out:  docs/redesign/dossier-2026-09/audit/RESULTS.json
         docs/redesign/dossier-2026-09/screenshots/before-*.png
   ============================================================ */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = resolve(HERE, "current-3col-probe.html");
const SHOTS = resolve(HERE, "..", "screenshots");

/* The dogfood band from the brief, plus 1024 as the last width above the
   shipped 1080px media query — the widths where the 3-column board is on. */
const WIDTHS = [1024, 1280, 1440, 1512];

const VARIANTS = [
  { id: "default", label: "filled role · resume ready · letter failed" },
  { id: "materials-drafting", label: "cover letter drafting in flight" },
  { id: "long-title", label: "long posting title in the masthead" },
];

const collect = () => {
  const round = (n) => Math.round(n * 10) / 10;
  const caseEl = document.querySelector(".case");
  if (!caseEl) return { error: "no .case rendered" };

  const cs = getComputedStyle(caseEl);
  const caseRect = caseEl.getBoundingClientRect();
  const caseBox = {
    left: caseRect.left + parseFloat(cs.borderLeftWidth),
    right: caseRect.right - parseFloat(cs.borderRightWidth),
  };

  const label = (el) => {
    const cls = (el.className || "").toString().split(/\s+/)
      .filter((c) => c.startsWith("case__") || c.startsWith("brief-materials"))[0];
    return cls || el.tagName.toLowerCase();
  };
  const trim = (s) => {
    const t = (s || "").replace(/\s+/g, " ").trim();
    return t.length > 68 ? `${t.slice(0, 68)}…` : t;
  };

  const findings = { escapes: [], selfOverflow: [], columnBleed: [], noise: [] };

  /* Two measurement artifacts that are not layout faults, separated out so the
     findings list stays trustworthy:
       - visually-hidden text (.case__vh, .case__st--vh) lives in a 1px box on
         purpose, so its scrollWidth is meant to exceed its clientWidth;
       - the ::after hit-target expanders (.case__step, .case__doc-a) are inset
         a few px horizontally, which shows up as a small scrollWidth excess. */
  const isHidden = (el, r) => r.width <= 2 || r.height <= 2;
  const isHitTargetPseudo = (el, excess) => excess <= 6
    && (el.classList.contains("case__step") || el.classList.contains("case__doc-a"));
  const lanes = [...caseEl.querySelectorAll(".case__lane")].map((lane) => {
    const lcs = getComputedStyle(lane);
    const r = lane.getBoundingClientRect();
    return {
      el: lane,
      name: label(lane),
      inner: {
        left: r.left + parseFloat(lcs.paddingLeft),
        right: r.right - parseFloat(lcs.paddingRight),
      },
      width: round(r.width),
      contentWidth: round(r.width - parseFloat(lcs.paddingLeft) - parseFloat(lcs.paddingRight)),
    };
  });

  for (const el of caseEl.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const name = label(el);

    /* Ink that leaves the frame is clipped: .case is overflow: hidden. */
    if (r.right > caseBox.right + 0.5 || r.left < caseBox.left - 0.5) {
      el.setAttribute("data-probe", "escapes");
      findings.escapes.push({
        el: name,
        clippedPx: round(Math.max(r.right - caseBox.right, caseBox.left - r.left)),
        text: trim(el.textContent),
      });
    }

    /* Content wider than its own padding box, with no scroller. */
    const scrollable = /auto|scroll/.test(getComputedStyle(el).overflowX);
    const excess = el.scrollWidth - el.clientWidth;
    if (excess > 1 && !scrollable) {
      const entry = {
        el: name,
        overflowPx: round(excess),
        boxPx: round(el.clientWidth),
        text: trim(el.textContent),
      };
      if (isHidden(el, r) || isHitTargetPseudo(el, excess)) {
        findings.noise.push({ ...entry, why: isHidden(el, r) ? "visually hidden by design" : "hit-target pseudo" });
      } else {
        el.setAttribute("data-probe", "self-overflow");
        findings.selfOverflow.push(entry);
      }
    }

    /* Ink crossing out of its own lane paints over the neighbouring lane.
       The lane itself is excluded: its own right padding is not a bleed. */
    const lane = lanes.find((l) => l.el !== el && l.el.contains(el));
    if (lane && r.right > lane.inner.right + 0.5 && !isHidden(el, r)) {
      findings.columnBleed.push({
        el: name,
        lane: lane.name,
        bleedPx: round(r.right - lane.inner.right),
        text: trim(el.textContent),
      });
    }
  }

  /* Named measurements the teardown cites directly. */
  const dims = (sel, key) => {
    const el = caseEl.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { [key]: { width: round(r.width), scrollWidth: round(el.scrollWidth), clientWidth: round(el.clientWidth) } };
  };

  const titleInput = caseEl.querySelector(".case__title");
  const events = caseEl.querySelector(".case__events");
  const eventCells = [...caseEl.querySelectorAll(".case__ev")];
  const tiles = [...caseEl.querySelectorAll(".case__num")];

  return {
    frame: {
      caseWidth: round(caseRect.width),
      caseOverflowX: cs.overflowX,
      dossierMaxWidth: getComputedStyle(caseEl.closest(".dossier")).maxWidth,
      viewport: window.innerWidth,
      /* The token is authored for a top-level flow region, where its `100%`
         is the page. Inside .dossier > .brief it re-resolves against .brief,
         so the 32px shell gutter is subtracted a second time. This is what a
         sibling region (pipeline) computes at the same viewport. */
      flowContentWidth: getComputedStyle(document.body).getPropertyValue("--jb-flow-content-width").trim(),
      siblingRegionWidth: (() => {
        const probe = document.createElement("div");
        probe.style.cssText = "width: var(--jb-flow-content-width); max-width: none;";
        document.body.appendChild(probe);
        const w = round(probe.getBoundingClientRect().width);
        probe.remove();
        return w;
      })(),
      unusedViewportPx: round(window.innerWidth - caseRect.width),
      boardColumns: getComputedStyle(caseEl.querySelector(".case__board")).gridTemplateColumns,
    },
    lanes: lanes.map(({ name, width, contentWidth }) => ({ name, width, contentWidth })),
    masthead: titleInput
      ? {
        inputWidth: round(titleInput.getBoundingClientRect().width),
        valueScrollWidth: round(titleInput.scrollWidth),
        truncatedPx: round(Math.max(0, titleInput.scrollWidth - titleInput.clientWidth)),
        value: titleInput.value,
      }
      : null,
    numbers: {
      tileCount: tiles.length,
      tileWidth: tiles.length ? round(tiles[0].getBoundingClientRect().width) : 0,
      subOverflow: tiles
        .map((t) => {
          const sub = t.querySelector(".case__num-sub");
          if (!sub) return null;
          return {
            tile: t.getAttribute("data-num"),
            overflowPx: round(sub.scrollWidth - sub.clientWidth),
            lines: Math.round(sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight || 12)),
          };
        })
        .filter(Boolean),
    },
    record: events
      ? {
        eventCount: eventCells.length,
        columnWidth: eventCells.length ? round(eventCells[0].getBoundingClientRect().width) : 0,
        tallestLabelLines: Math.max(
          ...eventCells.map((c) => {
            const t = c.querySelector(".case__ev-t");
            if (!t) return 0;
            return Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight || 20));
          }),
        ),
      }
      : null,
    materials: [...caseEl.querySelectorAll(".case__doc")].map((row) => {
      const nameCell = row.querySelector(".case__doc-n");
      const st = row.querySelector(".case__docst");
      const acts = row.querySelector(".case__doc-actions");
      const r = (el) => (el ? round(el.getBoundingClientRect().width) : 0);
      const label2 = row.querySelector(".case__doc-label");
      return {
        doc: row.getAttribute("data-doc"),
        rowWidth: r(row),
        nameColPx: r(nameCell),
        statusColPx: r(st),
        actionsColPx: r(acts),
        labelLines: label2
          ? Math.round(label2.getBoundingClientRect().height / parseFloat(getComputedStyle(label2).lineHeight || 18))
          : 0,
        nameColMinContentPx: nameCell ? round(nameCell.scrollWidth) : 0,
      };
    }),
    laneHeights: [...caseEl.querySelectorAll(".case__lane")].map((l) => ({
      lane: label(l),
      height: round(l.getBoundingClientRect().height),
      inkHeight: round(
        Math.max(...[...l.children].map((c) => c.getBoundingClientRect().bottom))
        - l.getBoundingClientRect().top,
      ),
    })),
    dimensionRows: [...caseEl.querySelectorAll(".case__dim")].map((d) => ({
      label: trim(d.firstElementChild?.textContent),
      labelColPx: round(d.firstElementChild?.getBoundingClientRect().width || 0),
      labelOverflowPx: round((d.firstElementChild?.scrollWidth || 0) - (d.firstElementChild?.clientWidth || 0)),
    })),
    findings,
    ...(dims(".case__stepper", "stepper") || {}),
  };
};

const run = async () => {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const results = { generatedAt: new Date().toISOString(), probe: "current-3col-probe.html", runs: [] };

  for (const variant of VARIANTS) {
    for (const width of WIDTHS) {
      /* 1x for the full-dossier stills: a 1116px frame at 1x is exactly what
         the dogfooder sees. The materials crop below re-shoots at 2x, where
         the mid-word shredding is the detail that matters. */
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      await page.goto(`file://${PROBE}?variant=${variant.id}`);
      await page.waitForSelector(".case__board");
      await page.evaluate(() => document.fonts.ready);

      const data = await page.evaluate(collect);
      results.runs.push({ variant: variant.id, label: variant.label, width, ...data });

      /* Clean screenshot, then the painted one. Only the default variant at
         the two dogfood anchors gets shot; the rest are numbers only. */
      const shoot = (variant.id === "default" && (width === 1280 || width === 1440))
        || (variant.id === "materials-drafting" && width === 1440)
        || (variant.id === "long-title" && width === 1280);
      if (shoot) {
        const el = await page.$(".case");
        await el.screenshot({ path: resolve(SHOTS, `before-${variant.id}-${width}.png`) });

        /* The materials rows on their own, to sit beside
           after-materials-rows.png at the same rendered scale. This is
           the crop the dogfood report is describing. */
        if (width === 1440) {
          const rows = await page.$('[data-mount="materials"]');
          if (rows) {
            const hi = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
            await hi.goto(`file://${PROBE}?variant=${variant.id}`);
            await hi.waitForSelector('[data-mount="materials"] .case__doc');
            await hi.evaluate(() => document.fonts.ready);
            await (await hi.$('[data-mount="materials"]'))
              .screenshot({ path: resolve(SHOTS, `before-materials-rows-${variant.id}.png`) });
            await hi.close();
          }
        }

        /* The painted pass is available (html.probe-paint) but is not
           committed: it highlights almost nothing, because the shipped
           layout does not overflow its frame — it crushes its own tracks
           instead. That absence is the finding, and it is reported as a
           number (escapes: 0) rather than as an empty picture. */
        if (process.env.PROBE_PAINT === "1") {
          await page.evaluate(() => document.documentElement.classList.add("probe-paint"));
          await el.screenshot({ path: resolve(SHOTS, `before-${variant.id}-${width}-overflow.png`) });
        }
      }
      await page.close();
    }
  }

  await browser.close();
  await writeFile(resolve(HERE, "RESULTS.json"), `${JSON.stringify(results, null, 2)}\n`);

  /* Console summary, so a reviewer can see the headline without opening JSON. */
  for (const r of results.runs) {
    const f = r.findings || {};
    console.log(
      `${r.variant.padEnd(20)} ${String(r.width).padStart(5)}px  `
      + `case=${r.frame.caseWidth}  lane=${r.lanes[0]?.contentWidth ?? "-"}  `
      + `escapes=${(f.escapes || []).length}  self-overflow=${(f.selfOverflow || []).length}  `
      + `column-bleed=${(f.columnBleed || []).length}`,
    );
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
