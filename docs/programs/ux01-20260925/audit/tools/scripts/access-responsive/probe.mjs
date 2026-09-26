import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const mode = process.argv[2] || "signed-in";
const app = await openApp({ mode, viewport: "desktop" });
const { page } = app;
const out = await page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
  return [...document.querySelectorAll("button, a[href], [role=button], input, select, textarea, [tabindex]")].filter(vis).slice(0, 120).map((el) => {
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].slice(0,2).join(".")} [${el.getAttribute("data-action")||""}] "${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g," ").slice(0,50)}" ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  });
});
console.log(out.join("\n"));
console.log("bodyclass", await page.evaluate(() => document.body.className));
await page.screenshot({ path: `/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/probe-${mode}.png` });
await app.close();
