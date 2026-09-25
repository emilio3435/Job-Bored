// Which legacy-*.css rules do live work under body.jb-v2? Coverage-used rule
// selectors per legacy sheet, across signed-in desktop states + greenfield.
// Run from worktree root:  node <this>
import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const used = new Map();
async function go(mode, drive) {
  const app = await openApp({ mode, viewport: "desktop", settleMs: 1500 });
  const { page } = app;
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await drive(page);
  for (const e of await page.coverage.stopCSSCoverage()) {
    const f = new URL(e.url).pathname.slice(1);
    if (!/legacy-|^style\.css|onboarding-celebration|discovery-run-preview|settings-tabs|fit-profile\.css|materials-queue|welcome|lattice|role\.css/.test(f)) continue;
    if (!used.has(f)) used.set(f, new Set());
    for (const r of e.ranges) {
      const chunk = e.text.slice(r.start, r.end);
      const sel = e.text.slice(Math.max(0, e.text.lastIndexOf("}", r.start) + 1), r.start).trim() || chunk.split("{")[0].trim();
      const s = (chunk.includes("{") ? chunk.split("{")[0] : sel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      if (s) used.get(f).add(s.slice(0, 90));
    }
  }
  await app.close();
}
const click = async (page, sel) => { try { await page.locator(sel).filter({ visible: true }).first().click({ timeout: 3000 }); await page.waitForTimeout(800); } catch {} };
const esc = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };
await go("signed-in", async (page) => {
  await click(page, ".brief-btn--primary");
  await page.evaluate(() => scrollTo(0, 0));
  await click(page, "#settingsBtn");
  for (let i = 0; i < 7; i++) { try { await page.locator(".settings-tablist__btn").nth(i).click({ timeout: 1500 }); await page.waitForTimeout(300); } catch {} }
  await esc(page);
  await click(page, "#discoveryBtn");
  for (const t of ["#dd-tab-sources", "#dd-tab-automation", "#dd-tab-connection", "#dd-tab-history"]) await click(page, t);
  await esc(page);
  await click(page, "#runsBtn"); await esc(page);
  await click(page, "#materialsBtn"); await esc(page);
  await click(page, "#authMenuToggle"); await esc(page);
});
await go("greenfield", async (page) => { await click(page, ".oneflow-demo__invite-action--primary"); });
for (const [f, s] of [...used].sort()) console.log(`\n### ${f} — ${s.size} used rule blocks\n  ` + [...s].slice(0, 25).join("\n  "));
