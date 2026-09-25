import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
const a = page.locator("article.pipe-sticker:visible").first();
await page.focus("#discoveryBtn");
for (let i = 0; i < 41; i++) await page.keyboard.press("Tab");
await page.waitForTimeout(900);
console.log(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { name: e.getAttribute("aria-label"), region: e.closest("[data-region]")?.getAttribute("data-region"), shadow: cs.boxShadow, outline: cs.outlineStyle + " " + cs.outlineWidth, fv: e.matches(":focus-visible"), cls: e.className, focusVar: getComputedStyle(document.body).getPropertyValue("--jb-shadow-focus") }; }));
await shoot(page, "access-responsive", "focus-card-article");
await app.close();
