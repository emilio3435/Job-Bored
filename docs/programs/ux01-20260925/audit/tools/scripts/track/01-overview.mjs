import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const mode = process.argv[2] || "signed-in";
for (const vp of ["desktop", "phone"]) {
  const app = await openApp({ mode, viewport: vp });
  const { page } = app;
  const info = await page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.height > 0 && r.width > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const sections = [];
    for (const el of document.querySelectorAll("body > *, main > *, #app > *, [id]")) {
      if (!el.id) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 60 && vis(el) && el.parentElement && (el.parentElement.tagName==="MAIN"||el.parentElement.tagName==="BODY"||el.parentElement.id==="app"||el.parentElement.classList.contains("main"))) sections.push({ id: el.id, cls: el.className?.toString().slice(0,60), top: Math.round(r.top + scrollY), h: Math.round(r.height) });
    }
    return { bodyClass: document.body.className, height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, sections };
  });
  console.log(vp, JSON.stringify(info, null, 1));
  await shoot(page, "track", `${mode}-page-full`, { fullPage: true });
  await shoot(page, "track", `${mode}-page-fold`);
  await app.close();
}
