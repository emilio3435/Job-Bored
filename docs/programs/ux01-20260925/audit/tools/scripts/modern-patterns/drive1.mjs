import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "modern-patterns";
const vp = process.argv[2] || "desktop";
const app = await openApp({ mode: "signed-in", viewport: vp });
const p = app.page;
const log = (...a) => console.log(vp, ...a);
// Today / brief
await shoot(p, L, "today-default");
// press ? for shortcuts help
await p.keyboard.press("Shift+Slash");
await p.waitForTimeout(400);
log("after ?: dialogs open =", await p.evaluate(() => [...document.querySelectorAll('[role=dialog],dialog')].filter(d => d.offsetParent || d.open).map(d => d.id || d.className).join("|")));
// Cmd+K
await p.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
await p.waitForTimeout(600);
log("after cmdk active:", await p.evaluate(() => { const a = document.activeElement; return a.tagName + " " + (a.getAttribute("aria-label") || a.className) + " y=" + Math.round(a.getBoundingClientRect().top); }));
await shoot(p, L, "cmdk-pressed");
await p.keyboard.type("orb");
await p.waitForTimeout(500);
await shoot(p, L, "cmdk-typed");
await p.keyboard.press("Escape");
// Pipeline board
await p.evaluate(() => { const i = document.querySelector("[data-pipeline-search]"); if (i) { i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); } });
const pipe = p.locator('[data-region="pipeline"], #pipeline, .pipe-toolbar').first();
await pipe.scrollIntoViewIfNeeded().catch(() => {});
await p.waitForTimeout(400);
await shoot(p, L, "pipeline-board");
// j/k on board
const firstCard = p.locator(".pipe-sticker").first();
await firstCard.focus().catch(() => {});
await p.keyboard.press("j");
await p.waitForTimeout(200);
log("after j focus:", await p.evaluate(() => document.activeElement.className + " " + (document.activeElement.getAttribute("data-stable-key") || "")));
// Add from URL
await p.locator('[data-action="add-job-url"]').first().click();
await p.waitForTimeout(500);
await shoot(p, L, "capture-add-url-open");
log("modal copy:", await p.evaluate(() => document.querySelector("[data-pipeline-url-modal]")?.innerText.replace(/\s+/g, " ").slice(0, 600)));
const input = p.locator("[data-pipeline-url-modal] input").first();
await input.fill("https://www.linkedin.com/jobs/view/1234567890/");
await p.keyboard.press("Enter");
await p.waitForTimeout(2500);
await shoot(p, L, "capture-add-url-linkedin");
log("after submit:", await p.evaluate(() => { const m = [...document.querySelectorAll('[role=dialog]')].filter(d => d.offsetParent && !d.hidden).map(d => d.innerText.replace(/\s+/g, " ").slice(0, 400)); const t = [...document.querySelectorAll('[role=status],[role=alert],.toast,.jb-toast')].map(x => x.innerText.trim()).filter(Boolean); return { m, t }; }));
await app.close();
