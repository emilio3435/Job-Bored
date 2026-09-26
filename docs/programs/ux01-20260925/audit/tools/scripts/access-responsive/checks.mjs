// Targeted checks: beat1 modality + keyboard, settings escapes, inert pointer, toast semantics, live region, 375 chrome/menu/settings tabs.
import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "access-responsive";
const nm = (page) => page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "<body>"; return (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40) + (e.closest(".discovery-setup-wizard, [data-oneflow], .oneflow") ? "" : " !OUT"); });
// Beat 1
if (process.env.BEAT1) {
  const app = await openApp({ mode: "greenfield", viewport: "desktop" }); const page = app.page;
  await page.focus("text=Make it mine"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const w = document.querySelector(".discovery-setup-wizard") || document.querySelector("[role=dialog]:not([hidden])"); const demo = document.querySelector(".oneflow-demo"); return { wizard: w && { cls: w.className.slice(0, 60), role: w.getAttribute("role"), modal: w.getAttribute("aria-modal"), label: w.getAttribute("aria-label") || w.getAttribute("aria-labelledby") }, demoInert: demo ? (demo.inert || !!demo.closest("[inert]")) : null, demoAriaHidden: demo ? !!demo.closest("[aria-hidden=true]") : null, h: [...document.querySelectorAll("h1,h2")].filter(h => h.getBoundingClientRect().width).map(h => h.tagName + ":" + h.textContent.trim().slice(0, 40)) }; });
  console.log("BEAT1 info", JSON.stringify(info)); console.log("BEAT1 focus after open:", await nm(page));
  const seq = []; for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); seq.push(await nm(page)); }
  console.log("BEAT1 tab seq:", seq.join(" > "));
  await shoot(page, L, "focus-beat1-tab");
  await page.keyboard.press("Escape"); await page.waitForTimeout(800); console.log("BEAT1 after Esc focus:", await nm(page), "wizard visible:", await page.evaluate(() => !!document.querySelector(".discovery-setup-wizard")?.getBoundingClientRect().width));
  await app.close();
}
// Settings escapes + inert pointer + toast semantics
{
  const app = await openApp({ mode: "signed-in", viewport: "desktop" }); const page = app.page;
  console.log("TOAST container:", await page.evaluate(() => { const t = document.getElementById("toastContainer"); return t && { role: t.getAttribute("role"), live: t.getAttribute("aria-live"), kids: t.children.length, kidRoles: [...t.children].map(c => c.getAttribute("role") || c.querySelector("[role]")?.getAttribute("role")) }; }));
  console.log("jb-a11y live regions:", await page.evaluate(() => [...document.querySelectorAll(".jb-a11y-visually-hidden[aria-live]")].map(n => n.getAttribute("aria-live") + ":" + n.textContent.slice(0, 60))));
  await page.focus("#settingsBtn"); await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  const s = []; for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); s.push(await page.evaluate(() => { const e = document.activeElement; const n = e === document.body ? "<body>" : (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 22); return n + (e.closest("#settingsModal") ? "" : " !OUT"); })); }
  console.log("SETTINGS tab seq:", s.join(" > "));
  console.log("SETTINGS modal attrs:", await page.evaluate(() => { const m = document.getElementById("settingsModal"); const d = m.querySelector("[role=dialog]") || m; return { role: d.getAttribute("role"), modal: d.getAttribute("aria-modal"), lab: d.getAttribute("aria-labelledby"), bgInert: [...document.body.children].filter(c => c.inert).length }; }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  // inert pointer: open drawer, click a background control at its coordinates
  await page.evaluate(() => document.getElementById("discoveryBtn").click()); await page.waitForTimeout(1200);
  const bg = await page.evaluate(() => { const b = document.querySelector('.page-nav__pill[data-region-target="pipeline"]'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, inert: !!b.closest("[inert]") }; });
  const before = await page.evaluate(() => scrollY);
  await page.mouse.click(bg.x, bg.y); await page.waitForTimeout(800);
  console.log("INERT pointer: bg pill inert=", bg.inert, "scrollY before/after", before, await page.evaluate(() => scrollY), "drawer open:", await page.evaluate(() => document.body.classList.contains("detail-open")));
  await page.evaluate(() => document.getElementById("discoveryBtn").click()); await page.waitForTimeout(1200);
  const snap = await page.locator("body").ariaSnapshot();
  console.log("INERT a11y tree: contains 'Open and reply'?", /Open and reply/.test(snap), "contains 'Target roles'?", /Target roles/i.test(snap));
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("settingsBtn").click()); await page.waitForTimeout(1200);
  console.log("SETTINGS unnamed focusables:", await page.evaluate(() => [...document.querySelectorAll("#settingsModal button, #settingsModal input, #settingsModal select, #settingsModal a[href], #settingsModal [tabindex='0']")].filter(e => e.getBoundingClientRect().width && !(e.getAttribute("aria-label") || e.textContent.trim() || e.labels?.length || e.getAttribute("title") || e.getAttribute("aria-labelledby"))).map(e => e.outerHTML.slice(0, 200))));
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  await page.locator(".today-item__action", { hasText: "Open dossier" }).first().click(); await page.waitForTimeout(1800);
  console.log("AFTER TOAST live regions:", await page.evaluate(() => [...document.querySelectorAll("[aria-live],[role=alert],[role=status]")].filter(n => n.textContent.trim()).map(n => (n.className || n.id).toString().slice(0, 30) + "[" + (n.getAttribute("aria-live") || n.getAttribute("role")) + "]:" + n.textContent.trim().slice(0, 70))));
  await app.close();
}
// 375 checks
{
  const app = await openApp({ mode: "signed-in", viewport: "phone" }); const page = app.page;
  console.log("375 chrome:", await page.evaluate(() => { const a = document.querySelector(".page-top__actions"); const t = document.getElementById("authMenuToggle").getBoundingClientRect(); const ar = a.getBoundingClientRect(); return { actions: [Math.round(ar.x), Math.round(ar.right)], scrollW: a.scrollWidth, clientW: a.clientWidth, avatarRight: Math.round(t.right), avatarVisiblePx: Math.max(0, Math.round(Math.min(t.right, ar.right) - t.x)), burger: [...document.querySelectorAll(".page-top button")].filter(b => b.getBoundingClientRect().x > 300).map(b => (b.getAttribute("aria-label") || b.textContent.trim()) + " exp=" + b.getAttribute("aria-expanded")) }; }));
  await shoot(page, L, "chrome-clipped", { locator: ".page-top" });
  const burger = page.locator(".page-top button[aria-expanded]").last();
  if (await burger.count()) { await burger.click(); await page.waitForTimeout(600); await shoot(page, L, "chrome-menu-open"); console.log("375 burger opens:", await page.evaluate(() => document.querySelector(".page-top")?.className)); await page.keyboard.press("Escape"); }
  // settings tabs at 375
  await page.evaluate(() => document.getElementById("settingsBtn").click()); await page.waitForTimeout(1200);
  console.log("375 settings tablist:", await page.evaluate(() => { const tl = document.querySelector("#settingsModal [role=tablist]"); const r = tl.getBoundingClientRect(); const cs = getComputedStyle(tl); return { w: Math.round(r.width), scrollW: tl.scrollWidth, ovx: cs.overflowX, tabsVisible: [...tl.querySelectorAll("[role=tab]")].filter(t => { const b = t.getBoundingClientRect(); return b.right <= r.right + 1 && b.x >= r.x - 1; }).map(t => t.textContent.trim()), tabCount: tl.querySelectorAll("[role=tab]").length }; }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  // pipeline at 375
  await page.locator('[data-region="pipeline"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await shoot(page, L, "pipeline-squeezed");
  // toasts on dossier 375
  await page.locator(".today-item__action", { hasText: "Open dossier" }).first().click(); await page.waitForTimeout(1800);
  console.log("375 toasts:", await page.evaluate(() => [...document.querySelectorAll("#toastContainer > *")].map(t => { const r = t.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} "${t.textContent.trim().slice(0, 50)}"`; })));
  // scribe ring overlap
  await page.locator('[data-region="scribe"] .scribe-scorecard').first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(400);
  console.log("375 scribe ring:", await page.evaluate(() => { const ring = document.querySelector(".scribe-scorecard__ring, [class*=scorecard__ring], [class*=scorecard__gauge]"); if (!ring) return "no ring"; const r = ring.getBoundingClientRect(); const txt = [...ring.querySelectorAll("*")].map(e => e.getBoundingClientRect()).reduce((m, b) => Math.max(m, b.width), 0); return { cls: ring.className, w: Math.round(r.width), h: Math.round(r.height), innerMaxW: Math.round(txt), text: ring.textContent.trim().slice(0, 60) }; }));
  await shoot(page, L, "scribe-scorecard", { locator: '[data-region="scribe"] .scribe-scorecard' }).catch((e) => console.log("noshot", e.message.slice(0, 80)));
  await app.close();
}
