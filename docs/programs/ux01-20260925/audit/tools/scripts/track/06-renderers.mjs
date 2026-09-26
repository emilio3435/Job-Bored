// Which renderers paint under body.jb-v2 vs render hidden vs stay dormant, and
// the text of each "what next" surface.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const path of ["/", "/?jb-v2=0"]) {
  const app = await openApp({ mode: "signed-in", viewport: "desktop", path });
  const { page } = app;
  const r = await page.evaluate(() => {
    const d = (sel) => { const el = document.querySelector(sel); if (!el) return "absent"; const cs = getComputedStyle(el); const rect = el.getBoundingClientRect(); return { display: cs.display, h: Math.round(rect.height), nodes: el.querySelectorAll("*").length, text: el.innerText.replace(/\s+/g, " ").slice(0, 700) }; };
    return {
      body: document.body.className,
      today: d('[data-region="today"]'),
      dawn: d('[data-region="dawn"]'),
      legacyBrief: d('.daily-brief-panel'),
      legacyCards: d('#jobCards'),
      lattice: d('[data-region="lattice"]'),
      pipeline: d('[data-region="pipeline"]'),
      whatsNext: d('[data-region="whats-next"]'),
      expiredBtn: d('#expiredReviewBtn') ,
      legacyCardCount: document.querySelectorAll('#jobCards .job-card, #jobCards [data-stable-key]').length,
      legacyActions: [...new Set([...document.querySelectorAll('#jobCards [data-action]')].map(e => e.getAttribute('data-action')))],
    };
  });
  console.log(path, JSON.stringify(r, null, 1));
  if (path !== "/") await shoot(page, "track", "legacy-view-full", { fullPage: true });
  await app.close();
}
