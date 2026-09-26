// Keyboard walk: chrome -> Run discovery drawer -> pipeline card -> move stage -> dossier -> close.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
import { writeFileSync } from "node:fs";
const L = "access-responsive";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page } = app;
const log = [];
const cur = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { name: "<body>", body: true };
  const cs = getComputedStyle(el);
  const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.placeholder || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ? `outline ${cs.outlineWidth} ${cs.outlineColor}` : (cs.boxShadow !== "none" ? `shadow` : "NONE");
  const r = el.getBoundingClientRect();
  const offscreen = r.bottom < 0 || r.top > innerHeight || r.width === 0;
  return { name, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", ring, fv: el.matches(":focus-visible"), cls: el.className.toString().slice(0, 40), inDrawer: !!el.closest("#discoveryDrawer"), offscreen };
});
async function tab(n, label, stopWhen) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab"); await page.waitForTimeout(60);
    const c = await cur(); c.step = label; log.push(c);
    if (stopWhen && stopWhen(c)) return c;
  }
}
console.log("start", await cur());
// 1. top chrome
await tab(14, "chrome");
// back to Run discovery: find by shift-tab loop is messy; focus via tabbing from top again
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("Tab");
let c; for (let i = 0; i < 20; i++) { c = await cur(); if (/Run discovery|Open discovery/i.test(c.name)) break; await page.keyboard.press("Tab"); }
log.push({ ...c, step: "reach-run-discovery" });
await shoot(page, L, "focus-run-discovery");
await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
log.push({ ...(await cur()), step: "drawer-opened" });
await shoot(page, L, "focus-drawer-open");
const drawerTabs = await tab(40, "drawer");
const escaped = log.filter(x => x.step === "drawer" && !x.inDrawer && !x.body);
console.log("drawer tabs escaping drawer:", escaped.length, escaped.slice(0, 3));
await page.keyboard.press("Escape"); await page.waitForTimeout(700);
log.push({ ...(await cur()), step: "drawer-closed(Esc)" });
// 2. tab to a pipeline card's move-to-stage
const cardHit = await tab(200, "to-card", (x) => /Move to stage/.test(x.name));
const tabsToMove = log.filter(x => x.step === "to-card").length;
console.log("tabs from Run discovery to first Move-to-stage:", tabsToMove, cardHit?.name);
await shoot(page, L, "focus-move-to-stage");
await page.keyboard.press("Enter"); await page.waitForTimeout(600);
log.push({ ...(await cur()), step: "menu-opened" });
await shoot(page, L, "focus-stage-menu-open");
await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150);
log.push({ ...(await cur()), step: "menu-arrow" });
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
log.push({ ...(await cur()), step: "after-stage-move" });
await shoot(page, L, "focus-after-stage-move");
// 3. open the dossier from a card via keyboard: Tab to the card article and press Enter
await page.evaluate(() => document.activeElement?.blur());
const art = await tab(250, "to-card-article", (x) => x.tag === "article" || /open letter|Open dossier/i.test(x.name));
console.log("card article/open dossier reached:", art?.name, art?.tag);
await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
log.push({ ...(await cur()), step: "dossier-opened" });
const inRole = await page.evaluate(() => !!document.activeElement?.closest('[data-region="role"]'));
console.log("focus inside dossier after open:", inRole);
await shoot(page, L, "focus-dossier-opened");
const toClose = await tab(80, "to-dossier-close", (x) => /Close this role/.test(x.name));
console.log("tabs to dossier close:", log.filter(x => x.step === "to-dossier-close").length, toClose?.name);
await shoot(page, L, "focus-dossier-close");
await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
log.push({ ...(await cur()), step: "dossier-closed" });
await shoot(page, L, "focus-after-dossier-close");
writeFileSync("/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/keyboard.json", JSON.stringify(log, null, 1));
for (const x of log) if (!/^(drawer|to-card|to-card-article|to-dossier-close)$/.test(x.step)) console.log(x.step, "|", x.name, "|", x.tag, x.role, "|", x.ring, "fv=" + x.fv);
console.log("--- chrome order"); log.filter(x => x.step === "chrome").forEach((x, i) => console.log(i + 1, x.name, "|", x.ring, x.offscreen ? "OFFSCREEN" : ""));
const noring = log.filter(x => !x.body && x.ring === "NONE");
console.log("stops with no ring:", noring.length, [...new Set(noring.map(x => x.cls + " " + x.name.slice(0, 25)))].slice(0, 20));
await app.close();
