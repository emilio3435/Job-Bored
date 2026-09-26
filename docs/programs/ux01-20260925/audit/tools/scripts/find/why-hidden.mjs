import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const r = await app.page.evaluate(() => {
  let e = document.getElementById("ingestUrlInput"); const chain = [];
  while (e && e !== document.body) { const cs = getComputedStyle(e); chain.push([e.tagName, e.id || e.className.toString().slice(0,60), cs.display, e.hidden, cs.visibility]); e = e.parentElement; }
  return { chain, bodyClass: document.body.className, mains: [...document.querySelectorAll("main, [data-region]")].map(m => [m.tagName, m.className.toString().slice(0,50), m.getAttribute("data-region"), getComputedStyle(m).display]) };
});
console.log(JSON.stringify(r, null, 1));
await app.close();
