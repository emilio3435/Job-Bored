import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
const st = () => page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const scrollers = [...document.querySelectorAll("*")].filter(e => e.scrollHeight > e.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e => e.tagName + "." + e.className.toString().slice(0, 30) + " st=" + e.scrollTop); return { y: Math.round(r.y), h: Math.round(r.height), winY: scrollY, docH: document.documentElement.scrollHeight, bodyOv: getComputedStyle(document.body).overflow, htmlOv: getComputedStyle(document.documentElement).overflow, scrollers: scrollers.slice(0, 6), inner: innerHeight }; });
await page.focus("#discoveryBtn");
for (let i = 0; i < 44; i++) await page.keyboard.press("Tab");
await page.waitForTimeout(800);
console.log(await st());
await page.screenshot({ path: "/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/scrollchk.png" });
await app.close();
