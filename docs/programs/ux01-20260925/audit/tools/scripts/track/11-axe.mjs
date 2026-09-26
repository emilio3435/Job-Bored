// axe on the Track regions + tab stops before the first board card.
import { openApp, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
for (const r of ["today", "dawn", "pipeline"]) {
  const v = await runAxe(page, { include: `[data-region="${r}"]` });
  console.log(r, JSON.stringify(v.map(x => `${x.id}(${x.impact})x${x.nodes}: ${x.targets.slice(0,2).join(" | ")}`)));
}
let n = 0; let hit = null;
await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0,0); });
for (; n < 200; n++) {
  await page.keyboard.press("Tab");
  hit = await page.evaluate(() => { const a = document.activeElement; return a && a.closest && a.closest('[data-region="pipeline"] .pipe-sticker') ? a.getAttribute('aria-label') : null; });
  if (hit) break;
}
console.log("Tab presses to first board card:", n + 1, hit);
// Nested interactive: card role=button containing buttons
console.log("nested buttons in role=button card:", await page.evaluate(() => document.querySelector('[data-region="pipeline"] .pipe-sticker[role=button]')?.querySelectorAll('button').length));
await app.close();
