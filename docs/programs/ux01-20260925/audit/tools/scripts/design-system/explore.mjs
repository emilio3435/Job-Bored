import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const mode = process.argv[2] || "signed-in"; const vp = process.argv[3] || "desktop";
const app = await openApp({ mode, viewport: vp, settleMs: 2500 });
const info = await app.page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
  return {
    bodyClass: document.body.className,
    buttons: [...document.querySelectorAll("button, a[role=button], [data-action]")].filter(vis).slice(0, 80).map((b) => `${b.tagName.toLowerCase()}#${b.id}.${[...b.classList].join(".")} [${b.getAttribute("data-action") || ""}] "${(b.textContent || "").trim().slice(0, 30)}"`),
    regions: [...document.querySelectorAll("[data-region]")].map((r) => `${r.dataset.region}:${vis(r)}`),
  };
});
console.log(JSON.stringify(info, null, 1));
await app.close();
