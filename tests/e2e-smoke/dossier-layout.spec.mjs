/**
 * dossier-layout.spec.mjs — the layout contract the shipped dossier had no
 * test for.
 *
 * The three-column board did not overflow: `repeat(3, minmax(0, 1fr))`,
 * `min-width: 0` and `overflow-wrap: anywhere` between them guaranteed the
 * layout always reported success, so a 12.3px name column with "Cover letter"
 * shredded over nine lines passed every one of the 166 jsdom assertions on
 * this surface. A jsdom test cannot see a crushed grid track; only a real
 * engine at a real width can.
 *
 * So this spec measures. At 1280 and 1440 it asserts, against the live app:
 *   - the frame is as wide as the pipeline region above it, and is not a
 *     scroll container (which is what forecloses the sticky docket)
 *   - the docket resolves to position: sticky and parks under the app chrome
 *   - no element's content is wider than its own box without a scroller
 *   - no label is shredded (3+ lines averaging under 6 characters each)
 *   - the materials rows keep a readable name column in every state,
 *     including the failed state that produced the bug report
 *
 * Why: docs/redesign/dossier-2026-09/TEARDOWN.md
 * Spec: docs/redesign/dossier-2026-09/SPEC.md §10 (acceptance criteria)
 *
 * Run:
 *   npm run test:e2e-smoke
 */

import { test, expect } from "@playwright/test";
import {
  installHermeticNetworkFence,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const ROLE_REGION = '[data-region="role"]';
const DEMO_BOARD = "#oneFlowDemoBoard";
/* The dogfood band from the brief. 1280 is the laptop the report came from;
   1440 is where the shipped board was worst. */
const WIDTHS = [1280, 1440];

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/* A long posting title on purpose: TEARDOWN §7 measured 81px of the real
   title unreachable inside the masthead input. */
const FIXTURE_JOB = {
  title: "Senior Marketing Manager, Digital Brand Media (US Remote)",
  company: "Meridian Labs",
  location: "Austin, TX",
  link: "https://jobs.meridian-labs.test/senior-marketing-manager",
  source: "Ashby",
  salary: "$185–230k",
  fitScore: 8,
  priority: "⚡",
  tags: "Design Systems, Accessibility",
  status: "Researching",
  notes: "Recruiter: Dana Whitfield (Talent Partner)",
  contact: "Dana Whitfield (Talent Partner)",
  responseFlag: "No",
  favorite: true,
  dateFoundRaw: "2026-08-29",
  _postingEnrichment: {
    roleInOneLine: "Own the brand's paid and organic story end to end.",
    mustHaves: [
      "8+ years in brand or performance marketing",
      "Owned a multi-channel budget above $2M",
      "Built a marketing analytics practice from scratch",
    ],
    niceToHaves: ["Marketplace experience", "Managed an agency roster"],
    toolsAndStack: ["Looker", "Braze", "Amplitude", "Figma"],
    talkingPoints: ["Cut blended CAC 24% in two quarters"],
    requirements: ["8+ years in brand or performance marketing", "Analytics ownership"],
    skills: ["Looker"],
    scrapedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  },
};

/* The two states that crushed the shipped row: a cover letter that failed
   after a retry (nowrap "couldn't finish" + Dismiss + Try again), and a
   resume in flight. Injected through role-materials.js's own renderer, so the
   markup under measurement is the production markup. */
const MANIFEST = {
  slug: "meridian-labs-senior-marketing-manager",
  documents: [
    {
      type: "resume",
      label: "Tailored resume",
      status: "ready",
      lastModifiedAt: "2026-08-30T09:00:00Z",
      primary: "resume.pdf",
      files: [{ filename: "resume.pdf", size: 184320, format: "pdf" }],
    },
  ],
  pending: {
    feature: "cover_letter",
    progress: { phase: "failed", elapsedSeconds: 67, attempt: 2 },
  },
  quality: { documents: {} },
};

async function openDossier(page) {
  await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator(DEMO_BOARD)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);

  const seeded = await page.evaluate((job) => {
    const core = window.JobBoredApp && window.JobBoredApp.core;
    const render = window.JobBoredApp && window.JobBoredApp.pipelineRender;
    if (!core || typeof core.setPipelineData !== "function") return false;
    core.setPipelineData([job]);
    render.renderPipeline();
    if (core.host && typeof core.host.revealDashboardShell === "function") {
      core.host.revealDashboardShell();
    }
    window.JobBoredFlowing.openRole.set("0");
    return true;
  }, FIXTURE_JOB);
  expect(seeded, "the pipeline seam must accept the fixture role").toBe(true);

  await expect(page.locator(`${ROLE_REGION} .case`)).toBeVisible({ timeout: 10_000 });
}

/** Paint the materials rows role-materials.js owns, in the failed state. */
async function paintMaterials(page) {
  await page.evaluate((manifest) => {
    const mount = document.querySelector('[data-mount="materials"]');
    const api = window.JobBoredRoleMaterials;
    if (mount && api && typeof api.renderManifest === "function") {
      api.renderManifest(mount, manifest, "http://127.0.0.1:3847");
    }
  }, MANIFEST);
  await expect(page.locator(`${ROLE_REGION} .case__doc`).first()).toBeVisible();
}

/**
 * Walk every element in the frame and report the three faults the audit in
 * docs/redesign/dossier-2026-09/audit measured, plus the frame's own numbers.
 */
const measure = () => {
  const round = (n) => Math.round(n * 10) / 10;
  const frame = document.querySelector('[data-region="role"] .case');
  if (!frame) return { error: "no .case rendered" };
  const frameStyle = getComputedStyle(frame);
  const label = (el) => {
    const cls = (el.className || "").toString().split(/\s+/)
      .filter((c) => c.startsWith("case__") || c.startsWith("brief-materials"))[0];
    return cls || el.tagName.toLowerCase();
  };
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

  const selfOverflow = [];
  const shredded = [];
  for (const el of frame.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue;
    const style = getComputedStyle(el);
    /* A scroller's overflow is reachable by design (the docket's stepper is
       the one place the spec allows a zero floor for exactly this reason). */
    const scrollable = /auto|scroll/.test(style.overflowX);
    const excess = el.scrollWidth - el.clientWidth;
    /* The ::after hit-target expanders are inset a few px horizontally, which
       reads as a small scrollWidth excess and is not a layout fault. */
    const hitTarget = excess <= 6
      && (el.classList.contains("case__step") || el.classList.contains("case__doc-btn"));
    if (excess > 1 && !scrollable && !hitTarget) {
      selfOverflow.push({ el: label(el), overflowPx: round(excess), boxPx: round(el.clientWidth), text: text(el).slice(0, 60) });
    }

    /* The shredding detector. "Cover letter" over nine lines is 12 characters
       in 9 lines: the label did not overflow, the layout destroyed it. */
    const lineHeight = parseFloat(style.lineHeight);
    const body = text(el);
    if (!el.children.length && body && Number.isFinite(lineHeight) && lineHeight > 0) {
      const lines = Math.round(rect.height / lineHeight);
      if (lines >= 3 && body.length / lines < 6) {
        shredded.push({ el: label(el), lines, chars: body.length, text: body.slice(0, 60) });
      }
    }
  }

  /* What a sibling flow region resolves to at this viewport. */
  const pipeline = document.querySelector('[data-region="pipeline"]');
  const docket = frame.querySelector(".case__docket");
  const canvas = frame.querySelector(".case__canvas");
  const ledger = frame.querySelector(".case__ledger");
  const rect = (el) => (el ? round(el.getBoundingClientRect().width) : 0);

  return {
    viewport: window.innerWidth,
    frameWidth: round(frame.getBoundingClientRect().width),
    frameOverflowX: frameStyle.overflowX,
    pipelineWidth: rect(pipeline),
    docketPosition: docket ? getComputedStyle(docket).position : "",
    docketTopPx: docket ? round(parseFloat(getComputedStyle(docket).top)) : null,
    canvasWidth: rect(canvas),
    ledgerWidth: rect(ledger),
    bodyColumns: frame.querySelector(".case__body")
      ? getComputedStyle(frame.querySelector(".case__body")).gridTemplateColumns
      : "",
    docs: [...frame.querySelectorAll(".case__doc")].map((row) => {
      const name = row.querySelector(".case__doc-n");
      const labelEl = row.querySelector(".case__doc-label");
      const lh = labelEl ? parseFloat(getComputedStyle(labelEl).lineHeight) : 0;
      return {
        doc: row.getAttribute("data-doc"),
        rowWidth: rect(row),
        nameColPx: rect(name),
        labelLines: labelEl && lh ? Math.round(labelEl.getBoundingClientRect().height / lh) : 0,
      };
    }),
    smallestFontPx: Math.min(...[...frame.querySelectorAll("*")]
      .filter((el) => (el.textContent || "").trim() && !el.children.length)
      .map((el) => parseFloat(getComputedStyle(el).fontSize))
      .filter((n) => Number.isFinite(n))),
    titleTruncatedPx: (() => {
      const title = frame.querySelector(".case__title");
      if (!title) return 0;
      return round(Math.max(0, title.scrollWidth - title.clientWidth));
    })(),
    selfOverflow,
    shredded,
  };
};

test("the dossier holds every track at 1280 and 1440", async ({ page }) => {
  await openDossier(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await paintMaterials(page);
    const at = await page.evaluate(measure);

    expect(at.error, `measurement failed at ${width}`).toBeUndefined();

    /* TEARDOWN §1–2: the crush. Both of these were clean on the shipped
       board — nothing overflowed — while "Cover letter" rendered as a
       nine-line column of single letters. */
    expect(at.selfOverflow, `nothing may overflow its own box at ${width}`).toEqual([]);
    expect(at.shredded, `no label may be shredded mid-word at ${width}`).toEqual([]);

    /* TEARDOWN §4: the frame was 104px narrower than the pipeline above it. */
    expect(
      Math.abs(at.frameWidth - at.pipelineWidth),
      `the dossier frame must match the pipeline region at ${width} (frame ${at.frameWidth}, pipeline ${at.pipelineWidth})`,
    ).toBeLessThanOrEqual(1);

    /* TEARDOWN §5: `overflow: hidden` on the frame silently disabled sticky
       for every descendant, which is why the drafting actions could not
       follow the reader down the page. */
    expect(at.frameOverflowX, `the frame must not be a scroll container at ${width}`).toBe("visible");
    expect(at.docketPosition, `the docket must be sticky at ${width}`).toBe("sticky");
    expect(at.docketTopPx, `the docket parks under the app chrome at ${width}`).toBeGreaterThan(0);

    /* SPEC §3.2: both body tracks are bounded, and the surplus is margin. */
    expect(at.canvasWidth, `canvas floor at ${width}`).toBeGreaterThanOrEqual(544);
    expect(at.canvasWidth, `canvas measure cap at ${width}`).toBeLessThanOrEqual(736);
    expect(at.ledgerWidth, `ledger floor at ${width}`).toBeGreaterThanOrEqual(320);
    expect(at.ledgerWidth, `ledger cap at ${width}`).toBeLessThanOrEqual(352);
    expect(at.bodyColumns, `the body is two bounded tracks at ${width}`).toMatch(/px \d/);

    /* TEARDOWN §2: the measured 12.3px name column, in the same failed
       state, at the real ledger width. */
    expect(at.docs.length, `the materials rows must render at ${width}`).toBeGreaterThan(0);
    for (const row of at.docs) {
      expect(row.nameColPx, `${row.doc} needs a readable name column at ${width}`).toBeGreaterThan(140);
      expect(row.labelLines, `${row.doc}'s label must not wrap past two lines at ${width}`).toBeLessThanOrEqual(2);
    }

    /* SPEC §8.2: 10px is a floor, not a default. */
    expect(at.smallestFontPx, `no text below 10px at ${width}`).toBeGreaterThanOrEqual(10);

    /* TEARDOWN §7: 81px of the real posting title was unreachable. */
    expect(at.titleTruncatedPx, `the role title must render in full at ${width}`).toBeLessThanOrEqual(1);
  }
});

/* SPEC §7: below the two-column threshold there is one column, and the ledger
   follows the canvas in source order — so reading order, tab order and visual
   order still agree. */
test("the dossier collapses to one honest column on a narrow frame", async ({ page }) => {
  await openDossier(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await paintMaterials(page);
  const at = await page.evaluate(measure);

  expect(at.selfOverflow, "nothing may overflow its own box at 900").toEqual([]);
  expect(at.shredded, "no label may be shredded mid-word at 900").toEqual([]);
  expect(at.bodyColumns.trim().split(/\s+/).length, "one column below the threshold").toBe(1);
  expect(at.docketPosition, "the docket stays sticky at 900").toBe("sticky");

  const order = await page.evaluate(() => {
    const body = document.querySelector('[data-region="role"] .case__body');
    return [...body.children].map((el) => (el.className || "").toString().split(/\s+/)[0]);
  });
  expect(order, "the ledger follows the canvas in source order").toEqual(["case__canvas", "case__ledger"]);
});
