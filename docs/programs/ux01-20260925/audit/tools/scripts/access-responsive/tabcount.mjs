import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
console.log(await page.evaluate(() => {
  const tabbable = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]")].filter(e => e.tabIndex >= 0 && !e.disabled && !e.closest("[inert]") && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
  const skip = [...document.querySelectorAll("a[href^='#']")].filter(a => /skip/i.test(a.textContent)).map(a => a.textContent.trim());
  const landmarks = { main: document.querySelectorAll("main,[role=main]").length, nav: document.querySelectorAll("nav,[role=navigation]").length, h1: [...document.querySelectorAll("h1")].map(h => h.textContent.trim().slice(0, 30)), lang: document.documentElement.lang, title: document.title };
  const idx = tabbable.findIndex(e => e.matches('[data-action="move-to-stage"]'));
  return { tabStops: tabbable.length, firstMoveToStageIndex: idx + 1, skip, ...landmarks };
}));
await app.close();
