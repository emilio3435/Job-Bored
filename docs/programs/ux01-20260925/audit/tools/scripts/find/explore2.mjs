import { openApp, shoot, runAxe } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const L = "find";
const vp = process.argv[2] || "desktop";
const log = (...a) => console.log(`[${vp}]`, ...a);
const toasts = page => page.evaluate(() => [...document.querySelectorAll('.toast')].filter(e => e.offsetParent).map(e => e.textContent.replace(/\s+/g, " ").trim()));
// ---- A: signed-in, v2 URL modal
{
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  const btn = page.locator('[data-action="add-job-url"]').first();
  const box = await page.evaluate(() => { const e = document.querySelector('[data-action="add-job-url"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), docH: document.documentElement.scrollHeight, vh: innerHeight, visible: !!e.offsetParent }; });
  log("add-job-url btn", JSON.stringify(box));
  const regions = await page.evaluate(() => [...document.querySelectorAll("[data-region]")].filter(e => e.offsetParent || getComputedStyle(e).display !== "none").map(e => { const b = e.getBoundingClientRect(); return [e.getAttribute("data-region"), Math.round(b.top + scrollY), Math.round(b.height)]; }));
  log("regions top/height", JSON.stringify(regions));
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, L, "pipeline-toolbar-add-url");
  await btn.click();
  await page.waitForTimeout(400);
  await shoot(page, L, "url-modal-open");
  await page.fill("#pipeUrlModalInput", "https://boards.greenhouse.io/example/jobs/123");
  await page.click("[data-pipeline-url-submit]");
  await page.waitForTimeout(4000);
  log("url modal error", await page.evaluate(() => { const e = document.querySelector("[data-pipeline-url-error]"); return e && !e.hidden ? e.textContent : "(none)"; }));
  log("url modal progress", await page.evaluate(() => document.querySelector("[data-pipeline-url-progress-label]")?.textContent));
  log("toasts", JSON.stringify(await toasts(page)));
  await shoot(page, L, "url-modal-error");
  const axe = await runAxe(page, { include: "[data-pipeline-url-modal]" });
  log("axe url modal", JSON.stringify(axe));
  log("unexpected", JSON.stringify(app.unexpectedExternal));
  await app.close();
}
// ---- B: signed-in-empty welcome buttons
{
  const app = await openApp({ mode: "signed-in-empty", viewport: vp, settleMs: 3000 });
  const { page } = app;
  await shoot(page, L, "empty-welcome");
  const w = await page.evaluate(() => { const r = document.querySelector('[data-region="welcome"]'); return r ? [getComputedStyle(r).display, r.innerText.slice(0, 300)] : null; });
  log("welcome", JSON.stringify(w));
  const paste = page.locator(".jbw-empty__actions button", { hasText: "Paste a URL" });
  if (await paste.count()) {
    await paste.click();
    await page.waitForTimeout(600);
    log("after Paste a URL: active=", await page.evaluate(() => { const a = document.activeElement; return a.id + " visible=" + !!a.offsetParent; }), "urlModalOpen=", await page.evaluate(() => { const m = document.querySelector("[data-pipeline-url-modal]"); return m ? !m.hidden : "n/a"; }));
    await shoot(page, L, "empty-after-paste-click");
    const manual = page.locator(".jbw-empty__actions button", { hasText: "Add manually" });
    log("manual still visible?", await manual.count() ? await manual.isVisible() : "gone");
  }
  await app.close();
}
{
  const app = await openApp({ mode: "signed-in-empty", viewport: vp, settleMs: 3000 });
  const { page } = app;
  const manual = page.locator(".jbw-empty__actions button", { hasText: "Add manually" });
  if (await manual.count()) {
    await manual.click();
    await page.waitForTimeout(700);
    log("after Add manually: modal display=", await page.evaluate(() => { const m = document.getElementById("ingestManualModal"); return m ? getComputedStyle(m).display : "n/a"; }));
    await shoot(page, L, "empty-after-manual-click");
    const axe = await runAxe(page, { include: "#ingestManualModal" });
    log("axe manual", JSON.stringify(axe));
  }
  await app.close();
}
// ---- C: no-webhook stranger: clear webhook overrides
{
  const app = await openApp({ mode: "signed-in", viewport: vp });
  const { page } = app;
  await page.addInitScript(() => {
    const k = "command_center_config_overrides";
    const o = JSON.parse(localStorage.getItem(k) || "{}");
    delete o.discoveryWebhookUrl; delete o.discoveryWebhookSecret;
    localStorage.setItem(k, JSON.stringify(o));
    localStorage.removeItem("command_center_discovery_coach_done");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  log("nohook btn title", await page.getAttribute("#discoveryBtn", "title"));
  await page.click("#discoveryBtn");
  await page.waitForTimeout(1500);
  log("nohook chip", await page.textContent("#discoveryDrawerReadiness"));
  const coach = await page.evaluate(() => { const c = document.querySelector('[class*="coach"]:not(#discoveryDrawerCoachBtn)'); const vis = [...document.querySelectorAll('[class*="coachmark"]')].filter(e => e.offsetParent); return vis.map(e => e.className + ": " + e.innerText.replace(/\s+/g, " ").slice(0, 160)).slice(0, 3); });
  log("coach", JSON.stringify(coach));
  await shoot(page, L, "drawer-coach-step1");
  // dismiss coach
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const drawerOpen = await page.evaluate(() => !document.getElementById("discoveryDrawer").hidden);
  log("drawer open after Esc?", drawerOpen);
  if (!drawerOpen) { await page.click("#discoveryBtn"); await page.waitForTimeout(1200); }
  await page.fill("#dpTargetRoles", "Senior Product Designer");
  await page.click("#discoveryPrefsRun");
  await page.waitForTimeout(3000);
  const wiz = await page.evaluate(() => [...document.querySelectorAll(".discovery-setup-wizard-root, [role=dialog]")].filter(e => e.offsetParent && e.innerText.trim()).map(e => (e.id || e.className) + " :: " + e.innerText.replace(/\s+/g, " ").slice(0, 600)));
  log("after run (no hook)", JSON.stringify(wiz));
  log("toasts", JSON.stringify(await toasts(page)));
  await shoot(page, L, "nohook-run-setup-wizard");
  await shoot(page, L, "nohook-run-setup-wizard-full", { fullPage: true });
  const jargon = await page.evaluate(() => { const t = [...document.querySelectorAll(".discovery-setup-wizard-root")].map(e => e.innerText).join(" "); const words = ["webhook","tunnel","ngrok","Tailscale","relay","worker","secret","Cloudflare","localhost","8644","npm","terminal","endpoint","Apps Script","bootstrap","CORS"]; return Object.fromEntries(words.map(w => [w, (t.match(new RegExp(w, "gi")) || []).length])); });
  log("wizard jargon counts", JSON.stringify(jargon));
  await app.close();
}
