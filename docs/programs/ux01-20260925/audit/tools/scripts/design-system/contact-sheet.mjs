// Builds component contact sheets from runtime.json reps (one per coarse signature).
// Run from worktree root after runtime.mjs:  node <this>
import { chromium } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/node_modules/playwright/index.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const HERE = import.meta.dirname;
const OUT = "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/shots/design-system";
const r = JSON.parse(readFileSync(join(HERE, "runtime.json"), "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const cat of ["button", "pill", "card", "input"]) {
  const groups = new Map();
  for (const x of r.inventory[cat]) {
    if (!x.shot || !existsSync(x.shot)) continue;
    const g = groups.get(x.coarse) || { n: 0, x };
    g.n += x.count; groups.set(x.coarse, g);
  }
  const items = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  const maxW = cat === "card" ? 420 : 260;
  const html = `<html><body style="margin:0;padding:24px;font:12px/1.35 -apple-system,system-ui;background:#fff;color:#222">
<h1 style="font:600 20px system-ui;margin:0 0 4px">${cat}: ${items.length} distinct looks (fill | border | radius | family | weight), ${r.inventory[cat].length} exact computed-style signatures</h1>
<p style="margin:0 0 16px;color:#555">UX01 design-system lens · f227fbb · greenfield + signed-in states at 1440 and 375 · one representative per look, most-rendered first</p>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${maxW}px,1fr));gap:14px">
${items.map(([c, g], i) => `<figure style="margin:0;border:1px solid #ddd;padding:8px;background:repeating-conic-gradient(#f4f4f4 0 25%,#fff 0 50%) 0 0/12px 12px">
<div style="height:${cat === "card" ? 200 : 64}px;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="data:image/png;base64,${readFileSync(g.x.shot).toString("base64")}" style="max-width:100%;max-height:100%"></div>
<figcaption style="background:#fff;margin-top:6px;word-break:break-word"><b>#${i + 1}</b> ×${g.n} · ${g.x.who.slice(0, 2).join(" ")}<br><span style="color:#777">${c}</span></figcaption></figure>`).join("")}
</div></body></html>`;
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `components-${cat}s-1440.png`), fullPage: true });
  console.log(cat, items.length, "looks");
}
await browser.close();
