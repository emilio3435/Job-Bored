import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const vp = process.argv[2] || "desktop";
const app = await openApp({ mode: "signed-in", viewport: vp });
const { page } = app;
const info = await page.evaluate(() => {
  const regions = [...document.querySelectorAll("[data-region]")].map(r => {
    const b = r.getBoundingClientRect();
    return { region: r.getAttribute("data-region"), top: Math.round(b.top + scrollY), h: Math.round(b.height), visible: b.height > 0 && getComputedStyle(r).display !== "none" };
  });
  return { regions, docH: document.documentElement.scrollHeight, cards: document.querySelectorAll(".jb-lat__card").length };
});
console.log(JSON.stringify(info, null, 1));
await shoot(page, "tailor-apply", "dashboard-default", { fullPage: true });
await app.close();
