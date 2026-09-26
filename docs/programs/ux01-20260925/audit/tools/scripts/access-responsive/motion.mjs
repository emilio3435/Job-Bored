// Reduced motion: emulate, assert matchMedia, list running animations.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const list = (page) => page.evaluate(() => {
  const anims = document.getAnimations().filter(a => a.playState === "running");
  const g = {};
  for (const a of anims) { const t = a.effect?.target; const k = (a.animationName || a.transitionProperty || a.constructor.name) + " @ " + (t ? (t.tagName.toLowerCase() + "." + [...t.classList].slice(0, 2).join(".")) : "?"); const tm = a.effect?.getTiming?.(); g[k] = g[k] || { n: 0, dur: tm?.duration, iter: tm?.iterations }; g[k].n++; }
  return { mq: matchMedia("(prefers-reduced-motion: reduce)").matches, running: anims.length, groups: g };
});
async function run(label, mode, go) {
  const app = await openApp({ mode, viewport: "desktop", reducedMotion: "reduce" });
  const page = app.page;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await go?.(page);
  const r = await list(page);
  console.log(`\n## ${label}: matchMedia(reduce)=${r.mq} running=${r.running}`);
  for (const [k, v] of Object.entries(r.groups)) console.log(`  ${v.n}x ${k} dur=${v.dur} iter=${v.iter}`);
  // control: same state without reduce
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return app;
}
let app = await run("demo-board", "greenfield"); await app.close();
app = await run("dashboard", "signed-in"); await app.close();
app = await run("dossier", "signed-in", async (p) => { await p.locator(".today-item__action", { hasText: "Open dossier" }).first().click(); await p.waitForTimeout(300); }); await app.close();
app = await run("discovery-drawer", "signed-in", async (p) => { await p.evaluate(() => document.getElementById("discoveryBtn").click()); await p.waitForTimeout(100); }); await app.close();
app = await run("celebration", "signed-in", async (p) => {
  await p.evaluate(() => window.JobBoredOnboardingCelebration.playOnboardingCelebration(() => {}, "flow_payoff"));
  await p.waitForTimeout(250);
  await shoot(p, "access-responsive", "celebration-reduced-motion");
}); await app.close();
// control run without reduce
const c = await openApp({ mode: "greenfield", viewport: "desktop" });
const r0 = await list(c.page); console.log(`\n## control demo-board no-preference: mq=${r0.mq} running=${r0.running}`); for (const [k, v] of Object.entries(r0.groups)) console.log(`  ${v.n}x ${k} dur=${v.dur} iter=${v.iter}`);
await c.close();
