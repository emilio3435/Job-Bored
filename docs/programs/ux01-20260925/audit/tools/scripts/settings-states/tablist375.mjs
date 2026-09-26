// Measures the Settings tablist at 375: visible width vs scroll width and each tab's box.
import { H, LENS } from "./common.mjs";
const { openApp, shoot } = await import(H);
const app = await openApp({ mode: "signed-in", viewport: "phone" }); const { page } = app;
await page.locator("#settingsBtn").click(); await page.waitForTimeout(800);
const m = await page.evaluate(() => { const l = document.querySelector(".settings-tablist"); const r = l.getBoundingClientRect(); return { listW: r.width, listH: r.height, scrollW: l.scrollWidth, scrollH: l.scrollHeight, overflowX: getComputedStyle(l).overflowX, dir: getComputedStyle(l).flexDirection, tabs: [...l.querySelectorAll("[role=tab]")].map(b => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }; }) }; });
console.log(JSON.stringify(m, null, 1));
await app.close();
