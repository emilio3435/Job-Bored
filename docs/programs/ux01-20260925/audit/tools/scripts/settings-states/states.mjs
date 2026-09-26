import { H, LENS, TOAST_SPY, toasts, visibleText } from "./common.mjs";
const { openApp, shoot } = await import(H);
const vp = process.argv[2] || "desktop";
const out = {};
// 1. signed-in-empty
{
  const app = await openApp({ mode: "signed-in-empty", viewport: vp });
  const { page } = app;
  await page.addInitScript(TOAST_SPY); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
  out.empty = { url: page.url(), emptyState: await visibleText(page, "#emptyState"), welcome: await visibleText(page, ".jbw-empty"), brief: await visibleText(page, "#dailyBrief, .brief-dashboard, main"), toasts: await toasts(page) };
  await shoot(page, LENS, "empty-pipeline-default");
  await shoot(page, LENS, "empty-pipeline-full", { fullPage: true });
  await app.close();
}
// 2. signed-in-error (fixture stub keeps the gate off)
{
  const app = await openApp({ mode: "signed-in-error", viewport: vp });
  const { page } = app;
  await page.addInitScript(TOAST_SPY); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000);
  out.errorStub = { errorState: await visibleText(page, "#errorState"), gate: await visibleText(page, "#sheetAccessGateScreen"), emptyState: await visibleText(page, "#emptyState"), toasts: await toasts(page) };
  await shoot(page, LENS, "sheet-403-dashboard");
  await shoot(page, LENS, "sheet-403-dashboard-full", { fullPage: true });
  // Now restore the real gate (what a stranger sees) and reload.
  await page.addInitScript(() => {
    let orig;
    window.addEventListener("DOMContentLoaded", () => { orig = window.JobBoredApp?.setup?.showSheetAccessGate; }, true);
    document.addEventListener("DOMContentLoaded", () => { setTimeout(() => { if (orig && window.JobBoredApp?.setup) window.JobBoredApp.setup.showSheetAccessGate = orig; }, 0); });
  });
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(4500);
  out.errorGate = { gate: await visibleText(page, "#sheetAccessGateScreen"), doctor: await visibleText(page, "#sheetAccessGateDoctorPanel"), errorState: await visibleText(page, "#errorState"), toasts: await toasts(page) };
  await shoot(page, LENS, "sheet-403-gate");
  await app.close();
}
console.log(JSON.stringify(out, null, 1));
