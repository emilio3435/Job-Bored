// Does "Start researching" (New -> Researching) silently request materials?
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const posts = [];
page.on("request", r => { if (r.url().includes("3847") && r.method() === "POST") posts.push(r.url().replace("http://127.0.0.1:3847", "") + " " + (r.postData() || "").slice(0, 160)); });
await page.locator('[data-region="today"] button', { hasText: "Start researching" }).first().click();
await page.waitForTimeout(800);
const dlg = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter(d => d.offsetParent).map(d => d.innerText.slice(0, 200)));
console.log("DIALOGS", JSON.stringify(dlg));
await page.waitForTimeout(5000);
console.log("POSTS", JSON.stringify(posts));
console.log("TOASTS", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast-message')].map(e => e.textContent.trim()))));
await shoot(page, "tailor-apply", "today-start-researching");
await app.close();
