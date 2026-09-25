// Offline writes WITHOUT a prior refresh: stage change via Move-to-stage, then favorite.
// Also greenfield gate screenshot (Today strip leak). Usage: node offline-write.mjs <desktop|phone>
import { H, LENS, TOAST_SPY, toasts, visibleText } from "./common.mjs";
const { openApp, shoot } = await import(H);
const vp = process.argv[2] || "desktop";
const out = {};
{
  const app = await openApp({ mode: "signed-in", viewport: vp }); const { page, context } = app;
  await page.addInitScript(TOAST_SPY); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll(".page-nav__pill")].find(b => /pipeline/i.test(b.innerText))?.click()); await page.waitForTimeout(1200);
  out.triggers = await page.locator("[data-action=move-to-stage]").count();
  out.triggerLabels = await page.evaluate(() => [...document.querySelectorAll("[data-action=move-to-stage]")].map(b => b.getAttribute("aria-label") + " | visible=" + !!b.offsetWidth + " | in=" + (b.closest("[data-stable-key]")?.dataset.stableKey ?? b.closest("section,[data-region]")?.getAttribute("data-region"))));
  await page.route("https://sheets.googleapis.com/**", (r) => r.abort("internetdisconnected"));
  await context.setOffline(true);
  const before = await page.locator(".pipe-sticker").count();
  const trig = page.locator("[data-action=move-to-stage]:visible").first();
  if (await trig.count()) {
    await trig.scrollIntoViewIfNeeded(); await trig.click(); await page.waitForTimeout(300);
    await shoot(page, LENS, "offline-stage-menu-open");
    out.menuFocus = await page.evaluate(() => document.activeElement?.textContent); await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
  }
  out.stage = { before, after: await page.locator(".pipe-sticker").count(), toasts: await toasts(page) };
  await shoot(page, LENS, "offline-stage-change");
  const fav = page.locator(".pipe-sticker__favorite:visible").first();
  if (await fav.count()) { await fav.click(); await page.waitForTimeout(2500); }
  out.fav = { toasts: await toasts(page), favState: await page.evaluate(() => document.querySelector(".pipe-sticker")?.dataset.favorite) };
  await shoot(page, LENS, "offline-favorite");
  await app.close();
}
{
  const app = await openApp({ mode: "greenfield", viewport: vp }); const { page } = app;
  await page.waitForTimeout(2500);
  out.greenfieldToday = await visibleText(page, "[data-region=today]");
  await shoot(page, LENS, "greenfield-first-paint");
  await app.close();
}
console.log(JSON.stringify(out, null, 1));
