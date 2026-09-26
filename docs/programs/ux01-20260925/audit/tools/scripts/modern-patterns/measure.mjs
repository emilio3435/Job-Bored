import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
for (const vp of ["phone", "desktop"]) {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const p = app.page;
  const reg = p.locator('[data-region="pipeline"]').first();
  await reg.scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  await shoot(p, L, "phone-board-region", { locator: '[data-region="pipeline"]' });
  const m = await p.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-region="pipeline"] .pipe-col, [data-region="pipeline"] [data-stage-col], [data-region="pipeline"] section')].slice(0, 12).map(c => { const r = c.getBoundingClientRect(); return (c.getAttribute("data-stage") || c.className.split(" ")[0]) + ":" + Math.round(r.left) + "+" + Math.round(r.width); });
    const cards = [...document.querySelectorAll(".pipe-sticker")].map(c => { const r = c.getBoundingClientRect(); return Math.round(r.width) + "w@" + Math.round(r.left); });
    const board = document.querySelector('[data-region="pipeline"] .pipe-board, [data-region="pipeline"] [class*=board]');
    return { vw: innerWidth, docScrollW: document.documentElement.scrollWidth, board: board && (board.className + " sw=" + board.scrollWidth + " cw=" + board.clientWidth), cols, visibleCards: cards };
  });
  console.log(vp, JSON.stringify(m));
  // keyboard: count key presses to move first discovered card to Researching
  await app.close();
}
