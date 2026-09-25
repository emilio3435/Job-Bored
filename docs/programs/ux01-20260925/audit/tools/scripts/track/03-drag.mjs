// Isolated drag: Canopy (Researching) -> Interviewing column. Samples the
// card's column at 50ms, 500ms, 3s; records the dossier hash and Sheet writes.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (r.url().includes("sheets.googleapis") && !["GET","OPTIONS"].includes(r.method())) writes.push((r.postData()||"").slice(0,300)); });
await page.locator('[data-region="pipeline"]').scrollIntoViewIfNeeded();
const sample = (t) => page.evaluate((t) => {
  const c = document.querySelector('[data-region="pipeline"] .pipe-sticker[data-stable-key="4"]');
  const cnt = [...document.querySelectorAll('[data-region="pipeline"] .pipe-col')].map(col => col.dataset.stage + ":" + (col.querySelector('.pipe-col__count')||{}).textContent).join(" ");
  return { t, parentStage: c && c.closest('[data-stage-body]')?.getAttribute('data-stage-body'), selected: c && c.getAttribute('data-selected'), hash: location.hash, pending: (document.querySelector('[data-region="pipeline"]').__pipePending||[]).length, counts: cnt, status: window.JobBored.getPipelineJobs()[4].status };
}, t);
const card = page.locator('.pipe-sticker[data-stable-key="4"]');
const col = page.locator('.pipe-col[data-stage="interviewing"]');
const a = await card.boundingBox(); const b = await col.boundingBox();
await page.mouse.move(a.x + 60, a.y + 20); await page.mouse.down();
await page.mouse.move(a.x + 80, a.y + 40, { steps: 5 });
await page.mouse.move(b.x + b.width / 2, b.y + 150, { steps: 20 });
await shoot(page, "track", "drag-in-flight");
await page.mouse.up();
console.log(JSON.stringify(await sample(50)));
await page.waitForTimeout(450); console.log(JSON.stringify(await sample(500)));
await page.waitForTimeout(2500); console.log(JSON.stringify(await sample(3000)));
await shoot(page, "track", "drag-after-3s");
console.log("writes", writes);
await app.close();
