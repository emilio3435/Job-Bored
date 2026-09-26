// (a) Dossier stepper move Kestrel Researching->Interviewing: writes + board.
// (b) Drag Parcel (Discovered) to Applied, then Cancel the confirm: board copy.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (r.url().includes("sheets.googleapis") && !["GET","OPTIONS"].includes(r.method())) writes.push(decodeURIComponent(r.url().split("/values")[1]||"").slice(0,60) + " " + (r.postData()||"").slice(0,240)); });
const where = (i) => page.evaluate((i) => { const c = document.querySelector(`[data-region="pipeline"] .pipe-sticker[data-stable-key="${i}"]`); return { status: window.JobBored.getPipelineJobs()[i].status, followUp: window.JobBored.getPipelineJobs()[i].followUpDate, card: c && c.getAttribute('data-stage'), counts: [...document.querySelectorAll('[data-region="pipeline"] .pipe-col')].map(col => col.dataset.stage + ":" + col.querySelector('.pipe-col__count').textContent).join(" ") }; }, i);
// (a)
await page.locator('.pipe-sticker[data-stable-key="3"]').click();
await page.waitForTimeout(1200);
writes.length = 0;
await page.locator('[data-region="role"] [data-action="stage-step"][data-stage="interviewing"]').click();
await page.waitForTimeout(2500);
console.log("(a) dossier step writes:", writes, JSON.stringify(await where(3)));
await shoot(page, "track", "dossier-stepper-after-move", { locator: '[data-region="role"] .case__stepper' });
// (b)
await page.evaluate(() => document.querySelector('[data-region="pipeline"]').scrollIntoView());
await page.locator('.pipe-col__toggle[data-stage-toggle="new"]').click();
await page.waitForTimeout(500);
writes.length = 0;
const card = page.locator('.pipe-sticker[data-stable-key="2"]');
const col = page.locator('.pipe-col[data-stage="applied"]');
const a = await card.boundingBox(); const b = await col.boundingBox();
await page.mouse.move(a.x + 60, a.y + 20); await page.mouse.down();
await page.mouse.move(a.x + 80, a.y + 40, { steps: 5 });
await page.mouse.move(b.x + b.width / 2, b.y + 150, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(800);
const dlg = page.locator('[role=dialog]').last();
console.log("(b) dialog visible:", await dlg.isVisible().catch(() => false));
await dlg.locator('button', { hasText: "Cancel" }).click().catch(e => console.log("no cancel", e.message));
await page.waitForTimeout(600);
const toasts = await page.evaluate(() => [...document.querySelectorAll('.pipe-toast, .jb-a11y-toast, .toast')].map(t => t.textContent.trim()).filter(Boolean));
console.log("(b) toasts after cancel:", toasts, JSON.stringify(await where(2)), "writes", writes);
await shoot(page, "track", "applied-cancel-toast");
await app.close();
