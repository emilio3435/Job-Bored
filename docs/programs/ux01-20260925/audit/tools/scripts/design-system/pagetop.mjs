import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "phone", settleMs: 2500 });
console.log(await shoot(app.page, "design-system", "page-top-default", { locator: ".page-top" }));
console.log(await app.page.evaluate(() => { const b = document.querySelector("#discoveryBtn"); const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return { w: r.width, h: r.height, text: b.textContent.trim(), overflow: s.overflow, fontSize: s.fontSize }; }));
console.log(await app.page.evaluate(() => { const l = document.querySelector(".settings-tablist"); return l ? getComputedStyle(l).overflowX : null; }));
await app.close();
