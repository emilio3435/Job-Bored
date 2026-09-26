// Drive every stage-move path on the signed-in board and record Sheet writes,
// toasts, the board's DOM, and the in-memory row status after each.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (r.url().includes("sheets.googleapis") && r.method() !== "GET" && r.method() !== "OPTIONS") writes.push({ m: r.method(), url: decodeURIComponent(r.url().split("/values")[1] || r.url()).slice(0, 80), body: (r.postData() || "").slice(0, 400) }); });
const toasts = () => page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert],.toast,.jb-a11y-toast,.pipe-toast')].map(e => e.textContent.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 8));
const state = (title) => page.evaluate((title) => {
  const jobs = window.JobBored.getPipelineJobs();
  const i = jobs.findIndex(j => j.title === title);
  const j = jobs[i];
  const card = document.querySelector(`[data-region="pipeline"] .pipe-sticker[data-stable-key="${i}"]`);
  const reg = document.querySelector('[data-region="pipeline"]');
  return { idx: i, status: j.status, applied: j.appliedDate, followUp: j.followUpDate, notes: j.notes, cardStage: card && card.getAttribute("data-stage"), pending: (reg.__pipePending || []).length };
}, title);
async function pickStage(card, key) {
  // The open list is painted under the next card (see stage-menu-open shot), so
  // pick by keyboard, which the menu supports: focus lands on item 0.
  const keys = await card.locator('.jb-a11y-stage-menu__item').evaluateAll(els => els.map(e => e.getAttribute('data-stage')));
  const n = keys.indexOf(key);
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
async function step(name, fn, title, waitMs = 2500) {
  writes.length = 0;
  const before = await state(title);
  await fn();
  await page.waitForTimeout(waitMs);
  const after = await state(title);
  console.log(JSON.stringify({ step: name, before, after, writes: [...writes], toasts: await toasts() }, null, 1));
}
// 1. Stage menu on Kestrel (Researching) -> Phone screen
await step("menu Kestrel->Phone screen", async () => {
  const card = page.locator('.pipe-sticker', { hasText: "Kestrel" }).first();
  await card.locator('[data-action="move-to-stage"]').click();
  await shoot(page, "track", "stage-menu-open", { locator: '[data-region="pipeline"]' });
  await pickStage(card, "phone-screen");
}, "Staff Frontend Engineer");
await shoot(page, "track", "stage-menu-after-move");
// 2. Drag Canopy (Researching) onto the Interviewing column
await step("drag Canopy->Interviewing", async () => {
  const card = page.locator('.pipe-sticker', { hasText: "Canopy" }).first();
  const col = page.locator('.pipe-col[data-stage="interviewing"]');
  const a = await card.boundingBox(); const b = await col.boundingBox();
  await page.mouse.move(a.x + 40, a.y + 20); await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 100, { steps: 15 });
  await page.mouse.up();
}, "Web Platform Engineer");
await shoot(page, "track", "drag-after-drop");
// 3. Today "Start researching" on Lumen (New)
await step("today start-research Lumen", async () => {
  await page.locator('[data-region="today"] button', { hasText: "Start researching" }).first().click();
}, "Senior Product Designer");
// 4. Expand Discovered, menu Parcel -> Applied (confirm dialog)
await step("menu Parcel->Applied (dialog)", async () => {
  await page.locator('.pipe-col[data-stage="new"] button').first().click().catch(()=>{});
  await page.waitForTimeout(400);
  const card = page.locator('.pipe-sticker', { hasText: "Parcel" }).first();
  await card.locator('[data-action="move-to-stage"]').click();
  await pickStage(card, "applied");
  await page.waitForTimeout(800);
  await shoot(page, "track", "applied-confirm-dialog");
  const dlg = page.locator('[role=dialog]').last();
  console.log("DIALOG:", (await dlg.textContent()).replace(/\s+/g, " ").slice(0, 500));
  await page.fill('#jb-submission-applied-date', '2026-09-20');
  await page.fill('#jb-submission-source', 'Referral from Sam');
  await page.fill('#jb-submission-follow-up-date', '2026-10-09');
  await dlg.locator('button', { hasText: "Mark submitted" }).click();
  await page.waitForTimeout(1000);
  await shoot(page, "track", "applied-undo-toast");
}, "Full-Stack Engineer", 12000);
await shoot(page, "track", "after-all-moves", { fullPage: true });
// is the board still stuck? force a render and re-check
await page.evaluate(() => window.JobBoredPipeline.scheduleRender());
await page.waitForTimeout(800);
console.log("final", JSON.stringify(await Promise.all(["Staff Frontend Engineer","Web Platform Engineer","Senior Product Designer","Full-Stack Engineer"].map(state))));
await app.close();
