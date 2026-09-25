import { openApp, shoot } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
for (const w of [320, 393]) {
  const app = await openApp({ mode: "signed-in", viewport: { width: w, height: 760 } }); const page = app.page;
  const cdp = await app.context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
  await page.reload(); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]"); };
    const els = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[tabindex='0']")].filter(vis);
    const small = els.filter(e => { const b = e.getBoundingClientRect(); return b.width < 44 || b.height < 44; });
    const tt = [...document.querySelectorAll(".jb-a11y-touch-target")].filter(vis).map(e => Math.round(e.getBoundingClientRect().height));
    return { coarse: matchMedia("(pointer: coarse)").matches, overflow: document.documentElement.scrollWidth - innerWidth, interactive: els.length, under44: small.length, touchTargetHeights: [...new Set(tt)], iconBtn: Math.round(document.getElementById("settingsBtn").getBoundingClientRect().height) };
  });
  console.log(w, JSON.stringify(r));
  await shoot(page, "access-responsive", "dashboard-coarse");
  await app.close();
}
