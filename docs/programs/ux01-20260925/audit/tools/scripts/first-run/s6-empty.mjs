import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in-empty", viewport: "desktop", setupDone: true });
const { page } = app;
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => {
  const es = document.getElementById("emptyState"); const t = document.getElementById("emptyStateTitle");
  const m = document.getElementById("ingestManualModalOpenBtn"); const u = document.getElementById("ingestUrlInput");
  const vis = (e) => e ? `${getComputedStyle(e).display}/${e.offsetParent !== null}` : "absent";
  return { es: vis(es), esStyle: es?.style.display, title: t?.textContent.trim(), manual: vis(m), url: vis(u), welcome: document.querySelector('[data-region="welcome"]')?.dataset.mode || "none",
    pipeEmpty: [...document.querySelectorAll("[class*='empty']")].filter((x) => x.getBoundingClientRect().height > 20).map((x) => x.className.toString().slice(0, 40) + ": " + x.innerText.replace(/\s+/g, " ").slice(0, 90)).slice(0, 6) };
}), null, 1));
await shoot(page, "first-run", "dashboard-empty-first-load", { fullPage: true });
await app.close();
