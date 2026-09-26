// Walks every Settings tab, the provider panel, Check connection, Clear confirm,
// scraper setup modal, and axe on the modal. Usage: node settings.mjs <desktop|phone>
import { H, LENS, TOAST_SPY, toasts, visibleText } from "./common.mjs";
const { openApp, shoot, runAxe } = await import(H);
const vp = process.argv[2] || "desktop";
const out = { tabs: {} };
const app = await openApp({ mode: "signed-in", viewport: vp }); const { page } = app;
await page.addInitScript(TOAST_SPY); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
await page.locator("#settingsBtn").click(); await page.waitForTimeout(800);
out.focusAfterOpen = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
out.modalBox = await page.evaluate(() => { const c = document.querySelector("#settingsModal .settings-modal"); const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, scrollH: c.scrollHeight, vh: innerHeight }; });
for (const [id, name] of [["setup","setup"],["fit-profile","fit-profile"],["sheet","sheet"],["scraping","scraping"],["ats-scoring","ats"],["ai-providers","ai"],["upgrades","upgrades"]]) {
  await page.locator(`#settings-tab-${id}`).click(); await page.waitForTimeout(700);
  out.tabs[name] = await visibleText(page, `#settings-panel-${id}`);
  await shoot(page, LENS, `settings-tab-${name}`);
}
// Fit Profile full content
await page.locator("#settings-tab-fit-profile").click(); await page.waitForTimeout(600);
await shoot(page, LENS, "settings-tab-fit-profile-panel", { locator: "#settings-panel-fit-profile" }).catch(()=>{});
// AI providers: default + check connection with no key
await page.locator("#settings-tab-ai-providers").click(); await page.waitForTimeout(400);
out.ai = await page.evaluate(() => ({ provider: document.getElementById("settingsResumeProvider").value, visiblePanels: [...document.querySelectorAll(".settings-provider-panel")].filter(p => p.offsetWidth).map(p => p.id), models: [...document.querySelectorAll(".settings-model-select")].filter(s=>s.offsetWidth).map(s => ({ id: s.id, n: s.options.length, first: s.options[0]?.textContent })) }));
const checkBtn = page.locator(".settings-provider-panel:visible .settings-check-btn").first();
if (await checkBtn.count()) { await checkBtn.click(); await page.waitForTimeout(600); out.ai.checkNoKey = await visibleText(page, ".settings-provider-panel:not([style*='none']) .settings-check-status"); }
await shoot(page, LENS, "settings-ai-check-nokey");
// Type a bogus key and check (network fenced → error message path)
const keyInput = page.locator(".settings-provider-panel:visible input[type=password]").first();
if (await keyInput.count()) { await keyInput.fill("sk-test-not-a-real-key"); await checkBtn.click(); await page.waitForTimeout(3000); out.ai.checkBogus = await page.evaluate(() => [...document.querySelectorAll(".settings-check-status")].filter(e=>!e.hidden).map(e=>e.textContent)); await shoot(page, LENS, "settings-ai-check-fail"); }
// Select each provider, record panel copy
out.ai.providers = {};
for (const p of ["openrouter","local","gemini","openai","anthropic","webhook"]) { await page.selectOption("#settingsResumeProvider", p); await page.waitForTimeout(200); out.ai.providers[p] = await page.evaluate(() => [...document.querySelectorAll(".settings-provider-panel")].filter(x=>x.offsetWidth).map(x=>x.id + ": " + x.innerText.replace(/\s+/g," ").slice(0,300))); }
await page.selectOption("#settingsResumeProvider", "local"); await page.waitForTimeout(400);
await shoot(page, LENS, "settings-ai-local");
// Clear confirm bar
await page.locator("#settings-tab-setup").click(); await page.waitForTimeout(300);
await page.locator("#settingsClearBtn").click(); await page.waitForTimeout(400);
out.clearBar = await visibleText(page, "#settingsClearConfirmBar");
await shoot(page, LENS, "settings-clear-confirm");
await page.locator("#settingsClearConfirmCancel").click();
// keyboard: focus the tablist, arrow
await page.locator("#settings-tab-setup").focus(); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
out.arrowFocus = await page.evaluate(() => document.activeElement?.id);
await shoot(page, LENS, "settings-tab-focused");
// axe
out.axe = await runAxe(page, { include: "#settingsModal" }).catch(e => "axe failed " + e.message);
// Scraper setup modal from Scraping tab
await page.locator("#settings-tab-scraping").click(); await page.waitForTimeout(300);
await page.locator("#openScraperSetupFromSettings").click(); await page.waitForTimeout(600);
out.scraper = { focus: await page.evaluate(() => document.activeElement?.id), box: await page.evaluate(() => { const r = document.querySelector("#scraperSetupModal .modal-card").getBoundingClientRect(); return { w: r.width, h: r.height }; }) };
await shoot(page, LENS, "scraper-setup-open");
out.scraper.inert = await page.evaluate(() => document.getElementById("scraperSetupModal").inert);
out.scraper.hitAtClose = await page.evaluate(() => { const b = document.getElementById("scraperSetupModalClose").getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2); return e ? (e.id || e.className) : null; });
await page.mouse.click(...(await page.evaluate(() => { const b = document.getElementById("scraperSetupModalClose").getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })));
await page.waitForTimeout(500);
out.scraper.afterCloseClick = await page.evaluate(() => ({ scraper: document.getElementById("scraperSetupModal").style.display, settings: document.getElementById("settingsModal").style.display }));
await shoot(page, LENS, "scraper-setup-after-close-click");
await page.keyboard.press("Escape"); await page.waitForTimeout(400);
out.scraper.afterEsc = await page.evaluate(() => ({ scraper: document.getElementById("scraperSetupModal").style.display, settings: document.getElementById("settingsModal").style.display, scraperInert: document.getElementById("scraperSetupModal").inert }));
await shoot(page, LENS, "scraper-setup-after-escape");
out.toasts = await toasts(page);
// Save & reload with no changes
await page.evaluate(() => { const m = document.getElementById("scraperSetupModal"); if (m) m.style.display = "none"; });
await page.locator("#settingsBtn").click({force:true}).catch(()=>{}); await page.waitForTimeout(600);
if (await page.locator("#settingsModal").isVisible()) { await page.locator("#settingsSaveBtn").click(); await page.waitForTimeout(200); out.saveToast = await toasts(page); }
console.log(JSON.stringify(out, null, 1));
await app.close();
