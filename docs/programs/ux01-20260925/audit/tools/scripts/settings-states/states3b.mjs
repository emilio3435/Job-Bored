// Expired token with the real sign-in gate restored (the harness stubs it); greenfield gate.
import { H, LENS, TOAST_SPY, toasts, visibleText } from "./common.mjs";
const { openApp, shoot } = await import(H);
const vp = process.argv[2] || "desktop";
const out = {};
const RESTORE_GATE = () => {
  let orig;
  window.addEventListener("DOMContentLoaded", () => { orig = window.JobBoredApp?.setup?.showSheetAccessGate; }, true);
  document.addEventListener("DOMContentLoaded", () => { setTimeout(() => { if (orig && window.JobBoredApp?.setup) window.JobBoredApp.setup.showSheetAccessGate = orig; }, 0); });
};
const EXPIRE = () => {
  const past = Date.now() - 60 * 60 * 1000;
  for (const [store, key] of [[localStorage, "command_center_oauth_session"], [sessionStorage, "command_center_oauth_runtime"]]) {
    try { const v = JSON.parse(store.getItem(key) || "{}"); v.expiresAt = past; store.setItem(key, JSON.stringify(v)); } catch {}
  }
};
{
  const app = await openApp({ mode: "signed-in", viewport: vp }); const { page } = app;
  await page.addInitScript(TOAST_SPY); await page.addInitScript(RESTORE_GATE); await page.addInitScript(EXPIRE);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(20000); out.startup = await page.evaluate(()=>document.body.dataset.startupPhase||"");
  out.expired = { gate: await visibleText(page, "#sheetAccessGateScreen"), toasts: await toasts(page) };
  await shoot(page, LENS, "expired-token-gate-20s");
  await app.close();
}
console.log(JSON.stringify(out,null,1));
