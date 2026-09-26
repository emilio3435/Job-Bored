import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
const live = () => page.evaluate(() => [...document.querySelectorAll(".jb-a11y-visually-hidden[aria-live]")].map(n => n.getAttribute("aria-live") + ":" + n.textContent.trim()));
const act = () => page.evaluate(() => { const e = document.activeElement; return e === document.body ? "<body>" : (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 50) + (e.closest("[role=dialog],[role=alertdialog]") ? " [dialog]" : ""); });
const t = page.locator('[data-action="move-to-stage"]:visible').first(); await t.focus();
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
console.log("move->Discovered focus:", await act(), "live:", await live());
// now move to Applied (triggers confirm dialog)
const t2 = page.locator('[data-action="move-to-stage"]:visible').first(); await t2.focus();
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
await page.keyboard.press("ArrowDown"); await page.waitForTimeout(100);
console.log("menu item:", await act());
await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
console.log("after choose Applied focus:", await act());
await shoot(page, "access-responsive", "applied-confirm-dialog");
await page.keyboard.press("Escape"); await page.waitForTimeout(800);
console.log("after Esc on confirm focus:", await act(), "live:", await live());
await app.close();
