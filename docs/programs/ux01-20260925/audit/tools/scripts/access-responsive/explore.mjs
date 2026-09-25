import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const S = "/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/";
const vp = process.argv[2] || "desktop";
const app = await openApp({ mode: "signed-in", viewport: vp });
const { page } = app;
page.on("pageerror", e => console.log("PAGEERR", e.message.slice(0,200)));
const info = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0,160), bodyCls: document.body.className, dialogs: [...document.querySelectorAll('[role=dialog],dialog,[aria-modal]')].filter(d=>d.getBoundingClientRect().width>0).map(d=>d.id||d.className).slice(0,5) }))));
// drawer
await page.click("#discoveryBtn"); await page.waitForTimeout(1200);
await info("drawer"); await page.screenshot({ path: S+`x-drawer-${vp}.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(600); await info("afterEsc");
// settings
await page.click("#settingsBtn"); await page.waitForTimeout(1200);
await info("settings"); await page.screenshot({ path: S+`x-settings-${vp}.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(600); await info("afterEsc");
// dossier
await page.locator(".today-item__action", { hasText: "Open dossier" }).first().click(); await page.waitForTimeout(1500);
await info("dossier"); await page.screenshot({ path: S+`x-dossier-${vp}.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(600); await info("afterEsc");
// stage menu
const trig = page.locator('[data-action="move-to-stage"]').first();
await trig.scrollIntoViewIfNeeded(); await trig.click(); await page.waitForTimeout(800);
await info("stagemenu"); await page.screenshot({ path: S+`x-stage-${vp}.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(400); await info("afterEsc");
// scribe
await page.locator(".brief-btn", { hasText: "Draft cover letter" }).first().click().catch(e=>console.log("nodraft", e.message.slice(0,100))); await page.waitForTimeout(1500);
await info("scribe"); await page.screenshot({ path: S+`x-scribe-${vp}.png` });
await app.close();
