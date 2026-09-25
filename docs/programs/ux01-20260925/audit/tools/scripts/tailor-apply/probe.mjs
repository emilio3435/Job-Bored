import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const out = await page.evaluate(() => {
  const reg = document.querySelector('[data-region="pipeline"]');
  const firstCard = reg.querySelector('[data-stable-key], [data-index]');
  return { cardHtml: firstCard ? firstCard.outerHTML.slice(0, 1500) : null,
    actions: [...new Set([...reg.querySelectorAll('[data-action]')].map(e => e.getAttribute('data-action')))],
    todayBtns: [...document.querySelectorAll('[data-region="today"] button, [data-region="today"] a')].map(b => b.textContent.trim() + " | " + b.getAttribute("data-action")).slice(0,10) };
});
console.log(JSON.stringify(out, null, 1));
await app.close();
