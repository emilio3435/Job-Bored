/**
 * Shared measurement helpers for the SIXBEATS visual gate.
 *
 * Everything here returns numbers a designer would read off a ruler —
 * bounding boxes, scroll widths, line counts, computed styles — so that a
 * failing gate names a geometry, not a pixel hash.
 *
 * The two viewports are the ones every SIXBEATS lane shipped its before/after
 * pair at (GROUND-RULES-ADDENDUM): the founder's desktop and a 390px phone.
 */

/** Spec §3.1 — the six beats, in order. */
export const BEAT_IDS = Object.freeze([
  "google",
  "ai",
  "resume",
  "fit",
  "discovery",
  "payoff",
]);

export const DESKTOP = Object.freeze({ width: 1440, height: 900 });
export const PHONE = Object.freeze({ width: 390, height: 844 });

/** Screen S0's overlay root (oneflow-demo-board.js ROOT_ID). */
export const DEMO_BOARD = "#oneFlowDemoBoard";
/** The single shell mount every beat renders into (spec §3.5). */
export const FLOW_MOUNT = "#oneFlowMount";
/** The one-flow variant of the shared wizard chassis (V2's CSS hook). */
export const SHELL = ".discovery-setup-wizard--spine";

/** Spec §4 — the invitation's two actions, verbatim. */
export const INVITE_PRIMARY = "Make it mine — 15 min, once";
export const INVITE_SECONDARY = "Poke around first";

/**
 * Every selector that has ever claimed to say "where you are" inside the
 * shell. Spec §2 says ONE spine; this union is what the gate counts, so a
 * revived step rail or a re-added "Step N of M" kicker fails the count
 * rather than quietly becoming a fourth progress system.
 */
export const PROGRESS_INDICATOR_SELECTORS = Object.freeze([
  ".discovery-setup-wizard__spine",
  ".discovery-setup-wizard__steps",
  ".discovery-setup-wizard__step-rail",
  ".discovery-setup-wizard__progress",
]);

/**
 * Let every running animation finish before anything is measured.
 *
 * The shell and the board both animate in. A bounding box read mid-entrance
 * is a box of a surface that is still moving — measured once at 850.6px for a
 * dock that settles at 844 — so every geometry assertion in this suite would
 * be a coin flip without this.
 */
export async function settleLayout(page) {
  await page.evaluate(async () => {
    const running = globalThis.document
      .getAnimations()
      .filter((animation) => animation.playState === "running");
    await Promise.all(
      running.map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise((done) => globalThis.requestAnimationFrame(() => done()));
  });
}

/** A zero-config first visit: no sheet, no keys, no completion flags. */
export async function bootColdStart(page, baseUrl) {
  await page.goto(`${baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await page.waitForSelector(`${DEMO_BOARD} .oneflow-demo__invite`);
  await settleLayout(page);
}

/** Accept the invitation and wait for the shell to paint its first beat. */
export async function openFlow(page) {
  await page.getByRole("button", { name: INVITE_PRIMARY, exact: true }).click();
  await page.waitForSelector(`${FLOW_MOUNT} .oneflow-beat`);
  await settleLayout(page);
}

/**
 * Drive the controller straight to a beat. Completing beats for real needs a
 * live Google grant and live provider keys, which the hermetic fence
 * deliberately refuses; the claims under test here are the shell's geometry,
 * not any beat's happy path.
 */
export async function goToBeat(page, beatId) {
  await page.evaluate((id) => globalThis.JobBoredOneFlow.goToBeat(id), beatId);
  await page.waitForFunction(
    (id) =>
      globalThis.document.querySelector("#oneFlowMount .oneflow-beat")?.dataset.beatId ===
      id,
    beatId,
  );
  await settleLayout(page);
}

/** Bounding box of the first match, rounded, or null when absent. */
export function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const node = globalThis.document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
      top: +r.top.toFixed(2),
      right: +r.right.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      left: +r.left.toFixed(2),
    };
  }, selector);
}

/**
 * Horizontal overflow, measured two ways because the app has two kinds of
 * scroller: the document itself, and the overlay roots that carry their own
 * `overflow`. A sideways scrollbar is the single loudest "this layout broke"
 * signal a phone can give.
 */
export function horizontalOverflow(page, selectors) {
  return page.evaluate((sels) => {
    const out = {
      document: {
        scrollWidth: globalThis.document.documentElement.scrollWidth,
        clientWidth: globalThis.document.documentElement.clientWidth,
        innerWidth: globalThis.innerWidth,
      },
      regions: {},
    };
    for (const sel of sels) {
      const node = globalThis.document.querySelector(sel);
      if (!node) continue;
      out.regions[sel] = {
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    }
    return out;
  }, selectors);
}

/**
 * How many line boxes a control's own label occupies, plus the geometry that
 * explains the answer. A Range over the button's contents reports one client
 * rect per line, so `lines > 1` on a one-word label IS the "Ad / d" break.
 */
export function labelGeometry(page, selector) {
  return page.evaluate((sel) => {
    return [...globalThis.document.querySelectorAll(sel)].map((node) => {
      const style = globalThis.getComputedStyle(node);
      const range = globalThis.document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (r) => r.width > 0 && r.height > 0,
      );
      const box = node.getBoundingClientRect();
      return {
        text: (node.textContent || "").trim(),
        lines: rects.length,
        lineWidths: rects.map((r) => +r.width.toFixed(2)),
        width: +box.width.toFixed(2),
        height: +box.height.toFixed(2),
        lineHeight: Number.parseFloat(style.lineHeight) || 0,
        flexShrink: style.flexShrink,
        overflowWrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
      };
    });
  }, selector);
}

/** True when the box sits entirely inside the viewport, no scrolling needed. */
export function isInsideViewport(box, viewport, tolerance = 1) {
  if (!box) return false;
  return (
    box.top >= -tolerance &&
    box.left >= -tolerance &&
    box.bottom <= viewport.height + tolerance &&
    box.right <= viewport.width + tolerance
  );
}

/** True when `inner` sits entirely inside `outer` (the framing assertion). */
export function isInsideBox(inner, outer, tolerance = 1) {
  if (!inner || !outer) return false;
  return (
    inner.top >= outer.top - tolerance &&
    inner.left >= outer.left - tolerance &&
    inner.bottom <= outer.bottom + tolerance &&
    inner.right <= outer.right + tolerance
  );
}

/** The same box shape as `boxOf`, for a Playwright locator. */
export async function boxOfLocator(locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  return {
    x: +box.x.toFixed(2),
    y: +box.y.toFixed(2),
    width: +box.width.toFixed(2),
    height: +box.height.toFixed(2),
    top: +box.y.toFixed(2),
    left: +box.x.toFixed(2),
    right: +(box.x + box.width).toFixed(2),
    bottom: +(box.y + box.height).toFixed(2),
  };
}
