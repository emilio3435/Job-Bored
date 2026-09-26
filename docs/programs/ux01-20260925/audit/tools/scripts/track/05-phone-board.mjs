// 375px board: shell scroll geometry, expand Applied, open column width, stage menu.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "phone" });
const { page } = app;
const geo = () => page.evaluate(() => {
  const sh = document.querySelector('[data-region="pipeline"] .pipe-shell');
  const cols = [...document.querySelectorAll('[data-region="pipeline"] .pipe-col')].map(c => `${c.dataset.stage}:${Math.round(c.getBoundingClientRect().width)}${c.dataset.collapsed==='true'?'c':''}`);
  const cards = [...document.querySelectorAll('[data-region="pipeline"] .pipe-sticker')].filter(c => c.getBoundingClientRect().width>0).map(c => Math.round(c.getBoundingClientRect().width));
  return { shellScrollW: sh.scrollWidth, shellClientW: sh.clientWidth, shellOverflowX: getComputedStyle(sh).overflowX, cols: cols.join(" "), visibleCardWidths: cards };
});
console.log("default", JSON.stringify(await geo()));
await page.evaluate(() => document.querySelector('[data-region="pipeline"]').scrollIntoView({ block: "start" }));
await page.locator('.pipe-col__toggle[data-stage-toggle="applied"]').click();
await page.waitForTimeout(500);
console.log("applied expanded", JSON.stringify(await geo()));
await page.evaluate(() => document.querySelector('[data-region="pipeline"] .pipe-board').scrollIntoView({ block: "start" }));
await shoot(page, "track", "board-phone-applied-expanded");
await page.evaluate(() => { const sh = document.querySelector('[data-region="pipeline"] .pipe-shell'); sh.scrollLeft = sh.scrollWidth; });
await page.waitForTimeout(300);
await shoot(page, "track", "board-phone-scrolled-end");
await app.close();
