// Page height + section map (data-region / major ids) at 1440 and 375, for
// signed-in and signed-in-empty. Also the board geometry at 375.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const mode of ["signed-in", "signed-in-empty"]) for (const vp of ["desktop", "phone"]) {
  const app = await openApp({ mode, viewport: vp });
  const { page } = app;
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };
    const regions = [...document.querySelectorAll('[data-region], #dailyBrief, #briefSection, .daily-brief, #jobCards, #dawn, [data-lattice], .lattice, #whatsNextBanner, .whats-next-banner, [data-dawn]')]
      .map(el => ({ sel: el.getAttribute('data-region') ? `[data-region=${el.getAttribute('data-region')}]` : (el.id ? '#' + el.id : '.' + [...el.classList].join('.')), vis: vis(el), top: Math.round(el.getBoundingClientRect().top + scrollY), h: Math.round(el.getBoundingClientRect().height) }));
    const board = document.querySelector('[data-region="pipeline"] .pipe-board');
    const cols = board ? [...board.querySelectorAll('.pipe-col')].map(c => { const r = c.getBoundingClientRect(); return `${c.dataset.stage}:${Math.round(r.left)}+${Math.round(r.width)}x${Math.round(r.height)}${c.dataset.collapsed==='true'?'(c)':''}`; }) : [];
    return { pageH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, viewportW: innerWidth, board: board && { scrollW: board.scrollWidth, clientW: board.clientWidth, overflowX: getComputedStyle(board).overflowX }, cols, regions };
  });
  console.log(mode, vp, JSON.stringify(info, null, 0));
  if (vp === "phone") {
    await page.locator('[data-region="pipeline"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('[data-region="pipeline"]').scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await shoot(page, "track", `${mode}-board-phone`);
  } else {
    await page.evaluate(() => document.querySelector('[data-region="pipeline"]').scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await shoot(page, "track", `${mode}-board`);
  }
  if (mode === "signed-in-empty") await shoot(page, "track", `${mode}-page-full`, { fullPage: true });
  await app.close();
}
