import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
await app.page.evaluate(() => window.JobBoredOnboardingCelebration.playOnboardingCelebration(() => {}, "flow_payoff"));
await app.page.waitForTimeout(250);
console.log(await app.page.evaluate(() => ({ mq: matchMedia("(prefers-reduced-motion: reduce)").matches, running: document.getAnimations().filter(a => a.playState === "running").map(a => a.animationName || a.transitionProperty).reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {}) })));
await app.close();
