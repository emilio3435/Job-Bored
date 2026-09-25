// WCAG 2.4.11 Focus Not Obscured: Tab through the whole signed-in page; flag stops whose center is covered.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const vp = process.argv[2] || "desktop";
const app = await openApp({ mode: "signed-in", viewport: vp }); const page = app.page;
await page.addStyleTag({ content: "html{scroll-behavior:auto!important}*{scroll-behavior:auto!important}" });
const seen = new Set(); let stops = 0; const obscured = []; let shot = false;
for (let i = 0; i < 150; i++) {
  await page.keyboard.press("Tab"); await page.waitForTimeout(30);
  const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const b = e.getBoundingClientRect(); const cx = b.x + b.width / 2, cy = b.y + Math.min(b.height / 2, 20); const inView = cy >= 0 && cy <= innerHeight && cx >= 0 && cx <= innerWidth; const top = inView ? document.elementFromPoint(cx, cy) : null; const ok = top && (top === e || e.contains(top) || top.contains(e)); const name = (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 32); const cover = top && !ok ? (top.closest("header,footer,[class*=strip],[class*=toast],[class*=topbar],[class*=page-top]")?.className?.toString().slice(0, 40) || top.className?.toString().slice(0, 40)) : ""; return { key: e.outerHTML.slice(0, 120), name, inView, ok: !!ok, cover }; });
  if (!r) continue; if (seen.has(r.key + r.name + r.inView)) continue; seen.add(r.key + r.name); stops++;
  if (!r.ok) { obscured.push(`${r.name} ${r.inView ? "covered by " + r.cover : "OFFSCREEN"}`); if (!shot && r.inView) { await shoot(page, "access-responsive", "focus-obscured"); shot = true; } }
}
console.log(`${vp}: unique stops=${stops} obscured=${obscured.length}`); obscured.forEach(o => console.log("  ", o));
await app.close();
