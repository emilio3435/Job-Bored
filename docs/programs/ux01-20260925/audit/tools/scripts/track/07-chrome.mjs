// Top chrome: which icons render, their accessible names, the expired-review
// button's hidden attr vs computed display, and the badge text.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const vp of ["desktop", "phone"]) {
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  const r = await page.evaluate(() => {
    const b = document.getElementById("expiredReviewBtn");
    const cs = getComputedStyle(b);
    const actions = [...document.querySelectorAll('.page-top__actions button, .page-top__actions a, header button, header a')].filter(e => e.getBoundingClientRect().width > 0).map(e => (e.getAttribute('aria-label') || e.title || e.innerText).trim().replace(/\s+/g,' ').slice(0,60));
    return { hiddenAttr: b.hidden, display: cs.display, rule: cs.display, badge: document.getElementById("expiredReviewCount")?.textContent, badgeVisible: !!document.getElementById("expiredReviewCount")?.getBoundingClientRect().width, aria: b.getAttribute('aria-label'), actions: [...new Set(actions)] };
  });
  console.log(vp, JSON.stringify(r, null, 1));
  await shoot(page, "track", "chrome-top", { locator: "header, .page-top" });
  await app.close();
}
