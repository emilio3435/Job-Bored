// Follow-ups and replies. (a) Push Juniper's follow-up into the past in page
// memory (no product code touched) and see how Today, Dawn and the card show
// it; (b) press Today's "Log follow-up" and see whether the item clears;
// (c) Today "Open and reply" on Orbital -> where it lands, People block.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const writes = [];
page.on("request", (r) => { if (r.url().includes("sheets.googleapis") && !["GET","OPTIONS"].includes(r.method())) writes.push(decodeURIComponent(r.url().split("/values")[1]||"").slice(0,60) + " " + (r.postData()||"").slice(0,200)); });
await page.evaluate(() => {
  const jobs = window.JobBored.getPipelineJobs();
  const j = jobs.find(x => x.company === "Juniper Bank");
  j.followUpDate = "2026-09-20";
  document.dispatchEvent(new CustomEvent("jb:pipeline:rendered"));
  window.JobBoredPipeline.scheduleRender();
});
await page.waitForTimeout(800);
const todayText = () => page.evaluate(() => document.querySelector('[data-region="today"]').innerText.replace(/\s+/g, " ").slice(0, 400));
console.log("TODAY with overdue:", await todayText());
await shoot(page, "track", "today-overdue-followup", { locator: '[data-region="today"]' });
const row = page.locator('[data-region="today"] button', { hasText: "Log follow-up" });
console.log("log-follow-up buttons:", await row.count());
if (await row.count()) {
  await row.first().click();
  await page.waitForTimeout(2000);
  console.log("writes after Log follow-up:", writes);
  console.log("TODAY after:", await todayText());
  console.log("juniper row now:", JSON.stringify(await page.evaluate(() => { const j = window.JobBored.getPipelineJobs().find(x => x.company === "Juniper Bank"); return { followUp: j.followUpDate, last: j.lastHeardFrom }; })));
  await shoot(page, "track", "today-after-log-follow-up", { locator: '[data-region="today"]' });
}
// (c) Open and reply
writes.length = 0;
await page.evaluate(() => scrollTo(0, 0));
await page.locator('[data-region="today"] button', { hasText: "Open and reply" }).nth(2).click();
await page.waitForTimeout(1500);
console.log("after open-and-reply: hash", await page.evaluate(() => location.hash), "scrollY", await page.evaluate(() => Math.round(scrollY)));
await shoot(page, "track", "today-open-and-reply-lands");
const people = page.locator('[data-region="role"] .case__section--people');
if (await people.count()) {
  await people.scrollIntoViewIfNeeded();
  await shoot(page, "track", "dossier-people-block", { locator: '[data-region="role"] .case__section--people' });
  console.log("PEOPLE:", (await people.innerText()).replace(/\s+/g, " "));
}
await app.close();
