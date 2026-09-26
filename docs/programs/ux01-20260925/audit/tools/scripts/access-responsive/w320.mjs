import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const mode of ["signed-in", "greenfield"]) {
const app = await openApp({ mode, viewport: { width: 320, height: 700 } }); const page = app.page;
console.log(mode, await page.evaluate(() => { const W = innerWidth; const out = []; for (const el of document.body.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (!b.width) continue; if (b.right > W + 1) { const p = el.parentElement.getBoundingClientRect(); if (p.right <= W + 1) out.push(el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 2).join(".") + " right=" + Math.round(b.right) + " w=" + Math.round(b.width)); } } return { overflow: document.documentElement.scrollWidth - W, offenders: out.slice(0, 10) }; }));
await shoot(page, "access-responsive", `${mode}-overflow`, { fullPage: false });
await app.close();
}
