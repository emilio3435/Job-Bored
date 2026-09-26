// How a board card shows an overdue follow-up (Juniper, pushed 5 days into the
// past in page memory) and an owed reply (Orbital).
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
await page.evaluate(() => { const j = window.JobBored.getPipelineJobs().find(x => x.company === "Juniper Bank"); j.followUpDate = "2026-09-20"; });
await page.evaluate(() => document.querySelector('[data-region="pipeline"]').scrollIntoView());
for (const [stage, key, name] of [["applied", "Juniper", "card-overdue-followup"], ["interviewing", "Orbital", "card-owed-reply"], ["offer", "Brightline", "card-offer"]]) {
  await page.locator(`.pipe-col__toggle[data-stage-toggle="${stage}"]`).click();
  await page.waitForTimeout(500);
  const card = page.locator('.pipe-sticker', { hasText: key }).first();
  console.log(name, (await card.innerText()).replace(/\s+/g, " "), "flag=", await card.getAttribute("data-flag"), "h=", Math.round((await card.boundingBox()).height));
  await shoot(page, "track", name, { locator: `.pipe-sticker:has-text("${key}")` });
}
await app.close();
