import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
for (const viewport of ["desktop", "phone"]) {
  for (const mode of ["greenfield", "signed-in"]) {
    const app = await openApp({ mode, viewport });
    const p = app.page;
    await shoot(p, L, `explore-${mode}`);
    await shoot(p, L, `explore-${mode}-full`, { fullPage: true });
    const info = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const btns = [...document.querySelectorAll("button, a, [role=tab]")].filter(vis).map(b => (b.innerText||b.getAttribute("aria-label")||"").trim().replace(/\s+/g," ").slice(0,50)).filter(Boolean);
      const heads = [...document.querySelectorAll("h1,h2,h3")].filter(vis).map(h => h.innerText.trim().slice(0,60));
      return { url: location.href, btns: [...new Set(btns)].slice(0,80), heads: heads.slice(0,40), bodyCls: document.body.className };
    });
    console.log(viewport, mode, JSON.stringify(info, null, 1));
    await app.close();
  }
}
