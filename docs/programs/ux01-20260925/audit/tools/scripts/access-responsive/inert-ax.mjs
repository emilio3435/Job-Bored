import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
const cdp = await app.context.newCDPSession(page);
const count = async () => { const { nodes } = await cdp.send("Accessibility.getFullAXTree"); const live = nodes.filter(n => !n.ignored); return { openReply: live.filter(n => /Open and reply/.test(n.name?.value || "")).length, targetRoles: live.filter(n => /Target roles/i.test(n.name?.value || "")).length }; };
console.log("drawer closed:", await count());
await page.evaluate(() => document.getElementById("discoveryBtn").click()); await page.waitForTimeout(1200);
console.log("drawer open:", await count());
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await page.focus("#settingsBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
for (let i = 0; i < 10; i++) { await page.keyboard.press("Tab"); const h = await page.evaluate(() => { const e = document.activeElement; const n = (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim(); return n ? null : e.outerHTML.slice(0, 220); }); if (h) console.log("UNNAMED STOP:", h); }
await app.close();
