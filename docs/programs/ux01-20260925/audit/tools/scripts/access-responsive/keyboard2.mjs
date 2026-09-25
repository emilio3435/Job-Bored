// Keyboard walk in phases, each from a fresh signed-in load at 1440.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "access-responsive";
const cur = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { name: "<body>", body: true };
  const cs = getComputedStyle(el);
  const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.placeholder || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ? `outline ${cs.outlineWidth}` : (cs.boxShadow !== "none" ? `shadow` : "NONE");
  return { name, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", ring, fv: el.matches(":focus-visible"), cls: el.className.toString().slice(0, 40), inDrawer: !!el.closest("#discoveryDrawer"), inRole: !!el.closest('[data-region="role"]'), inMenu: !!el.closest(".jb-a11y-stage-menu"), inDialog: !!el.closest("[role=dialog],[role=alertdialog]") };
});
const P = (t, x) => console.log(t, "|", x.name, "|", x.tag, x.role, "|", x.ring, "fv=" + x.fv, x.inDrawer ? "[drawer]" : "", x.inRole ? "[role]" : "", x.inDialog ? "[dialog]" : "");

// Phase B: drawer
{
  const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
  await page.focus("#discoveryBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  P("B drawer-open", await cur(page));
  let esc = 0, seq = [];
  for (let i = 0; i < 60; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(40); const c = await cur(page); seq.push(c.name.slice(0, 22) + (c.inDrawer ? "" : "!OUT")); if (!c.inDrawer) esc++; }
  console.log("B tabs=60 escapes=", esc); console.log("B seq:", seq.join(" > "));
  let sh = 0; for (let i = 0; i < 30; i++) { await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(30); if (!(await cur(page)).inDrawer) sh++; }
  console.log("B shift-tab 30 escapes=", sh);
  await shoot(page, L, "focus-drawer-tab");
  await page.keyboard.press("Escape"); await page.waitForTimeout(800);
  P("B after Esc", await cur(page)); console.log("B drawer still open:", await page.evaluate(() => document.body.classList.contains("detail-open")));
  // close via close button
  await page.focus("#discoveryBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(1000);
  const closeSel = await page.evaluate(() => { const b = [...document.querySelectorAll("#discoveryDrawer button")].find(b => /close/i.test(b.getAttribute("aria-label") || b.textContent)); b?.focus(); return b?.getAttribute("aria-label") || b?.textContent.trim(); });
  await page.keyboard.press("Enter"); await page.waitForTimeout(800); P("B after close btn (" + closeSel + ")", await cur(page));
  await app.close();
}
// Phase C/D: stage move
{
  const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
  await page.focus("#discoveryBtn");
  let n = 0, c; const seq = [];
  for (; n < 150; n++) { await page.keyboard.press("Tab"); c = await cur(page); seq.push(c.name.slice(0, 18)); if (/^Move to stage/.test(c.name)) break; }
  console.log("C tabs Run discovery -> first Move to stage:", n + 1); console.log("C seq:", seq.join(" > "));
  await shoot(page, L, "focus-move-to-stage");
  await page.keyboard.press("Enter"); await page.waitForTimeout(600); P("D menu open", await cur(page));
  await shoot(page, L, "focus-stage-menu-open");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); P("D menu Esc", await cur(page));
  await page.keyboard.press("Enter"); await page.waitForTimeout(600);
  await page.keyboard.press("Enter"); await page.waitForTimeout(1800); // choose first item: Discovered (New)
  P("D after move to Discovered", await cur(page));
  console.log("D live:", await page.evaluate(() => [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].map(n => n.textContent.trim()).filter(Boolean).slice(0, 5)));
  await shoot(page, L, "focus-after-stage-move");
  await app.close();
}
// Phase E: dossier
{
  const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
  const art = page.locator("article.pipe-sticker:visible").first(); await art.focus();
  P("E card focused", await cur(page)); await shoot(page, L, "focus-card-article");
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  P("E after Enter on card", await cur(page));
  console.log("E role region filled:", await page.evaluate(() => document.querySelector('[data-region="role"]')?.textContent.trim().slice(0, 60)));
  await shoot(page, L, "focus-dossier-opened");
  let n = 0, c; for (; n < 120; n++) { await page.keyboard.press("Tab"); c = await cur(page); if (/Close this role/.test(c.name)) break; }
  console.log("E tabs from card to dossier close:", n + 1, c.name);
  await shoot(page, L, "focus-dossier-close");
  await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  P("E after close", await cur(page));
  await page.keyboard.press("Tab"); P("E next Tab after close", await cur(page));
  await app.close();
}
// Phase F: settings modal
{
  const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
  await page.focus("#settingsBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  P("F settings open", await cur(page));
  let esc = 0; for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(30); if (!(await page.evaluate(() => !!document.activeElement.closest("#settingsModal")))) esc++; }
  console.log("F settings tabs=40 escapes=", esc);
  await page.keyboard.press("Escape"); await page.waitForTimeout(600); P("F after Esc", await cur(page));
  await app.close();
}
