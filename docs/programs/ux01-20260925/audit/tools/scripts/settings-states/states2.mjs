// Drives: empty Pipeline tab, mid-session 403, offline refresh + stage change + favorite,
// expired token reload, slow (4s) Sheets load. Usage: node states2.mjs <desktop|phone>
import { H, LENS, TOAST_SPY, toasts, visibleText } from "./common.mjs";
const { openApp, shoot } = await import(H);
const vp = process.argv[2] || "desktop";
const out = {};
const toPipeline = async (page) => { await page.locator(".page-nav__pill", { hasText: /pipeline/i }).first().click().catch(async () => { await page.evaluate(() => [...document.querySelectorAll(".page-nav__pill")].find(b => /pipeline/i.test(b.innerText))?.click()); }); await page.waitForTimeout(1200); };
async function withSpy(mode, extraInit) {
  const app = await openApp({ mode, viewport: vp });
  await app.page.addInitScript(TOAST_SPY);
  if (extraInit) await app.page.addInitScript(extraInit);
  await app.page.reload({ waitUntil: "domcontentloaded" });
  await app.page.waitForLoadState("networkidle").catch(() => {});
  await app.page.waitForTimeout(2500);
  return app;
}
// A. empty pipeline tab
{
  const app = await withSpy("signed-in-empty"); const { page } = app;
  await toPipeline(page);
  out.emptyPipeline = { emptyState: await visibleText(page, "#emptyState"), welcome: await visibleText(page, "[data-region=welcome]"), lattice: await visibleText(page, ".pipe-board, #jobCards") };
  await shoot(page, LENS, "empty-pipeline-tab");
  await app.close();
}
// B. mid-session 403 (initial load OK, later refresh 403s)
{
  const app = await withSpy("signed-in"); const { page } = app;
  await page.route("https://sheets.googleapis.com/**", async (r) => { if (r.request().method() === "GET") return r.fulfill({ status: 403, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } }) }); return r.fallback(); });
  await page.evaluate(() => window.loadAllData());
  await page.waitForTimeout(2000);
  out.mid403 = { brief: await visibleText(page, ".today, [data-region=today]"), errorState: await visibleText(page, "#errorState"), toasts: await toasts(page) };
  await shoot(page, LENS, "sheet-403-midsession-brief");
  await toPipeline(page);
  out.mid403.pipeline = { errorState: await visibleText(page, "#errorState"), cards: await page.locator(".pipe-sticker").count() };
  await shoot(page, LENS, "sheet-403-midsession-pipeline");
  await app.close();
}
// C. offline
{
  const app = await withSpy("signed-in"); const { page, context } = app;
  await toPipeline(page);
  await page.route("https://sheets.googleapis.com/**", (r) => r.abort("internetdisconnected"));
  await context.setOffline(true);
  const r = await page.evaluate(async () => { try { return await window.loadAllData(); } catch (e) { return "threw " + e.message; } });
  await page.waitForTimeout(1500);
  out.offline = { loadResult: r, errorState: await visibleText(page, "#errorState"), cards: await page.locator(".pipe-sticker").count(), toastsAfterRefresh: await toasts(page) };
  await shoot(page, LENS, "offline-after-refresh");
  // stage change via the Move-to-stage menu
  const trig = page.locator("[data-action=move-to-stage]").first();
  if (await trig.count()) {
    await trig.click(); await page.waitForTimeout(300);
    await shoot(page, LENS, "offline-stage-menu-open");
    await page.locator(".jb-a11y-stage-menu__item:visible").first().click().catch((e) => out.offline.menuErr = e.message);
    await page.waitForTimeout(2500);
  } else out.offline.noTrigger = true;
  out.offline.toastsAfterMove = await toasts(page);
  await shoot(page, LENS, "offline-stage-change");
  // favorite toggle
  await page.locator(".pipe-sticker__favorite").first().click().catch((e) => out.offline.favErr = e.message);
  await page.waitForTimeout(2000);
  out.offline.toastsAfterFav = await toasts(page);
  await shoot(page, LENS, "offline-favorite");
  // Back online: does anything reconcile?
  await context.setOffline(false); await page.unroute("https://sheets.googleapis.com/**", undefined).catch(()=>{});
  await page.waitForTimeout(2000);
  out.offline.toastsAfterOnline = await toasts(page);
  await app.close();
}
// D. expired token
{
  const app = await withSpy("signed-in", () => {
    const past = Date.now() - 60 * 60 * 1000;
    for (const [store, key] of [[localStorage, "command_center_oauth_session"], [sessionStorage, "command_center_oauth_runtime"]]) {
      try { const v = JSON.parse(store.getItem(key) || "{}"); v.expiresAt = past; store.setItem(key, JSON.stringify(v)); } catch {}
    }
  });
  const { page } = app;
  await page.waitForTimeout(2500);
  out.expired = { gate: await visibleText(page, "#sheetAccessGateScreen"), authSection: await visibleText(page, "#authSection"), cards: await page.locator(".pipe-sticker").count(), toasts: await toasts(page) };
  await shoot(page, LENS, "expired-token-reload");
  await toPipeline(page);
  await shoot(page, LENS, "expired-token-pipeline");
  await app.close();
}
// E. loading (Sheets delayed ~4s)
{
  const app = await openApp({ mode: "signed-in", viewport: vp }); const { page } = app;
  await page.route("https://sheets.googleapis.com/**", async (r) => { await new Promise((res) => setTimeout(res, 4000)); return r.fallback(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  out.loading = { at700: await page.evaluate(() => ({ gate: getComputedStyle(document.getElementById("sheetAccessGateScreen")||document.body).display, bodyText: document.body.innerText.slice(0, 400).replace(/\s+/g, " "), skeletons: document.querySelectorAll("[class*=skeleton],[aria-busy=true],.loading,[class*=spinner]").length })) };
  await shoot(page, LENS, "loading-700ms");
  await page.waitForTimeout(1800);
  out.loading.at2500 = await page.evaluate(() => ({ bodyText: document.body.innerText.slice(0, 400).replace(/\s+/g, " "), skeletons: [...document.querySelectorAll("[class*=skeleton],[aria-busy=true],.loading,[class*=spinner]")].filter(e=>e.offsetWidth).map(e=>e.className).slice(0,10) }));
  await shoot(page, LENS, "loading-2500ms");
  await toPipeline(page);
  await shoot(page, LENS, "loading-pipeline");
  await app.close();
}
console.log(JSON.stringify(out, null, 1));
