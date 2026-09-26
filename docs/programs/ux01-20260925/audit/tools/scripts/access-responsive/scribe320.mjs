import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: { width: 320, height: 700 } }); const page = app.page;
console.log(await page.evaluate(() => { let e = document.querySelector(".scribe-topbar"); const chain = []; while (e && e !== document.body) { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); chain.push(`${e.tagName.toLowerCase()}.${[...e.classList].slice(0,2).join(".")} x=${Math.round(b.x)} w=${Math.round(b.width)} minW=${cs.minWidth} pad=${cs.paddingLeft}/${cs.paddingRight} margin=${cs.marginLeft}/${cs.marginRight}`); e = e.parentElement; } return chain; }));
// widest children inside topbar
console.log(await page.evaluate(() => [...document.querySelectorAll(".scribe-topbar *, .scribe-strip *")].map(e => [e, e.getBoundingClientRect()]).filter(([, b]) => b.right > 322).map(([e, b]) => `${e.tagName.toLowerCase()}.${[...e.classList][0]||""} right=${Math.round(b.right)} w=${Math.round(b.width)} ws=${getComputedStyle(e).whiteSpace}`).slice(0, 12)));
await app.close();
